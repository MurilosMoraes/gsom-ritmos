// Gerenciamento de áudio e reprodução — com suporte a snapshot imutável

import { MAX_CHANNELS, type AudioChannel, type SequencerState } from '../types';
import { base64ToArrayBuffer } from '../utils/helpers';

export interface AudioSnapshot {
  step: number;
  pattern: boolean[][];
  channels: AudioChannel[];
  volumes: number[][];
  offsets?: number[][]; // -0.5 a +0.5 por célula (fração da duração do step)
  stepDuration?: number; // segundos por step — necessário pra aplicar offset
  masterVolume: number;
  shouldPlayStartSound: boolean;
  shouldPlayReturnSound: boolean;
  fillStartBuffer: AudioBuffer | null;
  fillReturnBuffer: AudioBuffer | null;
}

interface ActiveSource {
  source: AudioBufferSourceNode;
  gain: GainNode;
  endTime: number; // quando o sample termina naturalmente
}

export class AudioManager {
  private audioContext: AudioContext;
  private readonly FADE_TIME: number;
  // Margem mínima entre currentTime e qualquer time agendado.
  // Spec do Web Audio: rampa "no passado" vira step function = clique.
  // 20ms cobre jitter normal de JS thread (GC, render) sem audível atraso.
  private readonly SAFE_MARGIN = 0.020;
  private bufferCache = new Map<string, AudioBuffer>();
  // Master node — DynamicsCompressor previne clipping na soma de canais.
  // Sem isso, masterVolume * stepVolume * múltiplos canais podia somar > 1.0
  // → clipping digital → harmônicos altos = clique perceptual aleatório.
  private masterCompressor: DynamicsCompressorNode;

  // Rastrear source ativo por canal para cortar sample anterior sem estralo
  private activeSources = new Map<number, ActiveSource>();

  // ✱ Rastrear TODOS os nodes criados (source + gain) pra cleanup forçado.
  //   Chromium Android tem bug conhecido onde onended não dispara em sources
  //   encerrados via stop() manual — GainNodes ficam pendurados com tail-time
  //   reference e acumulam memória. Timeout de segurança garante disconnect.
  //   Ref: https://issues.chromium.org/issues/41042431
  private allNodes = new Set<{ source: AudioBufferSourceNode; gain: GainNode }>();

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
    // Mobile (PWA ou Capacitor) precisa de fade maior pra evitar estralos nas transições
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    this.FADE_TIME = isMobile ? 0.020 : 0.008; // 20ms mobile, 8ms desktop (era 12/5)

    // Master compressor: protege contra clipping no destino. Knee suave +
    // ratio moderado pra ser inaudível em uso normal mas pegar peaks.
    this.masterCompressor = audioContext.createDynamicsCompressor();
    this.masterCompressor.threshold.value = -3;
    this.masterCompressor.knee.value = 6;
    this.masterCompressor.ratio.value = 4;
    this.masterCompressor.attack.value = 0.003;
    this.masterCompressor.release.value = 0.1;
    this.masterCompressor.connect(audioContext.destination);
  }

  /**
   * Cancelamento robusto de rampa em curso num AudioParam.
   * cancelScheduledValues + setValueAtTime(.value) tem race condition:
   * .value é lido no JS thread, pode estar dessincronizado do audio thread.
   * cancelAndHoldAtTime "congela" o valor exato no time alvo no próprio
   * audio thread — atômico, sem race. Disponível em todos os browsers
   * modernos; fallback pro padrão antigo se não suportado.
   */
  private cancelAndHold(param: AudioParam, time: number): void {
    if (typeof (param as any).cancelAndHoldAtTime === 'function') {
      (param as any).cancelAndHoldAtTime(time);
    } else {
      param.cancelScheduledValues(time);
      param.setValueAtTime(param.value, time);
    }
  }

  /**
   * Garante que o time agendado NUNCA fica no passado.
   * Web Audio: rampas com time <= currentTime viram step function = clique.
   */
  private safeTime(time: number): number {
    const minTime = this.audioContext.currentTime + this.SAFE_MARGIN;
    return time < minTime ? minTime : time;
  }

  /**
   * Cleanup forçado de nodes que não dispararam onended.
   * Chamado em timeout após endTime estimado. Safety net pro bug do Chromium.
   */
  private forceCleanup(entry: { source: AudioBufferSourceNode; gain: GainNode }): void {
    if (!this.allNodes.has(entry)) return; // onended já limpou
    try { entry.source.disconnect(); } catch {}
    try { entry.gain.disconnect(); } catch {}
    this.allNodes.delete(entry);
  }

  async loadAudioFromFile(file: File): Promise<AudioBuffer> {
    const arrayBuffer = await file.arrayBuffer();
    return await this.audioContext.decodeAudioData(arrayBuffer);
  }

  async loadAudioFromPath(path: string): Promise<AudioBuffer> {
    // Cache por path normalizado (sem query params)
    const cacheKey = path.split('?')[0];
    const cached = this.bufferCache.get(cacheKey);
    if (cached) return cached;

    const response = await fetch(path);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = await this.audioContext.decodeAudioData(arrayBuffer);
    this.bufferCache.set(cacheKey, buffer);
    return buffer;
  }

  async loadAudioFromBase64(base64: string): Promise<AudioBuffer> {
    const arrayBuffer = base64ToArrayBuffer(base64);
    return await this.audioContext.decodeAudioData(arrayBuffer);
  }

  playSound(buffer: AudioBuffer, time: number, volume: number = 1.0): void {
    if (!buffer || volume <= 0) return;

    const safeStart = this.safeTime(time);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;

    const gainNode = this.audioContext.createGain();
    const clampedVolume = Math.max(0, Math.min(4, volume)); // hard limit

    // Warmup: valor síncrono ANTES de qualquer rampa elimina race entre
    // valor "default 1" do GainNode e a rampa começando em 0.
    gainNode.gain.value = 0;
    gainNode.gain.setValueAtTime(0, safeStart);
    gainNode.gain.linearRampToValueAtTime(clampedVolume, safeStart + this.FADE_TIME);

    // Fade out SEMPRE — mesmo em samples curtos. Antes só fadeava se
    // duration > FADE*3, samples curtos terminavam abruptos = clique.
    // Agora pega o menor entre FADE_TIME e 20% da duração.
    const duration = buffer.duration;
    const fadeOutDur = Math.min(this.FADE_TIME, duration * 0.2);
    if (fadeOutDur > 0.001) {
      gainNode.gain.setValueAtTime(clampedVolume, safeStart + duration - fadeOutDur);
      gainNode.gain.linearRampToValueAtTime(0, safeStart + duration);
    }

    source.connect(gainNode);
    gainNode.connect(this.masterCompressor);
    source.start(safeStart);

    // Rastrear + safety cleanup (Chromium Android às vezes não dispara onended)
    const entry = { source, gain: gainNode };
    this.allNodes.add(entry);
    const nowMs = performance.now();
    const endMs = (safeStart - this.audioContext.currentTime) * 1000 + duration * 1000 + 200;
    const safetyDelay = Math.max(100, endMs - (performance.now() - nowMs));
    setTimeout(() => this.forceCleanup(entry), safetyDelay);

    // Auto-cleanup: desconectar nodes após o sample terminar
    source.onended = () => {
      try { source.disconnect(); } catch {}
      try { gainNode.disconnect(); } catch {}
      this.allNodes.delete(entry);
    };
  }

  // ─── Play com corte do sample anterior no mesmo canal ─────────────

  private playSoundOnChannel(channel: number, buffer: AudioBuffer, time: number, volume: number): void {
    if (!buffer || volume <= 0) return;

    const safeStart = this.safeTime(time);

    // Cortar sample anterior deste canal com fade-out rápido (evita estralo).
    // cancelAndHoldAtTime resolve race condition do cancelScheduledValues +
    // setValueAtTime(.value): .value lido em JS thread vs audio thread podia
    // estar dessincronizado, gerando "fade de 0 pra 0" sem efeito real,
    // depois corte abrupto do source.stop() = clique audível clássico.
    const prev = this.activeSources.get(channel);
    if (prev) {
      try {
        this.cancelAndHold(prev.gain.gain, safeStart);
        prev.gain.gain.linearRampToValueAtTime(0, safeStart + this.FADE_TIME);
        prev.source.stop(safeStart + this.FADE_TIME + 0.005);
      } catch {
        // Source já parou naturalmente — ignorar
      }
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;

    const gainNode = this.audioContext.createGain();
    const clampedVolume = Math.max(0, Math.min(4, volume));

    // Warmup síncrono ANTES da rampa
    gainNode.gain.value = 0;
    gainNode.gain.setValueAtTime(0, safeStart);
    gainNode.gain.linearRampToValueAtTime(clampedVolume, safeStart + this.FADE_TIME);

    // Fade out SEMPRE — mesmo em samples curtos
    const duration = buffer.duration;
    const fadeOutDur = Math.min(this.FADE_TIME, duration * 0.2);
    if (fadeOutDur > 0.001) {
      gainNode.gain.setValueAtTime(clampedVolume, safeStart + duration - fadeOutDur);
      gainNode.gain.linearRampToValueAtTime(0, safeStart + duration);
    }

    source.connect(gainNode);
    gainNode.connect(this.masterCompressor);
    source.start(safeStart);

    const endTime = safeStart + duration;

    // Rastrear como source ativo deste canal
    this.activeSources.set(channel, { source, gain: gainNode, endTime });

    // Rastrear + safety cleanup (idem playSound)
    const entry = { source, gain: gainNode };
    this.allNodes.add(entry);
    const endMs = (safeStart - this.audioContext.currentTime) * 1000 + duration * 1000 + 200;
    setTimeout(() => this.forceCleanup(entry), Math.max(100, endMs));

    // Auto-cleanup
    source.onended = () => {
      try { source.disconnect(); } catch {}
      try { gainNode.disconnect(); } catch {}
      this.allNodes.delete(entry);
      // Só limpar do map se ainda for o source atual (não foi substituído)
      const current = this.activeSources.get(channel);
      if (current && current.source === source) {
        this.activeSources.delete(channel);
      }
    };
  }

  // ─── Método principal: agenda step a partir de snapshot imutável ────

  scheduleStepFromSnapshot(snapshot: AudioSnapshot, time: number): void {
    const { step, pattern, channels, volumes, masterVolume, offsets, stepDuration } = snapshot;

    // Som de início de fill
    if (snapshot.shouldPlayStartSound && snapshot.fillStartBuffer) {
      this.playSound(snapshot.fillStartBuffer, time, masterVolume);
    }

    // Som de retorno do fill
    if (snapshot.shouldPlayReturnSound && snapshot.fillReturnBuffer) {
      this.playSound(snapshot.fillReturnBuffer, time, masterVolume);
    }

    // Sons dos canais ativos — com corte de sample anterior por canal
    const audioNow = this.audioContext.currentTime;
    for (let channel = 0; channel < MAX_CHANNELS; channel++) {
      if (!pattern[channel] || !pattern[channel][step]) continue;

      const buffer = channels[channel]?.buffer;
      if (!buffer) continue;

      const stepVolume = volumes[channel]?.[step] ?? 1.0;
      const finalVolume = stepVolume * masterVolume;

      if (finalVolume <= 0) continue;

      // Aplicar offset da célula (se existir): -0.5 = meio step antes, +0.5 = meio step depois
      let cellTime = time;
      const cellOffset = offsets?.[channel]?.[step];
      if (cellOffset && stepDuration && stepDuration > 0) {
        const clamped = Math.max(-0.5, Math.min(0.5, cellOffset));
        cellTime = time + clamped * stepDuration;
        // Safety: nunca agendar no passado (offset negativo grande + lookahead curto)
        if (cellTime < audioNow + 0.005) cellTime = audioNow + 0.005;
      }

      this.playSoundOnChannel(channel, buffer, cellTime, finalVolume);
    }
  }

  // ─── Método legado para compatibilidade (usado no test mode, cymbal, etc) ──

  scheduleStep(step: number, time: number, state: SequencerState): void {
    const activePatternType = state.activePattern;
    const snapshot: AudioSnapshot = {
      step,
      pattern: state.patterns[activePatternType],
      channels: state.channels[activePatternType],
      volumes: state.volumes[activePatternType],
      masterVolume: state.masterVolume,
      shouldPlayStartSound: step === 0 && state.shouldPlayStartSound,
      shouldPlayReturnSound: step === 0 && state.shouldPlayReturnSound,
      fillStartBuffer: state.fillStartSound.buffer,
      fillReturnBuffer: state.fillReturnSound.buffer
    };
    this.scheduleStepFromSnapshot(snapshot, time);
  }

  getCurrentTime(): number {
    return this.audioContext.currentTime;
  }

  resume(): void {
    // Chamar resume() sincronamente — no iOS, qualquer await antes quebra
    // a cadeia de gesto do usuário e o áudio fica mudo permanentemente.
    // audioContext.resume() retorna Promise mas a chamada síncrona já
    // é suficiente para desbloquear o contexto dentro do gesto.
    //
    // Também tratar 'interrupted' — estado específico do iOS quando o app
    // é minimizado ou tem interrupção externa (ligação, etc).
    // Ref: https://github.com/Tonejs/Tone.js/issues/767
    const state = this.audioContext.state as string;
    if (state === 'suspended' || state === 'interrupted') {
      this.audioContext.resume();
    }
  }

  /**
   * Fade-out controlado em TODOS os sources ativos no momento.
   * Chamado antes de transições onde deixar samples morrerem sozinhos causa
   * estralos (minimizar no Android, trocar de ritmo bruscamente).
   *
   * Não para o scheduler. Não para o state.isPlaying. Apenas aplica fade-out
   * suave aos sources que já estão soando, pra que quando o próximo step
   * chegar não tenha sobreposição com samples antigos decaindo naturalmente.
   *
   * @param fadeTime tempo do fade em segundos (default 30ms — audível mas curto)
   */
  fadeOutAllActive(fadeTime: number = 0.03): void {
    const now = this.audioContext.currentTime;
    this.activeSources.forEach((entry) => {
      try {
        this.cancelAndHold(entry.gain.gain, now);
        entry.gain.gain.linearRampToValueAtTime(0, now + fadeTime);
        entry.source.stop(now + fadeTime + 0.005);
      } catch {
        // source já parou ou foi descartado
      }
    });
    this.activeSources.clear();
  }

  /**
   * Retorna o estado atual do AudioContext — usado em debug e fallbacks.
   * iOS tem estado 'interrupted' não-padrão que o TypeScript não conhece.
   */
  getState(): string {
    return this.audioContext.state as string;
  }
}
