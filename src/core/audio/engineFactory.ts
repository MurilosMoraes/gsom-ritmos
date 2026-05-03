// ═════════════════════════════════════════════════════════════════════════
// engineFactory — decide qual IAudioEngine instanciar baseado em plataforma.
// ═════════════════════════════════════════════════════════════════════════
//
// REGRAS DE OURO (proteção da web/PWA em produção):
// 1. Web/PWA SEMPRE usa WebAudioEngine. Nunca, em hipótese alguma, native.
// 2. Capacitor (iOS/Android) usa WebAudioEngine por DEFAULT até a flag virar.
// 3. Pra ativar native em Capacitor: localStorage.setItem('gdrums-engine', 'native')
//    Útil pra dev/beta tester antes de liberar pra todos.
// 4. Quando NativeAudioEngine estiver provado estável em produção, mudar
//    o `useNativeByDefault` pra true (e a flag vira opt-OUT pra debug).

import { Capacitor } from '@capacitor/core';
import type { IAudioEngine } from './IAudioEngine';
import { WebAudioEngine } from './WebAudioEngine';
import { NativeAudioEngine } from './NativeAudioEngine';

/** Mude pra `true` quando NativeAudioEngine estiver pronto pra rollout geral. */
const useNativeByDefault = false;

export function createAudioEngine(audioContext: AudioContext): IAudioEngine {
  // Web/PWA: SEMPRE WebAudio. Sem bypass possível.
  if (!Capacitor.isNativePlatform()) {
    return new WebAudioEngine(audioContext);
  }

  // Capacitor: respeita flag explícita do user/dev primeiro.
  let userOverride: string | null = null;
  try { userOverride = localStorage.getItem('gdrums-engine'); } catch {}

  if (userOverride === 'web') {
    // Force web engine (debug/fallback)
    return new WebAudioEngine(audioContext);
  }
  if (userOverride === 'native') {
    return new NativeAudioEngine(audioContext);
  }

  // Sem override: respeita default global
  return useNativeByDefault
    ? new NativeAudioEngine(audioContext)
    : new WebAudioEngine(audioContext);
}
