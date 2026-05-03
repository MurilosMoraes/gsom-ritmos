// ═════════════════════════════════════════════════════════════════════════
// NativeAudioEngine — wrapper TypeScript que orquestra o plugin Capacitor
// nativo (iOS Swift AVAudioEngine / Android Kotlin AudioTrack/Oboe).
// ═════════════════════════════════════════════════════════════════════════
//
// IMPORTANTE: esse engine NÃO substitui Web Audio API completamente — ele
// COEXISTE. O AudioContext continua existindo pra:
// - Decodificar samples (WebAudio decodeAudioData → passa PCM pro nativo)
// - Fallback automático se o plugin nativo falhar/não carregar
// - Compatibilidade com código que ainda espera AudioBuffer (loadAudioFromFile etc)
//
// O que muda: o SCHEDULING e PLAYBACK saem do Web Audio e vão pro nativo.
// AudioContext fica só pra decoding e fallback.
//
// Estado atual (Fase 0): wrapper apenas valida que o plugin existe. Toda
// chamada de scheduling cai no fallback WebAudio. Próximas fases vão
// progressivamente mover scheduling/playback pro nativo.

import { Capacitor, registerPlugin } from '@capacitor/core';
import type { IAudioEngine, AudioEngineKind } from './IAudioEngine';
import type { AudioSnapshot } from '../AudioManager';
import { WebAudioEngine } from './WebAudioEngine';

// Interface do plugin nativo (Swift/Kotlin implementam isso).
// Fase 0: só ping(). Próximas fases adicionam loadSample/scheduleSample/etc.
interface GDrumsAudioEnginePlugin {
  /** Sanity check — retorna platform + versão. Falha = plugin não instalado. */
  ping(): Promise<{ platform: string; version: string }>;
}

// Registra plugin (no-op em web, conecta com nativo em Capacitor)
const NativePlugin = registerPlugin<GDrumsAudioEnginePlugin>('GDrumsAudioEngine');

export class NativeAudioEngine implements IAudioEngine {
  readonly kind: AudioEngineKind;

  /** Engine web embutido pra fallback + decoding de samples (sempre disponível). */
  private fallback: WebAudioEngine;

  /** True se plugin nativo respondeu ao ping com sucesso. */
  private nativeReady: boolean = false;

  constructor(audioContext: AudioContext) {
    this.fallback = new WebAudioEngine(audioContext);
    this.kind = Capacitor.getPlatform() === 'ios' ? 'native-ios' : 'native-android';
    void this.bootstrap();
  }

  /** Valida que o plugin nativo tá instalado e respondendo. */
  private async bootstrap(): Promise<void> {
    try {
      const result = await NativePlugin.ping();
      console.log('[NativeAudioEngine] Plugin OK:', result);
      this.nativeReady = true;
    } catch (e) {
      console.warn('[NativeAudioEngine] Plugin indisponível, usando fallback web:', e);
      this.nativeReady = false;
    }
  }

  // ─── Loading: sempre via WebAudio (decodeAudioData é tudo que precisamos) ─

  loadAudioFromPath(path: string): Promise<AudioBuffer> {
    return this.fallback.loadAudioFromPath(path);
  }

  loadAudioFromFile(file: File): Promise<AudioBuffer> {
    return this.fallback.loadAudioFromFile(file);
  }

  loadAudioFromBase64(base64: string): Promise<AudioBuffer> {
    return this.fallback.loadAudioFromBase64(base64);
  }

  // ─── Scheduling: nas próximas fases vai pro nativo. Por enquanto fallback. ─

  playSound(buffer: AudioBuffer, time: number, volume: number = 1.0): void {
    // TODO Fase 1+: enviar PCM pro nativo via plugin se nativeReady
    this.fallback.playSound(buffer, time, volume);
  }

  scheduleStepFromSnapshot(snapshot: AudioSnapshot, time: number): void {
    // TODO Fase 1+: encaminhar snapshot pro nativo. Hoje fallback.
    this.fallback.scheduleStepFromSnapshot(snapshot, time);
  }

  // ─── Controle: passa pro fallback (que controla AudioContext) ──────────

  resume(): void {
    this.fallback.resume();
  }

  getCurrentTime(): number {
    return this.fallback.getCurrentTime();
  }

  getState(): string {
    return this.fallback.getState();
  }

  fadeOutAllActive(fadeTime: number = 0.03): void {
    this.fallback.fadeOutAllActive(fadeTime);
  }

  cancelAllScheduled(): void {
    this.fallback.cancelAllScheduled();
  }

  // ─── Identificação adicional ───────────────────────────────────────────

  /** True se plugin nativo está pronto (pode estar usando fallback senão). */
  isNativeActive(): boolean {
    return this.nativeReady;
  }
}
