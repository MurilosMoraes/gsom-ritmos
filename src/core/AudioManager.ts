// Gerenciamento de áudio e reprodução

import type { AudioChannel, PatternType, SequencerState } from '../types';
import { base64ToArrayBuffer } from '../utils/helpers';

export class AudioManager {
  private audioContext: AudioContext;

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
  }

  async loadAudioFromFile(file: File): Promise<AudioBuffer> {
    const arrayBuffer = await file.arrayBuffer();
    return await this.audioContext.decodeAudioData(arrayBuffer);
  }

  async loadAudioFromPath(path: string): Promise<AudioBuffer> {
    const response = await fetch(path);
    const arrayBuffer = await response.arrayBuffer();
    return await this.audioContext.decodeAudioData(arrayBuffer);
  }

  async loadAudioFromBase64(base64: string): Promise<AudioBuffer> {
    const arrayBuffer = base64ToArrayBuffer(base64);
    return await this.audioContext.decodeAudioData(arrayBuffer);
  }

  playSound(buffer: AudioBuffer, time: number, volume: number = 1.0): void {
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;

    const gainNode = this.audioContext.createGain();

    // Fade in/out suave para eliminar estalos (especialmente importante no Android)
    const fadeTime = 0.005; // 5ms de fade - imperceptível mas elimina cliques
    gainNode.gain.setValueAtTime(0, time);
    gainNode.gain.linearRampToValueAtTime(volume, time + fadeTime);

    // Fade out no final
    const duration = buffer.duration;
    if (duration > fadeTime * 2) {
      gainNode.gain.setValueAtTime(volume, time + duration - fadeTime);
      gainNode.gain.linearRampToValueAtTime(0, time + duration);
    }

    source.connect(gainNode);
    gainNode.connect(this.audioContext.destination);
    source.start(time);
  }

  scheduleStep(
    step: number,
    time: number,
    state: SequencerState
  ): void {
    const activePatternType = state.activePattern;
    const activePattern = state.patterns[activePatternType];
    const activeChannels = state.channels[activePatternType];
    const activeVolumes = state.volumes[activePatternType];
    const masterVolume = state.masterVolume;

    // Som de início
    if (step === 0 && state.shouldPlayStartSound && state.fillStartSound.buffer) {
      this.playSound(state.fillStartSound.buffer, time, masterVolume);
    }

    // Som de retorno
    if (step === 0 && state.shouldPlayReturnSound && state.fillReturnSound.buffer) {
      this.playSound(state.fillReturnSound.buffer, time, masterVolume);
    }

    // Sons dos canais ativos
    for (let channel = 0; channel < 8; channel++) {
      const buffer = activeChannels[channel].buffer;
      if (activePattern[channel][step] && buffer) {
        const volume = activeVolumes[channel][step] * masterVolume;
        this.playSound(buffer, time, volume);
      }
    }
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
