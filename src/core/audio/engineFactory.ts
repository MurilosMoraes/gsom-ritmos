// ═════════════════════════════════════════════════════════════════════════
// engineFactory — sempre retorna WebAudioEngine.
// ═════════════════════════════════════════════════════════════════════════
//
// HISTÓRICO (03/05/2026): tentei migração pra NativeAudioEngine (Swift
// AVAudioEngine + Java AudioTrack) pra eliminar gap de background no iOS.
// Funcionou parcial mas com problemas de scheduling sample-accurate que
// exigem dev iOS sênior pra resolver. Decisão do Murilo: reverter pra
// WebAudio em TODAS plataformas (igual ao que sempre funcionou na web).
//
// O código nativo (NativeAudioEngine.ts, GDrumsAudioEngineCore.swift,
// GDrumsAudioEngineCore.java, plugins) FICA NO REPO como base pra futura
// retomada (eventual freelancer Swift). Não está sendo executado.
//
// Pra retomar o nativo no futuro:
// 1. Mudar essa factory pra retornar NativeAudioEngine em Capacitor
// 2. Resolver o problema do AVAudioPlayerNode + lastRenderTime
//    (provavelmente precisa de pool de players + clock híbrido)

import type { IAudioEngine } from './IAudioEngine';
import { WebAudioEngine } from './WebAudioEngine';

export function createAudioEngine(audioContext: AudioContext): IAudioEngine {
  return new WebAudioEngine(audioContext);
}
