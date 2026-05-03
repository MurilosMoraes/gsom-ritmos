// ═════════════════════════════════════════════════════════════════════════
// NativeAudioEngine — wrapper TypeScript do plugin Capacitor nativo.
// ═════════════════════════════════════════════════════════════════════════
//
// MODO ESTRITO (03/05/2026): SEM fallback automático pro WebAudio.
// Se o plugin nativo falhar, o app sinaliza erro VISÍVEL (alerta) em vez
// de degradar silenciosamente — assim a gente descobre o bug na hora,
// não fica mudo. Decisão do Murilo: "no nativo, obriga a usar o nativo".
//
// Roteia scheduling/playback pro plugin nativo (AVAudioEngine iOS /
// AudioTrack mixer Android). Web Audio API ainda é usado SÓ pra:
//  - Decodificar samples (decodeAudioData) — preciso do AudioBuffer pra
//    código existente (.duration, etc) sem reescrever StateManager
//  - Carregar File (drag-drop user — esses samples NÃO vão pro nativo,
//    e por design não tocam até user salvar como ritmo personalizado)
//
// Padrão de operação:
//  1. loadAudioFromPath(p) → carrega no nativo (await initPromise).
//                            Se falhar, log de erro mas continua (sample
//                            ficará indisponível, scheduleStep pula ele)
//  2. scheduleStepFromSnapshot → traduz snapshot em chamadas
//                                scheduleSample pro plugin nativo
//  3. playSound(buffer, t) → identifica buffer no cache reverso →
//                            playOneShot/scheduleSample no nativo

import { Capacitor, registerPlugin } from '@capacitor/core';
import type { IAudioEngine, AudioEngineKind } from './IAudioEngine';
import type { AudioSnapshot } from '../AudioManager';
import { WebAudioEngine } from './WebAudioEngine';
import { MAX_CHANNELS } from '../../types';
import { DebugOverlay } from '../../native/DebugOverlay';

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
  /** WebAudioEngine usado APENAS pra decoding (decodeAudioData → AudioBuffer).
   *  NUNCA toca som — esse é trabalho exclusivo do plugin nativo. */
  private decoder: WebAudioEngine;
  private nativeReady: boolean = false;
  /** Mapeia AudioBuffer (referência) → key string registrada no nativo. */
  private bufferToKey: WeakMap<AudioBuffer, string> = new WeakMap();
  /** Anchor ativo? */
  private anchored: boolean = false;
  /** Anchor offset: subtraímos do `time` (audioContext.currentTime-based)
   *  pra obter offsetSeconds-relativo-ao-anchor que o nativo espera. */
  private anchorAudioCtxTime: number = 0;
  /** Pending init promise — chamadas esperam init terminar. */
  private initPromise: Promise<void>;
  private initFailed: boolean = false;
  private alertShown: boolean = false;

  constructor(audioContext: AudioContext) {
    this.decoder = new WebAudioEngine(audioContext);
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
      if (this.nativeReady) {
        console.log('%c[NativeAudioEngine] ✅ MODO NATIVO ATIVO', 'color:lime;font-weight:bold');
        DebugOverlay.log(`✅ Engine nativo ativo: ${pong.platform} sr=${init.sampleRate}Hz`);
      } else {
        this.handleInitFailure('Plugin nativo retornou ready=false');
      }
    } catch (e) {
      this.handleInitFailure('Plugin nativo não respondeu: ' + (e as Error).message);
    }
  }

  /** Modo estrito: erro pelo DebugOverlay (não atrapalha teste, abre só
   *  com 3 taps no canto sup. esq.). Sem fallback web. */
  private handleInitFailure(reason: string): void {
    this.initFailed = true;
    this.nativeReady = false;
    console.error('[NativeAudioEngine] ❌ FALHA CRÍTICA:', reason);
    DebugOverlay.error('NativeAudioEngine init falhou: ' + reason);
  }

  // ─── Loading ─────────────────────────────────────────────────────────────

  async loadAudioFromPath(path: string): Promise<AudioBuffer> {
    // Decoda via Web Audio (precisamos do AudioBuffer pra código que usa
    // .duration etc — não é pra TOCAR, só pra metadata).
    const webBuffer = await this.decoder.loadAudioFromPath(path);

    // Aguarda bootstrap antes de registrar no nativo (race condition fix).
    await this.initPromise.catch(() => {});

    if (!this.nativeReady) {
      // Modo estrito: erro visível. Não silencia.
      console.error('[NativeAudioEngine] sample NÃO registrado (native off):', path);
      return webBuffer;
    }

    const cleanPath = path.split('?')[0].replace(/^\//, '');
    const bundlePath = cleanPath.startsWith('public/') ? cleanPath : `public/${cleanPath}`;
    try {
      await NativePlugin.loadSample({ key: cleanPath, bundlePath, assetPath: bundlePath });
      this.bufferToKey.set(webBuffer, cleanPath);
      console.log('[NativeAudioEngine] sample registrado:', cleanPath);
    } catch (e) {
      console.error('[NativeAudioEngine] loadSample nativo FALHOU:', path, e);
    }
    return webBuffer;
  }

  async loadAudioFromFile(file: File): Promise<AudioBuffer> {
    // Drag-drop do user (editor) — só decoda, não vai pro nativo.
    // Esses samples não são tocados pelo sequencer principal — são pra
    // edição. Quando user salva como ritmo personalizado, vira midiPath
    // e aí passa por loadAudioFromPath normal.
    return this.decoder.loadAudioFromFile(file);
  }

  loadAudioFromBase64(base64: string): Promise<AudioBuffer> {
    // Mesma coisa que File — só decoda.
    return this.decoder.loadAudioFromBase64(base64);
  }

  // ─── Playback ────────────────────────────────────────────────────────────

  playSound(buffer: AudioBuffer, time: number, volume: number = 1.0): void {
    // One-shot (prato, fillStart, fillReturn).
    if (!this.nativeReady) {
      console.error('[NativeAudioEngine] playSound chamado mas native não pronto');
      return;
    }
    const key = this.bufferToKey.get(buffer);
    if (!key) {
      console.error('[NativeAudioEngine] playSound: buffer não registrado no nativo');
      return;
    }
    if (this.anchored) {
      const offset = Math.max(0, time - this.anchorAudioCtxTime);
      NativePlugin.scheduleSample({ channel: MAX_CHANNELS - 1, key, offsetSeconds: offset, volume })
        .catch(e => console.error('[NativeAudioEngine] scheduleSample one-shot falhou:', e));
    } else {
      NativePlugin.playOneShot({ channel: MAX_CHANNELS - 1, key, volume })
        .catch(e => console.error('[NativeAudioEngine] playOneShot falhou:', e));
    }
  }

  scheduleStepFromSnapshot(snapshot: AudioSnapshot, time: number): void {
    if (!this.nativeReady) return;

    // ESTRATÉGIA NOVA: re-anchora a CADA chamada com tempo "agora".
    // Razão: clock JS (audioContext.currentTime) é INDEPENDENTE do clock
    // nativo (engine.outputNode.lastRenderTime.sampleTime). Anchor único
    // no início da sessão fica desincronizado conforme tempo passa →
    // samples agendados no passado são descartados silenciosamente pelo
    // AVAudioPlayerNode = ritmo não toca.
    //
    // Solução: a cada scheduleStep, calcula quantos segundos no futuro
    // o sample deve tocar (delta = time - currentTime no clock JS), e
    // pede pro nativo anchorar AGORA (clock nativo), agendando esse
    // delta no futuro relativo ao anchor recém-criado. Os 2 clocks
    // ficam alinhados pelo "agora" comum.
    const nowJs = this.decoder.getCurrentTime();
    const deltaSeconds = time - nowJs; // segundos no futuro
    if (deltaSeconds < 0) {
      // Sample já no passado — pula (Scheduler tinha lookahead suficiente)
      return;
    }

    const { step, pattern, channels, volumes, masterVolume, fillStartBuffer, fillReturnBuffer } = snapshot;

    // Sons de fill start/return — offsetSeconds = "delta no futuro"
    // (nativo soma com lastRenderTime atual = AVAudioTime correto)
    if (snapshot.shouldPlayStartSound && fillStartBuffer) {
      const k = this.bufferToKey.get(fillStartBuffer);
      if (k) {
        NativePlugin.scheduleSample({
          channel: MAX_CHANNELS - 1, key: k, offsetSeconds: deltaSeconds, volume: masterVolume
        }).catch(() => {});
      }
    }
    if (snapshot.shouldPlayReturnSound && fillReturnBuffer) {
      const k = this.bufferToKey.get(fillReturnBuffer);
      if (k) {
        NativePlugin.scheduleSample({
          channel: MAX_CHANNELS - 1, key: k, offsetSeconds: deltaSeconds, volume: masterVolume
        }).catch(() => {});
      }
    }

    // Loop dos canais
    for (let channel = 0; channel < MAX_CHANNELS; channel++) {
      if (!pattern[channel] || !pattern[channel][step]) continue;
      const buffer = channels[channel]?.buffer;
      if (!buffer) continue;

      const stepVolume = volumes[channel]?.[step] ?? 1.0;
      const finalVolume = stepVolume * masterVolume;
      if (finalVolume <= 0) continue;

      const key = this.bufferToKey.get(buffer);
      if (!key) continue;

      // Aplica offset por célula
      let cellDelta = deltaSeconds;
      const cellOffset = snapshot.offsets?.[channel]?.[step];
      if (cellOffset && snapshot.stepDuration && snapshot.stepDuration > 0) {
        const clamped = Math.max(-0.5, Math.min(0.5, cellOffset));
        cellDelta = Math.max(0, deltaSeconds + clamped * snapshot.stepDuration);
      }

      NativePlugin.scheduleSample({
        channel,
        key,
        offsetSeconds: cellDelta,
        volume: finalVolume,
      }).catch(() => {});
    }
  }

  // ─── Controle ────────────────────────────────────────────────────────────

  resume(): void {
    // Resume do AudioContext (pra File API/decoder funcionar) — no-op se
    // já tá running. Não toca o nativo (AVAudioEngine sempre vivo).
    this.decoder.resume();
  }

  getCurrentTime(): number {
    // Usa audioContext.currentTime — clock que o Scheduler já conhece.
    return this.decoder.getCurrentTime();
  }

  getState(): string {
    return this.decoder.getState();
  }

  fadeOutAllActive(fadeTime: number = 0.03): void {
    if (this.nativeReady) {
      NativePlugin.cancelAll().catch(() => {});
    }
  }

  cancelAllScheduled(): void {
    this.anchored = false; // próxima scheduleStep vai re-anchorar
    if (this.nativeReady) {
      NativePlugin.cancelAll().catch(() => {});
    }
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
