// ═════════════════════════════════════════════════════════════════════════
// WebAudioEngine — implementação web/PWA da IAudioEngine.
// ═════════════════════════════════════════════════════════════════════════
//
// FILOSOFIA: ZERO mudança comportamental. Esse arquivo é só um wrapper
// finíssimo em volta do AudioManager.ts atual (que continua existindo
// porque o NativeAudioEngine pode usar partes dele tipo bufferCache).
//
// Quando o usuário roda em web, PWA, ou Capacitor com flag `native` desativada,
// é ESTE engine que roda. Tudo igual ao antes da migração nativa.
//
// IMPORTANTE: Não toque na assinatura/comportamento dos métodos pra não
// regredir os fixes recentes (cancelAndHoldAtTime, DynamicsCompressor,
// fade-out garantido, etc).

import { AudioManager, type AudioSnapshot } from '../AudioManager';
import type { IAudioEngine, AudioEngineKind } from './IAudioEngine';

export class WebAudioEngine implements IAudioEngine {
  readonly kind: AudioEngineKind = 'web';
  private inner: AudioManager;

  constructor(audioContext: AudioContext) {
    this.inner = new AudioManager(audioContext);
  }

  /** Acesso ao AudioManager interno — usado pelo main.ts pra retrocompatibilidade
   *  durante a migração. Quando NativeAudioEngine estiver completo, esse getter
   *  deve sair (todo lugar deve usar IAudioEngine). */
  get raw(): AudioManager {
    return this.inner;
  }

  loadAudioFromPath(path: string): Promise<AudioBuffer> {
    return this.inner.loadAudioFromPath(path);
  }

  loadAudioFromFile(file: File): Promise<AudioBuffer> {
    return this.inner.loadAudioFromFile(file);
  }

  loadAudioFromBase64(base64: string): Promise<AudioBuffer> {
    return this.inner.loadAudioFromBase64(base64);
  }

  playSound(buffer: AudioBuffer, time: number, volume: number = 1.0): void {
    this.inner.playSound(buffer, time, volume);
  }

  scheduleStepFromSnapshot(snapshot: AudioSnapshot, time: number): void {
    this.inner.scheduleStepFromSnapshot(snapshot, time);
  }

  resume(): void {
    this.inner.resume();
  }

  getCurrentTime(): number {
    return this.inner.getCurrentTime();
  }

  getState(): string {
    return this.inner.getState();
  }

  fadeOutAllActive(fadeTime: number = 0.03): void {
    this.inner.fadeOutAllActive(fadeTime);
  }

  cancelAllScheduled(): void {
    this.inner.cancelAllScheduled();
  }
}
