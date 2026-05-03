// ═════════════════════════════════════════════════════════════════════════
// IAudioEngine — interface comum entre WebAudioEngine (browser/PWA) e
// NativeAudioEngine (plugin Capacitor iOS Swift / Android Kotlin).
// ═════════════════════════════════════════════════════════════════════════
//
// Filosofia: a UI/StateManager/PatternEngine/Scheduler em TS continuam
// idênticos. Só o "como o áudio sai do dispositivo" muda por plataforma.
//
// - WebAudioEngine = embrulha o AudioManager.ts atual (Web Audio API).
//   Sem mudança de comportamento. Roda em web/PWA/Capacitor (fallback).
// - NativeAudioEngine = encaminha pra plugin Capacitor que roda
//   AVAudioEngine (iOS) ou AudioTrack/Oboe (Android) nativos. Zero gap
//   em background, lockscreen widget igual Spotify.
//
// O engineFactory.ts decide qual instanciar baseado em plataforma + flag
// (localStorage 'gdrums-engine' = 'native'). Default sempre WebAudio até
// o NativeAudioEngine estar provado estável.
//
// API espelha o que o main.ts/Scheduler já chamam hoje, pra refactor zero-risco.

import type { AudioSnapshot } from '../AudioManager';

export interface IAudioEngine {
  // ─── Carregamento de samples ──────────────────────────────────────────
  /** Carrega um sample de URL/path do servidor (ex: '/midi/bumbo.wav'). */
  loadAudioFromPath(path: string): Promise<AudioBuffer>;

  /** Carrega de File (drag-drop do user no editor). */
  loadAudioFromFile(file: File): Promise<AudioBuffer>;

  /** Carrega de base64 (formato exportado de projetos antigos). */
  loadAudioFromBase64(base64: string): Promise<AudioBuffer>;

  // ─── Reprodução ────────────────────────────────────────────────────────
  /** Toca sample one-shot no tempo agendado. Usado pra prato/intro/etc. */
  playSound(buffer: AudioBuffer, time: number, volume?: number): void;

  /** Agenda step do sequenciador a partir de snapshot imutável (hot path). */
  scheduleStepFromSnapshot(snapshot: AudioSnapshot, time: number): void;

  // ─── Controle de contexto ──────────────────────────────────────────────
  /** Retoma AudioContext (iOS exige isso síncrono dentro de user gesture). */
  resume(): void;

  /** Tempo atual do clock de áudio (segundos). */
  getCurrentTime(): number;

  /** Estado do contexto pra debug/fallback ('running'/'suspended'/etc). */
  getState(): string;

  // ─── Cleanup / transições ──────────────────────────────────────────────
  /** Fade-out controlado em todos os sources soando agora. */
  fadeOutAllActive(fadeTime?: number): void;

  /** Cancela TODOS sources (tocando + agendados pra futuro). Usado
   *  ao voltar do background no iOS pra evitar "música sobre música". */
  cancelAllScheduled(): void;

  // ─── Identificação ─────────────────────────────────────────────────────
  /** 'web' | 'native-ios' | 'native-android' — pra debug/telemetria. */
  readonly kind: AudioEngineKind;
}

export type AudioEngineKind = 'web' | 'native-ios' | 'native-android';
