// ═════════════════════════════════════════════════════════════════════════
// GDrumsAudioEngineCore — engine de áudio nativo iOS.
// ═════════════════════════════════════════════════════════════════════════
//
// Filosofia: ZERO gap em background, sample-accurate scheduling, lockscreen
// integrado igual Spotify. AVAudioEngine + 12 AVAudioPlayerNode (1 por canal),
// scheduleBuffer(at:) com AVAudioTime em sample frames absolutos.
//
// Usado pelo GDrumsAudioEnginePlugin que expõe métodos pro JS via Capacitor.
// O TypeScript orquestra (carrega samples, dispara play, queueFill, etc),
// e o Swift roda o áudio sem nenhum intermediário do WebView.
//
// API exposta pro plugin:
// - initialize(sampleRate)       → prepara AVAudioEngine
// - loadSample(key, base64Pcm)   → cacheia AVAudioPCMBuffer pra esse key
// - anchorNow(leadInMs)          → marca tempo zero do sequenciador
// - scheduleSample(channel, key, offsetSec, volume) → agenda em hostTime+offset
// - cancelChannel(channel)       → cancela buffers futuros desse canal
// - cancelAll()                  → cancela tudo
// - setMasterVolume(vol)
// - currentTime() → segundos desde anchor

import AVFoundation

@objc public class GDrumsAudioEngineCore: NSObject {
    public static let shared = GDrumsAudioEngineCore()

    // ─── Estado do engine ─────────────────────────────────────────────────
    private let engine = AVAudioEngine()
    /// Pool de N players POR CANAL — round-robin pra evitar:
    /// - .interrupts cancelar samples futuros agendados (bug build 17)
    /// - acumular samples no mesmo player (bug build 18 — fila lota)
    /// Cada novo schedule pega próximo player do pool. 4 por canal aguenta
    /// até 4 samples sobrepostos por canal (mais que suficiente — bateria
    /// raramente toca >2 hits do mesmo canal sobrepostos).
    private var channelPlayers: [[AVAudioPlayerNode]] = []
    private var channelMixers: [AVAudioMixerNode] = []
    private var channelRoundRobin: [Int] = []
    private let channelCount = 12
    private let playersPerChannel = 4

    /// Cache de samples decodificados, indexado por key string (ex: "/midi/bumbo.wav")
    private var sampleCache: [String: AVAudioPCMBuffer] = [:]
    private let cacheQueue = DispatchQueue(label: "com.gdrums.audio.cache", attributes: .concurrent)

    /// Âncora de tempo: sampleTime quando deu play. Usado pra agendar offsets relativos.
    private var sequenceAnchor: AVAudioTime?

    /// Sample rate do output (descoberta dinâmica do device — geralmente 48000)
    private var outputSampleRate: Double = 48000

    /// Format usado nas connects (stereo float32 no sample rate do device).
    /// Buffers carregados são convertidos pra ESSE format. Mismatch = crash.
    private var engineFormat: AVAudioFormat?

    private var isStarted: Bool = false

    // ─── Lifecycle ────────────────────────────────────────────────────────

    /// Inicializa engine + cria 12 PlayerNodes. Chamado uma vez no boot do app.
    public func initialize() {
        guard !isStarted else { return }

        // Detecta sample rate real do device (pode ser 44.1k em alguns casos)
        let outputFormat = engine.outputNode.outputFormat(forBus: 0)
        outputSampleRate = outputFormat.sampleRate

        let mainMixer = engine.mainMixerNode

        // Format dos canais: STEREO float32 deinterleaved no sample rate do
        // device. Stereo (não mono) porque mixer pra destination espera
        // stereo — se conectar mono direto, mismatch = crash em scheduleBuffer.
        // Buffers carregados em loadSample são convertidos pra ESSE format.
        guard let playerFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: outputSampleRate,
            channels: 2,
            interleaved: false
        ) else {
            NSLog("[GDrumsAudioEngine] Format inválido — abortando init")
            return
        }
        self.engineFormat = playerFormat

        // Cria N players por canal — todos conectados no MESMO mixer
        // do canal (volume per-channel preservado).
        for _ in 0..<channelCount {
            let mixer = AVAudioMixerNode()
            engine.attach(mixer)
            engine.connect(mixer, to: mainMixer, format: playerFormat)

            var pool: [AVAudioPlayerNode] = []
            for _ in 0..<playersPerChannel {
                let player = AVAudioPlayerNode()
                engine.attach(player)
                engine.connect(player, to: mixer, format: playerFormat)
                pool.append(player)
            }
            channelPlayers.append(pool)
            channelMixers.append(mixer)
            channelRoundRobin.append(0)
        }

        do {
            try engine.start()
            for pool in channelPlayers {
                for player in pool { player.play() }
            }
            isStarted = true
            NSLog("[GDrumsAudioEngine] Started @ \(outputSampleRate)Hz, \(channelCount)x\(playersPerChannel) players (stereo float32)")
        } catch {
            NSLog("[GDrumsAudioEngine] Start failed: \(error)")
        }
    }

    /// Para o engine completamente (raro — geralmente só pra cleanup).
    public func shutdown() {
        guard isStarted else { return }
        for pool in channelPlayers {
            for player in pool { player.stop() }
        }
        engine.stop()
        channelPlayers.removeAll()
        channelMixers.removeAll()
        channelRoundRobin.removeAll()
        isStarted = false
    }

    // ─── Sample loading ────────────────────────────────────────────────────

    /// Carrega WAV/MP3 de um path do bundle iOS, decodifica e cacheia.
    /// Caminho típico: "public/midi-native/bumbo.wav" ou "public/midi-native/Bloco 1.wav".
    ///
    /// Bundle.main.path(forResource:ofType:inDirectory:) é INSTÁVEL com:
    /// - nomes com espaço ("Bloco 1.wav")
    /// - subdiretórios profundos
    /// Solução: construir URL direta de bundleURL + appendingPathComponent.
    @discardableResult
    public func loadSample(key: String, bundlePath: String) -> Bool {
        // Tenta caminho direto primeiro (URL construído manualmente)
        let directURL = Bundle.main.bundleURL.appendingPathComponent(bundlePath)
        if FileManager.default.fileExists(atPath: directURL.path) {
            return loadSampleFromFileURL(key: key, url: directURL)
        }

        // Fallback: Bundle.main.path() (jeito antigo, falha com espaços)
        let parts = (bundlePath as NSString).pathComponents
        let filename = (parts.last ?? "") as NSString
        let name = filename.deletingPathExtension
        let ext = filename.pathExtension
        let directory = parts.dropLast().joined(separator: "/")
        if let path = Bundle.main.path(forResource: name, ofType: ext, inDirectory: directory) {
            return loadSampleFromFileURL(key: key, url: URL(fileURLWithPath: path))
        }

        NSLog("[GDrumsAudioEngine] Sample NÃO encontrado: \(bundlePath) (testou: \(directURL.path))")
        return false
    }

    /// Carrega de URL do filesystem. Usado pra samples baixados ou base64 decodificados.
    @discardableResult
    public func loadSampleFromFileURL(key: String, url: URL) -> Bool {
        guard let targetFormat = engineFormat else {
            NSLog("[GDrumsAudioEngine] engineFormat não inicializado — initialize() não foi chamado?")
            return false
        }
        do {
            let file = try AVAudioFile(forReading: url)
            // Lê tudo pra buffer no formato do arquivo
            guard let srcBuffer = AVAudioPCMBuffer(
                pcmFormat: file.processingFormat,
                frameCapacity: AVAudioFrameCount(file.length)
            ) else { return false }
            try file.read(into: srcBuffer)

            // ALVO: STEREO float32 no sample rate do device. MESMO format
            // que conectei o player no engine. Se conectar player com format
            // X e dar scheduleBuffer com format Y = NSException = crash.
            // Samples mono no source viram stereo aqui (canal duplicado).

            let finalBuffer: AVAudioPCMBuffer
            if file.processingFormat.sampleRate == targetFormat.sampleRate
               && file.processingFormat.channelCount == targetFormat.channelCount
               && file.processingFormat.commonFormat == targetFormat.commonFormat
               && file.processingFormat.isInterleaved == targetFormat.isInterleaved {
                finalBuffer = srcBuffer
            } else {
                guard let converter = AVAudioConverter(from: file.processingFormat, to: targetFormat) else {
                    NSLog("[GDrumsAudioEngine] AVAudioConverter falhou de \(file.processingFormat) pra \(targetFormat)")
                    return false
                }
                let ratio = targetFormat.sampleRate / file.processingFormat.sampleRate
                let outCapacity = AVAudioFrameCount(Double(srcBuffer.frameLength) * ratio + 1024)
                guard let outBuffer = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: outCapacity) else {
                    return false
                }

                var error: NSError?
                var consumed = false
                let inputBlock: AVAudioConverterInputBlock = { _, status in
                    if consumed { status.pointee = .endOfStream; return nil }
                    consumed = true
                    status.pointee = .haveData
                    return srcBuffer
                }
                converter.convert(to: outBuffer, error: &error, withInputFrom: inputBlock)
                if let e = error {
                    NSLog("[GDrumsAudioEngine] convert erro: \(e)")
                    return false
                }
                finalBuffer = outBuffer
            }

            cacheQueue.async(flags: .barrier) {
                self.sampleCache[key] = finalBuffer
            }
            return true
        } catch {
            NSLog("[GDrumsAudioEngine] loadSampleFromFileURL falhou: \(error)")
            return false
        }
    }

    /// True se o sample já foi carregado e cacheado.
    public func isSampleLoaded(key: String) -> Bool {
        var loaded = false
        cacheQueue.sync { loaded = self.sampleCache[key] != nil }
        return loaded
    }

    // ─── Scheduling ────────────────────────────────────────────────────────

    /// Marca o "tempo zero" do sequenciador. Tudo que for agendado depois é
    /// relativo a esse instante. leadInMs adiciona margem pra primeiro sample
    /// não cair no passado.
    public func anchorNow(leadInMs: Double = 50) {
        guard isStarted else { return }
        let now = engine.outputNode.lastRenderTime ?? AVAudioTime(hostTime: mach_absolute_time())
        let leadFrames = AVAudioFramePosition(leadInMs / 1000.0 * outputSampleRate)
        let anchorSampleTime = (now.isSampleTimeValid ? now.sampleTime : 0) + leadFrames
        sequenceAnchor = AVAudioTime(sampleTime: anchorSampleTime, atRate: outputSampleRate)
    }

    /// Agenda um sample no canal pra tocar `offsetSeconds` no FUTURO a partir
    /// de AGORA (clock nativo). Sample-accurate via AVAudioTime calculado
    /// dinamicamente com lastRenderTime + offset.
    ///
    /// Decisão arquitetural: NÃO usa âncora persistente entre chamadas.
    /// Clock JS (audioContext) é independente do clock nativo, então âncora
    /// única no início ficava desincronizada. Cada scheduleSample agora é
    /// auto-contido — JS calcula "quanto tempo no futuro" e nativo agenda
    /// nesse tempo relativo ao seu próprio "agora".
    /// Pega próximo player do pool em round-robin pro canal.
    /// Cada chamada retorna um player diferente (cíclico).
    private func nextPlayer(for channel: Int) -> AVAudioPlayerNode? {
        guard channel >= 0, channel < channelCount else { return nil }
        let pool = channelPlayers[channel]
        guard !pool.isEmpty else { return nil }
        let idx = channelRoundRobin[channel] % pool.count
        channelRoundRobin[channel] = (channelRoundRobin[channel] + 1) % pool.count
        return pool[idx]
    }

    public func scheduleSample(channel: Int, sampleKey: String, offsetSeconds: Double, volume: Float) {
        guard isStarted, channel >= 0, channel < channelCount else { return }

        var buffer: AVAudioPCMBuffer?
        cacheQueue.sync { buffer = self.sampleCache[sampleKey] }
        guard let buf = buffer else {
            NSLog("[GDrumsAudioEngine] Sample não carregado: \(sampleKey)")
            return
        }

        if let expected = engineFormat,
           buf.format.commonFormat != expected.commonFormat
           || buf.format.sampleRate != expected.sampleRate
           || buf.format.channelCount != expected.channelCount {
            NSLog("[GDrumsAudioEngine] Format mismatch p/ \(sampleKey)")
            return
        }

        // Pega próximo player do pool — round-robin evita sobreposição
        // no mesmo node (que ou seria cancelada com .interrupts ou
        // enfileirada sem respeitar `at:` sem .interrupts).
        guard let player = nextPlayer(for: channel) else { return }
        guard player.engine != nil else { return }
        if !player.isPlaying { player.play() }

        guard offsetSeconds >= 0 else { return }
        channelMixers[channel].outputVolume = max(0, min(4, volume))

        guard let now = engine.outputNode.lastRenderTime, now.isSampleTimeValid else {
            player.scheduleBuffer(buf, at: nil, options: [], completionHandler: nil)
            return
        }
        let offsetFrames = AVAudioFramePosition(offsetSeconds * outputSampleRate)
        let targetSampleTime = now.sampleTime + offsetFrames
        let when = AVAudioTime(sampleTime: targetSampleTime, atRate: outputSampleRate)
        player.scheduleBuffer(buf, at: when, options: [], completionHandler: nil)
    }

    /// One-shot imediato (sem âncora) — usado pra prato/feedback.
    public func playOneShotImmediate(channel: Int, sampleKey: String, volume: Float) {
        guard isStarted, channel >= 0, channel < channelCount else { return }
        var buffer: AVAudioPCMBuffer?
        cacheQueue.sync { buffer = self.sampleCache[sampleKey] }
        guard let buf = buffer else { return }
        if let expected = engineFormat,
           buf.format.commonFormat != expected.commonFormat
           || buf.format.sampleRate != expected.sampleRate
           || buf.format.channelCount != expected.channelCount {
            NSLog("[GDrumsAudioEngine] one-shot format mismatch \(sampleKey)")
            return
        }
        guard let player = nextPlayer(for: channel) else { return }
        guard player.engine != nil else { return }
        if !player.isPlaying { player.play() }
        channelMixers[channel].outputVolume = max(0, min(4, volume))
        player.scheduleBuffer(buf, at: nil, options: [], completionHandler: nil)
    }

    /// Cancela TODOS os buffers agendados nesse canal (pedal aciona fill).
    public func cancelChannel(_ channel: Int) {
        guard isStarted, channel >= 0, channel < channelCount else { return }
        // stop() cancela tudo no player. play() reativa pra próximos schedules.
        for player in channelPlayers[channel] {
            player.stop()
            player.play()
        }
    }

    /// Cancela TUDO em todos os canais (transição grande, parar de vez).
    public func cancelAll() {
        guard isStarted else { return }
        for pool in channelPlayers {
            for player in pool {
                player.stop()
                player.play()
            }
        }
    }

    // ─── Volume / utilities ────────────────────────────────────────────────

    public func setMasterVolume(_ volume: Float) {
        engine.mainMixerNode.outputVolume = max(0, min(2, volume))
    }

    /// Tempo atual desde o anchor, em segundos. -1 se sem âncora.
    public func currentTimeSinceAnchor() -> Double {
        guard let anchor = sequenceAnchor,
              let now = engine.outputNode.lastRenderTime,
              now.isSampleTimeValid else { return -1 }
        return Double(now.sampleTime - anchor.sampleTime) / outputSampleRate
    }

    public var ready: Bool { isStarted }
    public var sampleRate: Double { outputSampleRate }
}
