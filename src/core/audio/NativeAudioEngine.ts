// ═════════════════════════════════════════════════════════════════════════
// NativeAudioEngine — wrapper TypeScript do plugin Capacitor nativo.
// ═════════════════════════════════════════════════════════════════════════
//
// Roteia scheduling/playback pro plugin nativo (AVAudioEngine iOS /
// AudioTrack mixer Android), mantendo Web Audio API só pra:
//  - Decodificar samples (decodeAudioData → mas APENAS pro fallback web)
//  - Fallback automático se plugin falhar/não estiver pronto
//  - Compatibilidade com File API (drag-drop de WAV no editor)
//
// Padrão de operação:
//  1. loadAudioFromPath(p)   → registra path no plugin nativo + carrega
//                              AudioBuffer no fallback web (compat)
//  2. scheduleStepFromSnapshot → traduz snapshot em chamadas
//                                scheduleSample(channel, key, offset, vol)
//                                pro plugin nativo
//  3. playSound(buffer, t)   → identifica buffer no cache reverso →
//                              playOneShot no plugin (ou fallback se
//                              buffer veio de File não cacheado)
//
// Quando o native não tá pronto, todas as chamadas caem no WebAudioEngine
// transparentemente. Zero risco do app ficar mudo durante migração.

import { Capacitor, registerPlugin } from '@capacitor/core';
import type { IAudioEngine, AudioEngineKind } from './IAudioEngine';
import type { AudioSnapshot } from '../AudioManager';
import { WebAudioEngine } from './WebAudioEngine';
import { MAX_CHANNELS } from '../../types';

// ─── Plugin interface (deve bater com Swift/Java) ───────────────────────
interface GDrumsAudioEnginePlugin {
  ping(): Promise<{ platform: string; version: string; ready: boolean; sampleRate: number }>;
  initialize(): Promise<{ ready: boolean; sampleRate: number }>;

  // iOS usa 'bundlePath', Android usa 'assetPath'. Mandamos os 2.
  loadSample(opts: { key: string; bundlePath: string; assetPath: string }): Promise<{ loaded: boolean }>;
  isSampleLoaded(opts: { key: string }): Promise<{ loaded: boolean }>;

  anchorNow(opts: { leadInMs?: number }): Promise<void>;
  scheduleSample(opts: { channel: number; key: string; offsetSeconds: number; volume?: number }): Promise<void>;
  playOneShot(opts: { channel: number; key: string; volume?: number }): Promise<void>;

  cancelChannel(opts: { channel: number }): Promise<void>;
  cancelAll(): Promise<void>;

  setMasterVolume(opts: { volume: number }): Promise<void>;
  currentTime(): Promise<{ seconds: number }>;
}

const NativePlugin = registerPlugin<GDrumsAudioEnginePlugin>('GDrumsAudioEngine');

export class NativeAudioEngine implements IAudioEngine {
  readonly kind: AudioEngineKind;
  /** WebAudioEngine pra fallback + decoding (sempre disponível). */
  private fallback: WebAudioEngine;
  private nativeReady: boolean = false;
  /** Mapeia AudioBuffer (referência) → key string registrada no nativo.
   *  Permite scheduleStepFromSnapshot/playSound (que recebem buffer)
   *  encontrar a key correspondente pra chamar o plugin. */
  private bufferToKey: WeakMap<AudioBuffer, string> = new WeakMap();
  /** Anchor ativo? scheduleStep precisa disso pra saber se pode rotear pro nativo. */
  private anchored: boolean = false;
  /** Anchor offset: subtraímos do `time` (audioContext.currentTime-based)
   *  pra obter offsetSeconds-relativo-ao-anchor que o nativo espera. */
  private anchorAudioCtxTime: number = 0;
  /** Pending init promise — chamadas scheduleSample esperam init terminar. */
  private initPromise: Promise<void>;

  constructor(audioContext: AudioContext) {
    this.fallback = new WebAudioEngine(audioContext);
    this.kind = Capacitor.getPlatform() === 'ios' ? 'native-ios' : 'native-android';
    this.initPromise = this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    try {
      const pong = await NativePlugin.ping();
      console.log('[NativeAudioEngine] ping:', pong);
      const init = await NativePlugin.initialize();
      console.log('[NativeAudioEngine] initialize:', init);
      this.nativeReady = init.ready === true;
    } catch (e) {
      console.warn('[NativeAudioEngine] bootstrap falhou — fallback web:', e);
      this.nativeReady = false;
    }
  }

  // ─── Loading ─────────────────────────────────────────────────────────────

  async loadAudioFromPath(path: string): Promise<AudioBuffer> {
    // Sempre carrega no fallback web (precisamos do AudioBuffer pra compat
    // com código que usa .duration, etc + pro fallback funcionar)
    const webBuffer = await this.fallback.loadAudioFromPath(path);

    if (this.nativeReady) {
      // Path típico: "/midi/bumbo.wav"
      // iOS bundle: "public/midi/bumbo.wav"
      // Android assets: "public/midi/bumbo.wav"
      const cleanPath = path.split('?')[0].replace(/^\//, '');
      const bundlePath = cleanPath.startsWith('public/') ? cleanPath : `public/${cleanPath}`;
      try {
        await NativePlugin.loadSample({ key: cleanPath, bundlePath, assetPath: bundlePath });
        this.bufferToKey.set(webBuffer, cleanPath);
      } catch (e) {
        console.warn('[NativeAudioEngine] loadSample nativo falhou, usando fallback web:', path, e);
      }
    }

    return webBuffer;
  }

  async loadAudioFromFile(file: File): Promise<AudioBuffer> {
    // Drag-drop do user — não dá pra carregar no nativo (não é asset do bundle).
    // Fica só no fallback web. Esse caminho NÃO vai pro nativo na Fase 3.
    // Suporte a samples user-uploaded no nativo é Fase 7+ (gravação local).
    return this.fallback.loadAudioFromFile(file);
  }

  loadAudioFromBase64(base64: string): Promise<AudioBuffer> {
    return this.fallback.loadAudioFromBase64(base64);
  }

  // ─── Playback ────────────────────────────────────────────────────────────

  playSound(buffer: AudioBuffer, time: number, volume: number = 1.0): void {
    // playSound é usado pra one-shots (prato, fillStart, fillReturn).
    // Se conhecemos a key do buffer no nativo, usamos. Senão, fallback.
    const key = this.bufferToKey.get(buffer);
    if (this.nativeReady && key) {
      // Canal "extra" pra one-shots — usa o último canal (índice 11, MAX_CHANNELS-1)
      // pra não brigar com canais 0-10 do sequenciador.
      // Se houver anchor, agenda no time relativo. Senão, dispara imediato.
      if (this.anchored) {
        const offset = Math.max(0, time - this.anchorAudioCtxTime);
        NativePlugin.scheduleSample({ channel: MAX_CHANNELS - 1, key, offsetSeconds: offset, volume })
          .catch(e => console.warn('[NativeAudioEngine] scheduleSample one-shot falhou:', e));
      } else {
        NativePlugin.playOneShot({ channel: MAX_CHANNELS - 1, key, volume })
          .catch(e => console.warn('[NativeAudioEngine] playOneShot falhou:', e));
      }
      return;
    }
    // Fallback web (buffer não registrado no nativo, ou native não pronto)
    this.fallback.playSound(buffer, time, volume);
  }

  scheduleStepFromSnapshot(snapshot: AudioSnapshot, time: number): void {
    // Se native não tá pronto, fallback web faz tudo (preserva som imediato).
    if (!this.nativeReady) {
      this.fallback.scheduleStepFromSnapshot(snapshot, time);
      return;
    }

    // Se ainda não anchorou (primeira scheduleStep da sessão de play),
    // anchora AGORA usando o `time` recebido como tempo zero.
    // Próximas chamadas calculam offset relativo a esse tempo.
    if (!this.anchored) {
      this.anchorAudioCtxTime = time;
      this.anchored = true;
      // anchorNow no nativo usa "agora + leadIn" — passamos leadIn estimado
      // baseado em quanto faltava pro `time` chegar
      const leadInMs = Math.max(20, (time - this.fallback.getCurrentTime()) * 1000);
      NativePlugin.anchorNow({ leadInMs })
        .catch(e => console.warn('[NativeAudioEngine] anchorNow falhou:', e));
    }

    const offsetSeconds = time - this.anchorAudioCtxTime;
    const { step, pattern, channels, volumes, masterVolume, fillStartBuffer, fillReturnBuffer } = snapshot;

    // Sons de fill start/return (tocam no step 0 quando flag setada)
    if (snapshot.shouldPlayStartSound && fillStartBuffer) {
      const k = this.bufferToKey.get(fillStartBuffer);
      if (k) {
        NativePlugin.scheduleSample({
          channel: MAX_CHANNELS - 1, key: k, offsetSeconds, volume: masterVolume
        }).catch(() => {});
      } else {
        this.fallback.playSound(fillStartBuffer, time, masterVolume);
      }
    }
    if (snapshot.shouldPlayReturnSound && fillReturnBuffer) {
      const k = this.bufferToKey.get(fillReturnBuffer);
      if (k) {
        NativePlugin.scheduleSample({
          channel: MAX_CHANNELS - 1, key: k, offsetSeconds, volume: masterVolume
        }).catch(() => {});
      } else {
        this.fallback.playSound(fillReturnBuffer, time, masterVolume);
      }
    }

    // Loop dos canais — agenda cada step ativo via plugin nativo
    for (let channel = 0; channel < MAX_CHANNELS; channel++) {
      if (!pattern[channel] || !pattern[channel][step]) continue;
      const buffer = channels[channel]?.buffer;
      if (!buffer) continue;

      const stepVolume = volumes[channel]?.[step] ?? 1.0;
      const finalVolume = stepVolume * masterVolume;
      if (finalVolume <= 0) continue;

      const key = this.bufferToKey.get(buffer);
      if (!key) {
        // Sample veio de File (drag-drop) ou base64 — não está no nativo.
        // Fallback pra esse step específico.
        this.fallback.playSound(buffer, time, finalVolume);
        continue;
      }

      // Aplica offset por célula (mesma lógica do AudioManager)
      let cellTime = time;
      const cellOffset = snapshot.offsets?.[channel]?.[step];
      if (cellOffset && snapshot.stepDuration && snapshot.stepDuration > 0) {
        const clamped = Math.max(-0.5, Math.min(0.5, cellOffset));
        cellTime = time + clamped * snapshot.stepDuration;
      }
      const cellOffsetSec = cellTime - this.anchorAudioCtxTime;

      NativePlugin.scheduleSample({
        channel,
        key,
        offsetSeconds: cellOffsetSec,
        volume: finalVolume,
      }).catch(e => console.warn('[NativeAudioEngine] scheduleSample falhou:', e));
    }
  }

  // ─── Controle ────────────────────────────────────────────────────────────

  resume(): void {
    // Sempre resume o fallback (pra File API funcionar no editor)
    this.fallback.resume();
    // Native AVAudioEngine/AudioTrack não tem "resume" equivalente —
    // são auto-iniciados em initialize() e ficam vivos.
  }

  getCurrentTime(): number {
    // Continua usando audioContext.currentTime — é o clock que o Scheduler
    // já conhece. NativeAudioEngine traduz internamente pra anchor offset.
    return this.fallback.getCurrentTime();
  }

  getState(): string {
    return this.fallback.getState();
  }

  fadeOutAllActive(fadeTime: number = 0.03): void {
    if (this.nativeReady) {
      // Cancel suave no nativo (já tem fade interno de 5ms)
      NativePlugin.cancelAll().catch(() => {});
    }
    this.fallback.fadeOutAllActive(fadeTime);
  }

  cancelAllScheduled(): void {
    this.anchored = false; // próxima scheduleStep vai re-anchorar
    if (this.nativeReady) {
      NativePlugin.cancelAll().catch(() => {});
    }
    this.fallback.cancelAllScheduled();
  }

  /** True se plugin nativo está respondendo. */
  isNativeActive(): boolean {
    return this.nativeReady;
  }

  /** Força re-anchorar no próximo scheduleStep. Chamado em transições. */
  resetAnchor(): void {
    this.anchored = false;
  }
}
