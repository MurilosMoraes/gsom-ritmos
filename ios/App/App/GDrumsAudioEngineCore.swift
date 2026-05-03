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
    private var channelPlayers: [AVAudioPlayerNode] = []
    private var channelMixers: [AVAudioMixerNode] = []
    private let channelCount = 12

    /// Cache de samples decodificados, indexado por key string (ex: "/midi/bumbo.wav")
    private var sampleCache: [String: AVAudioPCMBuffer] = [:]
    private let cacheQueue = DispatchQueue(label: "com.gdrums.audio.cache", attributes: .concurrent)

    /// Âncora de tempo: sampleTime quando deu play. Usado pra agendar offsets relativos.
    private var sequenceAnchor: AVAudioTime?

    /// Sample rate do output (descoberta dinâmica do device — geralmente 48000)
    private var outputSampleRate: Double = 48000

    private var isStarted: Bool = false

    // ─── Lifecycle ────────────────────────────────────────────────────────

    /// Inicializa engine + cria 12 PlayerNodes. Chamado uma vez no boot do app.
    public func initialize() {
        guard !isStarted else { return }

        // Detecta sample rate real do device (pode ser 44.1k em alguns casos)
        let outputFormat = engine.outputNode.outputFormat(forBus: 0)
        outputSampleRate = outputFormat.sampleRate

        let mainMixer = engine.mainMixerNode

        // Cria 12 canais — cada um tem player + mixer próprio (volume per-channel)
        for _ in 0..<channelCount {
            let player = AVAudioPlayerNode()
            let mixer = AVAudioMixerNode()
            engine.attach(player)
            engine.attach(mixer)
            // Conecta player → mixer → mainMixer. Format nil deixa o engine decidir.
            engine.connect(player, to: mixer, format: nil)
            engine.connect(mixer, to: mainMixer, format: nil)
            channelPlayers.append(player)
            channelMixers.append(mixer)
        }

        do {
            try engine.start()
            // Pre-roll: cada player precisa de play() antes de aceitar scheduleBuffer
            for player in channelPlayers {
                player.play()
            }
            isStarted = true
            NSLog("[GDrumsAudioEngine] Started @ \(outputSampleRate)Hz, \(channelCount) channels")
        } catch {
            NSLog("[GDrumsAudioEngine] Start failed: \(error)")
        }
    }

    /// Para o engine completamente (raro — geralmente só pra cleanup).
    public func shutdown() {
        guard isStarted else { return }
        for player in channelPlayers { player.stop() }
        engine.stop()
        channelPlayers.removeAll()
        channelMixers.removeAll()
        isStarted = false
    }

    // ─── Sample loading ────────────────────────────────────────────────────

    /// Carrega WAV/MP3 de um path do bundle iOS, decodifica e cacheia.
    /// Caminho típico: "public/midi/bumbo.wav" (Capacitor copia /public pra App.app).
    @discardableResult
    public func loadSample(key: String, bundlePath: String) -> Bool {
        // Resolve path no bundle
        let parts = (bundlePath as NSString).pathComponents
        let filename = (parts.last ?? "") as NSString
        let name = filename.deletingPathExtension
        let ext = filename.pathExtension
        let directory = parts.dropLast().joined(separator: "/")

        guard let path = Bundle.main.path(forResource: name, ofType: ext, inDirectory: directory) else {
            NSLog("[GDrumsAudioEngine] Sample não encontrado no bundle: \(bundlePath)")
            return false
        }
        return loadSampleFromFileURL(key: key, url: URL(fileURLWithPath: path))
    }

    /// Carrega de URL do filesystem. Usado pra samples baixados ou base64 decodificados.
    @discardableResult
    public func loadSampleFromFileURL(key: String, url: URL) -> Bool {
        do {
            let file = try AVAudioFile(forReading: url)
            // Lê tudo pra buffer no formato do arquivo
            guard let srcBuffer = AVAudioPCMBuffer(
                pcmFormat: file.processingFormat,
                frameCapacity: AVAudioFrameCount(file.length)
            ) else { return false }
            try file.read(into: srcBuffer)

            // Converte pro formato preferido do engine (sample rate do output, mono)
            let targetFormat = AVAudioFormat(
                commonFormat: .pcmFormatFloat32,
                sampleRate: outputSampleRate,
                channels: 1,
                interleaved: false
            )!

            let finalBuffer: AVAudioPCMBuffer
            if file.processingFormat.sampleRate == outputSampleRate
               && file.processingFormat.channelCount == 1
               && file.processingFormat.commonFormat == .pcmFormatFloat32 {
                finalBuffer = srcBuffer
            } else {
                // Resample + downmix
                guard let converter = AVAudioConverter(from: file.processingFormat, to: targetFormat) else {
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
                if error != nil { return false }
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

    /// Agenda um sample no canal indicado pra tocar offsetSeconds APÓS a âncora.
    /// Sample-accurate — o AVAudioTime é em sampleTime absoluto do engine.
    public func scheduleSample(channel: Int, sampleKey: String, offsetSeconds: Double, volume: Float) {
        guard isStarted, channel >= 0, channel < channelCount else { return }
        guard let anchor = sequenceAnchor else {
            // Sem âncora ainda — toca imediatamente (one-shot fora do sequenciador)
            playOneShotImmediate(channel: channel, sampleKey: sampleKey, volume: volume)
            return
        }
        var buffer: AVAudioPCMBuffer?
        cacheQueue.sync { buffer = self.sampleCache[sampleKey] }
        guard let buf = buffer else {
            NSLog("[GDrumsAudioEngine] Sample não carregado: \(sampleKey)")
            return
        }

        let offsetFrames = AVAudioFramePosition(offsetSeconds * outputSampleRate)
        let when = AVAudioTime(
            sampleTime: anchor.sampleTime + offsetFrames,
            atRate: outputSampleRate
        )

        // Volume por canal — atualiza ANTES de scheduleBuffer
        channelMixers[channel].outputVolume = max(0, min(4, volume))

        // .interrupts = corta sample anterior do MESMO player (1 player por canal,
        // então corta SÓ esse canal, não os outros). Equivalente ao "corte de
        // sample anterior por canal com fade" do AudioManager.ts.
        channelPlayers[channel].scheduleBuffer(buf, at: when, options: [.interrupts], completionHandler: nil)
    }

    /// One-shot imediato (sem âncora) — usado pra prato/feedback.
    public func playOneShotImmediate(channel: Int, sampleKey: String, volume: Float) {
        guard isStarted, channel >= 0, channel < channelCount else { return }
        var buffer: AVAudioPCMBuffer?
        cacheQueue.sync { buffer = self.sampleCache[sampleKey] }
        guard let buf = buffer else { return }
        channelMixers[channel].outputVolume = max(0, min(4, volume))
        channelPlayers[channel].scheduleBuffer(buf, at: nil, options: [.interrupts], completionHandler: nil)
    }

    /// Cancela TODOS os buffers agendados nesse canal (pedal aciona fill).
    public func cancelChannel(_ channel: Int) {
        guard isStarted, channel >= 0, channel < channelCount else { return }
        // stop() cancela tudo. play() reativa pra próximos schedules.
        channelPlayers[channel].stop()
        channelPlayers[channel].play()
    }

    /// Cancela TUDO em todos os canais (transição grande, parar de vez).
    public func cancelAll() {
        guard isStarted else { return }
        for player in channelPlayers {
            player.stop()
            player.play()
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
