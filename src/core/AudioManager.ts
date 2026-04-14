// Gerenciamento de áudio e reprodução — com suporte a snapshot imutável

import { MAX_CHANNELS, type AudioChannel, type SequencerState } from '../types';
import { base64ToArrayBuffer } from '../utils/helpers';

export interface AudioSnapshot {
  step: number;
  pattern: boolean[][];
  channels: AudioChannel[];
  volumes: number[][];
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
  private bufferCache = new Map<string, AudioBuffer>();

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
    this.FADE_TIME = isMobile ? 0.012 : 0.005; // 12ms mobile, 5ms desktop
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

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;

    const gainNode = this.audioContext.createGain();
    const clampedVolume = Math.max(0, Math.min(4, volume)); // hard limit

    // Fade in suave para eliminar estalos
    gainNode.gain.setValueAtTime(0, time);
    gainNode.gain.linearRampToValueAtTime(clampedVolume, time + this.FADE_TIME);

    // Fade out no final do sample
    const duration = buffer.duration;
    if (duration > this.FADE_TIME * 3) {
      gainNode.gain.setValueAtTime(clampedVolume, time + duration - this.FADE_TIME);
      gainNode.gain.linearRampToValueAtTime(0, time + duration);
    }

    source.connect(gainNode);
    gainNode.connect(this.audioContext.destination);
    source.start(time);

    // Rastrear + safety cleanup (Chromium Android às vezes não dispara onended)
    const entry = { source, gain: gainNode };
    this.allNodes.add(entry);
    const nowMs = performance.now();
    const endMs = (time - this.audioContext.currentTime) * 1000 + duration * 1000 + 200;
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

    // Cortar sample anterior deste canal com fade-out rápido (evita estralo)
    const prev = this.activeSources.get(channel);
    if (prev) {
      try {
        // Cancelar qualquer rampa pendente e fazer fade-out rápido
        prev.gain.gain.cancelScheduledValues(time);
        prev.gain.gain.setValueAtTime(prev.gain.gain.value, time);
        prev.gain.gain.linearRampToValueAtTime(0, time + this.FADE_TIME);
        prev.source.stop(time + this.FADE_TIME + 0.001);
      } catch {
        // Source já parou naturalmente — ignorar
      }
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;

    const gainNode = this.audioContext.createGain();
    const clampedVolume = Math.max(0, Math.min(4, volume));

    // Fade in suave
    gainNode.gain.setValueAtTime(0, time);
    gainNode.gain.linearRampToValueAtTime(clampedVolume, time + this.FADE_TIME);

    // Fade out no final do sample
    const duration = buffer.duration;
    if (duration > this.FADE_TIME * 3) {
      gainNode.gain.setValueAtTime(clampedVolume, time + duration - this.FADE_TIME);
      gainNode.gain.linearRampToValueAtTime(0, time + duration);
    }

    source.connect(gainNode);
    gainNode.connect(this.audioContext.destination);
    source.start(time);

    const endTime = time + duration;

    // Rastrear como source ativo deste canal
    this.activeSources.set(channel, { source, gain: gainNode, endTime });

    // Rastrear + safety cleanup (idem playSound)
    const entry = { source, gain: gainNode };
    this.allNodes.add(entry);
    const endMs = (time - this.audioContext.currentTime) * 1000 + duration * 1000 + 200;
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
    const { step, pattern, channels, volumes, masterVolume } = snapshot;

    // Som de início de fill
    if (snapshot.shouldPlayStartSound && snapshot.fillStartBuffer) {
      this.playSound(snapshot.fillStartBuffer, time, masterVolume);
    }

    // Som de retorno do fill
    if (snapshot.shouldPlayReturnSound && snapshot.fillReturnBuffer) {
      this.playSound(snapshot.fillReturnBuffer, time, masterVolume);
    }

    // Sons dos canais ativos — com corte de sample anterior por canal
    for (let channel = 0; channel < MAX_CHANNELS; channel++) {
      if (!pattern[channel] || !pattern[channel][step]) continue;

      const buffer = channels[channel]?.buffer;
      if (!buffer) continue;

      const stepVolume = volumes[channel]?.[step] ?? 1.0;
      const finalVolume = stepVolume * masterVolume;

      if (finalVolume > 0) {
        this.playSoundOnChannel(channel, buffer, time, finalVolume);
      }
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
        entry.gain.gain.cancelScheduledValues(now);
        entry.gain.gain.setValueAtTime(entry.gain.gain.value, now);
        entry.gain.gain.linearRampToValueAtTime(0, now + fadeTime);
        entry.source.stop(now + fadeTime + 0.001);
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
