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

export class AudioManager {
  private audioContext: AudioContext;
  private readonly FADE_TIME = 0.005; // 5ms fade — elimina cliques
  private bufferCache = new Map<string, AudioBuffer>();

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
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

    // Auto-cleanup: desconectar nodes após o sample terminar
    source.onended = () => {
      source.disconnect();
      gainNode.disconnect();
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

    // Sons dos canais ativos
    for (let channel = 0; channel < MAX_CHANNELS; channel++) {
      if (!pattern[channel] || !pattern[channel][step]) continue;

      const buffer = channels[channel]?.buffer;
      if (!buffer) continue;

      const stepVolume = volumes[channel]?.[step] ?? 1.0;
      const finalVolume = stepVolume * masterVolume;

      if (finalVolume > 0) {
        this.playSound(buffer, time, finalVolume);
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

  async resume(): Promise<void> {
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }
}
