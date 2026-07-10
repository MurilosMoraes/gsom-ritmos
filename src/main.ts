// Entry point principal - GSOM Rhythm Sequencer

import { t, getLocale, setLocale } from './i18n';
import { StateManager } from './core/StateManager';
import type { IAudioEngine } from './core/audio/IAudioEngine';
import { createAudioEngine } from './core/audio/engineFactory';
import { Scheduler } from './core/Scheduler';
import { PatternEngine } from './core/PatternEngine';
import { FileManager } from './io/FileManager';
import { UIManager } from './ui/UIManager';
import { ModalManager } from './ui/ModalManager';
import { Toast } from './ui/Toast';
import { SetlistManager } from './core/SetlistManager';
import { SetlistEditorUI } from './ui/SetlistEditorUI';
import { ConversionManager } from './ui/ConversionManager';
import { MAX_CHANNELS, AUTO_CYMBAL_GAIN, type PatternType, type SequencerState } from './types';
import { expandPattern, expandVolumes, normalizeMidiPath } from './utils/helpers';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { HapticsService } from './native/HapticsService';
import { OfflineCache } from './native/OfflineCache';
import { StatusBarService } from './native/StatusBarService';
import { AttributionService } from './native/AttributionService';
// PushService removido — push agora é gerenciado pelo OneSignalService
// (tanto web quanto Capacitor nativo via onesignal-cordova-plugin).
import { isNativeApp, openExternal, internalNav, isAndroidWeb, openPlayStore, isIOSNative, APP_STORE_URL } from './native/Platform';
import { NowPlayingService } from './native/NowPlayingService';
import { DebugOverlay } from './native/DebugOverlay';
import { UserRhythmService } from './core/UserRhythmService';
import { PreviewPlayer } from './core/PreviewPlayer';
import { redirectIfRecoveryHash } from './auth/recoveryGuard';

// Pra App Store: iOS tem IAP via StoreKit (Apple 3.1.1 obriga). Pra
// Play Store: Android continua usando checkout externo no Chrome
// (Google Play permite link pra site fora do app pra assinaturas).
// IMPORTANTE: NÃO usar /plans aqui. O AndroidManifest registra App Links
// com pathPrefix="/plans" — abrir gdrums.com.br/plans "no navegador" faz o
// Android devolver o link PRO PRÓPRIO APP (handler verificado do domínio),
// e o upgrade "tenta ir pra web e volta pro app". /assinar é um rewrite do
// vercel.json pro mesmo plans.html, fora da lista de interceptação — abre
// no Chrome de verdade, sem precisar de release nas lojas.
const PLANS_URL_EXTERNAL = 'https://gdrums.com.br/assinar';

/** Roteia ação de "ir pros planos" respeitando compliance:
 *  - iOS nativo → /plans interno (StoreKit/IAP)
 *  - Android nativo → site externo no Chrome (InfinitePay)
 *  - Web → /plans interno */
function gotoPlans(path: string = '/plans'): void {
  if (isIOSNative()) {
    internalNav(path);
  } else if (isNativeApp()) {
    // Android: query string vira parte da URL externa
    const q = path.includes('?') ? path.substring(path.indexOf('?')) : '';
    openExternal(PLANS_URL_EXTERNAL + q);
  } else {
    internalNav(path);
  }
}

class RhythmSequencer {
  private audioContext: AudioContext;
  private stateManager: StateManager;
  private audioManager: IAudioEngine;
  private scheduler: Scheduler;
  private patternEngine: PatternEngine;
  private fileManager: FileManager;
  private uiManager: UIManager;
  private modalManager: ModalManager;
  private setlistManager: SetlistManager;
  private setlistEditor: SetlistEditorUI;
  private userRhythmService: UserRhythmService;
  private conversionManager: ConversionManager;
  private previewPlayer!: PreviewPlayer;
  private isAdminMode = false;
  private userRole: 'user' | 'admin' = 'user';
  private rhythmVersion: number = 0;
  // Pedal — esquerdo e direito (2 botões = padrão)
  private pedalLeft = 'ArrowLeft';
  private pedalRight = 'ArrowRight';
  // Pedal expandido (3 ou 4 botões — MVAVE Chocolate, etc):
  // - 3 botões: + Play/Pause instantâneo
  // - 4 botões: + Play/Pause + Finalização (end)
  private pedalCount: 2 | 3 | 4 = 2;
  private pedalPlayPause = '';  // tecla pra botão 3 (play/pause)
  private pedalEnd = '';        // tecla pra botão 4 (finalização)
  private pedalMapperOpen = false;
  private installPrompt: any = null;
  // Unlock do AudioContext (iOS) — re-armável quando o contexto cai
  private unlockListenersArmed = false;
  /** iOS: app foi pro background desde o último play — o pipeline de
   *  áudio pode ter morrido MUDO (state 'running' mas sem som). O kick
   *  suspend→resume religa; pendente até o próximo foreground/play. */
  private iosAudioKickPending = false;
  private iosWatchdogLastCt = -1;
  private iosLastKickAt = 0;
  private rearmUnlockListeners: () => void = () => {};

  constructor() {
    // DebugOverlay desativado em produção — botão 🐛 fixo competia com
    // o foco do pedalInput (pedal BT iOS sagrado). Pra reativar pra debug:
    // descomenta a linha abaixo + rebuilda.
    // DebugOverlay.init();

    // Inicializar contexto de áudio.
    //
    // latencyHint 'playback' no MOBILE: o default ('interactive') pede o
    // menor buffer de áudio possível — em aparelhos com chip de áudio
    // fraco o audio thread vive no limite do deadline e qualquer competição
    // momentânea (GC, render, notificação, bluetooth) estoura o prazo →
    // buffer underrun → ESTRALO aleatório. Por isso uns celulares estralavam
    // e outros não. 'playback' = buffer ~4x maior = folga pro audio thread.
    // Custo: ~50-150ms de latência de saída — invisível pra playback
    // contínuo agendado via audio clock (sequenciador), só perceptível em
    // estímulo-resposta direto (célula PRATO soa ~0,1s após o toque).
    // Desktop mantém 'interactive' (hardware dá conta, latência menor).
    // iPadOS 13+ reporta "Macintosh" — Mac + touch também é mobile
    const isMobileCtx = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (/Mac/i.test(navigator.userAgent) && (navigator.maxTouchPoints || 0) > 1);
    // iPad: GPU sofre com efeitos ambientes full-screen em retina grande
    // (orbs animados de fundo + backdrop blur). perf-lite desliga só o
    // decorativo — feedback visual de toque/step fica intacto.
    const isIPadPerf = /iPad/i.test(navigator.userAgent) ||
      (/Mac/i.test(navigator.userAgent) && (navigator.maxTouchPoints || 0) > 1);
    if (isIPadPerf) document.body.classList.add('perf-lite');
    // Desktop: meio-termo. 'interactive' puro (~10-20ms de buffer) deixa
    // o audio thread no limite e dava MINI-estralo em notebook sob carga.
    // 0.05s de buffer = folga real contra underrun, mantendo latência de
    // comando imperceptível (~50ms). Mobile segue 'playback' (~4x maior).
    this.audioContext = new AudioContext(
      isMobileCtx ? { latencyHint: 'playback' } : { latencyHint: 0.05 }
    );

    // ═══════════════════════════════════════════════════════════════════════
    // BACKGROUND AUDIO — defesa em profundidade pro WebKit.
    // ═══════════════════════════════════════════════════════════════════════
    // navigator.audioSession.type = 'playback' avisa o WebKit (iOS 17.5+)
    // que esse Web Audio é "playback" e não "ambient" — sem isso, o
    // AudioContext era cortado em background mesmo com UIBackgroundModes
    // configurado. Bug WebKit 261554 (resolved iOS 17.5).
    //
    // No nativo (Capacitor iOS), o AppDelegate.swift configura
    // AVAudioSession.setCategory(.playback) — esse JS é defesa redundante
    // pro caso de PWA web standalone também funcionar.
    // ═══════════════════════════════════════════════════════════════════════
    if ('audioSession' in navigator) {
      try {
        (navigator as any).audioSession.type = 'playback';
      } catch { /* silently ignore — pre-iOS 17 sem audioSession API */ }
    }
    // MediaSession metadata + action handlers — sinaliza pro WebView/SO
    // "tem áudio rolando" (Chromium Android usa isso pra não suspender
    // AudioContext) e habilita controles de play/pause no lockscreen.
    if ('mediaSession' in navigator) {
      try {
        (navigator as any).mediaSession.metadata = new (window as any).MediaMetadata({
          title: 'GDrums',
          artist: t('main.mediaSession.artist'),
        });
        (navigator as any).mediaSession.setActionHandler('play', () => this.togglePlayStop());
        (navigator as any).mediaSession.setActionHandler('pause', () => this.togglePlayStop());
        (navigator as any).mediaSession.setActionHandler('stop', () => {
          if (this.stateManager.isPlaying()) this.togglePlayStop();
        });
      } catch { /* MediaMetadata/setActionHandler indisponível em browsers velhos */ }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SILENT UNLOCK — destravar AudioContext no primeiro toque na tela.
    // ═══════════════════════════════════════════════════════════════════════
    // Cliente premium iOS reportava: abre app, pisa pedal, nada toca.
    // Causa: iOS só aceita user gesture "forte" (touch/click) pra destravar
    // o AudioContext. Keydown de teclado Bluetooth NÃO é confiável — Apple
    // muda regras entre versões iOS sem documentar (WebKit Bug 180522).
    //
    // Hack usado por Howler.js, PlayCanvas, Phaser, Tone.js: no primeiro
    // toque na tela (pra qualquer coisa — scroll, botão, etc), tocar um
    // buffer silencioso de 1 sample. Isso força o iOS a liberar o contexto.
    // { once: true } garante que roda uma vez só e se auto-remove.
    //
    // IMPORTANTE: isso é ORTOGONAL ao hack do input focado do pedal BT.
    // - Hack do input: captura keydown do pedal (sagrado, não mexer)
    // - Silent unlock: destrava o AudioContext (coisa diferente)
    // ═══════════════════════════════════════════════════════════════════════
    // Unlock iOS AudioContext — mesmo pattern do Howler.js
    // Roda em MÚLTIPLOS eventos de gesto até realmente destravar (onstatechange
    // confirma 'running'). Vários iPhones exigem combinações diferentes de
    // resume + playback de buffer silencioso. Mantemos os listeners ativos até
    // o state = 'running' ser confirmado.
    const unlockAudio = () => {
      if ((this.audioContext.state as string) === 'running') return;
      const ctx = this.audioContext;
      // 1. Resume síncrono (iOS exige dentro do gesture)
      try { ctx.resume(); } catch {}
      // 2. Buffer silencioso com start em currentTime (não 0 — iOS ignora 0 às vezes)
      try {
        const buf = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        if (typeof src.start === 'function') src.start(ctx.currentTime);
        else (src as any).noteOn(0);
      } catch {}
      // Tocar um oscilator também — alguns iPhones só liberam com isso
      try {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        g.gain.value = 0;
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.01);
      } catch {}
    };

    // Múltiplos tipos de evento. Removem-se quando state = 'running'.
    // SEM capture:true — isso compete com audioContext.resume e com o hack
    // do pedal BT. Listeners em bubbling phase, passivos quando possível.
    const unlockEvents: Array<keyof DocumentEventMap> = ['touchstart', 'touchend', 'click', 'keydown'];
    const onUnlock = () => {
      unlockAudio();
      if ((this.audioContext.state as string) === 'running') {
        unlockEvents.forEach(ev => document.removeEventListener(ev, onUnlock));
        this.unlockListenersArmed = false;
        // ═══════════════════════════════════════════════════════════════════
        // SILENT OSCILLATOR — só iOS — mantém AudioContext "warm"
        // ═══════════════════════════════════════════════════════════════════
        // iOS WKWebView suspende AudioContext em background ~500-1000ms após
        // minimizar, mesmo com UIBackgroundModes=audio + AVAudioSession
        // configurado. Causa: WebKit hesita em "comprometer" o context como
        // tocando antes de confirmar audio audível.
        //
        // Fix de mercado (Tone.js PR #716, Howler #1525): manter um
        // OscillatorNode rodando com gain absurdamente baixo (1e-37 — abaixo
        // do noise floor, inaudível). iOS vê "tem áudio rolando" e mantém
        // contexto vivo. Reduz silêncio inicial de ~1s pra ~100-200ms.
        //
        // Custo bateria/CPU: <1% (oscillator silencioso é praticamente free).
        // Risco zero pra Android/Web — só roda em iOS.
        // ═══════════════════════════════════════════════════════════════════
        const isIOSCtx = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
                         (/Mac/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
        if (isIOSCtx) {
          try {
            const silentOsc = this.audioContext.createOscillator();
            const silentGain = this.audioContext.createGain();
            silentGain.gain.value = 1e-37; // inaudível, mas iOS conta como "playing"
            silentOsc.connect(silentGain);
            silentGain.connect(this.audioContext.destination);
            silentOsc.start();
            // Não para nunca — fica rodando enquanto app vive
          } catch { /* fallback silencioso */ }
        }
      }
    };
    unlockEvents.forEach(ev => document.addEventListener(ev, onUnlock));
    this.unlockListenersArmed = true;

    // Re-armar os unlock listeners quando o contexto cair de novo.
    // Sem isso, após o 1º unlock os listeners morrem ({ removeEventListener })
    // e se o iOS derrubar o contexto pra 'interrupted' (sair/voltar do app,
    // ligação, Siri) e o resume() programático falhar, NÃO sobra nenhum
    // caminho de user gesture pra destravar — app fica mudo até o user
    // sair e voltar de novo na sorte. Bug reportado: "iOS nem sempre toca".
    //
    // ⚠️ PEDAL: re-arma os MESMOS listeners de sempre (bubbling, sem
    // capture) — não mexe em foco, não interage com o pedalInput.
    this.rearmUnlockListeners = () => {
      if (this.unlockListenersArmed) return;
      unlockEvents.forEach(ev => document.addEventListener(ev, onUnlock));
      this.unlockListenersArmed = true;
    };

    // ═══════════════════════════════════════════════════════════════════════
    // MODAL DE INICIALIZAÇÃO iOS — garante unlock com botão explícito.
    // ═══════════════════════════════════════════════════════════════════════
    // Cliente premium reportou: mesmo com silent unlock nos touchstart, algumas
    // sessões (cold start, app morto e reaberto) ainda precisavam de 1 toque
    // na tela antes do pedal funcionar. O silent unlock cobre maioria, mas não
    // 100% — depende do estado do iOS, versão, etc.
    //
    // Solução definitiva: modal blocante logo no load mostrando "Tudo pronto"
    // com botão grande. User toca → unlock garantido dentro de user gesture →
    // fecha modal → app já com áudio destravado. Abordagem de GarageBand,
    // Drum Pad, e outros apps de música iOS.
    //
    // Só iOS. Só uma vez por sessão. Não atrapalha Android.
    // ═══════════════════════════════════════════════════════════════════════
    const isIOSDevice = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
                        (/Mac/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    if (isIOSDevice) {
      // Aguardar DOM montado pra inserir overlay
      const showStartupModal = () => {
        // Se já destravou (user já tocou na tela antes do modal aparecer), skip
        if ((this.audioContext.state as string) === 'running') return;

        const overlay = document.createElement('div');
        overlay.id = 'iosStartupModal';
        overlay.style.cssText = 'position:fixed;inset:0;background:#030014;display:flex;align-items:center;justify-content:center;z-index:100000;padding:2rem;';
        overlay.innerHTML = `
          <div style="text-align:center;max-width:360px;width:100%;">
            <img src="/img/logo.png" alt="GDrums" style="height:48px;opacity:0.9;margin-bottom:2rem;">
            <h2 style="color:#fff;font-size:1.3rem;font-weight:700;margin:0 0 0.5rem;letter-spacing:-0.3px;">${t('main.iosStartup.title')}</h2>
            <p style="color:rgba(255,255,255,0.5);font-size:0.9rem;line-height:1.6;margin:0 0 2rem;">
              ${t('main.iosStartup.body')}
            </p>
            <button id="iosStartupBtn" style="
              width:100%;padding:1rem;border:none;border-radius:14px;
              background:linear-gradient(135deg,#00D4FF,#8B5CF6);
              color:#fff;font-size:1rem;font-weight:700;
              font-family:inherit;cursor:pointer;
              box-shadow:0 8px 24px rgba(0,212,255,0.25);
            ">${t('main.iosStartup.cta')}</button>
          </div>
        `;
        document.body.appendChild(overlay);

        const startBtn = overlay.querySelector('#iosStartupBtn') as HTMLButtonElement;
        const closeModal = () => {
          // Unlock síncrono dentro do click
          unlockAudio();
          // Remover overlay com fade
          overlay.style.transition = 'opacity 0.25s ease';
          overlay.style.opacity = '0';
          setTimeout(() => overlay.remove(), 280);
        };
        startBtn.addEventListener('click', closeModal);
        // Fallback: qualquer toque no overlay também destrava
        overlay.addEventListener('touchstart', closeModal, { once: true, passive: true });
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', showStartupModal, { once: true });
      } else {
        // DOM já pronto — mostrar na próxima frame pra garantir que tudo
        // foi renderizado e o user vê o modal em cima do app
        requestAnimationFrame(showStartupModal);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // onstatechange — recovery automático se o contexto cair.
    // ═══════════════════════════════════════════════════════════════════════
    // iOS pode voltar pra 'interrupted' após ligação, minimize, troca de
    // output (fone desconectou), etc. Android pode cair pra 'suspended' se
    // o SO ficar com pouca memória. Sempre que detectar, tentar resume.
    // ═══════════════════════════════════════════════════════════════════════
    this.audioContext.addEventListener('statechange', () => {
      const st = this.audioContext.state as string;
      if (st === 'suspended' || st === 'interrupted') {
        // Tenta resume silencioso. Se falhar (iOS exige user gesture),
        // o silent unlock no próximo touch vai pegar.
        this.audioContext.resume().catch(() => {});
        // Se o resume programático não pegou em 600ms, re-arma os unlock
        // listeners — assim QUALQUER toque na tela destrava de novo.
        // (Eles se auto-removem de novo quando o contexto voltar a rodar.)
        setTimeout(() => {
          if ((this.audioContext.state as string) !== 'running') {
            this.rearmUnlockListeners();
          }
        }, 600);
      }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // WATCHDOG DE RENDER MORTO (iOS) — o modo de falha que NADA acima pega.
    // ═══════════════════════════════════════════════════════════════════════
    // A AVAudioSession quica (outro app, Siri, ligação) e o WebKit fica com
    // o render de áudio MORTO reportando state 'running': resume() é no-op,
    // statechange nunca dispara, unlock listeners não agem. Sintomas reais
    // (report 12/06, iPhone 16): som some no meio da reprodução; cold start
    // mudo; user fechava/abria o app 4x até voltar; e o detector de modo
    // silencioso acusava FALSO positivo (ele lê zero exatamente porque o
    // render não tá puxando samples).
    // Detecção: com render morto, ctx.currentTime CONGELA. Checamos a cada
    // 600ms; congelou com state 'running' → kick suspend()→resume() religa
    // o pipeline (e realinha o scheduler se estava tocando). Cooldown 3s.
    // ⚠️ PEDAL: zero listeners, zero foco, zero capture — só API de áudio.
    if (isIOSDevice) {
      window.setInterval(() => {
        const ctx = this.audioContext;
        if ((ctx.state as string) !== 'running') { this.iosWatchdogLastCt = -1; return; }
        const ct = ctx.currentTime;
        const frozen = this.iosWatchdogLastCt >= 0 && ct === this.iosWatchdogLastCt;
        this.iosWatchdogLastCt = ct;
        if (!frozen) return;
        const now = performance.now();
        if (now - this.iosLastKickAt < 3000) return;
        this.iosLastKickAt = now;
        console.warn('[GDrums] render de áudio congelado (state running) — kick automático');
        const wasPlaying = this.stateManager.isPlaying();
        ctx.suspend().then(() => ctx.resume()).then(() => {
          if (wasPlaying && this.stateManager.isPlaying()) this.scheduler.restart();
        }).catch(() => {});
      }, 600);
    }

    // Inicializar gerenciadores
    this.stateManager = new StateManager();
    // Factory decide qual engine usar:
    // - Web/PWA: SEMPRE WebAudioEngine (sem risco)
    // - Capacitor: WebAudioEngine por default + flag opt-in pra NativeAudioEngine
    //   ('gdrums-engine'='native' no localStorage). Comportamento idêntico via
    //   IAudioEngine — Scheduler, FileManager, PreviewPlayer não percebem diferença.
    this.audioManager = createAudioEngine(this.audioContext);
    this.patternEngine = new PatternEngine(this.stateManager);
    this.scheduler = new Scheduler(this.stateManager, this.audioManager, this.patternEngine);
    this.fileManager = new FileManager(this.stateManager, this.audioManager);
    this.uiManager = new UIManager(this.stateManager);
    this.modalManager = new ModalManager();
    this.setlistManager = new SetlistManager();
    this.setlistEditor = new SetlistEditorUI();
    this.userRhythmService = new UserRhythmService();
    this.conversionManager = new ConversionManager();
    this.previewPlayer = new PreviewPlayer(this.audioContext, this.audioManager);

    // Setlist onChange — não atualizar UI automaticamente durante navegação
    // A UI é atualizada explicitamente após cada ação

    // Capturar prompt de instalação do PWA (Android)
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installPrompt = e;
    });

    // Configurar callbacks
    this.setupCallbacks();

    // Inicializar serviços nativos (iOS/Android)
    StatusBarService.init();

    // Deep links (Universal Links iOS / App Links Android): intercepta
    // https://gdrums.com.br/* clicado em email/whatsapp e roteia pra
    // página correspondente dentro do app. Crítico pro recovery de senha
    // funcionar quando o user clica no link do email com o app instalado.
    import('./native/DeepLinks').then(m => m.initDeepLinks()).catch(() => {});

    // Inicializar UI
    this.init();
  }

  private setupCallbacks(): void {
    // ═══════════════════════════════════════════════════════════════════════
    // Remote control do lockscreen iOS (MPRemoteCommandCenter via NowPlaying).
    // ═══════════════════════════════════════════════════════════════════════
    // Botões do Control Center / lockscreen / AirPods / BT car deck mapeiam
    // pra ações no app. Mesmo padrão do Spotify.
    NowPlayingService.onRemoteCommand((cmd) => {
      switch (cmd) {
        case 'play':
        case 'pause':
        case 'toggle':
          this.togglePlayStop();
          break;
        case 'next':
          // Próximo do setlist se tiver, senão próximo ritmo da biblioteca
          if (!this.setlistManager.isEmpty()) {
            const next = this.setlistManager.next();
            if (next) void this.loadSetlistItem(next);
          }
          break;
        case 'previous':
          if (!this.setlistManager.isEmpty()) {
            const prev = this.setlistManager.previous();
            if (prev) void this.loadSetlistItem(prev);
          }
          break;
      }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Visibilitychange — minimizar/voltar.
    // ═══════════════════════════════════════════════════════════════════════
    // Android: áudio continua em bg (user olha cifra em outro app).
    // iOS: WKWebView pausa áudio automaticamente.
    //
    // NOTA HISTÓRICA: antes de 14/abr, o código era só 4 linhas simples:
    //   if (!document.hidden && isPlaying()) { resume(); restart(); }
    // E isso FUNCIONAVA. As tentativas de "melhorar" (fade-out controlado,
    // preScheduleAhead, resyncToAudioClock, resetStep) introduziram bugs
    // maiores que o original. Mantemos o comportamento simples + fade-out
    // só no iOS (que realmente ajudou lá pela pausa do WKWebView).
    // ═══════════════════════════════════════════════════════════════════════
    const isIOSVis = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
                     (/Mac/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    let backgroundStartedAt = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (isIOSVis) this.iosAudioKickPending = true;
        backgroundStartedAt = performance.now();
        // Indo pro background — iOS fade-out antes do WKWebView pausar
        if (isIOSVis && this.stateManager.isPlaying()) {
          this.audioManager.fadeOutAllActive(0.03);
        }
        // Web/Android: não faz nada. Chromium mantém áudio rodando, scheduler
        // pode ficar throttled mas continua agendando enquanto o audio
        // exempt vale. Samples tocam limpos.
      } else {
        // Voltou pro foreground.
        // ── KICK do pipeline (iOS) ──
        // Modo de falha que NENHUM retry pega: AVAudioSession quica no
        // background e o WebAudio fica MUDO com state 'running' — o
        // resume() vira no-op e o user precisava matar/reabrir o app
        // várias vezes pro som voltar (relatos no iPhone 16).
        // suspend()→resume() força o WebKit a religar o render pipeline.
        // Só quando NÃO há som tocando (tocando, o kick daria um buraco;
        // nesse caso o kick acontece no próximo play, dentro do gesto).
        if (isIOSVis && this.iosAudioKickPending && !this.stateManager.isPlaying()) {
          this.iosAudioKickPending = false;
          const ctx = this.audioContext;
          if ((ctx.state as string) === 'running') {
            ctx.suspend().then(() => ctx.resume()).catch(() => {});
          }
        }
        if (this.stateManager.isPlaying()) {
          // resume() é seguro em qualquer plataforma — no-op se contexto já
          // tá running. Sem cancel/reset/restart em NENHUMA plataforma —
          // teste pra ver se iOS se recupera sozinho como web/Android.
          // Se iOS ficar mudo ou fora de fase, voltamos o tratamento.
          this.audioManager.resume();
          // Resync da cabeça: em background o lookahead vira 5s e o
          // currentStep interno roda na frente do áudio audível — comandos
          // pisados logo após voltar entravam "lá na frente" (virada
          // piscando como agendada por segundos). Volta a cabeça pro ponto
          // audível cancelando SÓ o áudio futuro; os mesmos steps são
          // re-agendados nos mesmos tempos (sem buraco, sem duplo áudio).
          // Cheio de guardas internas — se houver fill/end/intro na janela,
          // não faz nada (comportamento antigo).
          this.scheduler.resyncHeadToAudible();
        }
        // iOS: sair de 'interrupted' às vezes rejeita o 1º resume() e só
        // aceita re-tentativas espaçadas (timing interno do AVAudioSession).
        // Retry leve por até 3s. Se mesmo assim não pegar, os unlock
        // listeners (re-armados via statechange) destravam no próximo toque.
        // Retry roda MESMO sem isPlaying — o user pode dar play logo após
        // voltar e o contexto precisa estar são.
        if (isIOSVis && (this.audioContext.state as string) !== 'running') {
          const retryStart = performance.now();
          const retryTimer = window.setInterval(() => {
            const st = this.audioContext.state as string;
            if (st === 'running' || performance.now() - retryStart > 3000) {
              clearInterval(retryTimer);
              return;
            }
            this.audioContext.resume().catch(() => {});
          }, 250);
        }
        backgroundStartedAt = 0;
      }
    });

    // pagehide dispara ANTES do visibilitychange no iOS — chamar resume()
    // aqui força o WebKit a manter contexto "ativo" durante a transição
    // pra background. Pode reduzir o silêncio inicial de ~1s reportado.
    // Na web/Android o pagehide é raro (só fechamento de aba) — chamar
    // resume() é no-op se contexto já tá running. Zero risco.
    window.addEventListener('pagehide', () => {
      if (this.stateManager.isPlaying()) {
        this.audioManager.resume();
      }
    });

    // Scheduler -> UI (step visual + beat marker + countdown)
    this.scheduler.setUpdateStepCallback((step: number, pattern: PatternType) => {
      // Fase da grade no TEMPO REAL do step (este callback dispara no drain
      // de áudio, ~no instante em que o step toca) — usado pela contagem da
      // pausa pra cair no tempo do ritmo, não no agendamento (lookahead).
      this.lastStepTime = this.audioManager.getCurrentTime();
      this.lastStepIndex = step;
      this.uiManager.updateCurrentStepVisual();
      this.updateBeatMarker(step, pattern);
      this.updateCountdown(step, pattern);
    });

    // PatternEngine -> UI
    this.patternEngine.setOnPatternChange((pattern: PatternType) => {
      this.uiManager.updateStatusUI(pattern);
      this.uiManager.updatePerformanceGrid();
      this.uiManager.clearQueuedCells();
    });

    // Fura-fila do lookahead: virada/finalização/troca calculam a entrada
    // em cima do que está SOANDO, não da cabeça de agendamento (0.25-0.5s
    // à frente). Sem isso, pisar no pedal demorava lookahead + 1 step pra
    // responder — o famoso "apertei e não fez na hora".
    this.patternEngine.setBeforeTimingCommand(() => {
      this.scheduler.resyncForCommand();
    });

    this.patternEngine.setOnEndCymbal((time: number) => {
      // Agendar prato no tempo exato após o último step do end
      // (prato automático — ganho reduzido, ver AUTO_CYMBAL_GAIN)
      if (this.cymbalBuffer) {
        this.audioManager.playSound(this.cymbalBuffer, time, this.stateManager.getState().masterVolume * AUTO_CYMBAL_GAIN);
      } else {
        // Buffer ainda não carregado — carregar e tocar
        this.audioManager.loadAudioFromPath('/midi/prato.mp3').then(buffer => {
          this.cymbalBuffer = buffer;
          this.audioManager.playSound(buffer, time, this.stateManager.getState().masterVolume * AUTO_CYMBAL_GAIN);
        });
      }
    });

    this.patternEngine.setOnStop(() => {
      // onStop é chamado SÓ quando um "Final" (end) termina de tocar.
      this.stop();
      this.maybeAutoAdvance();
    });

    // StateManager -> UI observers
    this.stateManager.subscribe('playState', (state) => {
      this.uiManager.updatePlayStopUI(state.isPlaying);
      this.updateUserStatusBar(state);
    });

    this.stateManager.subscribe('tempo', (state) => {
      this.uiManager.updateTempoUI(state.tempo);
      this.updateCurrentRhythmMeta();
    });

    this.stateManager.subscribe('patterns', () => {
      this.uiManager.refreshGridDisplay();
    });

    this.stateManager.subscribe('variations', () => {
      this.uiManager.updateVariationButtons();
      this.uiManager.updatePerformanceGrid();
    });

    this.stateManager.subscribe('pendingFill', () => {
      this.uiManager.updatePerformanceGrid();
    });

    this.stateManager.subscribe('pendingEnd', () => {
      this.uiManager.updatePerformanceGrid();
    });

    // Subscribe para atualizar o step atual
    this.stateManager.subscribe('currentStep', (state) => {
      this.updateUserStatusBar(state);
    });
  }

  private updateUserStatusBar(state: SequencerState): void {
    // Atualizar status
    const statusUser = document.getElementById('statusUser');
    if (statusUser) {
      statusUser.textContent = state.isPlaying ? t('main.status.playing') : t('main.status.stopped');
    }

    // Atualizar posição atual
    const currentStepUser = document.getElementById('currentStepUser');
    if (currentStepUser) {
      const activePattern = state.activePattern as 'intro' | 'main' | 'fill' | 'end';
      const totalSteps = state.patternSteps[activePattern] || 16;
      currentStepUser.textContent = `${state.currentStep + 1}/${totalSteps}`;
    }

    // Atualizar próxima entrada (sempre mostra o padrão ativo)
    const nextEntryUser = document.getElementById('nextEntryUser');
    if (nextEntryUser) {
      const patternNames: Record<PatternType, string> = {
        intro: t('main.patternName.intro'),
        main: t('main.patternName.main'),
        fill: t('main.patternName.fill'),
        end: t('main.patternName.end'),
        transition: t('main.patternName.transition')
      };
      nextEntryUser.textContent = patternNames[state.activePattern] || '-';
    }
  }

  private init(): void {
    // Detectar WebView (Instagram, Facebook, etc) e avisar pra abrir no navegador
    const ua = navigator.userAgent || '';
    if (/Instagram|FBAN|FBAV|Line|Twitter/i.test(ua)) {
      document.body.innerHTML = `
        <div style="position:fixed;inset:0;background:#030014;display:flex;align-items:center;justify-content:center;padding:2rem;z-index:99999;">
          <div style="text-align:center;max-width:360px;">
            <img src="/img/logo.png" alt="GDrums" style="height:36px;opacity:0.7;margin-bottom:1.5rem;">
            <h2 style="color:#fff;font-size:1.1rem;margin:0 0 0.75rem;">${t('main.webviewWarning.title')}</h2>
            <p style="color:rgba(255,255,255,0.5);font-size:0.85rem;line-height:1.6;margin:0 0 1.5rem;">
              ${t('main.webviewWarning.body')}
            </p>
            <div style="background:rgba(0,212,255,0.06);border:1px solid rgba(0,212,255,0.15);border-radius:12px;padding:0.85rem;margin-bottom:1rem;">
              <p style="color:rgba(0,212,255,0.8);font-size:0.8rem;margin:0;">${t('main.webviewWarning.hint')}</p>
            </div>
            <a href="https://gdrums.com.br" style="display:inline-block;padding:0.7rem 2rem;background:linear-gradient(135deg,#00D4FF,#8B5CF6);color:#fff;text-decoration:none;border-radius:12px;font-weight:700;font-size:0.9rem;">${t('main.webviewWarning.copyLink')}</a>
          </div>
        </div>
      `;
      // Copiar link ao clicar
      document.querySelector('a')?.addEventListener('click', (e) => {
        e.preventDefault();
        navigator.clipboard?.writeText('https://gdrums.com.br').catch(() => {});
        const btn = e.target as HTMLElement;
        btn.textContent = t('main.webviewWarning.copied');
        setTimeout(() => { btn.textContent = t('main.webviewWarning.copyLink'); }, 2000);
      });
      return;
    }

    this.checkAccess().then(async (allowed) => {
      if (!allowed) return;

      // Inicializar favoritos — online: Supabase, offline: cache local
      try {
        const { supabase } = await import('./auth/supabase');
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          await this.setlistManager.initWithUser(session.user.id, supabase);
          await this.userRhythmService.initWithUser(session.user.id, supabase);

          // OneSignal: linka o user ao subscriber pra segmentação
          // Fire-and-forget — não bloqueia o app se OneSignal falhar
          import('./native/OneSignalService').then(async ({ initOneSignal, linkUserToPush, syncSubscriptionId }) => {
            await initOneSignal();
            await linkUserToPush(session.user.id);
            // Após linkar, salva o onesignal_id no Supabase pra admin
            // poder mandar push pra user específico
            syncSubscriptionId(session.user.id, supabase).catch(() => {});
          }).catch(() => { /* SDK falhou — sem push, app continua */ });

          // Push nativo (Capacitor Android/iOS): registra device no FCM/APNs
          // e cria subscription no OneSignal via edge function. Sem isso,
          // user com app instalado não recebe push (só via web/PWA).
          import('./native/NativePushService').then(({ initNativePush }) => {
            initNativePush(session.user.id).catch(() => {});
          }).catch(() => { /* não-nativo, ignora */ });
        }
      } catch {
        // Offline — setlist usa cache local automaticamente
      }

      // Carregar teclas do pedal (formato suporta 2/3/4 botões)
      const savedPedal = localStorage.getItem('gdrums_pedal_keys');
      if (savedPedal) {
        try {
          const parsed = JSON.parse(savedPedal);
          if (parsed.left) this.pedalLeft = parsed.left;
          if (parsed.right) this.pedalRight = parsed.right;
          if (parsed.count === 3 || parsed.count === 4) this.pedalCount = parsed.count;
          if (parsed.playPause) this.pedalPlayPause = parsed.playPause;
          if (parsed.end) this.pedalEnd = parsed.end;
        } catch { /* usar padrão */ }
      }
      localStorage.removeItem('gdrums_pedal_map'); // limpar formato antigo

      this.generateChannelsHTML();
      this.setupEventListeners();
      this.setupSetlistUI();
      this.loadAvailableMidi();
      this.loadAvailableRhythms();

      // Pré-carregar buffer do prato para evitar delay na primeira vez
      this.audioManager.loadAudioFromPath('/midi/prato.mp3').then(buffer => {
        this.cymbalBuffer = buffer;
      }).catch(() => {});

      // What's New — mostra novidades 1x por versão
      setTimeout(() => this.showWhatsNew(), 1500);

      // Sugerir instalação do app (1x, só se não está instalado)
      setTimeout(() => this.showInstallSuggestion(), 4000);

      // Modal de download offline — 1a vez ou quando manifest atualizar
      setTimeout(() => this.maybeShowOfflineDownload(), 6500);

      // Banner soft de notificações push — aparece pra user autenticado
      // que ainda não permitiu e não dismissou recentemente
      setTimeout(() => this.maybeShowPushBanner(), 10000);
    });
  }

  // ─── What's New ───────────────────────────────────────────────────

  private static readonly WHATS_NEW = {
    version: '3.3',
    overline: t('main.whatsNew.overline'),
    title: t('main.whatsNew.title'),
    subtitle: t('main.whatsNew.subtitle'),
    sections: [
      {
        label: t('main.whatsNew.section1.label'),
        featured: true,
        body: t('main.whatsNew.section1.body'),
      },
      {
        label: t('main.whatsNew.section2.label'),
        body: t('main.whatsNew.section2.body'),
      },
      {
        label: t('main.whatsNew.section3.label'),
        body: t('main.whatsNew.section3.body'),
      },
      {
        label: t('main.whatsNew.section4.label'),
        body: t('main.whatsNew.section4.body'),
      },
      {
        label: t('main.whatsNew.section5.label'),
        body: t('main.whatsNew.section5.body'),
      },
      {
        label: t('main.whatsNew.section6.label'),
        body: t('main.whatsNew.section6.body'),
      },
    ]
  };

  // ─── Download Offline ─────────────────────────────────────────────
  //
  // Modal que aparece (a) na 1a vez que o user loga, ou (b) quando o
  // manifest do servidor tem version maior que a versão baixada.
  // Baixa todos os ritmos + samples em paralelo (4 concurrent) com
  // barra de progresso. Não bloqueia: user pode pular.

  // ─── Push notifications — banner soft ─────────────────────────────
  //
  // Aparece quando:
  // - User autenticado
  // - Browser suporta push (iOS Safari comum não suporta)
  // - Permissão ainda não foi concedida nem negada
  // - User não dismissou nos últimos 7 dias
  //
  // Toast discreto no rodapé com "Permitir" / "Agora não". Click em
  // "Permitir" dispara o prompt nativo do browser (precisa de gesture).

  private async maybeShowPushBanner(): Promise<void> {
    try {
      // Em Capacitor nativo (iOS/Android), o prompt do sistema já é mostrado
      // pelo NativePushService no login. Não duplicar com banner web.
      const { Capacitor } = await import('@capacitor/core');
      if (Capacitor.isNativePlatform()) return;

      const { isPushSupported, hasPushPermission, isBannerDismissedRecently } = await import('./native/OneSignalService');

      if (!isPushSupported()) return;
      if (isBannerDismissedRecently()) return;
      if (await hasPushPermission()) return;

      // Estado da permissão ainda é "default" (não pediu nada) — mostra banner
      this.showPushBanner();
    } catch { /* noop */ }
  }

  private showPushBanner(): void {
    if (document.getElementById('pushBanner')) return; // já existe

    const banner = document.createElement('div');
    banner.id = 'pushBanner';
    banner.className = 'push-banner';
    banner.innerHTML = `
      <div class="push-banner-content">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 01-3.46 0"/>
        </svg>
        <div class="push-banner-text">
          <strong>${t('main.pushBanner.title')}</strong>
          <span>${t('main.pushBanner.subtitle')}</span>
        </div>
      </div>
      <div class="push-banner-actions">
        <button class="push-banner-skip" id="pushBannerSkip">${t('main.pushBanner.skip')}</button>
        <button class="push-banner-allow" id="pushBannerAllow">${t('main.pushBanner.allow')}</button>
      </div>
    `;
    document.body.appendChild(banner);
    this.injectPushBannerCss();

    // Anima entrada
    setTimeout(() => banner.classList.add('push-banner-visible'), 50);

    const dismiss = async (markDismissed: boolean) => {
      if (markDismissed) {
        const { markBannerDismissed } = await import('./native/OneSignalService');
        markBannerDismissed();
      }
      banner.classList.remove('push-banner-visible');
      setTimeout(() => banner.remove(), 220);
    };

    banner.querySelector('#pushBannerSkip')?.addEventListener('click', () => dismiss(true));

    banner.querySelector('#pushBannerAllow')?.addEventListener('click', async () => {
      const allowBtn = banner.querySelector('#pushBannerAllow') as HTMLButtonElement;
      allowBtn.disabled = true;
      allowBtn.textContent = t('main.pushBanner.waiting');
      let granted = false;
      try {
        const { requestPushPermission, syncSubscriptionId } = await import('./native/OneSignalService');
        granted = await requestPushPermission();
        if (granted) {
          // Sincroniza ID com Supabase
          const { supabase } = await import('./auth/supabase');
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            syncSubscriptionId(session.user.id, supabase).catch(() => {});
          }
          Toast.show(t('main.pushBanner.enabledToast'), { type: 'success' });
        } else {
          Toast.show(t('main.pushBanner.laterToast'), { type: 'info' });
        }
      } catch { /* noop */ }
      // Só marca como dismissed se permissão foi NEGADA — assim, se algo
      // der ruim (estado fantasma do OneSignal, server delete, etc), o
      // banner volta no próximo login pro user tentar de novo. Se ele
      // permitiu, o filtro hasPushPermission() vai esconder o banner
      // naturalmente.
      dismiss(!granted);
    });
  }

  private injectPushBannerCss(): void {
    if (document.getElementById('push-banner-css')) return;
    const style = document.createElement('style');
    style.id = 'push-banner-css';
    style.textContent = `
      .push-banner {
        position: fixed;
        bottom: 1rem; left: 50%;
        transform: translateX(-50%) translateY(120%);
        width: calc(100% - 2rem); max-width: 480px;
        background: #0a0a0f;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 14px;
        padding: 0.85rem 1rem 0.9rem;
        z-index: 9998;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
        transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        backdrop-filter: blur(10px);
      }
      .push-banner-visible { transform: translateX(-50%) translateY(0); }
      .push-banner-content {
        display: flex; align-items: flex-start; gap: 0.7rem;
        margin-bottom: 0.65rem;
        color: rgba(255, 255, 255, 0.9);
      }
      .push-banner-content svg {
        flex-shrink: 0; color: #00D4FF; margin-top: 0.1rem;
      }
      .push-banner-text { display: flex; flex-direction: column; gap: 0.15rem; }
      .push-banner-text strong {
        font-size: 0.95rem; font-weight: 600; letter-spacing: -0.005em;
      }
      .push-banner-text span {
        font-size: 0.78rem; color: rgba(255, 255, 255, 0.55); line-height: 1.4;
      }
      .push-banner-actions { display: flex; gap: 0.5rem; }
      .push-banner-skip, .push-banner-allow {
        flex: 1; padding: 0.65rem;
        border: none; border-radius: 9px;
        font-size: 0.85rem; font-weight: 600;
        font-family: inherit; cursor: pointer;
        transition: opacity 0.15s, background 0.15s;
      }
      .push-banner-skip {
        background: rgba(255, 255, 255, 0.05);
        color: rgba(255, 255, 255, 0.65);
      }
      .push-banner-skip:hover {
        background: rgba(255, 255, 255, 0.08); color: #fff;
      }
      .push-banner-allow {
        background: #00D4FF; color: #0a0a0f;
      }
      .push-banner-allow:hover { opacity: 0.9; }
      .push-banner-allow:disabled { opacity: 0.6; cursor: default; }
    `;
    document.head.appendChild(style);
  }

  private async maybeShowOfflineDownload(): Promise<void> {
    try {
      // Só dispara quando online (offline não faz sentido baixar)
      if (!navigator.onLine) return;

      // No app nativo (iOS/Android via Capacitor), os ritmos+samples já vêm
      // bundleados em www/ — não precisa baixar nada. Marca como ready e sai.
      if (isNativeApp()) {
        const { markNativeReady } = await import('./native/OfflineDownloader');
        await markNativeReady();
        return;
      }

      const { getOfflineStatus } = await import('./native/OfflineDownloader');
      const status = await getOfflineStatus();

      // Lê versão atual do servidor — se mesma da baixada, não precisa
      const manifestRes = await fetch('/rhythm/manifest.json').catch(() => null);
      if (!manifestRes || !manifestRes.ok) return;
      const manifest = await manifestRes.json();
      const currentVersion = manifest.version || 0;

      if (status.ready && status.manifestVersion === currentVersion) {
        return; // já tá em dia
      }

      // Dismiss persistente: se user pulou nessa versão, não pergunta de novo
      // até a próxima atualização do manifest
      const skippedVersion = parseInt(localStorage.getItem('gdrums-offline-skipped') || '0');
      if (skippedVersion === currentVersion) return;

      this.showOfflineDownloadModal(currentVersion, status.ready);
    } catch {
      /* falha silenciosa — não bloqueia o app */
    }
  }

  private showOfflineDownloadModal(targetVersion: number, isUpdate: boolean): void {
    const overlay = document.createElement('div');
    overlay.className = 'offline-modal-overlay';
    overlay.innerHTML = `
      <div class="offline-modal">
        <div class="offline-icon">
          <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </div>
        <h2 class="offline-title">${isUpdate ? t('main.offlineDownload.titleUpdate') : t('main.offlineDownload.titleFirst')}</h2>
        <p class="offline-sub">${isUpdate
          ? t('main.offlineDownload.subUpdate')
          : t('main.offlineDownload.subFirst')}</p>

        <div class="offline-stats" id="offlineStats" style="display:none;">
          <div class="offline-progress-bar">
            <div class="offline-progress-fill" id="offlineProgressFill" style="width:0%;"></div>
          </div>
          <div class="offline-progress-text" id="offlineProgressText">${t('main.offlineDownload.preparing')}</div>
          <div class="offline-current-file" id="offlineCurrentFile"></div>
        </div>

        <div class="offline-actions" id="offlineActions">
          <button class="offline-btn offline-btn-skip" id="offlineSkipBtn">${t('main.offlineDownload.skip')}</button>
          <button class="offline-btn offline-btn-go" id="offlineStartBtn">${t('main.offlineDownload.start')}</button>
        </div>

        <div class="offline-actions offline-actions-during" id="offlineActionsDuring" style="display:none;">
          <button class="offline-btn offline-btn-skip" id="offlineCancelBtn">${t('main.offlineDownload.cancel')}</button>
          <button class="offline-btn offline-btn-go" id="offlineBgBtn">${t('main.offlineDownload.background')}</button>
        </div>

        <div class="offline-done" id="offlineDone" style="display:none;">
          <div class="offline-done-icon">✓</div>
          <div class="offline-done-text">${t('main.offlineDownload.doneText')}</div>
          <button class="offline-btn offline-btn-go" id="offlineCloseBtn">${t('main.offlineDownload.close')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    this.injectOfflineCss();

    const skipBtn = overlay.querySelector('#offlineSkipBtn') as HTMLButtonElement;
    const startBtn = overlay.querySelector('#offlineStartBtn') as HTMLButtonElement;
    const statsDiv = overlay.querySelector('#offlineStats') as HTMLElement;
    const actionsInitial = overlay.querySelector('#offlineActions') as HTMLElement;
    const actionsDuring = overlay.querySelector('#offlineActionsDuring') as HTMLElement;
    const doneDiv = overlay.querySelector('#offlineDone') as HTMLElement;
    const progressFill = overlay.querySelector('#offlineProgressFill') as HTMLElement;
    const progressText = overlay.querySelector('#offlineProgressText') as HTMLElement;
    const currentFile = overlay.querySelector('#offlineCurrentFile') as HTMLElement;
    const cancelBtn = overlay.querySelector('#offlineCancelBtn') as HTMLButtonElement;
    const bgBtn = overlay.querySelector('#offlineBgBtn') as HTMLButtonElement;
    const closeBtn = overlay.querySelector('#offlineCloseBtn') as HTMLButtonElement;

    const abortController = new AbortController();
    let inBackground = false;

    const closeModal = () => { overlay.remove(); };

    skipBtn?.addEventListener('click', () => {
      // Salva versão pulada — não pergunta de novo até subir manifest novo
      localStorage.setItem('gdrums-offline-skipped', String(targetVersion));
      closeModal();
    });

    cancelBtn?.addEventListener('click', () => {
      abortController.abort();
      closeModal();
    });

    bgBtn?.addEventListener('click', () => {
      inBackground = true;
      closeModal();
      Toast.show(t('main.offlineDownload.bgToast'), { type: 'info' });
    });

    closeBtn?.addEventListener('click', closeModal);

    startBtn?.addEventListener('click', async () => {
      actionsInitial.style.display = 'none';
      actionsDuring.style.display = '';
      statsDiv.style.display = '';

      try {
        const { downloadEverything } = await import('./native/OfflineDownloader');
        const result = await downloadEverything((progress) => {
          if (inBackground) return; // não atualiza UI se foi pra background
          const pct = Math.round((progress.current / progress.total) * 100);
          progressFill.style.width = pct + '%';
          progressText.textContent = t('main.offlineDownload.progress', { current: progress.current, total: progress.total, pct });
          currentFile.textContent = progress.currentFile;
        }, abortController.signal);

        if (inBackground) {
          if (result.success) {
            Toast.show(t('main.offlineDownload.successToast'), { type: 'success' });
          } else if (result.failed.length > 0) {
            Toast.show(t('main.offlineDownload.failedToast', { count: result.failed.length }), { type: 'warn' });
          }
          return;
        }

        // Fluxo em primeiro plano: mostra tela "tudo pronto"
        if (result.success) {
          actionsDuring.style.display = 'none';
          statsDiv.style.display = 'none';
          doneDiv.style.display = '';
          HapticsService.success();
        } else if (result.failed.length > 0) {
          // Mostra opção de retry
          actionsDuring.style.display = 'none';
          actionsInitial.style.display = '';
          progressText.textContent = t('main.offlineDownload.retryHint', { count: result.failed.length });
          startBtn.textContent = t('main.offlineDownload.retry');
        }
      } catch (e) {
        if (!inBackground && !abortController.signal.aborted) {
          progressText.textContent = t('main.offlineDownload.errorText');
          actionsDuring.style.display = 'none';
          actionsInitial.style.display = '';
        }
      }
    });
  }

  private injectOfflineCss(): void {
    if (document.getElementById('offline-modal-css')) return;
    const style = document.createElement('style');
    style.id = 'offline-modal-css';
    style.textContent = `
      .offline-modal-overlay {
        position: fixed; inset: 0; z-index: 99999;
        background: rgba(0, 0, 0, 0.78);
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        display: flex; align-items: center; justify-content: center;
        padding: 1.5rem;
        animation: offline-fade-in 0.2s ease;
      }
      @keyframes offline-fade-in { from { opacity: 0; } to { opacity: 1; } }
      .offline-modal {
        width: 100%; max-width: 460px;
        background: #0a0a0f;
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 18px;
        padding: 2rem 1.75rem 1.5rem;
        text-align: center;
        animation: offline-slide-in 0.25s ease;
      }
      @keyframes offline-slide-in {
        from { opacity: 0; transform: translateY(12px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .offline-icon {
        width: 64px; height: 64px;
        background: rgba(0, 212, 255, 0.1);
        border: 1px solid rgba(0, 212, 255, 0.3);
        border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        margin: 0 auto 1rem;
        color: #00D4FF;
      }
      .offline-title {
        font-size: 1.3rem; font-weight: 700;
        letter-spacing: -0.02em; color: #fff;
        margin-bottom: 0.5rem;
      }
      .offline-sub {
        font-size: 0.9rem; line-height: 1.5;
        color: rgba(255, 255, 255, 0.6);
        margin-bottom: 1.5rem;
      }
      .offline-stats { margin-bottom: 1.5rem; }
      .offline-progress-bar {
        width: 100%; height: 8px;
        background: rgba(255, 255, 255, 0.06);
        border-radius: 4px; overflow: hidden;
        margin-bottom: 0.6rem;
      }
      .offline-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #00D4FF, #3ee8a7);
        transition: width 0.18s ease;
        border-radius: 4px;
      }
      .offline-progress-text {
        font-size: 0.85rem; font-weight: 600;
        color: #fff;
        margin-bottom: 0.3rem;
      }
      .offline-current-file {
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.4);
        font-family: ui-monospace, SFMono-Regular, monospace;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .offline-actions {
        display: flex; gap: 0.6rem;
      }
      .offline-btn {
        flex: 1;
        padding: 0.85rem;
        border: none; border-radius: 10px;
        font-size: 0.92rem; font-weight: 600;
        font-family: inherit; cursor: pointer;
        transition: opacity 0.15s, background 0.15s;
      }
      .offline-btn-skip {
        background: rgba(255,255,255,0.05);
        color: rgba(255,255,255,0.7);
        border: 1px solid rgba(255,255,255,0.1);
      }
      .offline-btn-skip:hover {
        background: rgba(255,255,255,0.08); color: #fff;
      }
      .offline-btn-go {
        background: #fff; color: #0a0a0f;
      }
      .offline-btn-go:hover { opacity: 0.9; }
      .offline-done { text-align: center; }
      .offline-done-icon {
        font-size: 3rem;
        color: #3ee8a7;
        margin-bottom: 0.5rem;
      }
      .offline-done-text {
        font-size: 0.95rem; color: #fff;
        margin-bottom: 1.25rem;
      }
    `;
    document.head.appendChild(style);
  }

  private showWhatsNew(): void {
    const key = 'gdrums-whats-new-seen';
    const seen = localStorage.getItem(key);
    if (seen === RhythmSequencer.WHATS_NEW.version) return;

    const wn = RhythmSequencer.WHATS_NEW;

    const overlay = document.createElement('div');
    overlay.className = 'wn-modal-overlay';
    overlay.innerHTML = `
      <div class="wn-modal">
        <button class="wn-close" aria-label="${t('main.whatsNew.closeAriaLabel')}">×</button>
        <div class="wn-overline">${t('main.whatsNew.overlineVersion', { overline: wn.overline, version: wn.version })}</div>
        <h2 class="wn-title">${wn.title}</h2>
        <p class="wn-subtitle">${wn.subtitle}</p>
        <div class="wn-sections">
          ${wn.sections.map((s: any) => `
            <div class="wn-section${s.featured ? ' wn-section-featured' : ''}">
              <div class="wn-section-label">
                ${s.featured ? `<span class="wn-badge">${t('main.whatsNew.badge')}</span>` : ''}
                ${s.label}
              </div>
              <p class="wn-section-body">${s.body}</p>
            </div>
          `).join('')}
        </div>
        <button class="wn-cta" id="whatsNewOk">${t('main.whatsNew.cta')}</button>
      </div>
    `;
    document.body.appendChild(overlay);

    // CSS injetado uma vez
    if (!document.getElementById('wn-modal-css')) {
      const style = document.createElement('style');
      style.id = 'wn-modal-css';
      style.textContent = `
        .wn-modal-overlay {
          position: fixed; inset: 0;
          background: rgba(0, 0, 0, 0.72);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          display: flex; align-items: flex-start; justify-content: center;
          padding: 1.5rem;
          padding-top: calc(1.5rem + env(safe-area-inset-top, 0px));
          padding-bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px));
          z-index: 100000;
          animation: wnOverlayIn 0.28s ease;
          font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
        }
        @media (min-height: 620px) {
          .wn-modal-overlay { align-items: center; }
        }
        @keyframes wnOverlayIn { from { opacity: 0; } to { opacity: 1; } }
        .wn-modal {
          width: 100%; max-width: 440px;
          background: #0a0a0f;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 20px;
          padding: 2rem 1.75rem 1.5rem;
          color: #fff; position: relative;
          margin: auto;
          animation: wnModalIn 0.32s cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        @keyframes wnModalIn {
          from { transform: translateY(12px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .wn-close {
          position: absolute; top: 0.75rem; right: 0.75rem;
          width: 32px; height: 32px;
          background: transparent; border: none;
          color: rgba(255, 255, 255, 0.35);
          font-size: 1.5rem; line-height: 1; cursor: pointer;
          border-radius: 8px;
          transition: color 0.15s, background 0.15s;
        }
        .wn-close:hover { color: #fff; background: rgba(255,255,255,0.05); }
        .wn-overline {
          font-size: 0.68rem; letter-spacing: 0.14em; text-transform: uppercase;
          color: rgba(255, 255, 255, 0.42); font-weight: 500;
          margin-bottom: 0.85rem;
        }
        .wn-title {
          font-size: 1.45rem; line-height: 1.25;
          font-weight: 600; letter-spacing: -0.015em;
          color: #fff; margin: 0 0 0.5rem;
        }
        .wn-subtitle {
          font-size: 0.9rem; line-height: 1.5;
          color: rgba(255, 255, 255, 0.55);
          margin: 0 0 1.5rem;
        }
        .wn-sections {
          display: flex; flex-direction: column;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          margin-bottom: 1.5rem;
        }
        .wn-section {
          padding: 0.9rem 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }
        .wn-section-featured {
          margin: 0.25rem -0.9rem;
          padding: 1rem 0.9rem;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
        }
        .wn-section-featured + .wn-section {
          border-top: 1px solid rgba(255, 255, 255, 0.06);
        }
        .wn-section-label {
          font-size: 0.76rem; font-weight: 600;
          color: #fff; margin-bottom: 0.4rem;
          letter-spacing: -0.005em;
          display: flex; align-items: center; gap: 0.5rem;
        }
        .wn-badge {
          display: inline-block;
          font-size: 0.58rem; font-weight: 600;
          letter-spacing: 0.12em; text-transform: uppercase;
          color: #0a0a0f; background: #fff;
          padding: 0.2rem 0.45rem;
          border-radius: 4px;
        }
        .wn-section-body {
          font-size: 0.86rem; line-height: 1.5;
          color: rgba(255, 255, 255, 0.65);
          margin: 0;
        }
        .wn-section-featured .wn-section-body {
          color: rgba(255, 255, 255, 0.78);
        }
        .wn-cta {
          width: 100%; padding: 0.9rem;
          background: #fff; color: #0a0a0f;
          border: none; border-radius: 10px;
          font-size: 0.95rem; font-weight: 600;
          letter-spacing: -0.005em;
          font-family: inherit; cursor: pointer;
          transition: opacity 0.15s;
        }
        .wn-cta:hover { opacity: 0.9; }
        .wn-cta:active { transform: scale(0.99); }
      `;
      document.head.appendChild(style);
    }

    const close = () => {
      localStorage.setItem(key, wn.version);
      overlay.remove();
      (window as any).__refocusPedal?.(); // refocus síncrono p/ pedal iOS
    };

    overlay.querySelector('.wn-close')?.addEventListener('click', close);
    overlay.querySelector('#whatsNewOk')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    };
    document.addEventListener('keydown', onKey);
  }

  /**
   * Limpa apenas dados de SESSÃO do localStorage, preservando dados do USER
   * (setlist, ritmos personalizados, mapeamento de pedal, etc).
   *
   * Usado quando detectamos que outra sessão tomou o lugar deste device.
   * Antes era localStorage.clear() — apagava setlist do user só porque ele
   * abriu o app em outro celular, causando perda silenciosa de repertório.
   */
  private clearSessionDataOnly(): void {
    // SÓ remove o que é de sessão/transitório:
    localStorage.removeItem('gdrums-session-id');
    localStorage.removeItem('gdrums-pending-order');
    localStorage.removeItem('gdrums-mode');
    // Token do Supabase (formato: sb-<ref>-auth-token) — remove tudo que
    // começa com sb- pra evitar resíduo de sessão
    Object.keys(localStorage)
      .filter(k => k.startsWith('sb-'))
      .forEach(k => localStorage.removeItem(k));
    // PRESERVA explicitamente: gdrums-setlist, gdrums-user-rhythms,
    // gdrums_pedal_keys, gdrums-toggle-*, gdrums-attr-v1, gdrums-whats-new-seen
  }

  private async checkAccess(): Promise<boolean> {
    const { supabase } = await import('./auth/supabase');

    // ─── Modo offline: se não tem rede, usar cache local ────────────
    if (OfflineCache.isOffline()) {
      if (OfflineCache.hasValidOfflineAccess()) {
        const cached = OfflineCache.getProfile();
        if (cached?.subscriptionExpiresAt) {
          this.showSubscriptionBanner(
            cached.subscriptionStatus,
            new Date(cached.subscriptionExpiresAt),
            cached.subscriptionPlan
          );
        }
        // Quando reconectar, revalidar acesso e atualizar cache
        window.addEventListener('online', () => {
          this.checkAccess();
        }, { once: true });
        return true;
      }

      // Sem cache válido e sem rede — explicar o motivo
      const cached = OfflineCache.getProfile();
      let reason = t('main.access.offlineReasonDefault');
      if (cached) {
        const expires = cached.subscriptionExpiresAt ? new Date(cached.subscriptionExpiresAt) : null;
        const cacheAge = Date.now() - cached.cachedAt;
        const maxAge = 7 * 24 * 60 * 60 * 1000;

        if (expires && expires <= new Date()) {
          reason = t('main.access.offlineReasonExpired');
        } else if (cacheAge > maxAge) {
          reason = t('main.access.offlineReasonStale');
        }
      }

      // Mostrar mensagem antes de redirecionar
      document.body.innerHTML = `
        <div style="position:fixed;inset:0;background:#030014;display:flex;align-items:center;justify-content:center;padding:2rem;">
          <div style="text-align:center;max-width:400px;">
            <div style="font-size:2.5rem;margin-bottom:1rem;">📡</div>
            <h2 style="color:#fff;font-size:1.2rem;margin:0 0 0.75rem;">${t('main.access.offlineTitle')}</h2>
            <p style="color:rgba(255,255,255,0.5);font-size:0.85rem;line-height:1.6;margin:0 0 1.5rem;">${reason}</p>
            <button onclick="window.location.reload()" style="
              padding:0.7rem 2rem;border:none;border-radius:12px;
              background:linear-gradient(135deg,#00D4FF,#8B5CF6);
              color:#fff;font-size:0.85rem;font-weight:600;cursor:pointer;font-family:inherit;
            ">${t('main.access.retryButton')}</button>
          </div>
        </div>
      `;
      // Quando reconectar, recarregar automaticamente
      window.addEventListener('online', () => window.location.reload(), { once: true });
      return false;
    }

    // ─── Modo online: autenticação normal ───────────────────────────
    let session;
    try {
      const result = await supabase.auth.getSession();
      session = result.data.session;
    } catch {
      // Falha de rede — navigator.onLine mentiu (comum no Capacitor)
      // Fallback pro cache offline
      if (OfflineCache.hasValidOfflineAccess()) {
        const cached = OfflineCache.getProfile();
        if (cached?.subscriptionExpiresAt) {
          this.showSubscriptionBanner(cached.subscriptionStatus, new Date(cached.subscriptionExpiresAt), cached.subscriptionPlan);
        }
        window.addEventListener('online', () => this.checkAccess(), { once: true });
        return true;
      }
      internalNav('/login');
      return false;
    }

    if (!session) {
      // Sem sessão mas pode ter cache offline válido
      if (OfflineCache.hasValidOfflineAccess()) {
        const cached = OfflineCache.getProfile();
        if (cached?.subscriptionExpiresAt) {
          this.showSubscriptionBanner(cached.subscriptionStatus, new Date(cached.subscriptionExpiresAt), cached.subscriptionPlan);
        }
        return true;
      }
      internalNav('/login');
      return false;
    }

    // Validar token
    let userError;
    try {
      const result = await supabase.auth.getUser();
      userError = result.error;
    } catch {
      // Rede caiu durante validação — usar cache
      if (OfflineCache.hasValidOfflineAccess()) {
        const cached = OfflineCache.getProfile();
        if (cached?.subscriptionExpiresAt) {
          this.showSubscriptionBanner(cached.subscriptionStatus, new Date(cached.subscriptionExpiresAt), cached.subscriptionPlan);
        }
        return true;
      }
      internalNav('/login');
      return false;
    }

    if (userError) {
      // Tentar refresh do token antes de deslogar
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        // Refresh falhou — se tem cache offline valido, usar
        if (OfflineCache.hasValidOfflineAccess()) {
          const cached = OfflineCache.getProfile();
          if (cached?.subscriptionExpiresAt) {
            this.showSubscriptionBanner(cached.subscriptionStatus, new Date(cached.subscriptionExpiresAt), cached.subscriptionPlan);
          }
          return true;
        }
        await supabase.auth.signOut();
        internalNav('/login');
        return false;
      }
    }

    const { data: profile } = await supabase
      .from('gdrums_profiles')
      .select('role, subscription_status, subscription_expires_at, subscription_plan, active_session_id, cpf_hash, phone')
      .eq('id', session.user.id)
      .single();

    // Guardar role do usuário (vindo do banco, não do client)
    this.userRole = (profile?.role === 'admin') ? 'admin' : 'user';

    // Conta incompleta (sem CPF OU sem phone) — sempre redireciona pra
    // /completar-cadastro em vez de signOut + register. Mais amigável:
    // user pagante (ex: Romilson) não perde acesso, só preenche os campos.
    // Admin é exceção (não precisa de CPF/phone pra logar no painel).
    if (profile && profile.role !== 'admin') {
      const incomplete = !profile.cpf_hash || !profile.phone;
      if (incomplete) {
        // Log de segurança só pra contas criadas após o cutoff (mantém
        // rastreabilidade de trial farming sem bloquear acesso)
        const created = new Date(session.user.created_at || 0);
        const cutoff = new Date('2026-04-03T00:00:00Z');
        if (created >= cutoff) {
          fetch('https://qsfziivubwdgtmwyztfw.supabase.co/functions/v1/security-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_id: session.user.id,
              email: session.user.email,
              name: session.user.user_metadata?.name || '',
              event: 'incomplete_profile',
              details: 'Conta sem CPF ou telefone — redirecionada pra completar',
            }),
          }).catch(() => {});
        }
        // Evita loop se já tá na página de completar
        if (!/\/completar-cadastro/i.test(window.location.pathname)) {
          internalNav('/completar-cadastro');
        }
        return false;
      }
    }

    // Sessão única — verificar se este device é o ativo
    const localSessionId = localStorage.getItem('gdrums-session-id');
    if (profile?.active_session_id && localSessionId && localSessionId !== profile.active_session_id) {
      // Outra sessão está ativa — deslogar este device.
      // CRÍTICO: NÃO chamar localStorage.clear() — apaga setlist, ritmos
      // salvos, mapeamento de pedal, preferências, e o cara perde tudo só
      // porque abriu o app em outro device. Só tira o que é da sessão.
      await supabase.auth.signOut();
      this.clearSessionDataOnly();
      internalNav('/login');
      return false;
    }

    // Se não tem session ID local, adotar o do banco em vez de gerar um novo.
    // Gerar novo aqui sobrescreveria o active_session_id e deslogaria outros
    // devices legítimos (ex: admin abre /admin em outra aba, ou tá testando APK).
    // Só login.ts/register.ts escrevem active_session_id (semântica: novo login
    // invalida outros devices intencionalmente).
    if (!localSessionId) {
      if (profile?.active_session_id) {
        localStorage.setItem('gdrums-session-id', profile.active_session_id);
      } else {
        // Perfil realmente sem sessão ativa (conta antiga pré-feature) — gerar e gravar
        const newId = crypto.randomUUID();
        localStorage.setItem('gdrums-session-id', newId);
        supabase.from('gdrums_profiles')
          .update({ active_session_id: newId })
          .eq('id', session.user.id)
          .then();
      }
    }

    const status = profile?.subscription_status;
    const expires = profile?.subscription_expires_at;

    if ((status === 'active' || status === 'trial') && expires) {
      const expiresDate = new Date(expires);
      if (expiresDate > new Date()) {

        // Salvar perfil no cache offline para próximo acesso sem rede
        OfflineCache.saveProfile({
          userId: session.user.id,
          name: session.user.user_metadata?.name || '',
          email: session.user.email || '',
          role: this.userRole,
          subscriptionStatus: status,
          subscriptionPlan: profile?.subscription_plan || '',
          subscriptionExpiresAt: expires,
          cachedAt: Date.now(),
        });

        // Mostrar banner de trial/assinatura
        this.showSubscriptionBanner(status, expiresDate, profile?.subscription_plan || '');
        return true;
      }
    }

    // ─── Verificar pedidos pendentes no banco (cara pagou mas fechou a página) ──
    const { data: pendingTx } = await supabase
      .from('gdrums_transactions')
      .select('order_nsu, transaction_nsu')
      .eq('user_id', session.user.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Tentar confirmar pedido pendente (max 1 tentativa por sessao)
    const pendingChecked = sessionStorage.getItem('gdrums-pending-checked');
    if (pendingTx?.order_nsu && !pendingChecked) {
      sessionStorage.setItem('gdrums-pending-checked', '1');
      try {
        const webhookBody: Record<string, string> = { order_nsu: pendingTx.order_nsu };
        if (pendingTx.transaction_nsu) webhookBody.transaction_nsu = pendingTx.transaction_nsu;

        const webhookResponse = await fetch(
          `https://qsfziivubwdgtmwyztfw.supabase.co/functions/v1/payment-webhook`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(webhookBody),
          }
        );
        const result = await webhookResponse.json();
        if (result.success) {
          localStorage.removeItem('gdrums-pending-order');
          window.location.reload();
          return false;
        }
      } catch { /* pagamento não confirmado — seguir pro plans */ }
    }

    // Trial expirou e não há pagamento confirmado.
    // iOS: vai pro /plans interno (StoreKit) — Apple 3.1.1 proíbe direcionar
    //   pra compra externa. NUNCA mostrar tela "assine no site" no iOS.
    // Android: mostra aviso pro user assinar no site (Play permite checkout web).
    // Web: redireciona pra plans.html normal.
    if (isIOSNative()) {
      internalNav('/plans');
      return false;
    }
    if (isNativeApp()) {
      this.showSubscribeOnWebsiteNotice();
      return false;
    }
    internalNav('/plans');
    return false;
  }

  /**
   * Mostra aviso fullscreen pra user ir ao site pra assinar.
   * Compliance Google Play / App Store: app nativo não pode ter fluxo de
   * pagamento de produto digital.
   */
  private showSubscribeOnWebsiteNotice(): void {
    document.body.innerHTML = `
      <div style="position:fixed;inset:0;background:#030014;display:flex;align-items:center;justify-content:center;padding:2rem;z-index:99999;">
        <div style="text-align:center;max-width:400px;width:100%;">
          <img src="/img/logo.png" alt="GDrums" style="height:40px;opacity:0.9;margin-bottom:1.5rem;">
          <h2 style="color:#fff;font-size:1.2rem;font-weight:700;margin:0 0 0.75rem;letter-spacing:-0.3px;">${t('main.subscribeNotice.title')}</h2>
          <p style="color:rgba(255,255,255,0.55);font-size:0.9rem;line-height:1.6;margin:0 0 1.75rem;">
            ${t('main.subscribeNotice.body')}
          </p>
          <button id="goToSiteBtn" style="
            width:100%;padding:1rem;border:none;border-radius:14px;
            background:linear-gradient(135deg,#00D4FF,#8B5CF6);
            color:#fff;font-size:0.95rem;font-weight:700;
            font-family:inherit;cursor:pointer;margin-bottom:0.75rem;
            box-shadow:0 8px 24px rgba(0,212,255,0.25);
          ">${t('main.subscribeNotice.openSite')}</button>
          <button id="logoutFromNoticeBtn" style="
            width:100%;padding:0.85rem;border:none;border-radius:12px;
            background:rgba(255,255,255,0.05);
            border:1px solid rgba(255,255,255,0.08);
            color:rgba(255,255,255,0.5);font-size:0.85rem;font-weight:600;
            font-family:inherit;cursor:pointer;
          ">${t('main.subscribeNotice.logout')}</button>
        </div>
      </div>
    `;
    document.getElementById('goToSiteBtn')?.addEventListener('click', () => {
      gotoPlans();
    });
    document.getElementById('logoutFromNoticeBtn')?.addEventListener('click', async () => {
      const { authService } = await import('./auth/AuthService');
      await authService.logout();
    });
  }

  private showSubscriptionBanner(status: string, expires: Date, plan: string): void {
    const isPaidPlan = status === 'active' && plan !== 'trial';
    const now = new Date();

    // ─── Plano pago próximo do vencimento ───────────────────────────────
    // Antes era banner fixed no bottom cobrindo BPM/Volume. Agora é
    // modal de sugestão NÃO-BLOQUEANTE — aparece 1x por sessão, user
    // fecha e usa o app normal. App não é interrompido.
    if (isPaidPlan) {
      this.conversionManager.setTrialActive(false);

      const daysLeft = Math.floor((expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysLeft > 7) return;

      // 1x por sessão (sessionStorage) — não martela o user a cada navegação
      if (sessionStorage.getItem('gdrums-renew-modal-shown')) return;
      sessionStorage.setItem('gdrums-renew-modal-shown', '1');

      let renewMsg: string;
      if (daysLeft <= 0) renewMsg = t('main.renewal.dueToday');
      else if (daysLeft === 1) renewMsg = t('main.renewal.dueTomorrow');
      else renewMsg = t('main.renewal.dueInDays', { days: daysLeft });

      this.showRenewalSuggestionModal({
        title: t('main.renewal.title'),
        message: renewMsg + t('main.renewal.messageSuffix'),
        ctaLabel: t('main.renewal.cta'),
        // IAP compliance (Apple 3.1.1): nativo NUNCA abre site externo de
// pagamento; usa /plans interno que aciona StoreKit no iOS.
ctaUrl: '/plans?renew=true',
      });
      return;
    }

    // ─── Trial — ainda em testes ────────────────────────────────────────
    this.conversionManager.setTrialActive(true);

    const hoursLeft = Math.max(0, Math.floor((expires.getTime() - now.getTime()) / (1000 * 60 * 60)));
    const minutesLeft = Math.max(0, Math.floor((expires.getTime() - now.getTime()) / (1000 * 60)) % 60);
    this.conversionManager.tick(hoursLeft);

    // Trial também vira modal não-bloqueante 1x por sessão
    if (sessionStorage.getItem('gdrums-trial-modal-shown')) return;
    sessionStorage.setItem('gdrums-trial-modal-shown', '1');

    const timeText = hoursLeft > 0 ? `${hoursLeft}h` : `${minutesLeft}min`;
    const trialMsg = hoursLeft <= 6
      ? t('main.renewal.trialExpiresIn', { time: timeText })
      : t('main.renewal.trialRemaining', { time: timeText });

    this.showRenewalSuggestionModal({
      title: hoursLeft <= 6 ? t('main.renewal.trialTitleUrgent') : t('main.renewal.trialTitleNormal'),
      message: trialMsg + t('main.renewal.trialMessageSuffix'),
      ctaLabel: t('main.renewal.trialCta'),
      // IAP compliance: nativo usa /plans interno (StoreKit).
      ctaUrl: '/plans',
    });
  }

  /**
   * Modal de sugestão de renovação/assinatura NÃO-BLOQUEANTE.
   * - Aparece centralizado, com overlay translúcido (não escuro)
   * - X grande pra fechar — user pode fechar e usar o app normal
   * - 1x por sessão (caller cuida do sessionStorage)
   * - SÓ o modal de expired (showSubscribeOnWebsiteNotice) bloqueia
   */
  private showRenewalSuggestionModal(opts: { title: string; message: string; ctaLabel: string; ctaUrl: string }): void {
    // Se já tem um aberto, não duplica
    if (document.getElementById('renewSuggestionModal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'renewSuggestionModal';
    overlay.className = 'renew-modal-overlay';
    overlay.innerHTML = `
      <div class="renew-modal">
        <button class="renew-modal-close" aria-label="${t('main.renewal.closeAriaLabel')}">×</button>
        <h3 class="renew-modal-title">${opts.title}</h3>
        <p class="renew-modal-message">${opts.message}</p>
        <div class="renew-modal-actions">
          <button class="renew-modal-skip">${t('main.renewal.skip')}</button>
          <a href="${opts.ctaUrl}" class="renew-modal-cta" id="renewModalCta">${opts.ctaLabel}</a>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    this.injectRenewModalStyles();

    const close = () => {
      overlay.classList.remove('renew-modal-visible');
      setTimeout(() => overlay.remove(), 200);
    };

    overlay.querySelector('.renew-modal-close')?.addEventListener('click', close);
    overlay.querySelector('.renew-modal-skip')?.addEventListener('click', close);
    // Fechar clicando fora (no overlay translúcido)
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // Nativo: iOS interno (StoreKit), Android externo (Chrome), web interno.
    if (isNativeApp()) {
      overlay.querySelector('#renewModalCta')?.addEventListener('click', (e) => {
        e.preventDefault();
        gotoPlans(opts.ctaUrl);
        close();
      });
    }

    // Anima entrada
    requestAnimationFrame(() => overlay.classList.add('renew-modal-visible'));
  }

  private injectRenewModalStyles(): void {
    if (document.getElementById('renew-modal-css')) return;
    const style = document.createElement('style');
    style.id = 'renew-modal-css';
    style.textContent = `
      .renew-modal-overlay {
        position: fixed; inset: 0;
        background: rgba(2, 2, 12, 0.55);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        display: flex; align-items: center; justify-content: center;
        padding: 1rem;
        z-index: 9999;
        opacity: 0;
        transition: opacity 0.2s ease;
      }
      .renew-modal-overlay.renew-modal-visible { opacity: 1; }
      .renew-modal {
        background: rgba(10, 10, 30, 0.97);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 20px;
        padding: 1.75rem 1.5rem 1.5rem;
        max-width: 400px;
        width: 100%;
        position: relative;
        transform: translateY(8px);
        transition: transform 0.25s ease;
      }
      .renew-modal-overlay.renew-modal-visible .renew-modal { transform: translateY(0); }
      .renew-modal-close {
        position: absolute; top: 0.6rem; right: 0.75rem;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.55);
        width: 32px; height: 32px;
        border-radius: 10px;
        font-size: 1.2rem; font-weight: 400;
        cursor: pointer; font-family: inherit;
        display: flex; align-items: center; justify-content: center;
        line-height: 1;
      }
      .renew-modal-close:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
      .renew-modal-title {
        font-size: 1.05rem; font-weight: 700; color: #fff;
        margin: 0 0 0.5rem; letter-spacing: -0.2px;
        padding-right: 2rem;
      }
      .renew-modal-message {
        font-size: 0.85rem; color: rgba(255, 255, 255, 0.6);
        margin: 0 0 1.25rem; line-height: 1.55;
      }
      .renew-modal-message strong { color: #fff; }
      .renew-modal-actions {
        display: flex; gap: 0.5rem;
      }
      .renew-modal-skip {
        flex: 1; padding: 0.7rem;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.45);
        border-radius: 12px;
        font-size: 0.85rem; font-weight: 600;
        font-family: inherit; cursor: pointer;
      }
      .renew-modal-skip:hover { color: rgba(255, 255, 255, 0.7); }
      .renew-modal-cta {
        flex: 1.4; padding: 0.7rem 1rem;
        background: linear-gradient(135deg, #00D4FF, #8B5CF6);
        color: #fff;
        border-radius: 12px;
        font-size: 0.85rem; font-weight: 700;
        text-decoration: none;
        text-align: center;
        display: flex; align-items: center; justify-content: center;
      }
      .renew-modal-cta:hover { opacity: 0.92; }
    `;
    document.head.appendChild(style);
  }

  private injectTrialBannerStyles(): void {
    if (document.getElementById('trial-banner-css')) return;
    const style = document.createElement('style');
    style.id = 'trial-banner-css';
    style.textContent = `
      .trial-banner {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        background: rgba(10, 10, 15, 0.88);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        padding: 0.7rem 1.25rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        z-index: 9999;
        animation: bannerSlideUp 0.3s ease;
      }
      .trial-banner-urgent {
        border-top-color: rgba(255, 255, 255, 0.12);
        background: rgba(14, 10, 10, 0.92);
      }
      /* Banner de renovação (assinante pago) — tom laranja "lembrete amigável",
         contrastando com o trial-banner-urgent que é "alarme vermelho-escuro" */
      .trial-banner-renew {
        border-top-color: rgba(249, 115, 22, 0.35);
        background: linear-gradient(180deg, rgba(249, 115, 22, 0.08) 0%, rgba(10, 10, 15, 0.92) 100%);
      }
      .trial-banner-renew.trial-banner-urgent {
        border-top-color: rgba(249, 115, 22, 0.6);
        background: linear-gradient(180deg, rgba(249, 115, 22, 0.18) 0%, rgba(14, 10, 10, 0.95) 100%);
      }
      .trial-banner-renew .trial-banner-btn {
        background: linear-gradient(135deg, #F97316 0%, #FF6B35 100%);
        color: #fff;
      }
      .trial-banner-text {
        font-size: 0.8rem;
        color: rgba(255, 255, 255, 0.55);
        font-weight: 400;
        letter-spacing: 0.01em;
      }
      .trial-banner-text strong {
        color: #fff;
        font-weight: 600;
      }
      .trial-banner-btn {
        font-size: 0.78rem;
        font-weight: 600;
        color: #0a0a0f;
        background: #fff;
        padding: 0.5rem 1rem;
        border-radius: 8px;
        text-decoration: none;
        white-space: nowrap;
        transition: opacity 0.15s;
        letter-spacing: -0.005em;
      }
      .trial-banner-btn:hover { opacity: 0.85; }
      .trial-banner-btn:active { transform: scale(0.98); }
      @keyframes bannerSlideUp {
        from { transform: translateY(100%); }
        to { transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }

  private generateChannelsHTML(): void {
    const sequencerContainer = document.getElementById('sequencer');
    if (!sequencerContainer) return;

    sequencerContainer.innerHTML = '';

    // Obter número de steps do padrão atual
    const patternType = this.stateManager.getEditingPattern();
    const numSteps = this.stateManager.getPatternSteps(patternType);

    for (let channel = 0; channel < MAX_CHANNELS; channel++) {
      const channelDiv = document.createElement('div');
      channelDiv.className = 'channel';

      // Informações do canal
      const channelInfo = document.createElement('div');
      channelInfo.className = 'channel-info';
      channelInfo.innerHTML = `
        <div class="channel-number">${t('main.channel.label', { number: channel + 1 })}</div>
        <select id="midiSelect${channel + 1}" class="channel-sound">
          <option value="">${t('main.channel.selectOption')}</option>
        </select>
      `;

      channelDiv.appendChild(channelInfo);

      // Steps (número variável baseado no padrão)
      for (let step = 0; step < numSteps; step++) {
        const stepDiv = document.createElement('div');
        stepDiv.className = 'step';
        stepDiv.setAttribute('data-step', step.toString());
        stepDiv.setAttribute('data-channel', channel.toString());

        stepDiv.addEventListener('click', () => {
          HapticsService.light();
          this.toggleStep(channel, step);
        });

        stepDiv.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.showVolumeControl(channel, step, stepDiv);
        });

        // Long-press em mobile: abre popup de volume + groove (500ms)
        let lpTimer: number | null = null;
        let lpFired = false;
        stepDiv.addEventListener('touchstart', () => {
          lpFired = false;
          lpTimer = window.setTimeout(() => {
            lpFired = true;
            HapticsService.medium();
            this.showVolumeControl(channel, step, stepDiv);
          }, 500);
        }, { passive: true });
        const cancelLp = () => {
          if (lpTimer !== null) { clearTimeout(lpTimer); lpTimer = null; }
        };
        stepDiv.addEventListener('touchend', (e) => {
          cancelLp();
          if (lpFired) e.preventDefault(); // bloquear click após long-press
        });
        stepDiv.addEventListener('touchmove', cancelLp, { passive: true });
        stepDiv.addEventListener('touchcancel', cancelLp);

        channelDiv.appendChild(stepDiv);
      }

      sequencerContainer.appendChild(channelDiv);
    }

    // Atualizar CSS grid para acomodar número dinâmico de steps
    const channels = sequencerContainer.querySelectorAll('.channel');
    channels.forEach(channel => {
      (channel as HTMLElement).style.gridTemplateColumns = `120px repeat(${numSteps}, 1fr)`;
    });
  }

  private setupEventListeners(): void {
    // Play/Stop
    const playStopBtn = document.getElementById('playStop');
    if (playStopBtn) {
      playStopBtn.addEventListener('click', () => { HapticsService.medium(); this.togglePlayStop(); });
    }

    // Volume da contagem (chimbal da pausa) — long-press 3s no botão abre o slider.
    const savedCountVol = parseFloat(localStorage.getItem('gdrums-count-volume') || '');
    if (!isNaN(savedCountVol)) this.countVolume = Math.max(0, Math.min(1, savedCountVol));

    // Pause instantâneo (admin) — pra músico em barzinho
    const pauseInstantBtn = document.getElementById('pauseInstant');
    if (pauseInstantBtn) {
      pauseInstantBtn.addEventListener('click', () => {
        if (this.longPressFired) { this.longPressFired = false; return; }
        HapticsService.medium();
        this.togglePauseInstant();
      });
      this.setupCountVolumeLongPress(pauseInstantBtn);
    }

    // Pause instantâneo (user) — célula no performance grid
    const pauseBtnUser = document.getElementById('pauseBtnUser');
    if (pauseBtnUser) {
      pauseBtnUser.addEventListener('click', () => {
        if (this.longPressFired) { this.longPressFired = false; return; }
        HapticsService.medium();
        this.togglePauseInstant();
      });
      this.setupCountVolumeLongPress(pauseBtnUser);
    }

    const playStopUserBtn = document.getElementById('playStopUser');
    if (playStopUserBtn) {
      playStopUserBtn.addEventListener('click', () => { HapticsService.medium(); this.togglePlayStop(); });
    }

    // Admin mode fill and end buttons
    const fillBtn = document.getElementById('fill');
    if (fillBtn) {
      fillBtn.addEventListener('click', () => {
        if (this.stateManager.isPlaying()) {
          HapticsService.heavy();
          this.patternEngine.playRotatingFill();
        }
      });
    }

    const endBtn = document.getElementById('end');
    if (endBtn) {
      endBtn.addEventListener('click', () => {
        if (this.stateManager.isPlaying()) {
          HapticsService.heavy();
          this.patternEngine.playEndAndStop();
        }
      });
    }

    // Cymbal button (prato)
    const cymbalBtn = document.getElementById('cymbalBtn');
    if (cymbalBtn) {
      cymbalBtn.addEventListener('click', () => { HapticsService.heavy(); this.playCymbal(); });
    }

    // Tempo controls
    this.setupTempoControls();

    // Volume controls
    this.setupVolumeControls();

    // Keyboard shortcuts
    this.setupKeyboardShortcuts();

    // Olhinho 👁 em todos os input[type=password] (modal de alterar senha em
    // Minha Conta + qualquer outro futuro). Funciona via MutationObserver,
    // pega campos criados depois também.
    import('./utils/passwordToggle').then(m => m.setupPasswordToggle()).catch(() => {});

    // Pattern tabs
    document.querySelectorAll('.pattern-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const patternType = target.getAttribute('data-pattern') as PatternType;
        this.switchEditingPattern(patternType);
      });
    });

    // Performance grid
    this.setupPerformanceGrid();
    this.setupToggles();

    // File operations
    this.setupFileOperations();

    // Mode toggle
    this.setupModeToggle();

    // MIDI selectors
    this.setupMIDISelectors();

    // Special sounds
    this.setupSpecialSounds();

    // Variations
    this.setupVariations();

    // Duplicate from rhythm
    this.setupDuplicateFromRhythm();

    // User mode
    this.setupUserMode();
  }

  private setupUserMode(): void {
    // Botão carregar ritmo do usuário
    const loadRhythmUserBtn = document.getElementById('loadRhythmUser');
    const rhythmSelectUser = document.getElementById('rhythmSelectUser') as HTMLSelectElement;

    if (loadRhythmUserBtn && rhythmSelectUser) {
      loadRhythmUserBtn.addEventListener('click', () => {
        const filePath = rhythmSelectUser.value;
        if (filePath) {
          this.loadRhythmFromPath(filePath);
        } else {
          this.uiManager.showAlert(t('main.userMode.selectRhythmFirst'));
        }
      });
    }


    // Botões de Variação no Modo Usuário
    document.querySelectorAll('.variation-btn-user').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const element = e.currentTarget as HTMLElement;
        const variationType = element.getAttribute('data-type') as PatternType;
        const variationIndex = parseInt(element.getAttribute('data-variation')!);
        this.switchVariation(variationType, variationIndex);
      });
    });

    // Atualizar UI inicial dos botões de variação
    this.uiManager.updateVariationButtons();
  }

  // ─── BPM customizado por ritmo (localStorage) ──────────────────────

  private readonly BPM_STORAGE_KEY = 'gdrums-custom-bpm';

  private getCustomBpmMap(): Record<string, number> {
    try {
      return JSON.parse(localStorage.getItem(this.BPM_STORAGE_KEY) || '{}');
    } catch { return {}; }
  }

  private saveCustomBpm(): void {
    if (!this.currentRhythmName) return;
    const currentBpm = this.stateManager.getTempo();
    // Só salvar se diferente do original do ritmo
    const map = this.getCustomBpmMap();
    if (currentBpm === this.currentRhythmOriginalBpm) {
      delete map[this.currentRhythmName]; // Voltou pro original, limpar
    } else {
      map[this.currentRhythmName] = currentBpm;
    }
    localStorage.setItem(this.BPM_STORAGE_KEY, JSON.stringify(map));
  }

  private getCustomBpm(rhythmName: string): number | null {
    const map = this.getCustomBpmMap();
    return map[rhythmName] ?? null;
  }

  private setupTempoControls(): void {
    // Controles do modo usuário
    const tempoUpUser = document.getElementById('tempoUpUser');
    const tempoDownUser = document.getElementById('tempoDownUser');

    if (tempoUpUser) {
      tempoUpUser.addEventListener('click', () => {
        const newTempo = Math.min(240, this.stateManager.getTempo() + 1);
        this.stateManager.setTempo(newTempo);
        this.saveCustomBpm();
      });
    }

    if (tempoDownUser) {
      tempoDownUser.addEventListener('click', () => {
        const newTempo = Math.max(40, this.stateManager.getTempo() - 1);
        this.stateManager.setTempo(newTempo);
        this.saveCustomBpm();
      });
    }

    // BPM display clicável → abre modal
    const tempoDisplayUser = document.getElementById('tempoDisplayUser');
    if (tempoDisplayUser) {
      tempoDisplayUser.addEventListener('click', () => {
        this.showBpmModal();
      });
    }

    // Controles do modo admin
    const tempoInput = document.getElementById('tempo') as HTMLInputElement;
    const tempoSlider = document.getElementById('tempoSlider') as HTMLInputElement;
    const tempoUp = document.getElementById('tempoUp');
    const tempoDown = document.getElementById('tempoDown');

    const updateTempo = (value: number) => {
      const newTempo = Math.max(40, Math.min(240, value));
      this.stateManager.setTempo(newTempo);
    };

    if (tempoInput) {
      tempoInput.addEventListener('change', (e) => {
        updateTempo(parseInt((e.target as HTMLInputElement).value));
      });
    }

    if (tempoSlider) {
      tempoSlider.addEventListener('input', (e) => {
        updateTempo(parseInt((e.target as HTMLInputElement).value));
      });
    }

    if (tempoUp) {
      tempoUp.addEventListener('click', () => {
        updateTempo(this.stateManager.getTempo() + 1);
      });
    }

    if (tempoDown) {
      tempoDown.addEventListener('click', () => {
        updateTempo(this.stateManager.getTempo() - 1);
      });
    }

    // Compasso (beatsPerBar) selector
    const beatsPerBarSelect = document.getElementById('beatsPerBarSelect') as HTMLSelectElement;
    if (beatsPerBarSelect) {
      beatsPerBarSelect.addEventListener('change', (e) => {
        const beats = parseInt((e.target as HTMLSelectElement).value);
        this.stateManager.getState().beatsPerBar = beats;
        this.ensureBeatDots(beats);
      });
    }

    // Fill Speed controls
    const fillSpeedInput = document.getElementById('fillSpeed') as HTMLInputElement;
    const fillSpeedUp = document.getElementById('fillSpeedUp');
    const fillSpeedDown = document.getElementById('fillSpeedDown');
    const fillSpeedDisplay = document.getElementById('fillSpeedDisplay');

    const updateFillSpeed = (value: number) => {
      const newSpeed = Math.max(0.25, Math.min(4, value));
      this.stateManager.getState().fillSpeed = newSpeed;
      if (fillSpeedInput) fillSpeedInput.value = newSpeed.toString();
      if (fillSpeedDisplay) fillSpeedDisplay.textContent = `${newSpeed}x`;
    };

    if (fillSpeedInput) {
      fillSpeedInput.addEventListener('change', (e) => {
        updateFillSpeed(parseFloat((e.target as HTMLInputElement).value));
      });
    }

    if (fillSpeedUp) {
      fillSpeedUp.addEventListener('click', () => {
        updateFillSpeed(this.stateManager.getState().fillSpeed + 0.25);
      });
    }

    if (fillSpeedDown) {
      fillSpeedDown.addEventListener('click', () => {
        updateFillSpeed(this.stateManager.getState().fillSpeed - 0.25);
      });
    }

    // End Speed controls
    const endSpeedInput = document.getElementById('endSpeed') as HTMLInputElement;
    const endSpeedUp = document.getElementById('endSpeedUp');
    const endSpeedDown = document.getElementById('endSpeedDown');
    const endSpeedDisplay = document.getElementById('endSpeedDisplay');

    const updateEndSpeed = (value: number) => {
      const newSpeed = Math.max(0.25, Math.min(4, value));
      this.stateManager.getState().endSpeed = newSpeed;
      if (endSpeedInput) endSpeedInput.value = newSpeed.toString();
      if (endSpeedDisplay) endSpeedDisplay.textContent = `${newSpeed}x`;
    };

    if (endSpeedInput) {
      endSpeedInput.addEventListener('change', (e) => {
        updateEndSpeed(parseFloat((e.target as HTMLInputElement).value));
      });
    }

    if (endSpeedUp) {
      endSpeedUp.addEventListener('click', () => {
        updateEndSpeed(this.stateManager.getState().endSpeed + 0.25);
      });
    }

    if (endSpeedDown) {
      endSpeedDown.addEventListener('click', () => {
        updateEndSpeed(this.stateManager.getState().endSpeed - 0.25);
      });
    }

    // Fill Steps select
    const fillStepsSelect = document.getElementById('fillSteps') as HTMLSelectElement;
    if (fillStepsSelect) {
      fillStepsSelect.addEventListener('change', (e) => {
        const value = parseInt((e.target as HTMLSelectElement).value);
        this.stateManager.getState().fillSteps = value;
      });
    }
  }

  private setupVolumeControls(): void {
    // Volume Master - Modo Usuário
    const masterVolumeUser = document.getElementById('masterVolumeUser') as HTMLInputElement;
    const volumeDisplayUser = document.getElementById('volumeDisplayUser');

    if (masterVolumeUser && volumeDisplayUser) {
      masterVolumeUser.addEventListener('input', (e) => {
        const sliderValue = parseInt((e.target as HTMLInputElement).value); // 0-200
        const displayPercent = Math.round(sliderValue / 2); // Mostrar 0-100%
        const actualValue = sliderValue / 100; // Valor real 0-2.0

        this.stateManager.setMasterVolume(actualValue);
        volumeDisplayUser.textContent = `${displayPercent}%`;

        // Sincronizar com o controle do modo admin
        const masterVolumeAdmin = document.getElementById('masterVolume') as HTMLInputElement;
        const volumeDisplayAdmin = document.getElementById('masterVolumeDisplay');
        if (masterVolumeAdmin) masterVolumeAdmin.value = sliderValue.toString();
        if (volumeDisplayAdmin) volumeDisplayAdmin.textContent = `${sliderValue}%`;
      });
    }

    // Volume Master - Modo Admin
    const masterVolume = document.getElementById('masterVolume') as HTMLInputElement;
    const masterVolumeDisplay = document.getElementById('masterVolumeDisplay');

    if (masterVolume && masterVolumeDisplay) {
      masterVolume.addEventListener('input', (e) => {
        const valuePercent = parseInt((e.target as HTMLInputElement).value);
        const value = valuePercent / 100;
        this.stateManager.setMasterVolume(value);
        masterVolumeDisplay.textContent = `${valuePercent}%`;

        // Sincronizar com o controle do modo usuário
        if (masterVolumeUser) masterVolumeUser.value = valuePercent.toString();
        if (volumeDisplayUser) volumeDisplayUser.textContent = `${valuePercent}%`;
      });
    }

    // Observer para atualizar a UI quando o volume master mudar
    this.stateManager.subscribe('masterVolume', (state) => {
      const volumePercent = Math.round(state.masterVolume * 100); // Valor real 0-200
      const displayPercent = Math.round(volumePercent / 2); // Mostrar 0-100% no modo usuário

      if (masterVolumeUser) masterVolumeUser.value = volumePercent.toString();
      if (volumeDisplayUser) volumeDisplayUser.textContent = `${displayPercent}%`;
      if (masterVolume) masterVolume.value = volumePercent.toString();
      if (masterVolumeDisplay) masterVolumeDisplay.textContent = `${volumePercent}%`;
    });
  }

  private setupKeyboardShortcuts(): void {
    // Converter pedalLeft/Right pra keyCode numérico pra comparação rápida
    const KEY_CODES: Record<string, number> = {
      'ArrowLeft': 37, 'ArrowUp': 38, 'ArrowRight': 39, 'ArrowDown': 40,
      'Space': 32, ' ': 32, 'Enter': 13, 'PageUp': 33, 'PageDown': 34,
    };

    // capture:true + passive:false — essencial no iOS pra capturar antes do scroll do browser
    window.addEventListener('keydown', (e) => {
      // Se o mapper de pedal está aberto, deixar ele capturar
      if (this.pedalMapperOpen) return;

      // Codes calculados POR EVENTO (4 lookups, custo zero) — antes eram
      // capturados 1x no boot e o mapeamento novo do "Mapear pedal" só
      // valia após recarregar a página (daí o aviso "Recarregue se não
      // funcionar"). Agora o save do mapper vale na hora.
      const pedalLeftCode = KEY_CODES[this.pedalLeft] || 0;
      const pedalRightCode = KEY_CODES[this.pedalRight] || 0;
      const pedalPlayPauseCode = this.pedalPlayPause ? (KEY_CODES[this.pedalPlayPause] || 0) : 0;
      const pedalEndCode = this.pedalEnd ? (KEY_CODES[this.pedalEnd] || 0) : 0;

      // Identificar via keyCode (funciona em TUDO, inclusive pedais BT)
      // Fallback pra e.code/e.key só se keyCode não veio
      const kc = e.keyCode || e.which || 0;
      const keyId = e.code || e.key || '';

      // Se um input/select está focado, só processar se for tecla de pedal/seta.
      // Up/Down (38/40) só contam como pedal se estiverem MAPEADOS (3º/4º
      // botão ou esquerdo/direito custom) — sem fallback fixo.
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        const isPedal = kc === pedalLeftCode || kc === pedalRightCode ||
                        (pedalPlayPauseCode > 0 && kc === pedalPlayPauseCode) ||
                        (pedalEndCode > 0 && kc === pedalEndCode) ||
                        kc === 37 || kc === 39 ||
                        keyId === this.pedalLeft || keyId === this.pedalRight;
        if (isPedal) {
          target.blur();
        } else {
          return;
        }
      }

      // Prevenir scroll/navegação do browser
      if (kc === 32 || kc === 33 || kc === 34 || // Space, PageUp, PageDown
          kc === 37 || kc === 38 || kc === 39 || kc === 40 || // Setas
          kc === pedalLeftCode || kc === pedalRightCode ||
          keyId === this.pedalLeft || keyId === this.pedalRight) {
        e.preventDefault();
      }

      if (e.repeat) return;

      // ─── PEDAL TEM PRIORIDADE ─────────────────────────────────────
      // Checar pedal mapeado primeiro (por keyCode E por keyId)
      if (kc === pedalLeftCode || keyId === this.pedalLeft) { this.handlePedalLeft(); return; }
      if (kc === pedalRightCode || keyId === this.pedalRight) { this.handlePedalRight(); return; }

      // Pedal expandido: 3º botão (play/pause) e 4º botão (end)
      if (this.pedalCount >= 3 && this.pedalPlayPause &&
          (kc === pedalPlayPauseCode || keyId === this.pedalPlayPause)) {
        // fromPedal=true → o CONTINUAR compensa a latência BT do pedal
        // além da latência de saída (ver resumeFromPause)
        this.togglePauseInstant(true);
        return;
      }
      if (this.pedalCount >= 4 && this.pedalEnd &&
          (kc === pedalEndCode || keyId === this.pedalEnd)) {
        if (this.isPaused) this.resumeWithAction('end', 0);        // pausa → finaliza
        else if (this.useFinal) this.patternEngine.playEndAndStop();
        else this.stopAndMaybeAdvance();
        return;
      }

      // Fallback: SÓ esquerda/direita ativam o pedal por padrão.
      //
      // ⚠️ Up/Down REMOVIDOS do fallback (2026-06): pedais de 4 botões
      // enviam as 4 setas — Up/Down caíam aqui e DUPLICAVAM os comandos
      // de esquerda/direita em vez de ficarem livres pro mapeamento do
      // 3º/4º botão (play-pause / finalização). Quem tem pedal de 2 botões
      // que só envia Up/Down mapeia em "Mapear pedal" (vira pedalLeft/
      // pedalRight custom e é tratado na checagem de prioridade acima).
      if (kc === 37) { this.handlePedalLeft(); return; }  // ArrowLeft(37)
      if (kc === 39) { this.handlePedalRight(); return; } // ArrowRight(39)

      // Space = Play/Pause (só se NÃO é pedal mapeado)
      if (kc === 32 || keyId === 'Space' || keyId === ' ') {
        this.togglePlayStop();
        return;
      }

    }, { capture: true, passive: false } as AddEventListenerOptions);

    // ═══════════════════════════════════════════════════════════════════════
    // ⚠️⚠️⚠️  PEDAL BLUETOOTH NO iOS — NÃO MEXE SEM LER ISSO  ⚠️⚠️⚠️
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Este bloco é o HACK que faz o pedal Bluetooth funcionar no iOS.
    // É o DIFERENCIAL DE MERCADO do GDrums. Se quebrar, o produto morre.
    // Já foi reescrito várias vezes — a combinação atual é a ÚNICA que funciona.
    //
    // COMO FUNCIONA:
    // No iOS/Safari, keydown/keyup de teclado Bluetooth SÓ dispara se houver
    // um <input> de texto focado. Pedais BT musicais se registram como
    // teclado. Então criamos um input invisível que fica sempre focado
    // e captura as teclas do pedal.
    //
    // REGRAS SAGRADAS (não quebrar nenhuma):
    //
    // 1. INPUT VISÍVEL E COM TAMANHO REAL — iOS ignora inputs com opacity~0
    //    ou height < 2px. Por isso height: 24px com fundo escuro.
    //
    // 2. focus() SÍNCRONO dentro de user gesture — iOS exige isso. Qualquer
    //    setTimeout perde o contexto de gesture e o focus é ignorado.
    //    Os listeners de touchend/click chamam focusPedalInput() direto
    //    (sem setTimeout, sem await, sem Promise).
    //
    // 3. LISTENERS NECESSÁRIOS (todos os 4 — remover qualquer um quebra):
    //    • touchend  → refocar após toque na tela (célula, botão)
    //    • click     → redundância pra click sintético
    //    • keydown   → refocar pra próxima tecla do pedal
    //    • keyup     → idem
    //    • blur      → refocar se input perde foco por qualquer motivo
    //    • setInterval 1500ms → safety net pra casos não cobertos
    //
    // 4. hasModalOpen() NÃO PODE detectar overlays permanentes. O .gm-overlay
    //    do ModalManager fica no DOM com display:none — se entrar no query,
    //    retorna true sempre e o pedal nunca refoca. SÓ colocar classes de
    //    overlays dinâmicos (criados no open, removidos no close).
    //
    // 5. focusPedalInput() TEM os guards necessários:
    //    a) se mapper do pedal está aberto, não refoca (mapper tem input próprio)
    //    b) se hasModalOpen() = true, não refoca (modal tem input próprio)
    //    c) se outro INPUT/TEXTAREA/SELECT tá focado, não rouba (user digitando)
    //    Esses guards fazem os listeners de touch/click serem seguros.
    //
    // HISTÓRICO DE TENTATIVAS QUE QUEBRARAM:
    // - setTimeout no focus (50/100/150/200ms) → iOS ignora focus fora de gesture
    // - capture:true nos listeners → compete com audioContext.resume
    // - adicionar .gm-overlay no hasModalOpen → overlay permanente trava tudo
    // - remover touch/click listeners → pedal só volta em 1.5s após tocar
    // - readonly input / contentEditable div → iOS não manda keydown pra isso
    // - input com opacity:0 ou height:1px → iOS ignora
    //
    // Commits de referência: 2f0e838 (focus síncrono), a44affc (guard modal),
    // de6f24e (input visível 24px), e7d5e31 (combinação final).
    // ═══════════════════════════════════════════════════════════════════════
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
                  (/Mac/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    if (isIOS) {
      const pedalInput = document.createElement('input');
      pedalInput.id = 'pedalBtInput';
      pedalInput.type = 'text';
      pedalInput.setAttribute('inputmode', 'none');
      pedalInput.setAttribute('autocomplete', 'off');
      pedalInput.setAttribute('autocorrect', 'off');
      pedalInput.setAttribute('autocapitalize', 'off');
      pedalInput.setAttribute('spellcheck', 'false');
      // DEVE ser visível e com tamanho real — iOS ignora inputs com opacity~0 ou height<2px
      pedalInput.style.cssText = 'position:fixed;bottom:0;left:0;right:0;width:100%;height:24px;font-size:10px;font-family:inherit;background:rgba(3,0,20,0.95);color:rgba(255,255,255,0.12);border:none;border-top:1px solid rgba(255,255,255,0.03);text-align:center;padding:0;margin:0;z-index:9998;outline:none;caret-color:transparent;';
      pedalInput.placeholder = t('main.pedalInput.placeholder');
      document.body.appendChild(pedalInput);

      const hasModalOpen = () => {
        // Se tem overlay/modal aberto, não roubar foco.
        //
        // ⚠️ CUIDADO: ModalManager cria .gm-overlay permanente no DOM com
        // display:none. Se a gente adicionar .gm-overlay aqui, o query
        // acha ele mesmo escondido e o pedal para de funcionar (bug 04/2026).
        // Mesma coisa vale pra qualquer overlay criado uma vez e reusado.
        // Só adicionar classe aqui se o overlay for criado on-demand e
        // removido após o close — todos listados abaixo são dinâmicos.
        //
        // Inclusões:
        // - .account-modal-overlay: modais antigos (Minha Conta, etc)
        // - .bpm-modal-overlay: BPM modal antigo (ainda no DOM histórico)
        // - .x-overlay: modais da experience layer v2 (Meus Ritmos,
        //   Salvar, BPM v2, Setlist Picker) — todos createElement + remove
        // - .sle-overlay: editor de repertório (SetlistEditorUI)
        // - .install-tut-overlay: tutorial de instalação
        // - .wn-modal-overlay: What's New
        // - z-index:99999 inline: fallback pra outros dinâmicos antigos
        // Overlays em animação de saída (.x-exit, .sle-exit, etc) NÃO contam:
        // o close() já foi disparado, o user clicou pra fechar. O refocus
        // do pedal precisa rolar AGORA dentro do mesmo user gesture do iOS,
        // mesmo que o nó ainda esteja no DOM por mais 200-300ms (animação).
        return !!document.querySelector(
          '.account-modal-overlay:not(.x-exit), .bpm-modal-overlay:not(.x-exit), ' +
          '.x-overlay:not(.x-exit), .sle-overlay:not(.sle-exit), ' +
          '.install-tut-overlay:not(.x-exit), .wn-modal-overlay:not(.x-exit), ' +
          '[style*="z-index: 99999"]:not(.x-exit), [style*="z-index:99999"]:not(.x-exit)'
        );
      };

      const focusPedalInput = () => {
        if (this.pedalMapperOpen) return;
        if (hasModalOpen()) return;
        const active = document.activeElement as HTMLElement;
        if (active && active !== pedalInput && active !== document.body &&
            (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;
        pedalInput.focus({ preventScroll: true });
      };

      // ✱ Refocar no touch/click síncrono DENTRO da user gesture (iOS exige isso).
      //   focusPedalInput() já tem o guard de hasModalOpen() + input focado,
      //   então não rouba foco de inputs em modais. Combina o fix do
      //   commit 2f0e838 (refocus síncrono pra iOS) com o do a44affc
      //   (guard de modal/input). Sem esse listener, após tocar em qualquer
      //   célula/botão o pedal só voltaria a funcionar em 1.5s (setInterval).
      document.addEventListener('touchend', () => focusPedalInput(), { passive: true });
      document.addEventListener('click', () => focusPedalInput());
      // Após keydown do pedal, refocar pra próxima pisada (síncrono ok aqui)
      window.addEventListener('keydown', () => focusPedalInput(), true);
      window.addEventListener('keyup', () => focusPedalInput(), true);
      // Safety net periódico
      setInterval(focusPedalInput, 1500);
      setTimeout(focusPedalInput, 500);
      pedalInput.addEventListener('input', () => { pedalInput.value = ''; });
      pedalInput.addEventListener('blur', () => { if (!hasModalOpen()) focusPedalInput(); });

      // Helper global pros close() de TODOS os modais devolverem o foco
      // ao pedal dentro do user gesture do iOS. Chamar SÍNCRONO logo após
      // adicionar a classe `.x-exit` no overlay (o hasModalOpen passa a
      // ignorar overlays em saída — ver query acima).
      (window as any).__refocusPedal = focusPedalInput;
    }
  }

  // ─── Handlers de pedal reutilizáveis ──────────────────────────────
  //
  // SEM ZONA MORTA (v2026-07): antes, a 1ª pisada esperava 500ms num
  // setTimeout pra saber se vinha uma 2ª (duplo-tap) — ou seja, TODA
  // ação simples do pedal atrasava meio segundo fixo, além do lookahead.
  // Agora a 1ª pisada dispara NA HORA e a 2ª (< 500ms) CONVERTE a ação:
  // - direito: virada já → 2ª pisada = finalização ASSUME a virada em
  //   andamento (activateEndWithTiming já suporta, space:'fill').
  // - esquerdo: próximo ritmo já → 2ª pisada = redireciona pro ANTERIOR
  //   ao ritmo da 1ª pisada (playFillToNextRhythm re-chamado com fill
  //   ativa só retarget-eia o destino, sem reiniciar a virada).

  private pedalLeftLastPress = 0;
  private pedalLeftBaseVariation = 0;
  private pedalRightLastPress = 0;

  private handlePedalLeft(): void {
    if (!this.stateManager.isPlaying()) {
      if (!this.hasRhythmLoaded()) return;
      this.patternEngine.activateRhythm(this.firstAvailableMainVariation()); // não iniciar em desativada
      if (this.useIntro) {
        this.patternEngine.playIntroAndStart();
      } else {
        this.stateManager.setShouldPlayStartSound(true);
      }
      this.play();
    } else {
      const now = Date.now();
      if (now - this.pedalLeftLastPress < 500 && this.pedalLeftLastPress > 0) {
        // 2ª pisada: converte pra ritmo ANTERIOR ao da 1ª pisada
        this.cyclePedalRhythm(-1, this.pedalLeftBaseVariation);
        this.pedalLeftLastPress = 0;
      } else {
        this.pedalLeftLastPress = now;
        // Base ANTES da troca — se a 2ª pisada vier, "anterior" é
        // relativo ao ritmo que estava tocando, não ao já trocado
        this.pedalLeftBaseVariation = this.stateManager.getCurrentVariation('main');
        this.cyclePedalRhythm(+1);
      }
    }
  }

  private handlePedalRight(): void {
    // Durante a PAUSA: botão direito faz VIRADA (volta pro ritmo), NÃO toca
    // prato. O prato do pedal só volta quando estiver parado (após finalizar).
    if (this.isPaused) {
      this.resumeWithAction('fill', 0);
      return;
    }
    if (!this.stateManager.isPlaying()) {
      this.playCymbal();
    } else {
      const now = Date.now();
      if (now - this.pedalRightLastPress < 500 && this.pedalRightLastPress > 0) {
        // 2ª pisada: finalização assume a virada disparada pela 1ª
        if (this.useFinal) { this.patternEngine.playEndAndStop(); } else { this.stopAndMaybeAdvance(); }
        this.pedalRightLastPress = 0;
      } else {
        this.pedalRightLastPress = now;
        this.patternEngine.playRotatingFill();
      }
    }
  }

  private longPressFired = false;

  private setupPerformanceGrid(): void {
    document.querySelectorAll('.grid-cell').forEach((cell) => {
      this.setupLongPressDisable(cell as HTMLElement); // segurar 3s desativa (só ritmo/virada)
      cell.addEventListener('click', (e) => {
        // Long-press acabou de (des)ativar a variação: ignora o click seguinte.
        if (this.longPressFired) { this.longPressFired = false; return; }
        HapticsService.medium();
        const element = e.currentTarget as HTMLElement;
        const cellType = element.getAttribute('data-type');
        const variationIndex = parseInt(element.getAttribute('data-variation') || '0');

        if (cellType === 'main') {
          if (this.stateManager.isVariationDisabled('main', variationIndex)) return; // desativada: não seleciona
          if (this.resuming) return; // re-entrada da pausa em andamento: ignora clique
          const currentVariation = this.stateManager.getCurrentVariation('main');

          if (this.isPaused) {
            // Durante a PAUSA: clicar num ritmo seleciona ele e RETOMA nele,
            // cravado no tempo — SEM refazer o intro. A contagem da pausa já
            // faz o papel de metrônomo. Espelha virada/final durante a pausa.
            this.patternEngine.activateRhythm(variationIndex);
            this.resumeFromPause();
            return;
          }

          if (!this.stateManager.isPlaying()) {
            // Verificar se a variação clicada tem conteúdo
            const variation = this.stateManager.getState().variations.main[variationIndex];
            const hasContent = variation?.pattern.some(row => row.some(step => step === true));
            if (!hasContent) {
              this.modalManager.show(
                t('main.modal.noRhythmLoadedTitle'),
                t('main.modal.noRhythmLoadedBody'),
                'warning'
              );
              return;
            }
            // Parado → ativar ritmo e dar play
            this.patternEngine.activateRhythm(variationIndex);
            if (this.useIntro) {
              this.patternEngine.playIntroAndStart();
            } else {
              this.stateManager.setShouldPlayStartSound(true);
            }
            this.play();
          } else if (variationIndex === currentVariation) {
            // Clicou no ritmo que já está tocando — ignorar.
            // Evita parar acidentalmente (cliques sem querer no pad ativo).
            // Pra parar, usar o botão FINAL ou o pedal.
          } else {
            // Tocando outro ritmo → trocar (com ou sem virada, conforme toggle)
            this.changeMainRhythm(variationIndex);
          }
        } else if (cellType === 'fill') {
          if (this.stateManager.isVariationDisabled('fill', variationIndex)) return; // desativada: não seleciona
          if (this.stateManager.isPlaying()) {
            this.patternEngine.activateFillWithTiming(variationIndex);
          } else if (this.isPaused) {
            // Virada durante a pausa: sai da pausa e aplica (volta pro ritmo).
            this.resumeWithAction('fill', variationIndex);
          }
        } else if (cellType === 'end') {
          if (this.stateManager.isPlaying()) {
            // Respeitar toggle de finalização (mesma regra do pedal direito duplo-tap)
            if (this.useFinal) {
              this.patternEngine.activateEndWithTiming(variationIndex);
            } else {
              this.stopAndMaybeAdvance();
            }
          } else if (this.isPaused) {
            // Finalização durante a pausa: sai da pausa e finaliza.
            this.resumeWithAction('end', variationIndex);
          }
        }
      });
    });
  }

  // ─── Desativar variação por long-press (3s) — ritmo/virada 1-3 ──────
  // Segurar 3s numa célula de ritmo ou virada alterna "desativada": fica
  // sem cor e é PULADA na rotação (pedal/auto). Persistido por ritmo.
  private setupLongPressDisable(cell: HTMLElement): void {
    const type = cell.getAttribute('data-type');
    if (type !== 'main' && type !== 'fill') return; // só ritmo e virada
    const index = parseInt(cell.getAttribute('data-variation') || '0');
    let timer: number | null = null;
    const start = () => {
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        this.longPressFired = true; // suprime o click que vem ao soltar
        const nowDisabled = this.stateManager.toggleVariationDisabled(type as 'main' | 'fill', index);
        this.persistDisabledVariations();
        this.uiManager.updatePerformanceGrid();
        HapticsService.heavy();
        this.uiManager.showAlert(nowDisabled ? t('main.variation.disabledAlert') : t('main.variation.enabledAlert'));
      }, 1500);
    };
    const cancel = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };
    cell.addEventListener('mousedown', start);
    cell.addEventListener('touchstart', start, { passive: true });
    cell.addEventListener('mouseup', cancel);
    cell.addEventListener('mouseleave', cancel);
    cell.addEventListener('touchend', cancel);
    cell.addEventListener('touchcancel', cancel);
  }

  private readonly disabledStorageKey = 'gdrums-disabled-variations';

  // Desativar variações é uma ALTERAÇÃO do ritmo SALVO — não do ritmo base.
  // Por isso só persiste pra ritmos do usuário (u:<id>). Em ritmo do catálogo
  // é só da sessão (não altera o base ao recarregar); ao "Salvar como meu
  // ritmo" a desativação atual viaja pro ritmo salvo (persist chamado no save).
  private persistDisabledVariations(): void {
    if (!this.currentUserRhythmId) return; // ritmo base: não persiste
    try {
      const all = JSON.parse(localStorage.getItem(this.disabledStorageKey) || '{}');
      const d = this.stateManager.getDisabledVariations();
      const key = `u:${this.currentUserRhythmId}`;
      if (d.main.length === 0 && d.fill.length === 0) delete all[key];
      else all[key] = d;
      localStorage.setItem(this.disabledStorageKey, JSON.stringify(all));
    } catch { /* noop */ }
  }

  /** Se a variação de ritmo ATUAL está desativada, troca pra 1ª disponível
   *  (com conteúdo e não desativada). Chamado antes de iniciar a reprodução
   *  pra não começar tocando uma variação desativada. */
  /** 1ª variação de ritmo disponível (com conteúdo e não desativada). Fallback 0. */
  private firstAvailableMainVariation(): number {
    const vars = this.stateManager.getState().variations.main;
    for (let i = 0; i < vars.length; i++) {
      const hasContent = vars[i]?.pattern?.some(r => r.some(s => s === true));
      if (hasContent && !this.stateManager.isVariationDisabled('main', i)) return i;
    }
    return 0;
  }

  private ensurePlayableMainVariation(): void {
    const cur = this.stateManager.getCurrentVariation('main');
    if (!this.stateManager.isVariationDisabled('main', cur)) return;
    this.patternEngine.activateRhythm(this.firstAvailableMainVariation());
  }

  /** Carrega o set de desativadas: ritmo do usuário → o que foi salvo; ritmo
   *  base (catálogo) → limpo (não retém alteração). Chamado ao trocar de ritmo. */
  private loadDisabledVariations(): void {
    if (!this.currentUserRhythmId) { this.stateManager.setDisabledVariations([], []); return; }
    try {
      const all = JSON.parse(localStorage.getItem(this.disabledStorageKey) || '{}');
      const d = all[`u:${this.currentUserRhythmId}`];
      this.stateManager.setDisabledVariations(
        Array.isArray(d?.main) ? d.main : [],
        Array.isArray(d?.fill) ? d.fill : []
      );
    } catch {
      this.stateManager.setDisabledVariations([], []);
    }
  }

  // ─── Toggles Intro/Viradas/Final (persistidos) ───────────────────

  private useIntro = true;
  private useFills = true;   // Viradas ao trocar de ritmo (default ON)
  private useFinal = true;
  private useAutoNext = false;  // Auto-avançar repertório ao finalizar (default OFF)

  private setupToggles(): void {
    // Carregar do localStorage
    const savedIntro = localStorage.getItem('gdrums-toggle-intro');
    const savedFills = localStorage.getItem('gdrums-toggle-fills');
    const savedFinal = localStorage.getItem('gdrums-toggle-final');
    const savedAutoNext = localStorage.getItem('gdrums-toggle-autonext');
    if (savedIntro !== null) this.useIntro = savedIntro === 'true';
    if (savedFills !== null) this.useFills = savedFills === 'true';
    if (savedFinal !== null) this.useFinal = savedFinal === 'true';
    if (savedAutoNext !== null) this.useAutoNext = savedAutoNext === 'true';

    const introToggle = document.getElementById('toggleIntro');
    const fillsToggle = document.getElementById('toggleFills');
    const finalToggle = document.getElementById('toggleFinal');
    const autoNextToggle = document.getElementById('toggleAutoNext');

    // Aplicar estado inicial
    if (introToggle) introToggle.classList.toggle('active', this.useIntro);
    if (fillsToggle) {
      fillsToggle.classList.toggle('active', this.useFills);
      fillsToggle.title = this.useFills
        ? t('main.toggle.fillsOnTitle')
        : t('main.toggle.fillsOffTitle');
    }
    if (finalToggle) finalToggle.classList.toggle('active', this.useFinal);
    if (autoNextToggle) {
      autoNextToggle.classList.toggle('active', this.useAutoNext);
      autoNextToggle.title = this.useAutoNext
        ? t('main.toggle.autoNextOnTitle')
        : t('main.toggle.autoNextOffTitle');
    }

    introToggle?.addEventListener('click', () => {
      this.useIntro = !this.useIntro;
      introToggle.classList.toggle('active', this.useIntro);
      localStorage.setItem('gdrums-toggle-intro', String(this.useIntro));
    });

    fillsToggle?.addEventListener('click', () => {
      this.useFills = !this.useFills;
      fillsToggle.classList.toggle('active', this.useFills);
      fillsToggle.title = this.useFills
        ? t('main.toggle.fillsOnTitle')
        : t('main.toggle.fillsOffTitle');
      localStorage.setItem('gdrums-toggle-fills', String(this.useFills));
    });

    finalToggle?.addEventListener('click', () => {
      this.useFinal = !this.useFinal;
      finalToggle.classList.toggle('active', this.useFinal);
      localStorage.setItem('gdrums-toggle-final', String(this.useFinal));
    });

    autoNextToggle?.addEventListener('click', () => {
      this.useAutoNext = !this.useAutoNext;
      autoNextToggle.classList.toggle('active', this.useAutoNext);
      autoNextToggle.title = this.useAutoNext
        ? t('main.toggle.autoNextOnTitle')
        : t('main.toggle.autoNextOffTitle');
      localStorage.setItem('gdrums-toggle-autonext', String(this.useAutoNext));
    });
  }

  /**
   * Troca de ritmo respeitando o toggle "VIRADAS":
   * - useFills=true  → playFillToNextRhythm (toca virada → muda)
   * - useFills=false → activateRhythm direto (muda imediato, sem fill)
   * Usado pelo clique nas células de ritmo.
   */
  private changeMainRhythm(targetVariation: number): void {
    if (this.useFills) {
      this.patternEngine.playFillToNextRhythm(targetVariation);
    } else {
      this.patternEngine.activateRhythm(targetVariation);
    }
  }

  /**
   * Rotação de ritmo via pedal. Direção +1 = próximo, -1 = anterior.
   * Pula ritmos vazios. Respeita toggle VIRADAS: ON faz virada antes,
   * OFF troca direto.
   *
   * @param baseIndex Variação de REFERÊNCIA pro cálculo. Usado pelo
   * duplo-tap do pedal esquerdo: a 1ª pisada já trocou (ou agendou) o
   * próximo, então "anterior" precisa ser relativo ao ritmo da 1ª
   * pisada, não ao atual. Default: variação main corrente.
   */
  private cyclePedalRhythm(direction: 1 | -1, baseIndex?: number): void {
    const state = this.stateManager.getState();
    const available = state.variations.main
      .map((v, index) => ({ index, hasContent: v.pattern.some(row => row.some(s => s === true)) }))
      .filter(r => r.hasContent && !this.stateManager.isVariationDisabled('main', r.index));

    if (available.length <= 1) {
      // Só 1 ritmo (ou nenhum) — fallback pro fill rotativo se VIRADAS ON,
      // senão não faz nada.
      if (this.useFills) this.patternEngine.playFillToNextRhythm();
      return;
    }

    const currentIndex = baseIndex ?? this.stateManager.getCurrentVariation('main');
    const currentPos = available.findIndex(r => r.index === currentIndex);
    const nextPos = direction === 1
      ? (currentPos + 1) % available.length
      : (currentPos - 1 + available.length) % available.length;
    const targetVariation = available[nextPos].index;

    if (this.useFills) {
      this.patternEngine.playFillToNextRhythm(targetVariation);
    } else {
      this.patternEngine.activateRhythm(targetVariation);
    }
  }

  private setupFileOperations(): void {
    // Novo Projeto
    const newProjectBtn = document.getElementById('newProject');
    if (newProjectBtn) {
      newProjectBtn.addEventListener('click', async () => {
        const confirmed = await this.uiManager.showConfirm(t('main.confirm.newProjectTitle'), t('main.confirm.newProjectBody'));
        if (confirmed) {
          if (this.stateManager.isPlaying()) this.stop();
          // Resetar state do editor sem afetar user mode
          const state = this.stateManager.getState();
          const { createEmptyPattern, createEmptyVolumes, createEmptyChannels } = await import('./utils/helpers');
          for (const type of ['main', 'fill', 'end', 'intro', 'transition'] as const) {
            state.patterns[type] = createEmptyPattern();
            state.volumes[type] = createEmptyVolumes();
            state.channels[type] = createEmptyChannels();
            const maxVar = type === 'end' || type === 'intro' || type === 'transition' ? 1 : 3;
            for (let i = 0; i < maxVar; i++) {
              state.variations[type][i] = {
                pattern: createEmptyPattern(),
                volumes: createEmptyVolumes(),
                channels: createEmptyChannels(),
                steps: type === 'end' ? 8 : 16,
                speed: 1
              };
            }
          }
          state.tempo = 80;
          this.stateManager.setTempo(80);
          this.switchEditingPattern('main');
          this.updateProjectBar('');
          this.uiManager.refreshGridDisplay();
          this.uiManager.updateVariationButtons();
          this.uiManager.showAlert(t('main.alert.newProjectCreated'));
        }
      });
    }

    // Salvar Projeto
    const saveAllBtn = document.getElementById('saveAll');
    if (saveAllBtn) {
      saveAllBtn.addEventListener('click', () => this.fileManager.saveProject());
    }

    // Abrir Projeto
    const loadAllBtn = document.getElementById('loadAll');
    const loadAllFile = document.getElementById('loadAllFile') as HTMLInputElement;
    if (loadAllBtn && loadAllFile) {
      loadAllBtn.addEventListener('click', () => loadAllFile.click());
      loadAllFile.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          try {
            if (this.stateManager.isPlaying()) this.stop();
            await this.fileManager.loadProjectFromFile(file);
            this.updateProjectBar(file.name.replace('.json', ''));
            this.uiManager.refreshGridDisplay();
            this.uiManager.updateVariationButtons();
            this.uiManager.showAlert(t('main.alert.projectLoaded'));
          } catch (error) {
            void error;
            this.uiManager.showAlert(t('main.alert.projectLoadError'));
          }
        }
      });
    }

    // Save/Load Pattern
    const savePatternBtn = document.getElementById('savePattern');
    if (savePatternBtn) {
      savePatternBtn.addEventListener('click', () => {
        const pattern = this.stateManager.getEditingPattern();
        this.fileManager.savePattern(pattern);
      });
    }

    const loadPatternBtn = document.getElementById('loadPattern');
    const loadFile = document.getElementById('loadFile') as HTMLInputElement;
    if (loadPatternBtn && loadFile) {
      loadPatternBtn.addEventListener('click', () => loadFile.click());
      loadFile.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          try {
            await this.fileManager.loadPatternFromFile(file);
            this.uiManager.refreshGridDisplay();
            this.uiManager.showAlert(t('main.alert.patternLoaded'));
          } catch (error) {
            console.error('Error loading pattern:', error);
            this.uiManager.showAlert(t('main.alert.patternLoadError'));
          }
        }
      });
    }

    // Clear Pattern
    const clearPatternBtn = document.getElementById('clearPattern');
    if (clearPatternBtn) {
      clearPatternBtn.addEventListener('click', () => {
        if (confirm(t('main.confirm.clearPattern'))) {
          const pattern = this.stateManager.getEditingPattern();
          const state = this.stateManager.getState();
          const numSteps = this.stateManager.getPatternSteps(pattern);

          // Limpar padrão com número correto de steps
          for (let channel = 0; channel < MAX_CHANNELS; channel++) {
            for (let step = 0; step < numSteps; step++) {
              state.patterns[pattern][channel][step] = false;
              state.volumes[pattern][channel][step] = 1.0;
            }
          }

          // Auto-salvar a variação limpa
          const currentSlot = this.stateManager.getCurrentVariation(pattern);
          this.stateManager.saveVariation(pattern, currentSlot);

          this.uiManager.refreshGridDisplay();
          this.uiManager.updateVariationButtons();
          this.uiManager.showAlert(t('main.alert.patternCleared'));
        }
      });
    }

    // Load rhythm - Admin mode
    const rhythmSelect = document.getElementById('rhythmSelect') as HTMLSelectElement;
    if (rhythmSelect) {
      rhythmSelect.addEventListener('change', () => {
        const filePath = rhythmSelect.value;
        if (filePath) {
          this.loadRhythmFromPath(filePath);
        }
      });
    }

    // Load rhythm - User mode
    const rhythmSelectUser = document.getElementById('rhythmSelectUser') as HTMLSelectElement;
    if (rhythmSelectUser) {
      rhythmSelectUser.addEventListener('change', () => {
        const filePath = rhythmSelectUser.value;
        if (filePath) {
          this.loadRhythmFromPath(filePath);
        }
      });
    }


    // Refresh rhythms button
    const refreshRhythmsBtn = document.getElementById('refreshRhythms');
    if (refreshRhythmsBtn) {
      refreshRhythmsBtn.addEventListener('click', () => {
        this.loadAvailableRhythms();
        this.uiManager.showAlert(t('main.alert.rhythmListRefreshed'));
      });
    }
  }

  // ─── Admin mode com persistência segura ──────────────────────────

  // Token secreto que não pode ser adivinhado pelo usuário
  // Gerado com timestamp + salt no primeiro acesso admin
  private static readonly ADMIN_STORAGE_KEY = 'gdrums-mode';
  private static readonly ADMIN_SECRET = 'gD$2026!rHyThM#aDmIn';

  private generateAdminToken(): string {
    // Hash simples mas não-trivial: combina secret + user agent + screen
    const raw = RhythmSequencer.ADMIN_SECRET + navigator.userAgent + screen.width;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = ((hash << 5) - hash) + raw.charCodeAt(i);
      hash = hash & hash;
    }
    return 'adm_' + Math.abs(hash).toString(36) + '_' + raw.length.toString(36);
  }

  private saveAdminState(isAdmin: boolean): void {
    if (isAdmin) {
      localStorage.setItem(RhythmSequencer.ADMIN_STORAGE_KEY, this.generateAdminToken());
    } else {
      localStorage.removeItem(RhythmSequencer.ADMIN_STORAGE_KEY);
    }
  }

  private isAdminPersisted(): boolean {
    // Só admins reais (role do banco) podem ter modo admin
    if (this.userRole !== 'admin') return false;
    const stored = localStorage.getItem(RhythmSequencer.ADMIN_STORAGE_KEY);
    if (!stored) return false;
    return stored === this.generateAdminToken();
  }

  private setupModeToggle(): void {
    // Seletor de idioma — o item do menu mostra a BANDEIRINHA do idioma
    // atual + label traduzido (HTML estático não é hidratado pelo i18n;
    // este item é via JS)
    const languageBtn = document.getElementById('languageBtn');
    if (languageBtn) {
      const flags: Record<string, string> = { 'pt-BR': '🇧🇷', 'es-419': '🇲🇽', 'en': '🇺🇸' };
      languageBtn.textContent = `${flags[getLocale()] || '🌎'} ${t('main.language.menuItem')}`;
      languageBtn.addEventListener('click', () => this.showLanguageSelector());
    }

    // Manual do Usuário
    const userManualBtn = document.getElementById('userManualBtn');
    if (userManualBtn) {
      userManualBtn.addEventListener('click', () => this.showUserManual());
    }

    // Equalizador e Reverb
    const eqBtn = document.getElementById('eqBtn');
    if (eqBtn) {
      eqBtn.addEventListener('click', () => this.openEqPanel());
    }
    this.applyAudioFxFromStorage(); // aplica EQ/reverb salvos ao iniciar

    // Info pedal
    const pedalInfoBtn = document.getElementById('pedalInfoBtn');
    if (pedalInfoBtn) {
      pedalInfoBtn.addEventListener('click', () => {
        if (fabDropdown) fabDropdown.style.display = 'none';
        this.showPedalInfo();
      });
    }

    // Botões de loja no TOPO — só em clientes NÃO-nativos (web/PWA).
    // No app nativo ficam escondidos (o usuário já baixou).
    if (!isNativeApp()) {
      const hdrPlay = document.getElementById('hdrPlayStoreBtn');
      if (hdrPlay) {
        hdrPlay.style.display = '';
        hdrPlay.addEventListener('click', () => openPlayStore()); // market:// c/ fallback HTTPS
      }
      const hdrApp = document.getElementById('hdrAppStoreBtn');
      if (hdrApp) {
        hdrApp.style.display = '';
        hdrApp.addEventListener('click', () => openExternal(APP_STORE_URL));
      }
    }

    // Baixar offline (manual — user pode forçar mesmo se já tá baixado)
    const offlineBtn = document.getElementById('menuOfflineBtn');
    if (offlineBtn) {
      offlineBtn.addEventListener('click', async () => {
        if (fabDropdown) fabDropdown.style.display = 'none';
        // No app nativo, ritmos+samples já estão bundleados — não há nada pra baixar.
        if (isNativeApp()) {
          const { markNativeReady } = await import('./native/OfflineDownloader');
          await markNativeReady();
          Toast.show(t('main.toast.allOffline'), { type: 'success' });
          return;
        }
        // Limpa o "pulado" pra modal mostrar de novo
        localStorage.removeItem('gdrums-offline-skipped');
        try {
          const manifestRes = await fetch('/rhythm/manifest.json');
          const manifest = await manifestRes.json();
          const { getOfflineStatus } = await import('./native/OfflineDownloader');
          const status = await getOfflineStatus();
          this.showOfflineDownloadModal(manifest.version || 0, status.ready);
        } catch {
          Toast.show(t('main.toast.offlineCheckFailed'), { type: 'warn' });
        }
      });
    }

    // Mapear pedal
    const pedalMapBtn = document.getElementById('pedalMapBtn');
    if (pedalMapBtn) {
      pedalMapBtn.addEventListener('click', () => {
        if (fabDropdown) fabDropdown.style.display = 'none';
        this.showPedalMapper();
      });
    }

    // Modo Show — switch sempre visível na topbar (1 clique liga/desliga)
    const stageModeSwitch = document.getElementById('stageModeSwitch') as HTMLInputElement | null;
    if (stageModeSwitch) {
      // Sincroniza estado inicial caso usuário recarregue com stage-mode ativo
      stageModeSwitch.checked = document.body.classList.contains('stage-mode');
      stageModeSwitch.addEventListener('change', () => {
        if (stageModeSwitch.checked) {
          this.enterStageMode();
        } else {
          this.exitStageMode();
        }
      });
    }

    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        if (this.stateManager.isPlaying()) this.stop();
        const { authService } = await import('./auth/AuthService');
        await authService.logout();
      });
    }

    // Minha Conta
    const myAccountBtn = document.getElementById('myAccountBtn');
    if (myAccountBtn) {
      myAccountBtn.addEventListener('click', () => {
        const fabDropdown = document.getElementById('fabDropdown');
        if (fabDropdown) fabDropdown.style.display = 'none';
        // showAccountModal é async — captura erros pra não morrer silenciosamente
        this.showAccountModal().catch(err => {
          console.error('[gdrums] Erro ao abrir Minha Conta:', err);
          this.modalManager.show(t('main.modal.accountErrorTitle'), t('main.modal.accountErrorBody'), 'warning');
        });
      });
    }

    // Instalar app — botão sempre visível no MENU quando não-standalone.
    //
    // Comportamento por plataforma:
    // - Android/Desktop com installPrompt capturado: dispara nativo na hora
    // - Android/Desktop sem prompt: mostra tutorial com passos manuais
    //   (caso comum: user já dispensou o prompt OU browser não suporta)
    // - iOS Safari (não tem beforeinstallprompt): sempre mostra tutorial
    // - Já instalado (standalone): botão fica hidden
    const menuInstallBtn = document.getElementById('menuInstallBtn');
    // Esconder em PWA standalone OU Capacitor app nativo (já está instalado).
    const isStandalonePWA = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as any).standalone === true
      || isNativeApp();
    if (menuInstallBtn) {
      menuInstallBtn.style.display = isStandalonePWA ? 'none' : '';

      // Android web: existe app oficial na Play Store. Label muda pra ficar
      // claro que vai abrir a loja, não instalar PWA.
      if (isAndroidWeb()) {
        menuInstallBtn.textContent = t('main.install.playStoreButton');
      }

      menuInstallBtn.addEventListener('click', () => {
        const fabDropdown = document.getElementById('fabDropdown');
        if (fabDropdown) fabDropdown.style.display = 'none';

        // Android web: existe app nativo na Play Store, então PWA fragmenta
        // a base de usuários. Sempre prioriza loja sobre PWA.
        if (isAndroidWeb()) {
          openPlayStore();
          return;
        }

        if (this.installPrompt) {
          // Desktop com prompt capturado — dispara nativo
          this.installPrompt.prompt();
          this.installPrompt.userChoice.then((choice: any) => {
            if (choice.outcome === 'accepted') {
              this.modalManager.show(t('main.modal.appInstalledTitle'), t('main.modal.appInstalledBody'), 'success');
              menuInstallBtn.style.display = 'none';
            }
            this.installPrompt = null;
          });
        } else {
          // iOS OU Desktop sem prompt disponível — tutorial manual
          this.showInstallTutorial();
        }
      });
    }

    // Fab menu toggle
    const fabMenu = document.getElementById('fabMenu');
    const fabDropdown = document.getElementById('fabDropdown');
    if (fabMenu && fabDropdown) {
      fabMenu.addEventListener('click', (e) => {
        e.stopPropagation();
        fabDropdown.style.display = fabDropdown.style.display === 'none' ? 'block' : 'none';
      });
      document.addEventListener('click', () => {
        fabDropdown.style.display = 'none';
      });
    }

    // Mode toggle — só visível para admins (role do banco de dados)
    const adminModeToggle = document.getElementById('adminModeToggle') as HTMLInputElement;
    const userMode = document.getElementById('userMode');
    const adminMode = document.getElementById('adminMode');
    const modeLabel = document.getElementById('modeLabel');
    const modeToggleItem = adminModeToggle?.closest('.topbar-dropdown-item') as HTMLElement;

    if (this.userRole !== 'admin') {
      // Não é admin — esconder toggle completamente e forçar modo usuário
      if (modeToggleItem) modeToggleItem.style.display = 'none';
      if (modeLabel) modeLabel.style.display = 'none';
      this.isAdminMode = false;
      this.saveAdminState(false);
    } else if (adminModeToggle && userMode && adminMode && modeLabel) {
      // É admin — mostrar toggle e permitir troca
      if (modeToggleItem) modeToggleItem.style.display = '';

      // Restaurar estado persistido (com validação de token)
      if (this.isAdminPersisted()) {
        this.isAdminMode = true;
        adminModeToggle.checked = true;
        userMode.classList.remove('active');
        adminMode.classList.add('active');
        modeLabel.textContent = t('main.mode.admin');
      }

      adminModeToggle.addEventListener('change', (e) => {
        const isAdmin = (e.target as HTMLInputElement).checked;
        this.isAdminMode = isAdmin;

        if (isAdmin) {
          userMode.classList.remove('active');
          adminMode.classList.add('active');
          modeLabel.textContent = t('main.mode.admin');
        } else {
          adminMode.classList.remove('active');
          userMode.classList.add('active');
          modeLabel.textContent = t('main.mode.user');
        }

        this.saveAdminState(isAdmin);
        if (fabDropdown) fabDropdown.style.display = 'none';
      });
    }
  }

  private setupMIDISelectors(): void {
    for (let i = 1; i <= MAX_CHANNELS; i++) {
      const midiSelect = document.getElementById(`midiSelect${i}`) as HTMLSelectElement;
      if (midiSelect) {
        midiSelect.addEventListener('change', (e) => this.handleMidiSelect(e, i - 1));
      }

      const customMidiBtn = document.querySelector(`.btn-custom-midi[data-channel="${i}"]`) as HTMLElement;
      const customMidiInput = document.getElementById(`customMidiInput${i}`) as HTMLInputElement;
      if (customMidiBtn && customMidiInput) {
        customMidiBtn.addEventListener('click', () => customMidiInput.click());
        customMidiInput.addEventListener('change', (e) => this.handleCustomMidiUpload(e, i - 1));
      }
    }
  }

  private setupSpecialSounds(): void {
    // Som de início (Fill Start)
    const fillStartSelect = document.getElementById('fillStartSelect') as HTMLSelectElement;
    const fillStartCustomInput = document.getElementById('fillStartCustomInput') as HTMLInputElement;
    const fillStartCustomBtn = document.getElementById('fillStartCustomBtn');

    if (fillStartSelect) {
      // Carregar MIDIs disponíveis no select
      this.loadAvailableMidi().then(() => {
        const midiFiles = [
          'bumbo.wav', 'caixa.wav', 'chimbal_fechado.wav', 'chimbal_aberto.wav',
          'prato.mp3', 'surdo.wav', 'tom_1.wav', 'tom_2.wav'
        ];
        fillStartSelect.innerHTML = `<option value="">${t('main.select.none')}</option>`;
        midiFiles.forEach(file => {
          const option = document.createElement('option');
          option.value = `/midi/${file}`;
          option.textContent = file;
          fillStartSelect.appendChild(option);
        });
      });

      fillStartSelect.addEventListener('change', async (e) => {
        const path = (e.target as HTMLSelectElement).value;
        if (path) {
          const buffer = await this.audioManager.loadAudioFromPath(path);
          this.stateManager.getState().fillStartSound = {
            buffer,
            fileName: path.split('/').pop() || '',
            midiPath: path
          };
        } else {
          this.stateManager.getState().fillStartSound = {
            buffer: null,
            fileName: '',
            midiPath: ''
          };
        }
      });
    }

    if (fillStartCustomBtn && fillStartCustomInput) {
      fillStartCustomBtn.addEventListener('click', () => fillStartCustomInput.click());
      fillStartCustomInput.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const audioBuffer = await this.audioManager.loadAudioFromFile(file);
          this.stateManager.getState().fillStartSound = {
            buffer: audioBuffer,
            fileName: file.name,
            midiPath: ''
          };
          const fileNameDisplay = document.getElementById('fillStartFileName');
          if (fileNameDisplay) fileNameDisplay.textContent = file.name;
        }
      });
    }

    // Som de retorno (Fill Return)
    const fillReturnSelect = document.getElementById('fillReturnSelect') as HTMLSelectElement;
    const fillReturnCustomInput = document.getElementById('fillReturnCustomInput') as HTMLInputElement;
    const fillReturnCustomBtn = document.getElementById('fillReturnCustomBtn');

    if (fillReturnSelect) {
      // Carregar MIDIs disponíveis no select
      this.loadAvailableMidi().then(() => {
        const midiFiles = [
          'bumbo.wav', 'caixa.wav', 'chimbal_fechado.wav', 'chimbal_aberto.wav',
          'prato.mp3', 'surdo.wav', 'tom_1.wav', 'tom_2.wav'
        ];
        fillReturnSelect.innerHTML = `<option value="">${t('main.select.none')}</option>`;
        midiFiles.forEach(file => {
          const option = document.createElement('option');
          option.value = `/midi/${file}`;
          option.textContent = file;
          fillReturnSelect.appendChild(option);
        });
      });

      fillReturnSelect.addEventListener('change', async (e) => {
        const path = (e.target as HTMLSelectElement).value;
        if (path) {
          const buffer = await this.audioManager.loadAudioFromPath(path);
          this.stateManager.getState().fillReturnSound = {
            buffer,
            fileName: path.split('/').pop() || '',
            midiPath: path
          };
        } else {
          this.stateManager.getState().fillReturnSound = {
            buffer: null,
            fileName: '',
            midiPath: ''
          };
        }
      });
    }

    if (fillReturnCustomBtn && fillReturnCustomInput) {
      fillReturnCustomBtn.addEventListener('click', () => fillReturnCustomInput.click());
      fillReturnCustomInput.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const audioBuffer = await this.audioManager.loadAudioFromFile(file);
          this.stateManager.getState().fillReturnSound = {
            buffer: audioBuffer,
            fileName: file.name,
            midiPath: ''
          };
          const fileNameDisplay = document.getElementById('fillReturnFileName');
          if (fileNameDisplay) fileNameDisplay.textContent = file.name;
        }
      });
    }
  }

  private setupVariations(): void {
    // Event listeners para slots de variação
    document.querySelectorAll('.variation-slot').forEach((slot) => {
      slot.addEventListener('click', (e) => {
        const slotIndex = parseInt((e.currentTarget as HTMLElement).getAttribute('data-slot')!);
        this.selectVariationSlot(slotIndex);
      });
    });

    // Botão Testar Variação
    const testVariationBtn = document.getElementById('testVariation');
    if (testVariationBtn) {
      testVariationBtn.addEventListener('click', () => this.testCurrentVariation());

      // Atualizar o texto do botão baseado no estado de reprodução
      this.stateManager.subscribe('playState', (state) => {
        if (state.isPlaying) {
          testVariationBtn.innerHTML = `<span>${t('main.variation.stopButton')}</span>`;
        } else {
          testVariationBtn.innerHTML = `<span>${t('main.variation.testButton')}</span>`;
        }
      });
    }

    // Controle de velocidade da variação
    const variationSpeedSlider = document.getElementById('variationSpeed') as HTMLInputElement;
    const variationSpeedDisplay = document.getElementById('variationSpeedDisplay');

    if (variationSpeedSlider && variationSpeedDisplay) {
      variationSpeedSlider.addEventListener('input', (e) => {
        const speed = parseFloat((e.target as HTMLInputElement).value);
        const patternType = this.stateManager.getEditingPattern();
        const slotIndex = this.stateManager.getCurrentVariation(patternType);

        this.stateManager.setVariationSpeed(patternType, slotIndex, speed);
        variationSpeedDisplay.textContent = `${speed}x`;

        // Atualizar botões de preset
        this.updateSpeedPresetButtons(speed);
      });
    }

    // Botões de preset de velocidade
    document.querySelectorAll('.speed-preset').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const speed = parseFloat((e.target as HTMLElement).dataset.speed || '1');
        const patternType = this.stateManager.getEditingPattern();
        const slotIndex = this.stateManager.getCurrentVariation(patternType);

        this.stateManager.setVariationSpeed(patternType, slotIndex, speed);

        if (variationSpeedSlider) variationSpeedSlider.value = speed.toString();
        if (variationSpeedDisplay) variationSpeedDisplay.textContent = `${speed}x`;

        this.updateSpeedPresetButtons(speed);
      });
    });

    // Seletor de steps do padrão
    const patternStepsSelect = document.getElementById('patternStepsSelect') as HTMLSelectElement;
    const currentStepsDisplay = document.getElementById('currentStepsDisplay');

    if (patternStepsSelect) {
      patternStepsSelect.addEventListener('change', (e) => {
        const steps = parseInt((e.target as HTMLSelectElement).value);
        const patternType = this.stateManager.getEditingPattern();

        // Expandir ou encolher os arrays pattern e volumes para o novo tamanho
        const state = this.stateManager.getState();
        const currentPattern = state.patterns[patternType];
        const currentVolumes = state.volumes[patternType];

        // Criar novos arrays com o tamanho correto
        const newPattern: boolean[][] = [];
        const newVolumes: number[][] = [];

        for (let i = 0; i < MAX_CHANNELS; i++) {
          newPattern[i] = [];
          newVolumes[i] = [];
          for (let j = 0; j < steps; j++) {
            // Copiar valores existentes ou usar padrão
            newPattern[i][j] = currentPattern[i]?.[j] ?? false;
            newVolumes[i][j] = currentVolumes[i]?.[j] ?? 1.0;
          }
        }

        // Atualizar state
        state.patterns[patternType] = newPattern;
        state.volumes[patternType] = newVolumes;

        // Atualizar steps do padrão atual
        this.stateManager.setPatternSteps(patternType, steps);

        // Auto-salvar a variação atual com o novo tamanho
        const currentSlot = this.stateManager.getCurrentVariation(patternType);
        this.stateManager.saveVariation(patternType, currentSlot);

        // Atualizar display
        if (currentStepsDisplay) {
          currentStepsDisplay.textContent = t('main.variation.stepsCount', { steps });
        }

        // Regenerar grid com novo número de steps
        this.generateChannelsHTML();

        // Recarregar MIDIs e reconectar event listeners
        this.loadAvailableMidi().then(() => {
          this.setupMIDISelectors();
        });

        // Atualizar display
        this.uiManager.refreshGridDisplay();
      });
    }

    // Observer para atualizar o seletor quando mudar de padrão ou variação
    this.stateManager.subscribe('editingPattern', () => {
      this.updateStepsSelector();
    });

    this.stateManager.subscribe('patternSteps', () => {
      this.updateStepsSelector();
    });

    // Atualizar UI inicial
    this.updateVariationSlotsUI();
    this.updateStepsSelector();
  }

  private updateStepsSelector(): void {
    const patternStepsSelect = document.getElementById('patternStepsSelect') as HTMLSelectElement;
    const currentStepsDisplay = document.getElementById('currentStepsDisplay');
    const patternType = this.stateManager.getEditingPattern();
    const steps = this.stateManager.getPatternSteps(patternType);

    if (patternStepsSelect) {
      patternStepsSelect.value = steps.toString();
    }

    if (currentStepsDisplay) {
      currentStepsDisplay.textContent = t('main.variation.stepsCount', { steps });
    }
  }

  private selectVariationSlot(slotIndex: number): void {
    const patternType = this.stateManager.getEditingPattern();
    const maxSlots = patternType === 'end' ? 1 : 3;

    if (slotIndex >= maxSlots) {
      this.uiManager.showAlert(t('main.alert.maxVariations', { pattern: patternType.toUpperCase(), max: maxSlots }));
      return;
    }

    // Auto-salvar a variação atual antes de trocar
    const currentSlot = this.stateManager.getCurrentVariation(patternType);
    this.stateManager.saveVariation(patternType, currentSlot);

    // Trocar para o novo slot
    this.stateManager.setCurrentVariation(patternType, slotIndex);

    // Carregar a variação selecionada (mesmo que vazia)
    const state = this.stateManager.getState();
    const variation = state.variations[patternType][slotIndex];

    if (variation && variation.pattern) {
      this.stateManager.loadVariation(patternType, slotIndex);
      this.updateMIDISelectorsFromState();
      this.uiManager.refreshGridDisplay();
    }

    this.updateVariationSlotsUI();
  }

  private testCurrentVariation(): void {
    const patternType = this.stateManager.getEditingPattern();
    const slotIndex = this.stateManager.getCurrentVariation(patternType);
    let state = this.stateManager.getState();

    // Se estiver tocando, parar
    if (this.stateManager.isPlaying()) {
      this.patternEngine.setTestMode(false);
      this.stop();
      return;
    }

    const variation = state.variations[patternType][slotIndex];

    if (!variation || !variation.pattern) {
      this.uiManager.showAlert(t('main.alert.noVariationToTest'));
      return;
    }

    // Verificar se há conteúdo na variação
    const hasContent = variation.pattern.some(row => row.some(step => step === true));
    if (!hasContent) {
      this.uiManager.showAlert(t('main.alert.variationEmpty'));
      return;
    }

    // Auto-salvar antes de testar
    this.stateManager.saveVariation(patternType, slotIndex);

    // Carregar a variação atual nos patterns principais para tocar
    const loadSuccess = this.stateManager.loadVariation(patternType, slotIndex);
    void loadSuccess;

    // Verificar quantos steps tem a variação
    const numSteps = this.stateManager.getPatternSteps(patternType);
    void numSteps;

    state = this.stateManager.getState();

    // Definir o padrão ativo para o que está sendo editado
    this.stateManager.setActivePattern(patternType);
    this.stateManager.resetStep();

    // Ativar modo de teste para evitar transições automáticas
    this.patternEngine.setTestMode(true);

    // Tocar apenas o padrão que está sendo editado (sem intro/transições)
    this.stateManager.setPlaying(true);
    this.scheduler.start();

    // Notificar UI da mudança
    this.uiManager.updateStatusUI(patternType);
  }

  private updateVariationSlotsUI(): void {
    const patternType = this.stateManager.getEditingPattern();
    const currentSlot = this.stateManager.getCurrentVariation(patternType);
    const maxSlots = patternType === 'end' ? 1 : 3;
    const state = this.stateManager.getState();

    document.querySelectorAll('.variation-slot').forEach((slot, index) => {
      const slotElement = slot as HTMLElement;

      slotElement.classList.remove('active', 'has-content');

      if (patternType === 'end' && index >= maxSlots) {
        slotElement.style.opacity = '0.3';
        slotElement.style.pointerEvents = 'none';
      } else {
        slotElement.style.opacity = '1';
        slotElement.style.pointerEvents = 'auto';
      }

      if (index === currentSlot) {
        slotElement.classList.add('active');
      }

      const variation = state.variations[patternType][index];
      if (variation && variation.pattern) {
        const hasContent = variation.pattern.some(row => row.some(step => step === true));
        if (hasContent) {
          slotElement.classList.add('has-content');
        }
      }
    });

    // Atualizar controle de velocidade para o slot atual
    this.updateSpeedControls();
  }

  private updateSpeedControls(): void {
    const patternType = this.stateManager.getEditingPattern();
    const slotIndex = this.stateManager.getCurrentVariation(patternType);
    const speed = this.stateManager.getVariationSpeed(patternType, slotIndex);

    const variationSpeedSlider = document.getElementById('variationSpeed') as HTMLInputElement;
    const variationSpeedDisplay = document.getElementById('variationSpeedDisplay');

    if (variationSpeedSlider) variationSpeedSlider.value = speed.toString();
    if (variationSpeedDisplay) variationSpeedDisplay.textContent = `${speed}x`;

    this.updateSpeedPresetButtons(speed);
  }

  private updateSpeedPresetButtons(currentSpeed: number): void {
    document.querySelectorAll('.speed-preset').forEach((btn) => {
      const btnSpeed = parseFloat((btn as HTMLElement).dataset.speed || '1');
      if (btnSpeed === currentSpeed) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  private switchVariation(patternType: PatternType, variationIndex: number): void {
    const state = this.stateManager.getState();
    const variation = state.variations[patternType][variationIndex];

    if (!variation || !variation.pattern) {
      this.uiManager.showAlert(t('main.alert.variationNotAvailable', { pattern: patternType.toUpperCase(), index: variationIndex + 1 }));
      return;
    }

    // Verificar se tem conteúdo
    const hasContent = variation.pattern.some(row => row.some(step => step === true));
    if (!hasContent) {
      this.uiManager.showAlert(t('main.alert.variationEmptyConfigure', { pattern: patternType.toUpperCase(), index: variationIndex + 1 }));
      return;
    }

    // Atualizar índice da variação atual e carregar
    this.stateManager.setCurrentVariation(patternType, variationIndex);
    this.stateManager.loadVariation(patternType, variationIndex);

    // Atualizar UI
    this.uiManager.updateVariationButtons();
    this.uiManager.refreshGridDisplay();
  }

  /**
   * Modo Show — ativa layout minimalista pra palco.
   *
   * O que muda:
   * - body.stage-mode ligado (CSS esconde topbar, amplia células, etc)
   * - keep-awake ativado (tela não apaga)
   * - banner no topo com botão "Sair"
   * - haptic feedback success
   *
   * Sair: botão "Sair" do banner OU long-press 2s no próprio banner.
   */
  private enterStageMode(): void {
    if (document.body.classList.contains('stage-mode')) return;
    document.body.classList.add('stage-mode');


    // Ativa keep-awake (ignora erro se não for native)
    KeepAwake.keepAwake().catch(() => { /* navegador web — sem efeito */ });

    // Banner com botão sair
    const banner = document.createElement('div');
    banner.className = 'x-stage-banner';
    banner.id = 'xStageBanner';
    banner.innerHTML = `
      <span class="x-stage-banner-dot"></span>
      <span class="x-stage-banner-label">${t('main.stageMode.label')}</span>
      <button class="x-stage-banner-exit" id="xStageExit" type="button">${t('main.stageMode.exit')}</button>
    `;
    document.body.appendChild(banner);

    banner.querySelector('#xStageExit')?.addEventListener('click', () => this.exitStageMode());

    // Sincroniza o switch da topbar (caso ativação tenha vindo de outro caminho)
    const sw = document.getElementById('stageModeSwitch') as HTMLInputElement | null;
    if (sw) sw.checked = true;

    HapticsService.success();
    Toast.show(t('main.stageMode.activeToast'), { type: 'success' });
  }

  private exitStageMode(): void {
    if (!document.body.classList.contains('stage-mode')) return;
    document.body.classList.remove('stage-mode');

    // Só libera sleep se não estiver tocando (scheduler também controla)
    if (!this.stateManager.isPlaying()) {
      KeepAwake.allowSleep().catch(() => { /* noop */ });
    }

    document.getElementById('xStageBanner')?.remove();

    // Sincroniza o switch da topbar (caso saída tenha vindo pelo botão do banner)
    const sw = document.getElementById('stageModeSwitch') as HTMLInputElement | null;
    if (sw) sw.checked = false;

    HapticsService.light();
  }

  // Core methods
  private showPedalInfo(): void {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(2,2,12,0.85);backdrop-filter:blur(16px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem;';

    overlay.innerHTML = `
      <div style="background:rgba(10,10,30,0.95);border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:2rem;max-width:440px;width:100%;max-height:85vh;overflow-y:auto;">
        <h2 style="font-size:1.2rem;font-weight:700;color:#fff;margin:0 0 0.5rem;text-align:center;">${t('main.pedalInfo.title')}</h2>
        <p style="font-size:0.75rem;color:rgba(255,255,255,0.3);text-align:center;margin:0 0 1.25rem;">${t('main.pedalInfo.subtitle')}</p>

        <div style="display:flex;flex-direction:column;gap:1rem;">
          <div style="background:rgba(139,92,246,0.06);border:1px solid rgba(139,92,246,0.2);border-radius:12px;padding:1rem;">
            <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:rgba(139,92,246,0.7);margin-bottom:0.5rem;">${t('main.pedalInfo.leftLabel')}</div>
            <div style="font-size:0.8rem;color:rgba(255,255,255,0.5);line-height:1.7;">
              ${t('main.pedalInfo.leftBody')}
            </div>
          </div>

          <div style="background:rgba(249,115,22,0.06);border:1px solid rgba(249,115,22,0.2);border-radius:12px;padding:1rem;">
            <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:rgba(249,115,22,0.7);margin-bottom:0.5rem;">${t('main.pedalInfo.rightLabel')}</div>
            <div style="font-size:0.8rem;color:rgba(255,255,255,0.5);line-height:1.7;">
              ${t('main.pedalInfo.rightBody')}
            </div>
          </div>

          <div style="background:rgba(0,212,255,0.05);border:1px solid rgba(0,212,255,0.15);border-radius:12px;padding:1rem;">
            <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:rgba(0,212,255,0.6);margin-bottom:0.5rem;">${t('main.pedalInfo.configLabel')}</div>
            <div style="font-size:0.8rem;color:rgba(255,255,255,0.5);line-height:1.7;">
              ${t('main.pedalInfo.configBody')}
            </div>
          </div>

          <div style="background:rgba(0,230,140,0.05);border:1px solid rgba(0,230,140,0.15);border-radius:12px;padding:1rem;">
            <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:rgba(0,230,140,0.6);margin-bottom:0.5rem;">${t('main.pedalInfo.tipsLabel')}</div>
            <div style="font-size:0.8rem;color:rgba(255,255,255,0.5);line-height:1.7;">
              ${t('main.pedalInfo.tipsBody')}
            </div>
          </div>
        </div>

        <button id="closePedalInfo" style="width:100%;margin-top:1.25rem;padding:0.7rem;border:none;border-radius:12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.6);font-size:0.85rem;font-weight:600;font-family:inherit;cursor:pointer;">${t('main.pedalInfo.closeButton')}</button>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => { overlay.remove(); (window as any).__refocusPedal?.(); };
    overlay.querySelector('#closePedalInfo')!.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  }

  /** Seletor de idioma com bandeiras. Nomes de idioma NUNCA traduzem
   *  (cada um aparece na própria língua — padrão universal de UX).
   *  Trocar = setLocale + reload (aplica em tudo de uma vez). */
  private showLanguageSelector(): void {
    const LANGS: Array<{ code: string; flag: string; name: string }> = [
      { code: 'pt-BR', flag: '🇧🇷', name: 'Português (Brasil)' },
      { code: 'es-419', flag: '🇲🇽', name: 'Español (Latinoamérica)' },
      { code: 'en', flag: '🇺🇸', name: 'English' },
    ];
    const current = getLocale();

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(3,0,20,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1.5rem;';
    overlay.innerHTML = `
      <div style="background:#0d0a24;border:1px solid rgba(139,92,246,0.35);border-radius:18px;padding:1.6rem;max-width:340px;width:100%;">
        <h2 style="color:#fff;font-size:1.05rem;margin:0 0 1rem;text-align:center;">${t('main.language.title')}</h2>
        ${LANGS.map(l => `
          <button data-lang="${l.code}" style="
            width:100%;display:flex;align-items:center;gap:0.8rem;padding:0.85rem 1rem;
            margin-bottom:0.5rem;border-radius:12px;cursor:pointer;font-family:inherit;
            font-size:0.95rem;font-weight:600;text-align:left;color:#fff;
            background:${l.code === current ? 'linear-gradient(135deg,rgba(0,212,255,0.18),rgba(139,92,246,0.18))' : 'rgba(255,255,255,0.04)'};
            border:1px solid ${l.code === current ? 'rgba(0,212,255,0.5)' : 'rgba(255,255,255,0.08)'};
          ">
            <span style="font-size:1.4rem;">${l.flag}</span>
            <span style="flex:1;">${l.name}</span>
            ${l.code === current ? '<span style="color:#00D4FF;">✓</span>' : ''}
          </button>
        `).join('')}
        <button id="langCancel" style="width:100%;padding:0.7rem;border:none;border-radius:12px;background:transparent;color:rgba(255,255,255,0.45);font-size:0.85rem;cursor:pointer;font-family:inherit;">${t('ui.modal.cancel')}</button>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#langCancel')?.addEventListener('click', () => overlay.remove());
    overlay.querySelectorAll<HTMLElement>('[data-lang]').forEach(btn => {
      btn.addEventListener('click', () => {
        const code = btn.dataset.lang!;
        if (code === current) { overlay.remove(); return; }
        setLocale(code);
        window.location.reload();
      });
    });
  }

  private showUserManual(): void {
    const dd = document.getElementById('fabDropdown');
    if (dd) dd.style.display = 'none';
    document.querySelectorAll('.manual-overlay').forEach(el => el.remove());

    const overlay = document.createElement('div');
    overlay.className = 'manual-overlay';
    const iconPause = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
    const iconSave = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>';
    const iconUp = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>';
    const iconDown = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    const toggle = (label: string) => `<span class="mb-toggle"><span class="mb-dot"></span>${label}</span>`;
    const pedal = (n: string) => `<span class="mb-pedal">${n}</span>`;

    overlay.innerHTML = `
      <div class="manual-card">
        <div class="manual-head">
          <div>
            <div class="manual-title">${t('main.manual.title')}</div>
            <div class="manual-sub">${t('main.manual.subtitle')}</div>
          </div>
          <button class="manual-close" id="manualClose" aria-label="${t('main.manual.closeAriaLabel')}">&#10005;</button>
        </div>
        <div class="manual-body">

          <div class="m-sec">
            <div class="m-sec-title">${t('main.manual.section.rhythms')}</div>
            <div class="m-row">
              <div class="m-visual m-visual-trio"><span class="mb-pad cyan">1</span><span class="mb-pad cyan">2</span><span class="mb-pad cyan">3</span></div>
              <div class="m-text"><div class="m-name">${t('main.manual.rhythms.item1.name')}</div><div class="m-desc">${t('main.manual.rhythms.item1.desc')}</div></div>
            </div>
            <div class="m-row">
              <div class="m-visual m-visual-trio"><span class="mb-pad purple">1</span><span class="mb-pad purple">2</span><span class="mb-pad purple">3</span></div>
              <div class="m-text"><div class="m-name">${t('main.manual.rhythms.item2.name')}</div><div class="m-desc">${t('main.manual.rhythms.item2.desc')}</div></div>
            </div>
            <div class="m-row">
              <div class="m-visual m-visual-trio"><span class="mb-pad orange wide">${t('main.manual.badge.finalWide')}</span></div>
              <div class="m-text"><div class="m-name">${t('main.manual.rhythms.item3.name')}</div><div class="m-desc">${t('main.manual.rhythms.item3.desc')}</div></div>
            </div>
            <div class="m-row">
              <div class="m-visual m-visual-trio"><span class="mb-pad cyan hold">1</span></div>
              <div class="m-text"><div class="m-name">${t('main.manual.rhythms.item4.name')}</div><div class="m-desc">${t('main.manual.rhythms.item4.desc')}</div></div>
            </div>
          </div>

          <div class="m-sec">
            <div class="m-sec-title">${t('main.manual.section.controls')}</div>
            <div class="m-row">
              <div class="m-visual">${toggle(t('main.manual.badge.intro'))}</div>
              <div class="m-text"><div class="m-name">${t('main.manual.controls.item1.name')}</div><div class="m-desc">${t('main.manual.controls.item1.desc')}</div></div>
            </div>
            <div class="m-row">
              <div class="m-visual">${toggle(t('main.manual.badge.viradas'))}</div>
              <div class="m-text"><div class="m-name">${t('main.manual.controls.item2.name')}</div><div class="m-desc">${t('main.manual.controls.item2.desc')}</div></div>
            </div>
            <div class="m-row">
              <div class="m-visual">${toggle(t('main.manual.badge.final'))}</div>
              <div class="m-text"><div class="m-name">${t('main.manual.controls.item3.name')}</div><div class="m-desc">${t('main.manual.controls.item3.desc')}</div></div>
            </div>
            <div class="m-row">
              <div class="m-visual">${toggle(t('main.manual.badge.auto'))}</div>
              <div class="m-text"><div class="m-name">${t('main.manual.controls.item4.name')}</div><div class="m-desc">${t('main.manual.controls.item4.desc')}</div></div>
            </div>
          </div>

          <div class="m-sec">
            <div class="m-sec-title">${t('main.manual.section.pause')}</div>
            <div class="m-row">
              <div class="m-visual"><span class="mb mb-pause">${iconPause}</span></div>
              <div class="m-text"><div class="m-name">${t('main.manual.pause.item1.name')}</div><div class="m-desc">${t('main.manual.pause.item1.desc')}</div></div>
            </div>
            <div class="m-row">
              <div class="m-visual"><span class="mb mb-pause hold">${iconPause}</span></div>
              <div class="m-text"><div class="m-name">${t('main.manual.pause.item2.name')}</div><div class="m-desc">${t('main.manual.pause.item2.desc')}</div></div>
            </div>
          </div>

          <div class="m-sec">
            <div class="m-sec-title">${t('main.manual.section.setlist')}</div>
            <div class="m-row">
              <div class="m-visual"><span class="mb-pad cyan wide">30</span></div>
              <div class="m-text"><div class="m-name">${t('main.manual.setlist.item1.name')}</div><div class="m-desc">${t('main.manual.setlist.item1.desc')}</div></div>
            </div>
            <div class="m-row">
              <div class="m-visual"><span class="mb mb-save">${iconSave}</span></div>
              <div class="m-text"><div class="m-name">${t('main.manual.setlist.item2.name')}</div><div class="m-desc">${t('main.manual.setlist.item2.desc')}</div></div>
            </div>
            <div class="m-row">
              <div class="m-visual"><span class="mb-arrow">${iconUp}</span><span class="mb-arrow">${iconDown}</span></div>
              <div class="m-text"><div class="m-name">${t('main.manual.setlist.item3.name')}</div><div class="m-desc">${t('main.manual.setlist.item3.desc')}</div></div>
            </div>
          </div>

          <div class="m-sec">
            <div class="m-sec-title">${t('main.manual.section.pedal2')}</div>
            <div class="m-row">
              <div class="m-visual">${pedal('1')}</div>
              <div class="m-text"><div class="m-name">${t('main.manual.pedalBtn1.name')}</div>
                <ul class="m-list">
                  <li>${t('main.manual.pedalBtn1.li1')}</li>
                  <li>${t('main.manual.pedalBtn1.li2')}</li>
                  <li>${t('main.manual.pedalBtn1.li3')}</li>
                </ul>
              </div>
            </div>
            <div class="m-row">
              <div class="m-visual">${pedal('2')}</div>
              <div class="m-text"><div class="m-name">${t('main.manual.pedalBtn2.name')}</div>
                <ul class="m-list">
                  <li>${t('main.manual.pedalBtn2.li1')}</li>
                  <li>${t('main.manual.pedalBtn2.li2')}</li>
                  <li>${t('main.manual.pedalBtn2.li3TwoButtons')}</li>
                </ul>
              </div>
            </div>
          </div>

          <div class="m-sec">
            <div class="m-sec-title">${t('main.manual.section.pedal4')}</div>
            <div class="m-row">
              <div class="m-visual">${pedal('1')}</div>
              <div class="m-text"><div class="m-name">${t('main.manual.pedalBtn1.name')}</div>
                <ul class="m-list">
                  <li>${t('main.manual.pedalBtn1.li1')}</li>
                  <li>${t('main.manual.pedalBtn1.li2')}</li>
                  <li>${t('main.manual.pedalBtn1.li3')}</li>
                </ul>
              </div>
            </div>
            <div class="m-row">
              <div class="m-visual">${pedal('2')}</div>
              <div class="m-text"><div class="m-name">${t('main.manual.pedalBtn2.name')}</div>
                <ul class="m-list">
                  <li>${t('main.manual.pedalBtn2.li1')}</li>
                  <li>${t('main.manual.pedalBtn2.li2')}</li>
                </ul>
              </div>
            </div>
            <div class="m-row">
              <div class="m-visual">${pedal('3')}</div>
              <div class="m-text"><div class="m-name">${t('main.manual.pedalBtn3.name')}</div>
                <ul class="m-list">
                  <li>${t('main.manual.pedalBtn3.li1')}</li>
                </ul>
              </div>
            </div>
            <div class="m-row">
              <div class="m-visual">${pedal('4')}</div>
              <div class="m-text"><div class="m-name">${t('main.manual.pedalBtn4.name')}</div>
                <ul class="m-list">
                  <li>${t('main.manual.pedalBtn4.li1')}</li>
                  <li>${t('main.manual.pedalBtn4.li2')}</li>
                </ul>
              </div>
            </div>
            <div class="m-row">
              <div class="m-visual"><span class="mb-pad cyan wide">${t('main.manual.badge.mapear')}</span></div>
              <div class="m-text"><div class="m-name">${t('main.manual.pedal4.mapear.name')}</div><div class="m-desc">${t('main.manual.pedal4.mapear.desc')}</div></div>
            </div>
          </div>

          <div class="m-sec">
            <div class="m-sec-title">${t('main.manual.section.volume')}</div>
            <div class="m-row">
              <div class="m-visual"><span class="mb-pad cyan wide">${t('main.manual.badge.vol')}</span></div>
              <div class="m-text"><div class="m-name">${t('main.manual.volume.item1.name')}</div><div class="m-desc">${t('main.manual.volume.item1.desc')}</div></div>
            </div>
            <div class="m-row">
              <div class="m-visual"><span class="mb-bpm">&minus;</span><span class="mb-bpm">+</span></div>
              <div class="m-text"><div class="m-name">${t('main.manual.volume.item2.name')}</div><div class="m-desc">${t('main.manual.volume.item2.desc')}</div></div>
            </div>
            <div class="m-row">
              <div class="m-visual"><span class="mb-pad orange wide">${t('main.manual.badge.show')}</span></div>
              <div class="m-text"><div class="m-name">${t('main.manual.volume.item3.name')}</div><div class="m-desc">${t('main.manual.volume.item3.desc')}</div></div>
            </div>
          </div>

          <div class="m-sec">
            <div class="m-sec-title">${t('main.manual.section.eq')}</div>
            <div class="m-row">
              <div class="m-visual"><span class="mb-pad cyan wide">${t('main.manual.badge.eq')}</span></div>
              <div class="m-text"><div class="m-name">${t('main.manual.eq.item1.name')}</div><div class="m-desc">${t('main.manual.eq.item1.desc')}</div></div>
            </div>
            <div class="m-row">
              <div class="m-visual"><span class="mb-pad orange wide">${t('main.manual.badge.rev')}</span></div>
              <div class="m-text"><div class="m-name">${t('main.manual.eq.item2.name')}</div><div class="m-desc">${t('main.manual.eq.item2.desc')}</div></div>
            </div>
          </div>

        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    const close = () => { overlay.remove(); (window as any).__refocusPedal?.(); };
    overlay.querySelector('#manualClose')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  }

  /** Aplica EQ/reverb salvos no localStorage ao iniciar. */
  private applyAudioFxFromStorage(): void {
    try {
      const eq = JSON.parse(localStorage.getItem('gdrums-eq') || 'null');
      if (Array.isArray(eq)) eq.forEach((db: any, i: number) => this.audioManager.setEqGain(i, Number(db) || 0));
    } catch { /* noop */ }
    try {
      const rv = parseFloat(localStorage.getItem('gdrums-reverb') || '');
      if (!isNaN(rv)) this.audioManager.setReverbAmount(rv);
    } catch { /* noop */ }
  }

  /** Painel de Equalizador (5 bandas) + Reverb, nas cores do app. */
  private openEqPanel(): void {
    const dd = document.getElementById('fabDropdown');
    if (dd) dd.style.display = 'none';
    document.querySelectorAll('.eq-overlay').forEach(el => el.remove());

    const labels = [t('main.eq.band1'), t('main.eq.band2'), t('main.eq.band3'), t('main.eq.band4'), t('main.eq.band5')];
    const freqs = ['80 Hz', '250 Hz', '1 kHz', '3.5 kHz', '10 kHz'];
    let eq: number[] = [0, 0, 0, 0, 0];
    try { const s = JSON.parse(localStorage.getItem('gdrums-eq') || 'null'); if (Array.isArray(s)) eq = s.map((x: any) => Number(x) || 0); } catch { /* noop */ }
    let reverb = 0;
    try { const r = parseFloat(localStorage.getItem('gdrums-reverb') || ''); if (!isNaN(r)) reverb = r; } catch { /* noop */ }

    const overlay = document.createElement('div');
    overlay.className = 'eq-overlay';
    const bandsHtml = labels.map((lab, i) => `
      <div class="eq-band">
        <div class="eq-band-head"><span class="eq-band-name">${lab}</span><span class="eq-band-freq">${freqs[i]}</span></div>
        <div class="eq-band-row">
          <input type="range" min="-12" max="12" step="1" value="${eq[i] ?? 0}" data-eq="${i}" class="eq-slider">
          <span class="eq-val" data-eqval="${i}">${(eq[i] ?? 0) > 0 ? '+' : ''}${eq[i] ?? 0} dB</span>
        </div>
      </div>`).join('');
    overlay.innerHTML = `
      <div class="eq-card">
        <div class="eq-head">
          <div class="eq-title">${t('main.eq.title')}</div>
          <button class="eq-close" id="eqClose" aria-label="${t('main.eq.closeAriaLabel')}">&#10005;</button>
        </div>
        <div class="eq-body">
          ${bandsHtml}
          <div class="eq-band eq-reverb">
            <div class="eq-band-head"><span class="eq-band-name">${t('main.eq.reverbLabel')}</span><span class="eq-band-freq">${t('main.eq.reverbHint')}</span></div>
            <div class="eq-band-row">
              <input type="range" min="0" max="100" step="1" value="${Math.round(reverb * 100)}" id="eqReverb" class="eq-slider">
              <span class="eq-val" id="eqReverbVal">${Math.round(reverb * 100)}%</span>
            </div>
          </div>
        </div>
        <div class="eq-actions">
          <button class="eq-reset" id="eqReset">${t('main.eq.resetButton')}</button>
          <button class="eq-done" id="eqDone">${t('main.eq.doneButton')}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelectorAll('.eq-slider[data-eq]').forEach(el => {
      el.addEventListener('input', () => {
        const i = parseInt((el as HTMLElement).getAttribute('data-eq') || '0');
        const db = parseInt((el as HTMLInputElement).value) || 0;
        eq[i] = db;
        this.audioManager.setEqGain(i, db);
        const v = overlay.querySelector(`[data-eqval="${i}"]`);
        if (v) v.textContent = `${db > 0 ? '+' : ''}${db} dB`;
        localStorage.setItem('gdrums-eq', JSON.stringify(eq));
      });
    });

    const rvSlider = overlay.querySelector('#eqReverb') as HTMLInputElement;
    const rvVal = overlay.querySelector('#eqReverbVal') as HTMLElement;
    rvSlider?.addEventListener('input', () => {
      const pct = parseInt(rvSlider.value) || 0;
      reverb = pct / 100;
      this.audioManager.setReverbAmount(reverb);
      localStorage.setItem('gdrums-reverb', String(reverb));
      if (rvVal) rvVal.textContent = `${pct}%`;
    });

    overlay.querySelector('#eqReset')?.addEventListener('click', () => {
      eq = [0, 0, 0, 0, 0]; reverb = 0;
      eq.forEach((_, i) => this.audioManager.setEqGain(i, 0));
      this.audioManager.setReverbAmount(0);
      localStorage.setItem('gdrums-eq', JSON.stringify(eq));
      localStorage.setItem('gdrums-reverb', '0');
      overlay.querySelectorAll('.eq-slider[data-eq]').forEach((el, i) => {
        (el as HTMLInputElement).value = '0';
        const v = overlay.querySelector(`[data-eqval="${i}"]`);
        if (v) v.textContent = '0 dB';
      });
      if (rvSlider) rvSlider.value = '0';
      if (rvVal) rvVal.textContent = '0%';
    });

    const close = () => { overlay.remove(); (window as any).__refocusPedal?.(); };
    overlay.querySelector('#eqClose')?.addEventListener('click', close);
    overlay.querySelector('#eqDone')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  private showPedalMapper(): void {
    const keyLabels: Record<string, string> = {
      // e.code values
      'ArrowLeft': t('main.pedalMapper.key.arrowLeft'), 'ArrowRight': t('main.pedalMapper.key.arrowRight'),
      'ArrowUp': t('main.pedalMapper.key.arrowUp'), 'ArrowDown': t('main.pedalMapper.key.arrowDown'),
      'Space': t('main.pedalMapper.key.space'), 'Enter': t('main.pedalMapper.key.enter'),
      'PageUp': t('main.pedalMapper.key.pageUp'), 'PageDown': t('main.pedalMapper.key.pageDown'),
      // e.key values (fallback iOS pedais BT)
      ' ': t('main.pedalMapper.key.space'),
    };
    const getLabel = (code: string) => keyLabels[code] || code;

    let tempLeft = this.pedalLeft;
    let tempRight = this.pedalRight;
    let tempPlayPause = this.pedalPlayPause;
    let tempEnd = this.pedalEnd;
    let tempCount: 2 | 3 | 4 = this.pedalCount;
    let listening: 'left' | 'right' | 'playPause' | 'end' | null = null;

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(2,2,12,0.92);backdrop-filter:blur(20px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem;';

    // Botão de pedal — sempre largura fixa (110px), centralizado no slot.
    const pedalButton = (which: 'left'|'right'|'playPause'|'end', label: string, code: string, color: string, hint: string) => {
      const isListening = listening === which;
      const colorRgba = (alpha: number) => `rgba(${color},${alpha})`;
      return `
        <div style="display:flex;flex-direction:column;align-items:center;gap:0.4rem;width:110px;flex:0 0 110px;">
          <div style="font-size:0.58rem;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:${colorRgba(0.7)};text-align:center;line-height:1.2;height:1.6rem;display:flex;align-items:center;justify-content:center;">${label}</div>
          <button id="pedalBtn-${which}" style="width:110px;height:78px;border-radius:14px;border:2px solid ${colorRgba(isListening ? 0.85 : 0.3)};background:${colorRgba(0.08)};cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:inherit;padding:0.4rem;${isListening ? `box-shadow:0 0 20px ${colorRgba(0.4)};transform:scale(1.04);` : ''}">
            <div style="font-size:0.7rem;font-weight:700;color:${colorRgba(0.95)};background:${colorRgba(0.15)};padding:0.3rem 0.55rem;border-radius:8px;text-align:center;">${code ? getLabel(code) : '—'}</div>
          </button>
          <div style="font-size:0.55rem;color:rgba(255,255,255,0.4);text-align:center;line-height:1.3;min-height:2.2rem;">${hint}</div>
        </div>
      `;
    };

    const render = () => {
      const buttons: string[] = [
        pedalButton('left', t('main.pedalMapper.label.left'), tempLeft, '139,92,246', t('main.pedalMapper.hint.left')),
        pedalButton('right', t('main.pedalMapper.label.right'), tempRight, '249,115,22', t('main.pedalMapper.hint.right')),
      ];
      if (tempCount >= 3) {
        buttons.push(pedalButton('playPause', t('main.pedalMapper.label.playPause'), tempPlayPause, '0,210,255', t('main.pedalMapper.hint.playPause')));
      }
      if (tempCount >= 4) {
        buttons.push(pedalButton('end', t('main.pedalMapper.label.end'), tempEnd, '255,90,90', t('main.pedalMapper.hint.end')));
      }

      // Layout flex centralizado com wrap natural — funciona pra 2/3/4 botões.
      // Cada card tem largura fixa (110px), flex distribui igual com wrap.
      const gridHtml = `
        <div style="display:flex;flex-wrap:wrap;justify-content:center;align-items:flex-start;gap:0.7rem 0.6rem;margin-bottom:0.9rem;">
          ${buttons.join('')}
        </div>
      `;

      overlay.innerHTML = `
        <div style="background:rgba(10,10,30,0.95);border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:1.25rem;max-width:340px;width:100%;max-height:92vh;overflow-y:auto;">
          <h2 style="font-size:1.05rem;font-weight:700;color:#fff;margin:0 0 0.25rem;text-align:center;">${t('main.pedalMapper.title')}</h2>
          <p style="font-size:0.62rem;color:rgba(255,255,255,0.35);text-align:center;margin:0 0 0.9rem;">${t('main.pedalMapper.subtitle')}</p>

          <div style="display:flex;gap:0.4rem;justify-content:center;margin-bottom:1rem;">
            ${[2,3,4].map(n => `
              <button data-count="${n}" class="pedalCountBtn" style="flex:1;max-width:90px;padding:0.45rem 0.4rem;border:1px solid ${tempCount === n ? 'rgba(0,230,140,0.6)' : 'rgba(255,255,255,0.1)'};background:${tempCount === n ? 'rgba(0,230,140,0.12)' : 'rgba(255,255,255,0.03)'};color:${tempCount === n ? 'rgba(0,230,140,0.9)' : 'rgba(255,255,255,0.5)'};border-radius:9px;font-size:0.7rem;font-weight:700;font-family:inherit;cursor:pointer;">${t('main.pedalMapper.buttonsCount', { n })}</button>
            `).join('')}
          </div>

          ${gridHtml}

          <div id="pedalStatus" style="text-align:center;font-size:0.7rem;color:rgba(0,210,255,0.7);min-height:1.4rem;margin-bottom:0.9rem;">${listening ? t('main.pedalMapper.listeningStatus', { label: listening === 'playPause' ? t('main.pedalMapper.label.playPause') : listening === 'end' ? t('main.pedalMapper.label.end') : listening === 'left' ? t('main.pedalMapper.label.left') : t('main.pedalMapper.label.right') }) : ''}</div>

          <div style="display:flex;gap:0.5rem;">
            <button id="pedalReset" style="flex:1;padding:0.6rem;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.4);font-size:0.78rem;font-weight:600;font-family:inherit;cursor:pointer;">${t('main.pedalMapper.resetButton')}</button>
            <button id="pedalSave" style="flex:2;padding:0.6rem;border-radius:10px;background:rgba(0,230,140,0.12);border:1px solid rgba(0,230,140,0.25);color:rgba(0,230,140,0.9);font-size:0.78rem;font-weight:600;font-family:inherit;cursor:pointer;">${t('main.pedalMapper.saveButton')}</button>
          </div>
        </div>
      `;

      // Seletor de count
      overlay.querySelectorAll<HTMLButtonElement>('.pedalCountBtn').forEach(btn => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          tempCount = parseInt(btn.getAttribute('data-count') || '2') as 2 | 3 | 4;
          listening = null;
          render();
          mapperInput.focus({ preventScroll: true });
        });
      });

      // Botões de pedal — qualquer um focado começa a "ouvir" tecla
      const wireBtn = (which: 'left'|'right'|'playPause'|'end') => {
        const el = overlay.querySelector(`#pedalBtn-${which}`);
        if (!el) return;
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          listening = which;
          render();
          mapperInput.focus({ preventScroll: true });
        });
      };
      wireBtn('left'); wireBtn('right');
      if (tempCount >= 3) wireBtn('playPause');
      if (tempCount >= 4) wireBtn('end');

      overlay.querySelector('#pedalReset')!.addEventListener('click', () => {
        tempLeft = 'ArrowLeft'; tempRight = 'ArrowRight';
        tempPlayPause = ''; tempEnd = '';
        tempCount = 2;
        listening = null; render();
        mapperInput.focus({ preventScroll: true });
      });

      overlay.querySelector('#pedalSave')!.addEventListener('click', () => {
        this.pedalLeft = tempLeft;
        this.pedalRight = tempRight;
        this.pedalPlayPause = tempPlayPause;
        this.pedalEnd = tempEnd;
        this.pedalCount = tempCount;
        localStorage.setItem('gdrums_pedal_keys', JSON.stringify({
          left: tempLeft, right: tempRight,
          playPause: tempPlayPause, end: tempEnd,
          count: tempCount,
        }));
        close();
        this.modalManager.show(t('main.pedalMapper.savedTitle'), t('main.pedalMapper.savedBody'), 'success');
      });

      // Qualquer toque no overlay refoca o input (user gesture)
      overlay.addEventListener('click', () => mapperInput.focus({ preventScroll: true }));
    };

    document.body.appendChild(overlay);
    this.pedalMapperOpen = true;

    // ─── iOS: input receptor dentro do mapper pra capturar keydown BT ──
    // Criado ANTES do render() pra que os botões possam refocar nele
    const mapperInput = document.createElement('input');
    mapperInput.type = 'text';
    mapperInput.setAttribute('inputmode', 'none');
    mapperInput.setAttribute('autocomplete', 'off');
    mapperInput.setAttribute('autocorrect', 'off');
    mapperInput.setAttribute('autocapitalize', 'off');
    mapperInput.setAttribute('spellcheck', 'false');
    mapperInput.placeholder = t('main.pedalMapper.inputPlaceholder');
    mapperInput.style.cssText = 'position:fixed;bottom:0;left:0;right:0;width:100%;height:36px;font-size:12px;font-family:inherit;background:rgba(0,0,0,0.9);color:rgba(0,212,255,0.5);border:none;border-top:1px solid rgba(0,212,255,0.2);text-align:center;padding:0;margin:0;z-index:999999;outline:none;caret-color:transparent;';
    document.body.appendChild(mapperInput);

    let mapperAlive = true;
    const focusMapperInput = () => {
      if (!mapperAlive) return;
      mapperInput.focus({ preventScroll: true });
    };
    mapperInput.addEventListener('input', () => { mapperInput.value = ''; });
    mapperInput.addEventListener('blur', () => { focusMapperInput(); setTimeout(focusMapperInput, 10); });
    const mapperFocusInterval = setInterval(focusMapperInput, 800);

    render();
    // Focar SÍNCRONO — ainda dentro da call stack do click que abriu o mapper
    mapperInput.focus({ preventScroll: true });

    const handleDetected = (code: string, debugInfo: string) => {
      if (!listening) {
        // Não está ouvindo, mas mostrar debug pra ajudar diagnóstico
        const statusEl = overlay.querySelector('#pedalStatus');
        if (statusEl) {
          statusEl.innerHTML = `<span style="color:rgba(0,212,255,0.6);">${debugInfo}</span>`;
        }
        return;
      }

      if (listening === 'left') tempLeft = code;
      else if (listening === 'right') tempRight = code;
      else if (listening === 'playPause') tempPlayPause = code;
      else if (listening === 'end') tempEnd = code;

      const statusEl = overlay.querySelector('#pedalStatus');
      if (statusEl) {
        statusEl.innerHTML = `<span style="color:rgba(0,230,140,0.8);">${t('main.pedalMapper.mappedPrefix', { debugInfo })}</span>`;
      }

      listening = null;
      render();
    };

    // Mapa keyCode → nome legível
    const KC_MAP: Record<number, string> = {
      37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown',
      32: 'Space', 13: 'Enter', 33: 'PageUp', 34: 'PageDown',
    };

    // Capturar keydown (principal) — usa keyCode pra máxima compatibilidade
    const keyHandler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const kc = e.keyCode || e.which || 0;
      const code = e.code || e.key || KC_MAP[kc] || '';
      if (!code && !kc) return;
      const finalCode = code || KC_MAP[kc] || `KeyCode${kc}`;
      handleDetected(finalCode, `keyCode=${kc} code="${e.code || ''}" key="${e.key || ''}"`);
    };

    // Capturar keyup como fallback (alguns pedais BT no iOS só emitem keyup)
    const keyUpHandler = (e: KeyboardEvent) => {
      const kc = e.keyCode || e.which || 0;
      const code = e.code || e.key || KC_MAP[kc] || '';
      if ((!code && !kc) || !listening) return;
      e.preventDefault();
      const finalCode = code || KC_MAP[kc] || `KeyCode${kc}`;
      handleDetected(finalCode, `keyup: keyCode=${kc} code="${e.code || ''}" key="${e.key || ''}"`);
    };

    document.addEventListener('keydown', keyHandler, true);
    document.addEventListener('keyup', keyUpHandler, true);

    const close = () => {
      mapperAlive = false;
      this.pedalMapperOpen = false;
      clearInterval(mapperFocusInterval);
      document.removeEventListener('keydown', keyHandler, true);
      document.removeEventListener('keyup', keyUpHandler, true);
      mapperInput.remove();
      overlay.remove();
      // Refocar o input principal do app (síncrono = dentro de user gesture)
      const mainInput = document.getElementById('pedalBtInput') as HTMLInputElement;
      if (mainInput) mainInput.focus({ preventScroll: true });
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }

  private showInstallSuggestion(): void {
    // Não mostrar se já instalado: PWA standalone, iOS Safari home-screen
    // OU Capacitor app nativo (iOS/Android — usuário já está dentro do app
    // instalado, sugerir "instale" não faz sentido).
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as any).standalone === true
      || isNativeApp();
    if (isStandalone) return;

    // Não mostrar se já viu
    if (localStorage.getItem('gdrums_install_seen')) return;
    localStorage.setItem('gdrums_install_seen', '1');

    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
                  (/Mac/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    const isAndroid = isAndroidWeb();

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(2,2,12,0.88);backdrop-filter:blur(16px);z-index:99999;display:flex;align-items:flex-end;justify-content:center;padding:1rem;';

    // Android: oferece Play Store em vez de PWA (app nativo é o canal oficial).
    const headline = isAndroid ? t('main.installSuggestion.headlineAndroid') : t('main.installSuggestion.headlineDefault');
    const subline = isAndroid
      ? t('main.installSuggestion.sublineAndroid')
      : t('main.installSuggestion.sublineDefault');

    overlay.innerHTML = `
      <div style="background:rgba(10,10,30,0.97);border:1px solid rgba(255,255,255,0.08);border-radius:20px 20px 0 0;padding:1.5rem 1.5rem 2rem;max-width:400px;width:100%;animation:slideUp 0.3s ease-out;">
        <style>@keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}</style>
        <div style="text-align:center;margin-bottom:1rem;">
          <img src="/img/icon-192.png" alt="GDrums" style="width:56px;height:56px;border-radius:14px;margin-bottom:0.75rem;">
          <h2 style="font-size:1.1rem;font-weight:700;color:#fff;margin:0 0 0.25rem;">${headline}</h2>
          <p style="font-size:0.75rem;color:rgba(255,255,255,0.4);margin:0;">${subline}</p>
        </div>

        ${isAndroid ? `
        <div style="font-size:0.78rem;color:rgba(255,255,255,0.5);text-align:center;margin-bottom:1rem;">
          ${t('main.installSuggestion.androidStep')}
        </div>
        ` : isIOS ? `
        <div style="display:flex;flex-direction:column;gap:0.55rem;margin-bottom:1rem;">
          <div style="display:flex;align-items:center;gap:0.6rem;font-size:0.78rem;color:rgba(255,255,255,0.55);">
            <span style="width:22px;height:22px;border-radius:6px;background:rgba(0,212,255,0.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:0.68rem;font-weight:700;color:rgba(0,212,255,0.85);">1</span>
            ${t('main.installSuggestion.iosStep1')} <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(0,212,255,0.7)" stroke-width="2" style="flex-shrink:0;"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
          </div>
          <div style="display:flex;align-items:center;gap:0.6rem;font-size:0.78rem;color:rgba(255,255,255,0.55);">
            <span style="width:22px;height:22px;border-radius:6px;background:rgba(139,92,246,0.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:0.68rem;font-weight:700;color:rgba(139,92,246,0.85);">2</span>
            ${t('main.installSuggestion.iosStep2')}
          </div>
          <div style="display:flex;align-items:center;gap:0.6rem;font-size:0.78rem;color:rgba(255,255,255,0.55);">
            <span style="width:22px;height:22px;border-radius:6px;background:rgba(62,232,167,0.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:0.68rem;font-weight:700;color:rgba(62,232,167,0.9);">3</span>
            ${t('main.installSuggestion.iosStep3')}
          </div>
        </div>
        ` : `
        <div style="font-size:0.78rem;color:rgba(255,255,255,0.5);text-align:center;margin-bottom:1rem;">
          ${t('main.installSuggestion.desktopStep')}
        </div>
        `}

        <div style="display:flex;gap:0.5rem;">
          <button id="installDismiss" style="flex:1;padding:0.65rem;border:none;border-radius:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.4);font-size:0.8rem;font-weight:600;font-family:inherit;cursor:pointer;">${t('main.installSuggestion.dismissButton')}</button>
          ${isAndroid ? `
          <button id="installPlayStore" style="flex:2;padding:0.65rem;border:none;border-radius:12px;background:rgba(62,232,167,0.15);border:1px solid rgba(62,232,167,0.3);color:rgba(62,232,167,0.95);font-size:0.8rem;font-weight:700;font-family:inherit;cursor:pointer;">${t('main.installSuggestion.playStoreButton')}</button>
          ` : !isIOS && this.installPrompt ? `
          <button id="installAccept" style="flex:2;padding:0.65rem;border:none;border-radius:12px;background:rgba(0,212,255,0.15);border:1px solid rgba(0,212,255,0.3);color:rgba(0,212,255,0.9);font-size:0.8rem;font-weight:700;font-family:inherit;cursor:pointer;">${t('main.installSuggestion.installButton')}</button>
          ` : `
          <button id="installDismiss2" style="flex:2;padding:0.65rem;border:none;border-radius:12px;background:rgba(0,212,255,0.15);border:1px solid rgba(0,212,255,0.3);color:rgba(0,212,255,0.9);font-size:0.8rem;font-weight:700;font-family:inherit;cursor:pointer;">${t('main.installSuggestion.dismissButton2')}</button>
          `}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => { overlay.remove(); (window as any).__refocusPedal?.(); };
    overlay.querySelector('#installDismiss')?.addEventListener('click', close);
    overlay.querySelector('#installDismiss2')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('#installPlayStore')?.addEventListener('click', () => {
      openPlayStore();
      close();
    });

    overlay.querySelector('#installAccept')?.addEventListener('click', () => {
      if (this.installPrompt) {
        this.installPrompt.prompt();
        this.installPrompt.userChoice.then(() => { this.installPrompt = null; });
      }
      close();
    });
  }

  /**
   * Tutorial de instalação com tabs por navegador.
   *
   * iOS tem dois fluxos (Safari e Chrome), Android também (Chrome padrão
   * vs outros). Deteta o browser atual e já abre a tab certa, mas user
   * pode trocar pra ver o outro (caso precise instruir alguém).
   */
  private showInstallTutorial(): void {
    // Defesa em profundidade: Android web nunca deveria chegar aqui (os
    // entry points já desviam pra Play Store), mas se algum caller esquecer,
    // pula tutorial e abre a loja direto. iOS continua tendo só o tutorial
    // PWA porque app nativo iOS ainda não foi publicado.
    if (isAndroidWeb()) {
      openPlayStore();
      return;
    }

    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/i.test(ua) ||
                  (/Mac/i.test(ua) && navigator.maxTouchPoints > 1);
    // No iOS o Chrome reporta "CriOS" (Chrome iOS), Firefox "FxiOS".
    // Se não for nenhum desses, é Safari (ou outro WebView que segue regras
    // do Safari no iOS).
    const isCriOS = /CriOS/i.test(ua);
    const isAndroidChrome = !isIOS && /Android/i.test(ua);

    // Tab default: já abre no browser que o user está usando.
    let activeTab: 'ios-safari' | 'ios-chrome' | 'android' =
      isIOS ? (isCriOS ? 'ios-chrome' : 'ios-safari') : 'android';

    // Estética editorial (mesma linguagem do ConversionManager / demo)
    this.injectInstallTutorialCSS();

    const overlay = document.createElement('div');
    overlay.className = 'install-tut-overlay';

    interface TutStep { n: string; body: string; }
    type TutKey = 'ios-safari' | 'ios-chrome' | 'android';

    const stepsBy: Record<TutKey, TutStep[]> = {
      'ios-safari': [
        { n: '01', body: t('main.installTutorial.iosSafari.step1') },
        { n: '02', body: t('main.installTutorial.iosShared.step2') },
        { n: '03', body: t('main.installTutorial.iosShared.step3') },
        { n: '04', body: t('main.installTutorial.iosShared.step4') },
      ],
      'ios-chrome': [
        { n: '01', body: t('main.installTutorial.iosChrome.step1') },
        { n: '02', body: t('main.installTutorial.iosShared.step2') },
        { n: '03', body: t('main.installTutorial.iosShared.step3') },
        { n: '04', body: t('main.installTutorial.iosShared.step4') },
      ],
      'android': [
        { n: '01', body: t('main.installTutorial.android.step1') },
        { n: '02', body: t('main.installTutorial.android.step2') },
        { n: '03', body: t('main.installTutorial.android.step3') },
      ],
    };

    const tabsDef = isIOS
      ? [
          { key: 'ios-safari' as TutKey, label: t('main.installTutorial.tab.safari') },
          { key: 'ios-chrome' as TutKey, label: t('main.installTutorial.tab.chrome') },
        ]
      : [
          { key: 'android' as TutKey, label: t('main.installTutorial.tab.chromeAndroid') },
        ];

    const deviceLabel = isIOS ? t('main.installTutorial.deviceIphone') : t('main.installTutorial.deviceGeneric');

    const renderTabs = (): string => {
      if (tabsDef.length <= 1) return '';
      return `
        <div class="install-tut-tabs" role="tablist">
          ${tabsDef.map(t => `
            <button class="install-tut-tab ${t.key === activeTab ? 'active' : ''}" data-tab="${t.key}" role="tab" type="button">
              ${t.label}
            </button>
          `).join('')}
        </div>
      `;
    };

    const renderSteps = (): string => {
      const steps = stepsBy[activeTab];
      return steps.map(s => `
        <li class="install-tut-step">
          <span class="install-tut-step-num">${s.n}</span>
          <span class="install-tut-step-body">${s.body}</span>
        </li>
      `).join('');
    };

    const render = (): void => {
      overlay.innerHTML = `
        <div class="install-tut-modal">
          <button class="install-tut-close" aria-label="${t('main.installTutorial.closeAriaLabel')}">×</button>
          <div class="install-tut-overline">${t('main.installTutorial.overline')}</div>
          <h2 class="install-tut-title">${t('main.installTutorial.title', { device: deviceLabel })}</h2>
          <p class="install-tut-body">
            ${t('main.installTutorial.body')}
          </p>
          ${renderTabs()}
          <ul class="install-tut-steps">${renderSteps()}</ul>
          <button class="install-tut-cta" id="installTutorialClose">${t('main.installTutorial.cta')}</button>
        </div>
      `;

      overlay.querySelector('#installTutorialClose')?.addEventListener('click', close);
      overlay.querySelector('.install-tut-close')?.addEventListener('click', close);
      overlay.querySelectorAll<HTMLElement>('[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.tab as TutKey;
          if (key === activeTab) return;
          activeTab = key;
          render();
        });
      });
    };

    const close = (): void => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };

    document.body.appendChild(overlay);
    render();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);

    // Refs pra evitar "unused"
    void isAndroidChrome;
  }

  private injectInstallTutorialCSS(): void {
    if (document.getElementById('install-tut-css')) return;
    const style = document.createElement('style');
    style.id = 'install-tut-css';
    style.textContent = `
      .install-tut-overlay {
        position: fixed; inset: 0;
        background: rgba(0, 0, 0, 0.72);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        z-index: 100000;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 1.5rem;
        padding-top: calc(1.5rem + env(safe-area-inset-top, 0px));
        padding-bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px));
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
        animation: installTutIn 0.24s ease;
      }
      @media (min-height: 620px) {
        .install-tut-overlay { align-items: center; }
      }
      @keyframes installTutIn { from { opacity: 0 } to { opacity: 1 } }

      .install-tut-modal {
        width: 100%; max-width: 420px;
        background: #0a0a0f;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 20px;
        padding: 2rem 1.75rem 1.5rem;
        color: #fff;
        position: relative;
        margin: auto;
      }
      .install-tut-close {
        position: absolute; top: 0.75rem; right: 0.75rem;
        width: 32px; height: 32px;
        background: transparent; border: none;
        color: rgba(255,255,255,0.35);
        font-size: 1.5rem; line-height: 1;
        cursor: pointer; border-radius: 8px;
        transition: color 0.15s, background 0.15s;
      }
      .install-tut-close:hover { color: #fff; background: rgba(255,255,255,0.05); }

      .install-tut-overline {
        font-size: 0.68rem;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.42);
        font-weight: 500;
        margin-bottom: 0.85rem;
      }
      .install-tut-title {
        font-size: 1.35rem;
        font-weight: 600;
        letter-spacing: -0.015em;
        line-height: 1.2;
        margin: 0 0 0.6rem;
      }
      .install-tut-body {
        font-size: 0.88rem;
        line-height: 1.5;
        color: rgba(255,255,255,0.55);
        margin: 0 0 1.5rem;
      }
      .install-tut-tabs {
        display: inline-flex;
        padding: 3px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 10px;
        margin: 0 0 1.1rem;
        gap: 2px;
      }
      .install-tut-tab {
        background: transparent;
        border: none;
        color: rgba(255, 255, 255, 0.55);
        font-family: inherit;
        font-size: 0.78rem;
        font-weight: 600;
        padding: 0.45rem 0.9rem;
        border-radius: 8px;
        cursor: pointer;
        transition: background 0.14s, color 0.14s;
        -webkit-tap-highlight-color: transparent;
      }
      .install-tut-tab.active {
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
      }
      .install-tut-tab:hover:not(.active) {
        color: rgba(255, 255, 255, 0.85);
      }
      .install-tut-steps {
        list-style: none;
        padding: 0;
        margin: 0 0 1.5rem;
        border-top: 1px solid rgba(255,255,255,0.06);
      }
      .install-tut-step {
        display: flex;
        align-items: baseline;
        gap: 0.85rem;
        padding: 0.85rem 0;
        border-bottom: 1px solid rgba(255,255,255,0.06);
      }
      .install-tut-step-num {
        font-size: 0.72rem;
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.02em;
        color: rgba(255,255,255,0.4);
        flex-shrink: 0;
        width: 1.4rem;
      }
      .install-tut-step-body {
        font-size: 0.88rem;
        line-height: 1.5;
        color: rgba(255,255,255,0.75);
      }
      .install-tut-step-body strong {
        color: #fff;
        font-weight: 600;
      }
      .install-tut-cta {
        width: 100%;
        padding: 0.9rem;
        background: #fff;
        color: #0a0a0f;
        border: none;
        border-radius: 10px;
        font-size: 0.95rem;
        font-weight: 600;
        letter-spacing: -0.005em;
        font-family: inherit;
        cursor: pointer;
        transition: opacity 0.15s;
      }
      .install-tut-cta:hover { opacity: 0.9; }
      .install-tut-cta:active { transform: scale(0.99); }
    `;
    document.head.appendChild(style);
  }

  private updateProjectBar(name: string): void {
    const nameEl = document.getElementById('projectName') as HTMLInputElement;
    const dotEl = document.getElementById('projectDot');
    if (nameEl) nameEl.value = name || t('main.project.defaultName');
    if (dotEl) {
      dotEl.classList.toggle('loaded', !!name);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAUSE/RESUME — pra músico em barzinho que pausa pra falar com cliente
  // ═══════════════════════════════════════════════════════════════════════
  // Diferente de stop() (que reseta pra step 0 e ativa pattern main).
  // Pause CONGELA tudo, mantém estado, e ao resume continua do INÍCIO do
  // compasso (step 0) — facilita "engatar de volta no tempo" pro músico.
  //
  // Implementação: scheduler.stop() + flag interna + fade-out anti-clique.
  // Resume: scheduler.start() de novo. Sem reset de pattern/variation.
  private isPaused = false;
  private resuming = false;            // CONTINUAR pressionado, aguardando downbeat
  private countActive = false;         // loop da contagem (chimbal) rodando
  private countLoopTimer: number | null = null;
  private countGridStart = 0;          // t0 da grade da contagem (relógio de áudio)
  private countSpb = 0;                // segundos por tempo da contagem
  private lastStepTime = 0;            // tempo de áudio do último step (fase do ritmo)
  private lastStepIndex = 0;           // índice do último step tocado
  private countFlashTimers: number[] = []; // timers do pisca laranja do botão
  private pendingResumeAction: { type: 'fill' | 'end'; variationIndex: number } | null = null;
  private countVolume = 0.6; // volume do chimbal da contagem (0-1, default 60%)

  private pauseInstant(): void {
    if (!this.stateManager.isPlaying()) return;
    this.isPaused = true;
    // Fade-out rápido pra não cortar sample no meio (clique audível)
    this.audioManager.fadeOutAllActive(0.04);
    this.scheduler.stop();
    this.stateManager.setPlaying(false);
    this.stateManager.resetStep(); // ao retomar começa do downbeat
    if ('mediaSession' in navigator) {
      try { (navigator as any).mediaSession.playbackState = 'paused'; } catch {}
    }
    void NowPlayingService.setPlaybackState(false);
    // Para o ForegroundService Android — sem isso, notificação "GDrums
    // tocando" fica mesmo após pause / após user fechar o app.
    this.stopBackgroundAudioService();
    const statusAdmin = document.getElementById('status');
    const statusUser = document.getElementById('statusUser');
    if (statusAdmin) statusAdmin.textContent = t('main.status.paused');
    if (statusUser) statusUser.textContent = t('main.status.paused');
    this.uiManager.updatePerformanceGrid();
    this.updatePauseButtonUI();
    // Pausa NÃO fica muda: começa a contagem (chimbal) em loop, no tempo.
    this.resuming = false;
    this.startCountLoop();
  }

  private resumeFromPause(fromPedal: boolean = false): void {
    if (!this.isPaused) return;
    this.isPaused = false;
    // Sem isso o botão ficava preso em "CONTINUAR" pra sempre depois da
    // primeira pausa (só pauseInstant/stop atualizavam o rótulo).
    this.updatePauseButtonUI();
    void fromPedal;
    // Mantém isPaused=true e a CONTAGEM tocando até o ritmo re-entrar no
    // topo do próximo compasso — sem buraco no metrônomo. `resuming` trava
    // toque duplo enquanto a re-entrada está agendada.
    this.resuming = true;
    this.audioManager.resume();
    this.stateManager.setShouldPlayStartSound(false);

    const spb = this.countSpb || (60 / this.stateManager.getTempo());
    const now = this.audioManager.getCurrentTime();
    // Volta no PRÓXIMO TEMPO (batida) da grade — NÃO espera o compasso
    // reiniciar. Entrada na hora que apertou, casada com o metrônomo.
    const k = Math.ceil((now + 0.05 - this.countGridStart) / spb);
    const entry = this.countGridStart + k * spb;
    this.scheduleRhythmEntryAt(entry);
  }

  /**
   * Espera o relógio de áudio chegar em `downbeatTime` e faz o ritmo entrar
   * CRAVADO (o comp absorve o jitter do timer, pro 1º step cair exato no
   * downbeat). Ao entrar, corta a contagem. NÃO altera o motor.
   */
  private scheduleRhythmEntryAt(downbeatTime: number): void {
    const SCHED_LEAD = 0.05; // = lead interno do scheduler.start()
    const tick = () => {
      // Abortar se algo já retomou a reprodução no meio (outro botão).
      if (this.stateManager.isPlaying()) { this.resuming = false; this.pendingResumeAction = null; return; }
      const now = this.audioManager.getCurrentTime();
      const target = downbeatTime - SCHED_LEAD;
      if (now >= target) {
        const comp = Math.max(0, Math.min(0.4, now - target));
        this.stopCountLoop();
        this.resuming = false;
        const action = this.pendingResumeAction;
        this.pendingResumeAction = null;
        this.play(comp);
        if (action) {
          // Virada/Finalização pedida durante a pausa: aplica ao re-entrar.
          if (action.type === 'fill') {
            this.patternEngine.activateFillWithTiming(action.variationIndex); // volta pro ritmo anterior
          } else if (this.useFinal) {
            this.patternEngine.activateEndWithTiming(action.variationIndex);
          } else {
            this.stopAndMaybeAdvance();
          }
        } else {
          // Resume NORMAL: toca um prato de "deixa" no re-entry pra não
          // voltar do nada (prato de retorno do ritmo, ou fallback).
          const returnBuf = this.stateManager.getState().fillReturnSound?.buffer;
          const gain = this.stateManager.getState().masterVolume * AUTO_CYMBAL_GAIN;
          if (returnBuf) this.audioManager.playSound(returnBuf, downbeatTime, gain);
          else this.playCymbal(AUTO_CYMBAL_GAIN);
        }
      } else {
        setTimeout(tick, Math.max(0, (target - now) * 1000 - 4));
      }
    };
    tick();
  }

  /** Sai da pausa JÁ aplicando uma virada/finalização (botões durante a pausa). */
  private resumeWithAction(type: 'fill' | 'end', variationIndex: number): void {
    if (!this.isPaused || this.resuming) return;
    this.pendingResumeAction = { type, variationIndex };
    this.resumeFromPause();
  }

  // ─── Contagem em LOOP durante a pausa (chimbal fechado) ───────────────
  // Enquanto pausado, o chimbal fechado toca 1x por tempo, em loop, no tempo
  // do ritmo (metrônomo vivo). Agendado no relógio de áudio com lookahead.
  // Para quando o ritmo re-entra no downbeat OU quando outro botão toca
  // (play/stop chamam stopCountLoop).
  private startCountLoop(): void {
    this.stopCountLoop();
    this.countActive = true;
    this.audioManager.loadAudioFromPath('/midi/chimbal_fechado.wav')
      .then(b => this.runCountLoop(b))
      .catch(() => this.runCountLoop(null));
  }

  private runCountLoop(buf: AudioBuffer | null): void {
    if (!this.countActive || !this.isPaused) return;
    // Acento: tempos ÍMPARES (1,3,5…) fortes; PARES (2,4,6…) mais fracos.
    // Volume base = this.countVolume (ajustável no long-press do botão de pausa).
    // Grade REAL do ritmo. stepsPerBeat = floor(totalSteps/beatsPerBar) —
    // MESMA definição do app (updateBeatMarker). Antes eu assumia 2 steps
    // por batida, o que deixava a contagem 2x rápida em ritmos de 16 steps.
    const tempo = this.stateManager.getTempo();
    const ap = this.stateManager.getActivePattern();
    const vi = this.stateManager.getCurrentVariation(ap);
    const speed = this.stateManager.getVariationSpeed(ap, vi) || 1;
    const beats = Math.max(1, this.stateManager.getState().beatsPerBar || 4);
    const totalSteps = Math.max(1, this.stateManager.getPatternSteps(ap));
    const stepsPerBeat = Math.max(1, Math.floor(totalSteps / beats));
    const secondsPerStep = (60 / tempo / 2) / speed;
    const spb = stepsPerBeat * secondsPerStep;         // 1 tempo = stepsPerBeat steps
    const masterVol = this.stateManager.getState().masterVolume;
    const LOOKAHEAD = 0.3;
    // Fase: recua do último step até o começo do TEMPO em que ele caiu.
    const posInBeat = ((this.lastStepIndex % stepsPerBeat) + stepsPerBeat) % stepsPerBeat;
    const beatPhase = this.lastStepTime - posInBeat * secondsPerStep;
    // Índice do tempo no compasso (0 = downbeat do ritmo) — pra alinhar o acento.
    const beatIdxAtPhase = Math.floor(this.lastStepIndex / stepsPerBeat) % beats;
    const now0 = this.audioManager.getCurrentTime();
    const kStart = Math.ceil((now0 + 0.08 - beatPhase) / spb);
    const t0 = beatPhase + kStart * spb;               // 1ª batida, no tempo
    const beatIdxStart = (((beatIdxAtPhase + kStart) % beats) + beats) % beats;
    this.countGridStart = t0;
    this.countSpb = spb;
    let nextHit = 0;
    const schedule = () => {
      if (!this.countActive) return;
      const now = this.audioManager.getCurrentTime();
      while (buf && t0 + nextHit * spb < now + LOOKAHEAD) {
        const ht = t0 + nextHit * spb;
        const beatIdx = (beatIdxStart + nextHit) % beats;  // alinhado ao downbeat
        const strong = (beatIdx % 2 === 0);                // beats 1,3,5 fortes
        if (ht >= now - 0.005) {
          const gain = this.countVolume * (strong ? 1 : 0.6); // fraco = 60% do forte
          this.audioManager.playSound(buf, ht, masterVol * gain);
          this.schedulePauseFlash(ht, now, strong);
        }
        nextHit++;
      }
      this.countLoopTimer = window.setTimeout(schedule, 60);
    };
    schedule();
  }

  /** Agenda o pisca LARANJA do botão de pausa pra bater no tempo `atTime`. */
  private schedulePauseFlash(atTime: number, now: number, strong: boolean): void {
    const id = window.setTimeout(() => {
      const cell = document.getElementById('pauseBtnUser');
      if (!cell) return;
      cell.classList.remove('count-flash', 'count-flash-strong');
      void cell.offsetWidth; // reflow: reinicia o pisca em batidas seguidas
      cell.classList.add(strong ? 'count-flash-strong' : 'count-flash');
      window.setTimeout(() => cell.classList.remove('count-flash', 'count-flash-strong'), strong ? 130 : 90);
    }, Math.max(0, (atTime - now) * 1000));
    this.countFlashTimers.push(id);
  }

  private stopCountLoop(): void {
    this.countActive = false;
    if (this.countLoopTimer !== null) {
      clearTimeout(this.countLoopTimer);
      this.countLoopTimer = null;
    }
    for (const id of this.countFlashTimers) clearTimeout(id);
    this.countFlashTimers = [];
    const cell = document.getElementById('pauseBtnUser');
    if (cell) cell.classList.remove('count-flash', 'count-flash-strong');
  }

  // ─── Volume da contagem (chimbal da pausa) — slider por long-press 3s ──
  private setupCountVolumeLongPress(btn: HTMLElement): void {
    let timer: number | null = null;
    const start = () => {
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        this.longPressFired = true; // suprime o click (não pausa/retoma)
        HapticsService.heavy();
        this.openCountVolumePopup();
      }, 1500);
    };
    const cancel = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };
    btn.addEventListener('mousedown', start);
    btn.addEventListener('touchstart', start, { passive: true });
    btn.addEventListener('mouseup', cancel);
    btn.addEventListener('mouseleave', cancel);
    btn.addEventListener('touchend', cancel);
    btn.addEventListener('touchcancel', cancel);
  }

  /** Popup (cores do app) pra ajustar o volume do chimbal da contagem.
   *  Se a contagem estiver tocando, o preview é ao vivo (runCountLoop lê
   *  this.countVolume a cada batida). */
  private openCountVolumePopup(): void {
    document.querySelectorAll('.count-vol-overlay').forEach(el => el.remove());
    const pct = Math.round(this.countVolume * 100);
    const overlay = document.createElement('div');
    overlay.className = 'count-vol-overlay';
    overlay.innerHTML = `
      <div class="count-vol-card">
        <div class="count-vol-title">${t('main.countVolume.title')}</div>
        <div class="count-vol-sub">${t('main.countVolume.subtitle')}</div>
        <div class="count-vol-row">
          <input type="range" min="0" max="100" step="1" value="${pct}" id="countVolSlider" class="count-vol-slider">
          <span class="count-vol-value" id="countVolValue">${pct}%</span>
        </div>
        <button class="count-vol-done" id="countVolDone">${t('main.countVolume.doneButton')}</button>
      </div>
    `;
    document.body.appendChild(overlay);
    const slider = overlay.querySelector('#countVolSlider') as HTMLInputElement;
    const valueEl = overlay.querySelector('#countVolValue') as HTMLElement;
    slider?.addEventListener('input', () => {
      const v = parseInt(slider.value) || 0;
      valueEl.textContent = `${v}%`;
      this.countVolume = v / 100;
      localStorage.setItem('gdrums-count-volume', String(this.countVolume));
    });
    const close = () => overlay.remove();
    overlay.querySelector('#countVolDone')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  /** Atualiza label e classe .active do botão pause user. */
  private updatePauseButtonUI(): void {
    const cell = document.getElementById('pauseBtnUser');
    const label = document.getElementById('pauseBtnLabel');
    if (cell) cell.classList.toggle('active', this.isPaused);
    if (label) label.textContent = this.isPaused ? t('main.pauseButton.continue') : t('main.pauseButton.pause');
  }

  /** Toggle exclusivo de pause/resume — botão e pedal usam esse. */
  private togglePauseInstant(fromPedal: boolean = false): void {
    if (this.resuming) return; // já a caminho de voltar — ignora toque
    if (this.isPaused) {
      this.resumeFromPause(fromPedal);
    } else if (this.stateManager.isPlaying()) {
      this.pauseInstant();
    } else if (this.hasRhythmLoaded()) {
      // Parado total: dá play normal (mesmo comportamento do botão play)
      if (this.useIntro) this.patternEngine.playIntroAndStart();
      else this.stateManager.setShouldPlayStartSound(true);
      this.play();
    }
  }

  private togglePlayStop(): void {
    // iOS: pipeline pode estar mudo com state 'running' (sessão quicou no
    // background). Kick suspend→resume DENTRO do gesto religa o áudio.
    if (this.iosAudioKickPending && !this.stateManager.isPlaying()) {
      this.iosAudioKickPending = false;
      const ctx = this.audioContext;
      if ((ctx.state as string) === 'running') {
        ctx.suspend().then(() => ctx.resume()).catch(() => {});
      }
    }
    if (this.stateManager.isPlaying()) {
      if (this.useFinal) {
        this.patternEngine.playEndAndStop();
      } else {
        this.stopAndMaybeAdvance();
      }
    } else {
      if (!this.hasRhythmLoaded()) {
        this.modalManager.show(
          t('main.modal.noRhythmLoadedTitle'),
          t('main.modal.noRhythmLoadedBody2'),
          'warning'
        );
        return;
      }

      this.ensurePlayableMainVariation(); // não iniciar numa variação desativada

      if (this.useIntro) {
        this.patternEngine.playIntroAndStart();
      } else {
        this.stateManager.setShouldPlayStartSound(true);
      }
      this.play();
    }
  }

  private hasRhythmLoaded(): boolean {
    const state = this.stateManager.getState();

    // Verificar se alguma variação do main tem conteúdo
    const hasMainContent = state.variations.main.some(variation =>
      variation.pattern.some(row => row.some(step => step === true))
    );

    return hasMainContent;
  }

  private silentModeChecked = false;
  private silentModeWarningShown = false;

  private checkIOSSilentMode(): void {
    // Tocar um oscilador de teste quase inaudível e medir volume de saída
    // No modo silencioso do iOS, o AudioContext roda mas sem output real
    try {
      const ctx = this.audioContext;

      // ⚠️ Só faz sentido medir com o contexto REALMENTE rodando.
      // 'suspended'/'interrupted' (ex: app acabou de voltar do background,
      // resume ainda em andamento) também produz sum=0 e gerava AVISO
      // FALSO de "tá no silencioso" com a chave desligada. Nesse caso,
      // libera pra re-checar num play futuro com o contexto são.
      if ((ctx.state as string) !== 'running') {
        this.silentModeChecked = false;
        return;
      }

      const oscillator = ctx.createOscillator();
      const analyser = ctx.createAnalyser();
      const gain = ctx.createGain();

      oscillator.frequency.value = 200;
      gain.gain.value = 0.001; // quase inaudível
      analyser.fftSize = 256;

      oscillator.connect(gain);
      gain.connect(analyser);
      analyser.connect(ctx.destination);

      oscillator.start();

      // Verificar após 200ms se está produzindo output
      setTimeout(() => {
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);
        const sum = dataArray.reduce((a, b) => a + b, 0);

        oscillator.stop();
        oscillator.disconnect();
        gain.disconnect();
        analyser.disconnect();

        // Mesma guarda na hora da MEDIÇÃO: se o contexto caiu nesses
        // 200ms (minimizou, ligação), sum=0 não significa silencioso.
        if ((ctx.state as string) !== 'running') {
          this.silentModeChecked = false;
          return;
        }

        // Se sum é 0 com contexto rodando, o iOS está em modo silencioso
        if (sum === 0 && !this.silentModeWarningShown) {
          this.silentModeWarningShown = true;
          this.showSilentModeWarning();
        }
      }, 200);
    } catch {
      // Ignorar erros — não bloquear o play
    }
  }

  private showSilentModeWarning(): void {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(2,2,12,0.85);backdrop-filter:blur(8px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem;';

    overlay.innerHTML = `
      <div style="background:rgba(10,10,30,0.95);border:1px solid rgba(255,180,32,0.2);border-radius:20px;padding:2rem 1.5rem;max-width:340px;width:100%;text-align:center;">
        <div style="font-size:2.5rem;margin-bottom:0.75rem;">🔇</div>
        <h3 style="color:#fff;font-size:1.1rem;font-weight:700;margin:0 0 0.5rem;">${t('main.silentMode.title')}</h3>
        <p style="color:rgba(255,255,255,0.5);font-size:0.85rem;line-height:1.6;margin:0 0 1.25rem;">
          ${t('main.silentMode.body')}
        </p>
        <div style="background:rgba(255,180,32,0.06);border:1px solid rgba(255,180,32,0.15);border-radius:10px;padding:0.75rem;margin-bottom:1.25rem;">
          <p style="color:rgba(255,255,255,0.4);font-size:0.75rem;margin:0;line-height:1.5;">
            ${t('main.silentMode.hint')}
          </p>
        </div>
        <button id="silentModeOk" style="width:100%;padding:0.75rem;border:none;border-radius:12px;background:linear-gradient(135deg,#FFB420,#F97316);color:#fff;font-size:0.9rem;font-weight:700;font-family:inherit;cursor:pointer;">${t('main.silentMode.closeButton')}</button>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => { overlay.remove(); (window as any).__refocusPedal?.(); };
    overlay.querySelector('#silentModeOk')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  private play(latencyCompensation: number = 0): void {
    // IMPORTANTE: resume() DEVE ser chamado sincronamente dentro do gesto do usuário.
    // No iOS, qualquer await antes do resume() quebra a cadeia de gesto
    // e o AudioContext fica permanentemente suspenso (mudo).
    this.audioManager.resume();
    // Qualquer play encerra a contagem em loop da pausa.
    this.stopCountLoop();
    this.resuming = false;

    // Sai do estado de pausa em qualquer play (clicar em ritmo, fill, etc).
    // Sem isso, botão CONTINUAR fica visível mesmo tocando = confusão visual.
    if (this.isPaused) {
      this.isPaused = false;
      this.updatePauseButtonUI();
    }

    this.stateManager.setPlaying(true);

    const activePattern = this.stateManager.getActivePattern();
    this.uiManager.updateStatusUI(activePattern);
    this.uiManager.updatePerformanceGrid();

    this.scheduler.start(latencyCompensation);

    // Detectar modo silencioso no iOS (chave lateral)
    if (!this.silentModeChecked && /iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      this.silentModeChecked = true;
      this.checkIOSSilentMode();
    }

    // KeepAwake é fire-and-forget — não bloquear o play
    KeepAwake.keepAwake().catch(() => {});

    // MediaSession 'playing' — sinaliza pro SO/WebView que tem áudio
    // rolando. Sem isso, Chromium Android suspende AudioContext em bg.
    if ('mediaSession' in navigator) {
      try { (navigator as any).mediaSession.playbackState = 'playing'; } catch {}
    }

    // Android: inicia ForegroundService que mantém WebView vivo + áudio
    // tocando em background com tela bloqueada. iOS já tem AVAudioSession
    // configurado no AppDelegate.swift (não precisa do plugin).
    this.startBackgroundAudioService();

    // iOS: atualiza Now Playing card no lockscreen com nome do ritmo + BPM
    void NowPlayingService.update({
      title: this.currentRhythmName || 'GDrums',
      bpm: this.stateManager.getTempo(),
    });
    void NowPlayingService.setPlaybackState(true);

    // Gatilho de conversão: marca início do play
    this.conversionManager.onPlayStart();
  }

  private async startBackgroundAudioService(): Promise<void> {
    if (!isNativeApp()) return;
    try {
      const { Capacitor, registerPlugin } = await import('@capacitor/core');
      if (Capacitor.getPlatform() !== 'android') return;
      const GDrumsBackground = registerPlugin<{ start: () => Promise<void>; stop: () => Promise<void> }>('GDrumsBackground');
      await GDrumsBackground.start();
    } catch { /* plugin não registrado em build antigo — fail silent */ }
  }

  private async stopBackgroundAudioService(): Promise<void> {
    if (!isNativeApp()) return;
    try {
      const { Capacitor, registerPlugin } = await import('@capacitor/core');
      if (Capacitor.getPlatform() !== 'android') return;
      const GDrumsBackground = registerPlugin<{ start: () => Promise<void>; stop: () => Promise<void> }>('GDrumsBackground');
      await GDrumsBackground.stop();
    } catch { /* fail silent */ }
  }

  private stop(): void {
    this.stopCountLoop();
    this.resuming = false;
    this.pendingResumeAction = null;
    this.stateManager.setPlaying(false);
    this.isPaused = false;
    this.updatePauseButtonUI();
    if ('mediaSession' in navigator) {
      try { (navigator as any).mediaSession.playbackState = 'paused'; } catch {}
    }
    // Para o ForegroundService Android (notification some)
    this.stopBackgroundAudioService();
    this.stateManager.resetStep();
    this.stateManager.setActivePattern('main');
    this.stateManager.clearQueue();
    this.stateManager.setPendingFill(null);
    this.stateManager.setPendingEnd(null);

    this.scheduler.stop();
    // iOS Now Playing: marca pausado (lockscreen mostra ícone correto)
    void NowPlayingService.setPlaybackState(false);
    this.conversionManager.onPlayStop();

    // Liberar keep awake quando parar
    try {
      KeepAwake.allowSleep();
      console.log('[KeepAwake] Screen can sleep now');
    } catch (error) {
      console.warn('[KeepAwake] Failed to allow sleep:', error);
    }

    const statusAdmin = document.getElementById('status');
    const statusUser = document.getElementById('statusUser');
    if (statusAdmin) statusAdmin.textContent = t('main.status.stopped');
    if (statusUser) statusUser.textContent = t('main.status.stopped');

    this.uiManager.clearQueuedCells();
    this.uiManager.updatePerformanceGrid();
    this.resetBeatMarker();
  }

  // ─── Beat Marker ────────────────────────────────────────────────────

  private updateBeatMarker(step: number, pattern: PatternType): void {
    const totalSteps = this.stateManager.getPatternSteps(pattern);
    const beatsPerBar = this.stateManager.getState().beatsPerBar || 4;
    const stepsPerBeat = Math.max(1, Math.floor(totalSteps / beatsPerBar));
    const currentBeat = Math.floor(step / stepsPerBeat) % beatsPerBar;
    const isDownbeat = step % stepsPerBeat === 0;

    // Atualizar quantidade de bolinhas se mudou
    this.ensureBeatDots(beatsPerBar);

    const dots = document.querySelectorAll('.beat-dot');
    dots.forEach((dot, i) => {
      dot.classList.remove('beat-active', 'beat-pulse');
      if (i === currentBeat) {
        dot.classList.add('beat-active');
        if (isDownbeat) {
          dot.classList.add('beat-pulse');
        }
      }
    });

    // Atualizar step counter
    const stepEl = document.getElementById('currentStepUser');
    if (stepEl) {
      stepEl.textContent = `${step + 1}/${totalSteps}`;
    }
  }

  private lastBeatDotCount = 4;

  private ensureBeatDots(count: number): void {
    if (count === this.lastBeatDotCount) return;
    this.lastBeatDotCount = count;

    const container = document.getElementById('beatDots');
    if (!container) return;

    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const dot = document.createElement('div');
      dot.className = 'beat-dot';
      dot.setAttribute('data-beat', i.toString());
      container.appendChild(dot);
    }
  }

  private resetBeatMarker(): void {
    const beatsPerBar = this.stateManager.getState().beatsPerBar || 4;
    this.ensureBeatDots(beatsPerBar);
    document.querySelectorAll('.beat-dot').forEach(dot => {
      dot.classList.remove('beat-active', 'beat-pulse');
    });
  }

  private updateBeatsPerBarUI(): void {
    const beats = this.stateManager.getState().beatsPerBar || 4;
    const select = document.getElementById('beatsPerBarSelect') as HTMLSelectElement;
    if (select) select.value = beats.toString();
    this.ensureBeatDots(beats);
  }

  // ─── Countdown Overlay ──────────────────────────────────────────────

  private countdownOverlay: HTMLElement | null = null;
  private countdownNumEl: HTMLElement | null = null;
  private countdownStyleInjected = false;

  private updateCountdown(step: number, pattern: PatternType): void {
    if (pattern !== 'intro') {
      this.hideCountdown();
      return;
    }

    this.injectCountdownStyles();

    const totalSteps = this.stateManager.getPatternSteps('intro');
    const beatsPerBar = this.stateManager.getState().beatsPerBar || 4;
    const stepsPerBeat = Math.max(1, Math.floor(totalSteps / beatsPerBar));
    const beatNum = Math.floor(step / stepsPerBeat) + 1;

    // Só mostrar no downbeat de cada tempo
    if (step % stepsPerBeat !== 0) return;

    // Criar overlay + span uma única vez (reuso evita garbage collection
    // pesado no 3º ritmo — causava intro lenta em iPhone antigo).
    if (!this.countdownOverlay) {
      this.countdownOverlay = document.createElement('div');
      this.countdownOverlay.className = 'countdown-overlay';
      this.countdownNumEl = document.createElement('span');
      this.countdownNumEl.className = 'countdown-num';
      this.countdownOverlay.appendChild(this.countdownNumEl);
      document.body.appendChild(this.countdownOverlay);
    }

    this.countdownOverlay.style.display = 'flex';
    if (this.countdownNumEl) {
      this.countdownNumEl.textContent = String(beatNum);
      // Web Animations API: reinicia a animação SEM o truque de
      // remove-classe + offsetHeight + add-classe. O offsetHeight forçava
      // um reflow síncrono do documento INTEIRO a cada beat — somava com a
      // rasterização do número gigante e travava iPhone/iPad mais fracos.
      // el.animate() cancela/reinicia direto no compositor, zero reflow.
      this.countdownNumEl.animate(
        [
          { opacity: 0, transform: 'scale(0.4)' },
          { opacity: 1, transform: 'scale(1.1)', offset: 0.3 },
          { opacity: 1, transform: 'scale(1)', offset: 0.6 },
          { opacity: 0.15, transform: 'scale(0.95)' },
        ],
        { duration: 450, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' }
      );
    }
  }

  private hideCountdown(): void {
    if (this.countdownOverlay) {
      this.countdownOverlay.style.display = 'none';
    }
  }

  private injectCountdownStyles(): void {
    if (this.countdownStyleInjected) return;
    this.countdownStyleInjected = true;

    const style = document.createElement('style');
    style.id = 'countdown-styles';
    style.textContent = `
      .countdown-overlay {
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 99998;
        pointer-events: none;
        background: rgba(2, 0, 15, 0.4);
      }

      /* HISTÓRICO DE CRASH — iOS Safari crashava/travava com efeitos pesados
         neste número. Tentativa 1: filter:drop-shadow + background-clip:text
         → crash (GPU surface estourava). Tentativa 2: text-shadow 30/60px +
         background-clip:text → ainda travava iPhone/iPad (re-rasterização da
         textura gigante a cada beat).
         REGRA ATUAL (não regredir): cor SÓLIDA (sem background-clip:text),
         UM text-shadow leve no máximo, glifo ≤ 12rem, animação via WAAPI
         (transform/opacity só — compositor puro, sem reflow). */
      .countdown-num {
        font-size: clamp(7rem, 24vw, 12rem);
        font-weight: 900;
        color: #FF8C35;
        line-height: 1;
        opacity: 0;
        transform: scale(0.5);
        text-shadow: 0 0 24px rgba(249, 115, 22, 0.45);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif;
        letter-spacing: -0.05em;
        will-change: transform, opacity;
      }
    `;
    document.head.appendChild(style);
  }

  private cymbalBuffer: AudioBuffer | null = null;

  // ─── Modal BPM ──────────────────────────────────────────────────────

  // ─── Modal de telefone (usuários antigos sem WhatsApp) ──────────

  // ─── Meus Ritmos ───────────────────────────────────────────────────

  /**
   * Salvar ritmo (v2) — modal compacto com auto-nome inteligente.
   *
   * - Nome pré-preenchido no padrão "Nome da biblioteca — HH:MM" (ou "Meu ritmo"
   *   se é pattern vazio) — user pode aceitar ou editar
   * - BPM já vem preenchido com o atual
   * - Enter no input salva direto
   * - Toast com "Renomear" depois do save — pode corrigir em 5s sem abrir modal
   */
  private showSaveRhythmModal(): void {
    if (!this.currentRhythmName && !this.stateManager.getState().patterns.main.some(r => r.some(s => s))) {
      this.modalManager.show(t('main.modal.myRhythmsTitle'), t('main.modal.loadRhythmBeforeSave'), 'warning');
      return;
    }

    // User em trial: salvar é feature do plano pago — bloqueia com modal de conversão
    if (this.conversionManager.tryFireSaveRhythm()) {
      return;
    }

    const esc = (s: string): string =>
      s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

    const currentBpm = this.stateManager.getTempo();

    // Modo ATUALIZAR: o ritmo carregado é um "meu ritmo" — o save
    // sobrescreve ele (padrão DAW), com "Salvar como novo" de escape.
    // Ritmo de biblioteca NUNCA é sobrescrito — só "salvar como novo".
    const editing = this.currentUserRhythmId
      ? this.userRhythmService.getById(this.currentUserRhythmId)
      : undefined;

    // Auto-nome (modo novo): "Vaneira · 21:42" ou "Meu ritmo · 21:42"
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const base = this.currentRhythmName || t('main.saveRhythm.defaultRhythmName');
    const suggestedName = editing ? editing.name : `${base} · ${hh}:${mm}`;

    // Destino: chips de repertório. Default = ATIVO (modo novo) / nenhum
    // (modo atualizar — re-adicionar duplicaria o item no repertório).
    const setlists = this.setlistManager.getSetlists();
    let destId: string | null = editing ? null : (setlists.find(l => l.active)?.id ?? null);

    const overlay = document.createElement('div');
    overlay.className = 'x-overlay';
    overlay.innerHTML = `
      <div class="x-sheet" role="dialog" aria-label="${t('main.saveRhythm.dialogAriaLabel')}">
        <div class="x-grip"></div>
        <div class="x-head">
          <div>
            <h2 class="x-head-title">${editing ? t('main.saveRhythm.titleEdit') : t('main.saveRhythm.titleNew')}</h2>
            <div class="x-head-sub">${editing ? t('main.saveRhythm.subEditing', { name: esc(editing.name) }) : t('main.saveRhythm.subNew')}</div>
          </div>
          <button class="x-close" id="xSaveClose" aria-label="${t('main.saveRhythm.closeAriaLabel')}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div class="x-body">
          <div class="x-save-fields">
            <div class="x-save-field">
              <label for="xSaveName">${t('main.saveRhythm.nameLabel')}</label>
              <input type="text" id="xSaveName" class="x-save-input" value="${esc(suggestedName)}" maxlength="60" placeholder="${t('main.saveRhythm.namePlaceholder')}" autocomplete="off" />
              <div class="x-save-hint">${t('main.saveRhythm.nameHint')}</div>
            </div>
            <div class="x-save-field">
              <label>${t('main.saveRhythm.bpmLabel')}</label>
              <div class="x-bpm-ctrl x-bpm-ctrl-lg" id="xSaveBpmCtrl">
                <button class="x-bpm-btn" data-step="-1" type="button" aria-label="${t('main.saveRhythm.bpmDecreaseAriaLabel')}">&minus;</button>
                <span class="x-bpm-val" id="xSaveBpmVal" role="button" title="${t('main.saveRhythm.bpmTapHint')}">${Math.round(currentBpm)}</span>
                <button class="x-bpm-btn" data-step="1" type="button" aria-label="${t('main.saveRhythm.bpmIncreaseAriaLabel')}">+</button>
              </div>
            </div>
            <div class="x-save-field">
              <label>${t('main.saveRhythm.addToSetlistLabel')}</label>
              <div class="x-save-dest">
                <button class="x-dest-chip ${destId === null ? 'active' : ''}" data-dest="" type="button">${t('main.saveRhythm.noAddButton')}</button>
                ${setlists.map(l => `
                  <button class="x-dest-chip ${destId === l.id ? 'active' : ''}" data-dest="${esc(l.id)}" type="button">
                    ${esc(l.name)} <span class="x-dest-count">${l.count}</span>
                  </button>
                `).join('')}
              </div>
            </div>
          </div>
          <div class="x-save-actions">
            ${editing
              ? `<button class="x-btn x-btn-ghost" id="xSaveAsNew" type="button">${t('main.saveRhythm.saveAsNewButton')}</button>
                 <button class="x-btn x-btn-primary" id="xSaveConfirm" type="button">${t('main.saveRhythm.updateButton', { name: esc(editing.name.length > 18 ? editing.name.slice(0, 18) + '…' : editing.name) })}</button>`
              : `<button class="x-btn x-btn-ghost" id="xSaveCancel" type="button">${t('main.saveRhythm.cancelButton')}</button>
                 <button class="x-btn x-btn-primary" id="xSaveConfirm" type="button">${t('main.saveRhythm.saveButton')}</button>`}
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    const close = (): void => {
      overlay.classList.remove('active');
      overlay.classList.add('x-exit');
      (window as any).__refocusPedal?.(); // refocus síncrono p/ pedal iOS
      setTimeout(() => overlay.remove(), 220);
    };

    overlay.querySelector('#xSaveClose')?.addEventListener('click', close);
    overlay.querySelector('#xSaveCancel')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const nameInput = overlay.querySelector('#xSaveName') as HTMLInputElement;
    setTimeout(() => { nameInput.focus(); nameInput.select(); }, 50);

    // ── BPM: stepper pill (mesmo do Meus Ritmos) ──
    let bpmValue = Math.max(40, Math.min(240, Math.round(currentBpm)));
    const bpmCtrl = overlay.querySelector('#xSaveBpmCtrl') as HTMLElement;
    const bpmVal = overlay.querySelector('#xSaveBpmVal') as HTMLElement;
    const setBpmValue = (v: number): void => {
      bpmValue = Math.max(40, Math.min(240, Math.round(v)));
      bpmVal.textContent = String(bpmValue);
    };
    bpmCtrl.querySelectorAll<HTMLButtonElement>('[data-step]').forEach(btn => {
      btn.addEventListener('click', () => {
        setBpmValue(bpmValue + parseInt(btn.dataset.step!));
        HapticsService.light();
      });
    });
    // Tap no número → digita direto
    bpmVal.addEventListener('click', () => {
      if (bpmCtrl.querySelector('.x-bpm-input')) return;
      bpmVal.innerHTML = `<input type="number" class="x-bpm-input" value="${bpmValue}" min="40" max="240" inputmode="numeric" />`;
      const input = bpmVal.querySelector('input') as HTMLInputElement;
      input.focus();
      input.select();
      const commit = (): void => {
        const typed = parseInt(input.value);
        bpmVal.textContent = String(bpmValue);
        if (!isNaN(typed)) setBpmValue(typed);
      };
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
        if (ev.key === 'Escape') { ev.preventDefault(); input.value = String(bpmValue); input.blur(); }
      });
      input.addEventListener('blur', commit);
    });

    // Chips de destino
    overlay.querySelectorAll<HTMLButtonElement>('.x-dest-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        destId = chip.dataset.dest || null;
        overlay.querySelectorAll('.x-dest-chip').forEach(c =>
          c.classList.toggle('active', c === chip));
      });
    });

    const validate = (): { name: string; bpm: number } | null => {
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        nameInput.style.borderColor = 'rgba(255, 107, 131, 0.5)';
        Toast.show(t('main.saveRhythm.nameRequiredToast'), { type: 'warn' });
        return null;
      }
      // bpmValue é sempre válido por construção (clamp 40-240 no stepper)
      return { name, bpm: bpmValue };
    };

    const addToDest = (rhythmId: string, name: string, bpm: number, baseRhythmName?: string): string => {
      if (!destId) return '';
      const dest = this.setlistManager.getSetlists().find(l => l.id === destId);
      if (!dest) return '';
      this.setlistManager.addItemTo(destId, {
        name,
        path: '',
        userRhythmId: rhythmId,
        ...(baseRhythmName ? { baseRhythmName } : {}),
        bpm,
      });
      this.updateSetlistUI();
      return t('main.saveRhythm.addedToSuffix', { name: dest.name });
    };

    const doSaveAsNew = async (): Promise<void> => {
      const v = validate();
      if (!v) return;

      const rhythmData = this.fileManager.exportProjectAsJSON();
      const isLibraryRhythm = this.availableRhythms.some(r => r.name === this.currentRhythmName);
      const baseRhythmName = isLibraryRhythm
        ? this.currentRhythmName
        : (editing?.base_rhythm_name || undefined);

      const saved = await this.userRhythmService.save(v.name, v.bpm, rhythmData, baseRhythmName);
      this.currentUserRhythmId = saved.id; // próximo save já oferece "Atualizar"
      this.persistDisabledVariations(); // as variações desativadas viajam pro ritmo salvo
      const destMsg = addToDest(saved.id, v.name, v.bpm, baseRhythmName);
      close();
      HapticsService.success();

      Toast.show(t('main.saveRhythm.savedToast', { name: v.name, destMsg }), {
        type: 'success',
        durationMs: 5000,
        action: {
          label: t('main.saveRhythm.renameAction'),
          onClick: () => this.renameRhythmInline(saved.id),
        },
      });
    };

    const doUpdate = async (): Promise<void> => {
      if (!editing) return doSaveAsNew();
      const v = validate();
      if (!v) return;

      const rhythmData = this.fileManager.exportProjectAsJSON();
      await this.userRhythmService.update(editing.id, v.name, v.bpm, rhythmData);
      this.currentUserRhythmId = editing.id;
      this.persistDisabledVariations(); // salva as desativadas no ritmo atualizado
      const destMsg = addToDest(editing.id, v.name, v.bpm, editing.base_rhythm_name || undefined);
      close();
      HapticsService.success();
      Toast.show(t('main.saveRhythm.updatedToast', { name: v.name, destMsg }), { type: 'success' });
    };

    overlay.querySelector('#xSaveConfirm')?.addEventListener('click', editing ? doUpdate : doSaveAsNew);
    overlay.querySelector('#xSaveAsNew')?.addEventListener('click', () => {
      // "Salvar como novo" sem mexer no nome: sugere variação pra não
      // criar homônimo sem querer
      if (editing && nameInput.value.trim() === editing.name) {
        nameInput.value = `${editing.name} 2`;
      }
      doSaveAsNew();
    });
    // Enter no nome salva (no modo editar = atualizar)
    const onEnter = editing ? doUpdate : doSaveAsNew;
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') onEnter(); });

    // ESC fecha
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
    };
    document.addEventListener('keydown', onEsc);
  }

  /**
   * Abre edit in-line pro ritmo pessoal. Usado pelo toast "Renomear" logo
   * após salvar, e pelo botão de rename na lista Meus Ritmos.
   */
  private renameRhythmInline(rhythmId: string): void {
    const rhythm = this.userRhythmService.getById(rhythmId);
    if (!rhythm) return;

    // Abre a lista Meus Ritmos — o botão de rename in-line já tá lá.
    // Pra melhorar o fluxo: depois de abrir, dispara programaticamente
    // o click no rename daquele id.
    this.showMyRhythmsModal();
    setTimeout(() => {
      const btn = document.querySelector(`[data-rename="${rhythmId}"]`) as HTMLElement | null;
      btn?.click();
    }, 300);
  }

  /**
   * Meus Ritmos (v2) — cards com edit in-line, busca fuzzy, undo na deleção.
   *
   * - Tap no card = carrega o ritmo
   * - Tap no ícone ✏️ = renomear in-line (Enter salva, Esc cancela)
   * - Tap no ícone 🗑 = deleta com toast + botão "Desfazer" 5s
   * - Busca fuzzy (ignora acento/caixa) quando há 6+ ritmos
   */
  private showMyRhythmsModal(): void {
    const overlay = document.createElement('div');
    overlay.className = 'x-overlay';

    let searchQuery = '';

    const norm = (s: string): string =>
      s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    const close = (): void => {
      overlay.classList.remove('active');
      overlay.classList.add('x-exit');
      (window as any).__refocusPedal?.(); // refocus síncrono p/ pedal iOS
      setTimeout(() => overlay.remove(), 220);
    };

    const escapeHtml = (s: string): string =>
      s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

    const renderList = (): void => {
      const list = this.userRhythmService.getAll();
      const total = list.length;
      const q = norm(searchQuery.trim());
      const filtered = q ? list.filter(r => norm(r.name).includes(q)) : list;

      // Busca sempre visível quando há ritmos (era só com 6+, parecia
      // que "faltava um pesquisar")
      const showSearch = total > 0;

      const listHtml = filtered.length === 0
        ? (q
            ? `<div class="x-empty">
                 <svg class="x-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                 <div class="x-empty-title">${t('main.myRhythms.emptySearchTitle')}</div>
                 <div class="x-empty-desc">${t('main.myRhythms.emptySearchDesc')}</div>
               </div>`
            : `<div class="x-empty">
                 <svg class="x-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                 <div class="x-empty-title">${t('main.myRhythms.emptyTitle')}</div>
                 <div class="x-empty-desc">${t('main.myRhythms.emptyDesc')}</div>
               </div>`)
        : `<div class="x-rhythms-list">${
            filtered.map(r => `
              <div class="x-rhythm-card" data-id="${r.id}">
                <span class="x-rhythm-accent"></span>
                <div class="x-rhythm-content">
                  <div class="x-rhythm-top">
                    <div class="x-rhythm-name" data-name="${escapeHtml(r.name)}">${escapeHtml(r.name)}</div>
                    <div class="x-rhythm-actions">
                      <button class="x-rhythm-action" data-rename="${r.id}" aria-label="${t('main.myRhythms.renameAriaLabel')}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                      </button>
                      <button class="x-rhythm-action danger" data-delete="${r.id}" aria-label="${t('main.myRhythms.deleteAriaLabel')}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                      </button>
                    </div>
                  </div>
                  <div class="x-rhythm-bottom">
                    <div class="x-rhythm-meta">
                      ${r.base_rhythm_name ? `<span class="x-rhythm-base">${t('main.myRhythms.basedOn', { name: escapeHtml(r.base_rhythm_name) })}</span>` : ''}
                      ${!r.synced ? `${r.base_rhythm_name ? '<span class="x-rhythm-meta-dot"></span>' : ''}<button class="x-rhythm-pending" data-sync-one="${r.id}" title="${t('main.myRhythms.syncTooltip')}">${t('main.myRhythms.pendingSync')}</button>` : ''}
                    </div>
                    <div class="x-bpm-ctrl" data-bpm-ctrl="${r.id}" aria-label="${t('main.myRhythms.bpmAriaLabel')}">
                      <button class="x-bpm-btn" data-bpm-step="-1" aria-label="${t('main.myRhythms.bpmDecreaseAriaLabel')}">&minus;</button>
                      <span class="x-bpm-val" data-bpm-val="${r.id}" role="button" title="${t('main.myRhythms.bpmTapHint')}">${r.bpm}</span>
                      <button class="x-bpm-btn" data-bpm-step="1" aria-label="${t('main.myRhythms.bpmIncreaseAriaLabel')}">+</button>
                    </div>
                  </div>
                </div>
              </div>
            `).join('')
          }</div>`;

      overlay.innerHTML = `
        <div class="x-sheet x-myrh-sheet" role="dialog" aria-label="${t('main.myRhythms.dialogAriaLabel')}">
          <div class="x-grip"></div>
          <div class="x-head">
            <div>
              <h2 class="x-head-title">${t('main.myRhythms.title')}</h2>
              <div class="x-head-sub">${total === 0 ? t('main.myRhythms.countZero') : (total === 1 ? t('main.myRhythms.countSingular', { total }) : t('main.myRhythms.countPlural', { total }))}</div>
            </div>
            <button class="x-close" id="xMyRhClose" aria-label="${t('main.myRhythms.closeAriaLabel')}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <div class="x-body">
            ${showSearch ? `
              <div class="x-search-wrap">
                <div class="x-search-input-wrap">
                  <svg class="x-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input type="text" class="x-search-input" id="xMyRhSearch" placeholder="${t('main.myRhythms.searchPlaceholder')}" value="${escapeHtml(searchQuery)}" autocomplete="off" />
                  <button class="x-search-clear ${searchQuery ? 'visible' : ''}" id="xMyRhSearchClear" aria-label="${t('main.myRhythms.clearSearchAriaLabel')}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              </div>
            ` : ''}
            ${listHtml}
          </div>
        </div>
      `;

      overlay.querySelector('#xMyRhClose')?.addEventListener('click', close);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

      // Busca
      const searchInput = overlay.querySelector('#xMyRhSearch') as HTMLInputElement | null;
      const searchClear = overlay.querySelector('#xMyRhSearchClear') as HTMLElement | null;
      if (searchInput) {
        searchInput.addEventListener('input', () => {
          searchQuery = searchInput.value;
          searchClear?.classList.toggle('visible', !!searchQuery);
          // Re-render apenas a lista (sem rebuild completo pra não perder foco)
          const bodyEl = overlay.querySelector('.x-body');
          const listEl = bodyEl?.querySelector('.x-rhythms-list, .x-empty');
          if (listEl && bodyEl) {
            const caret = searchInput.selectionStart;
            renderList();
            // Restaurar foco e caret
            const newInput = overlay.querySelector('#xMyRhSearch') as HTMLInputElement | null;
            if (newInput) {
              newInput.focus();
              if (caret !== null) newInput.setSelectionRange(caret, caret);
            }
          } else {
            renderList();
          }
        });
      }
      searchClear?.addEventListener('click', () => {
        searchQuery = '';
        renderList();
      });

      // Tap no card = carregar ritmo
      overlay.querySelectorAll<HTMLElement>('.x-rhythm-card').forEach(card => {
        card.addEventListener('click', (e) => {
          const target = e.target as HTMLElement;
          // Ignora cliques nos botões de ação, no controle de BPM ou em inputs
          if (target.closest('.x-rhythm-action, .x-rhythm-name-input, .x-bpm-ctrl')) return;
          const id = card.dataset.id!;
          const rhythm = this.userRhythmService.getById(id);
          if (!rhythm) return;
          flushBpm(id); // BPM editado mas ainda não salvo? salva antes de carregar
          this.loadUserRhythm(rhythm.name, rhythm.bpm, rhythm.rhythm_data, rhythm.id);
          close();
        });
      });

      // Badge "pendente sync": tap = tenta subir AGORA e mostra o motivo
      // real se falhar (antes o erro era invisível, só no console)
      overlay.querySelectorAll<HTMLElement>('[data-sync-one]').forEach(badge => {
        badge.addEventListener('click', async (e) => {
          e.stopPropagation();
          badge.textContent = t('main.myRhythms.syncingLabel');
          const result = await this.userRhythmService.syncOne(badge.dataset.syncOne!);
          if (result.ok) {
            Toast.show(t('main.myRhythms.syncedToast'), { type: 'success' });
            renderList();
          } else {
            badge.textContent = t('main.myRhythms.pendingSync');
            Toast.show(t('main.myRhythms.syncFailedToast', { error: result.error ?? '' }), { type: 'warn', durationMs: 8000 });
          }
        });
      });

      // ── BPM editável no card ──
      // ±1 nos botões; tap no número abre input pra digitar. Salva com
      // debounce de 600ms (não spamma o Supabase a cada toque).
      const bpmTimers: Record<string, number> = {};
      const flushBpm = (id: string): void => {
        if (!bpmTimers[id]) return;
        clearTimeout(bpmTimers[id]);
        delete bpmTimers[id];
        const valEl = overlay.querySelector(`[data-bpm-val="${id}"]`);
        const rhythm = this.userRhythmService.getById(id);
        const bpm = parseInt(valEl?.textContent || '');
        if (rhythm && !isNaN(bpm)) void this.userRhythmService.update(id, rhythm.name, bpm);
      };
      const commitBpm = (id: string, bpm: number): void => {
        const rhythm = this.userRhythmService.getById(id);
        if (!rhythm) return;
        const clamped = Math.max(40, Math.min(240, bpm));
        const valEl = overlay.querySelector(`[data-bpm-val="${id}"]`);
        if (valEl) valEl.textContent = String(clamped);
        if (bpmTimers[id]) clearTimeout(bpmTimers[id]);
        bpmTimers[id] = window.setTimeout(() => {
          delete bpmTimers[id];
          void this.userRhythmService.update(id, rhythm.name, clamped);
        }, 600);
      };

      overlay.querySelectorAll<HTMLElement>('[data-bpm-ctrl]').forEach(ctrl => {
        const id = ctrl.dataset.bpmCtrl!;
        ctrl.addEventListener('click', (e) => e.stopPropagation());

        ctrl.querySelectorAll<HTMLButtonElement>('[data-bpm-step]').forEach(btn => {
          btn.addEventListener('click', () => {
            const valEl = ctrl.querySelector('.x-bpm-val');
            const cur = parseInt(valEl?.textContent || '');
            if (isNaN(cur)) return;
            commitBpm(id, cur + parseInt(btn.dataset.bpmStep!));
            HapticsService.light();
          });
        });

        // Tap no número → input pra digitar direto
        const valEl = ctrl.querySelector('.x-bpm-val') as HTMLElement | null;
        valEl?.addEventListener('click', () => {
          if (ctrl.querySelector('.x-bpm-input')) return;
          const cur = valEl.textContent || '';
          valEl.innerHTML = `<input type="number" class="x-bpm-input" value="${cur}" min="40" max="240" inputmode="numeric" />`;
          const input = valEl.querySelector('input') as HTMLInputElement;
          input.focus();
          input.select();
          const commit = (): void => {
            const typed = parseInt(input.value);
            valEl.textContent = cur; // restaura; commitBpm regrava clampeado
            if (!isNaN(typed)) commitBpm(id, typed);
          };
          input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
            if (ev.key === 'Escape') { ev.preventDefault(); input.value = cur; input.blur(); }
          });
          input.addEventListener('blur', commit);
          input.addEventListener('click', (ev) => ev.stopPropagation());
        });
      });

      // Renomear in-line
      overlay.querySelectorAll<HTMLElement>('[data-rename]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.dataset.rename!;
          const rhythm = this.userRhythmService.getById(id);
          if (!rhythm) return;

          const card = btn.closest('.x-rhythm-card') as HTMLElement | null;
          const nameEl = card?.querySelector('.x-rhythm-name') as HTMLElement | null;
          if (!nameEl) return;

          const originalName = rhythm.name;
          nameEl.innerHTML = `<input type="text" class="x-rhythm-name-input" value="${escapeHtml(originalName)}" maxlength="60" />`;
          const input = nameEl.querySelector('input') as HTMLInputElement;
          input.focus();
          input.select();

          const commit = async (save: boolean): Promise<void> => {
            const newName = input.value.trim();
            if (save && newName && newName !== originalName) {
              await this.userRhythmService.update(id, newName, rhythm.bpm);
              Toast.show(t('main.myRhythms.renamedToast', { name: newName }), { type: 'success' });
            }
            renderList();
          };

          input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); commit(true); }
            if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
          });
          input.addEventListener('blur', () => commit(true));
          // Stop propagation pra não disparar click do card
          input.addEventListener('click', (ev) => ev.stopPropagation());
        });
      });

      // Deletar: dupla confirmação (1º tap vira "Excluir?", 2º confirma —
      // igual no repertório) + undo de 5s por garantia
      overlay.querySelectorAll<HTMLElement>('[data-delete]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = btn.dataset.delete!;
          const rhythm = this.userRhythmService.getById(id);
          if (!rhythm) return;

          if (!btn.dataset.confirming) {
            btn.dataset.confirming = '1';
            btn.classList.add('confirming');
            btn.innerHTML = `<span class="x-delete-confirm-label">${t('main.myRhythms.deleteConfirmLabel')}</span>`;
            // Cancela sozinho se o user não confirmar em 3s
            window.setTimeout(() => {
              if (!btn.isConnected || !btn.dataset.confirming) return;
              delete btn.dataset.confirming;
              btn.classList.remove('confirming');
              btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
            }, 3000);
            return;
          }

          // Captura snapshot pra undo
          const snapshot = {
            name: rhythm.name,
            bpm: rhythm.bpm,
            data: rhythm.rhythm_data,
            base: rhythm.base_rhythm_name,
          };

          // Anima saída do card e remove
          const card = btn.closest('.x-rhythm-card') as HTMLElement | null;
          card?.classList.add('deleting');
          await this.userRhythmService.delete(id);
          renderList();
          HapticsService.medium();

          Toast.show(t('main.myRhythms.deletedToast', { name: snapshot.name }), {
            type: 'info',
            durationMs: 5000,
            action: {
              label: t('main.myRhythms.undoAction'),
              onClick: async () => {
                await this.userRhythmService.save(snapshot.name, snapshot.bpm, snapshot.data, snapshot.base);
                renderList();
              },
            },
          });
        });
      });
    };

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));
    renderList();

    // Tem pendente? tenta subir agora — se sincronizar, o badge
    // "pendente sync" some na hora em vez de esperar o próximo boot
    void this.userRhythmService.syncNow().then(changed => {
      if (changed && overlay.isConnected) renderList();
    });
  }

  private async loadUserRhythm(name: string, bpm: number, rhythmData: any, rhythmId?: string): Promise<void> {
    try {
      if (this.stateManager.isPlaying()) this.stop();

      await this.fileManager.loadProjectFromData(rhythmData);
      this.stateManager.setTempo(bpm);
      this.currentRhythmOriginalBpm = bpm;
      // Rastreia o id pro fluxo "Atualizar 'X'" (salvar sem duplicar)
      this.currentUserRhythmId = rhythmId || null;

      const patternType = this.stateManager.getEditingPattern();
      this.stateManager.loadVariation(patternType, 0);

      this.updateMIDISelectorsFromState();
      this.updateSpecialSoundsSelectors();
      this.updateBeatsPerBarUI();
      this.uiManager.refreshGridDisplay();
      this.uiManager.updateVariationButtons();

      this.currentRhythmName = name;
      this.loadDisabledVariations(); // aplica as variações desativadas salvas deste ritmo
      const nameEl = document.getElementById('currentRhythmName');
      if (nameEl) nameEl.textContent = name;
      this.playingOutsideSetlist = true; // loadSetlistItem desfaz se for do repertório
      this.updateSetlistUI();

      this.updateRhythmStripActive();

      // Mostrar botão de salvar
      const saveBtn = document.getElementById('saveAsMyRhythmBtn');
      if (saveBtn) saveBtn.style.display = 'flex';

      this.modalManager.show(t('main.modal.myRhythmsTitle'), t('main.loadRhythm.loadedToast', { name }), 'success');
    } catch (err) {
      this.modalManager.show(t('main.loadRhythm.errorTitle'), t('main.loadRhythm.errorBody'), 'error');
    }
  }

  private showPhoneModal(userId: string): void {
    const overlay = document.createElement('div');
    overlay.className = 'account-modal-overlay';
    overlay.innerHTML = `
      <div class="account-modal" style="max-width:360px;">
        <div class="account-header">
          <div class="account-avatar" style="width:48px;height:48px;font-size:1.2rem;margin-bottom:0.5rem;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
          </div>
          <div class="account-name">${t('main.phoneModal.title')}</div>
          <div class="account-email" style="max-width:280px;">${t('main.phoneModal.body')}</div>
        </div>

        <div style="padding:0 0.5rem;">
          <input type="tel" id="phoneModalInput" class="account-password-input" placeholder="${t('main.phoneModal.placeholder')}" inputmode="tel" maxlength="15" style="text-align:center;font-size:1.1rem;margin-bottom:0.5rem;" />
          <div id="phoneModalStatus" style="font-size:0.72rem;min-height:1rem;text-align:center;"></div>
          <button id="phoneModalSave" class="account-action-btn" style="margin-top:0.5rem;">${t('main.phoneModal.saveButton')}</button>
          <button id="phoneModalSkip" style="width:100%;background:none;border:none;color:rgba(255,255,255,0.2);font-size:0.72rem;font-family:inherit;cursor:pointer;padding:0.6rem 0;margin-top:0.25rem;">${t('main.phoneModal.skipButton')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    const input = overlay.querySelector('#phoneModalInput') as HTMLInputElement;
    const statusEl = overlay.querySelector('#phoneModalStatus') as HTMLElement;

    // Máscara — remove prefix de código país (+55) pra não perder dígitos ao truncar
    const VALID_DDDS = new Set(['11','12','13','14','15','16','17','18','19','21','22','24','27','28','31','32','33','34','35','37','38','41','42','43','44','45','46','47','48','49','51','53','54','55','61','62','63','64','65','66','67','68','69','71','73','74','75','77','79','81','82','83','84','85','86','87','88','89','91','92','93','94','95','96','97','98','99']);
    input.addEventListener('input', () => {
      let raw = input.value.replace(/\D/g, '');
      // 12+ dígitos começando com 55: user claramente colou com código país
      if (raw.length >= 12 && raw.startsWith('55')) raw = raw.slice(2);
      // 11 dígitos começando com 55 onde [2-3] é DDD válido + 5º é '9': +55 que truncou
      else if (raw.length === 11 && raw.startsWith('55') && VALID_DDDS.has(raw.slice(2,4)) && raw[4] === '9') {
        raw = raw.slice(2);
      }
      let v = raw.slice(0, 11);
      if (v.length > 6) v = `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
      else if (v.length > 2) v = `(${v.slice(0,2)}) ${v.slice(2)}`;
      else if (v.length > 0) v = `(${v}`;
      input.value = v;
    });

    const close = () => {
      overlay.classList.remove('active');
      overlay.classList.add('x-exit'); // hasModalOpen passa a ignorar
      (window as any).__refocusPedal?.(); // refocus síncrono p/ pedal iOS
      setTimeout(() => overlay.remove(), 200);
    };

    // Salvar
    overlay.querySelector('#phoneModalSave')!.addEventListener('click', async () => {
      const phone = input.value.replace(/\D/g, '');
      if (phone.length < 10 || phone.length > 11) {
        statusEl.textContent = t('main.phoneModal.invalidNumber');
        statusEl.style.color = '#FF4466';
        return;
      }

      statusEl.textContent = t('main.phoneModal.saving');
      statusEl.style.color = 'rgba(255,255,255,0.4)';

      const { supabase } = await import('./auth/supabase');
      const { error } = await supabase
        .from('gdrums_profiles')
        .update({ phone })
        .eq('id', userId);

      if (error) {
        statusEl.textContent = t('main.phoneModal.saveError');
        statusEl.style.color = '#FF4466';
      } else {
        statusEl.textContent = t('main.phoneModal.saved');
        statusEl.style.color = '#00E68C';
        setTimeout(close, 800);
      }
    });

    // Pular
    overlay.querySelector('#phoneModalSkip')!.addEventListener('click', close);

    // Foco no input
    setTimeout(() => input.focus(), 300);
  }

  /**
   * BPM / Tap Tempo redesenhado (v2).
   *
   * Principais mudanças:
   * - Sem botão "Confirmar" (dismiss = já aplica, ESC = cancela)
   * - Tap tempo com janela deslizante dos últimos 6 taps
   * - BPM atualiza ao vivo a partir do 2º tap, pulsa visualmente a cada hit
   * - Haptic light em mobile a cada tap
   * - Nudge ±1/±5 com hit target 44×44 mínimo
   * - Input numérico direto + slider fine-tune
   * - Bottom sheet em mobile, centered em desktop (via CSS)
   */
  private showBpmModal(): void {
    const originalTempo = this.stateManager.getTempo();
    let currentBpm = originalTempo;
    let confirmed = false;

    const overlay = document.createElement('div');
    overlay.className = 'x-overlay';
    overlay.innerHTML = `
      <div class="x-sheet" role="dialog" aria-label="${t('main.bpmModal.dialogAriaLabel')}">
        <div class="x-grip"></div>
        <div class="x-head">
          <div>
            <h2 class="x-head-title">${t('main.bpmModal.title')}</h2>
            <div class="x-head-sub">${t('main.bpmModal.subtitle')}</div>
          </div>
          <button class="x-close" id="xBpmClose" aria-label="${t('main.bpmModal.closeAriaLabel')}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div class="x-body">
          <div class="x-tap-wrap">
            <div class="x-tap-display">
              <div class="x-tap-bpm" id="xBpmValue">${currentBpm}</div>
              <div class="x-tap-unit">BPM</div>
            </div>

            <button class="x-tap-pad" id="xTapPad" type="button" aria-label="${t('main.bpmModal.tapAriaLabel')}">
              ${t('main.bpmModal.tapButton')}
            </button>

            <div class="x-tap-hint" id="xTapHint">${t('main.bpmModal.tapHintInitial')}</div>

            <div class="x-tap-nudge">
              <button class="x-tap-nudge-btn" data-nudge="-5" aria-label="${t('main.bpmModal.nudgeMinus5AriaLabel')}">−5</button>
              <button class="x-tap-nudge-btn" data-nudge="-1" aria-label="${t('main.bpmModal.nudgeMinus1AriaLabel')}">−1</button>
              <input type="number" class="x-tap-nudge-input" id="xBpmInput" min="40" max="240" inputmode="numeric" value="${currentBpm}" aria-label="BPM" />
              <button class="x-tap-nudge-btn" data-nudge="1" aria-label="${t('main.bpmModal.nudgePlus1AriaLabel')}">+1</button>
              <button class="x-tap-nudge-btn" data-nudge="5" aria-label="${t('main.bpmModal.nudgePlus5AriaLabel')}">+5</button>
            </div>

            <input type="range" class="x-tap-slider" id="xBpmSlider" min="40" max="240" value="${currentBpm}" aria-label="${t('main.bpmModal.sliderAriaLabel')}" />

            ${this.currentRhythmOriginalBpm > 0 && currentBpm !== this.currentRhythmOriginalBpm
              ? `<button class="x-tap-restore" id="xBpmRestore">${t('main.bpmModal.restoreButton', { bpm: this.currentRhythmOriginalBpm })}</button>`
              : ''}
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    const valueEl = overlay.querySelector('#xBpmValue') as HTMLElement;
    const inputEl = overlay.querySelector('#xBpmInput') as HTMLInputElement;
    const sliderEl = overlay.querySelector('#xBpmSlider') as HTMLInputElement;
    const padEl = overlay.querySelector('#xTapPad') as HTMLElement;
    const hintEl = overlay.querySelector('#xTapHint') as HTMLElement;

    const applyBpm = (bpm: number, source?: 'input' | 'slider' | 'tap'): void => {
      currentBpm = Math.max(40, Math.min(240, Math.round(bpm)));
      valueEl.textContent = String(currentBpm);
      if (source !== 'input') inputEl.value = String(currentBpm);
      if (source !== 'slider') sliderEl.value = String(currentBpm);
      valueEl.classList.toggle('live', source === 'tap');
      this.stateManager.setTempo(currentBpm);
    };

    // Nudge ±1/±5
    overlay.querySelectorAll<HTMLElement>('[data-nudge]').forEach(btn => {
      btn.addEventListener('click', () => {
        const delta = parseInt(btn.dataset.nudge || '0');
        applyBpm(currentBpm + delta);
        HapticsService.light();
      });
    });

    // Input direto
    inputEl.addEventListener('input', () => {
      const v = parseInt(inputEl.value);
      if (!isNaN(v) && v >= 40 && v <= 240) applyBpm(v, 'input');
    });
    inputEl.addEventListener('focus', () => inputEl.select());

    // Slider fine-tune
    sliderEl.addEventListener('input', () => applyBpm(parseInt(sliderEl.value), 'slider'));

    // ─── Tap Tempo (janela deslizante) ─────────────────────────────
    // Mantém últimos 6 intervalos. Reseta se gap > 2s entre taps.
    const TAP_WINDOW = 6;
    const TAP_GAP_MS = 2000;
    const tapTimes: number[] = [];
    let tapResetTimer: number | null = null;

    const resetHint = (): void => {
      tapTimes.length = 0;
      hintEl.innerHTML = t('main.bpmModal.tapHintInitial');
    };

    const handleTap = (): void => {
      const now = performance.now();
      // Reset se gap grande
      if (tapTimes.length > 0 && now - tapTimes[tapTimes.length - 1] > TAP_GAP_MS) {
        tapTimes.length = 0;
      }
      tapTimes.push(now);
      if (tapTimes.length > TAP_WINDOW) tapTimes.shift();

      // Feedback visual (ripple + pulse)
      padEl.classList.remove('hit');
      void padEl.offsetWidth;
      padEl.classList.add('hit');
      valueEl.classList.add('pulse');
      setTimeout(() => {
        padEl.classList.remove('hit');
        valueEl.classList.remove('pulse');
      }, 180);

      HapticsService.light();

      if (tapResetTimer) clearTimeout(tapResetTimer);
      tapResetTimer = window.setTimeout(resetHint, TAP_GAP_MS + 200);

      // Precisa 2+ taps
      if (tapTimes.length < 2) {
        hintEl.innerHTML = t('main.bpmModal.tapHintOneMore');
        return;
      }

      // Média dos intervalos (da janela atual)
      let sum = 0;
      for (let i = 1; i < tapTimes.length; i++) sum += tapTimes[i] - tapTimes[i - 1];
      const avg = sum / (tapTimes.length - 1);
      const bpm = Math.round(60000 / avg);

      if (bpm >= 40 && bpm <= 240) {
        applyBpm(bpm, 'tap');
        const taps = tapTimes.length;
        hintEl.innerHTML = taps >= 4
          ? t('main.bpmModal.tapResultCounted', { bpm, taps })
          : t('main.bpmModal.tapResultContinue', { bpm });
      }
    };

    // Suporta click (mouse), touch (mobile), space (teclado — não conflita
    // com pedal porque só ativo dentro do overlay).
    padEl.addEventListener('click', (e) => {
      e.preventDefault();
      handleTap();
    });
    padEl.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        handleTap();
      }
    });

    // Restaurar BPM original do ritmo
    overlay.querySelector('#xBpmRestore')?.addEventListener('click', () => {
      applyBpm(this.currentRhythmOriginalBpm);
    });

    // Fechar
    const close = (cancel = false): void => {
      if (confirmed) return;
      confirmed = true;
      if (cancel) this.stateManager.setTempo(originalTempo);
      overlay.classList.remove('active');
      overlay.classList.add('x-exit');
      (window as any).__refocusPedal?.(); // refocus síncrono p/ pedal iOS
      setTimeout(() => overlay.remove(), 220);
      document.removeEventListener('keydown', onKeydown);
      // Salva BPM se mudou e NÃO cancelou
      if (!cancel && currentBpm !== originalTempo) {
        this.saveCustomBpm();
      }
    };

    overlay.querySelector('#xBpmClose')?.addEventListener('click', () => close(false));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });

    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close(true);
    };
    document.addEventListener('keydown', onKeydown);
  }

  // ─── Modal Minha Conta ───────────────────────────────────────────────

  private async showAccountModal(): Promise<void> {
    const { supabase } = await import('./auth/supabase');
    const { PLANS } = await import('./auth/PaymentService');

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      // Sessão perdida — manda pro login em vez de ficar em silêncio
      console.warn('[account] sessão não recuperada:', userErr);
      this.modalManager.show(t('main.accountModal.sessionExpiredTitle'), t('main.accountModal.sessionExpiredBody'), 'warning');
      return;
    }

    // maybeSingle em vez de single — sem profile não deve quebrar o modal
    const { data: profile, error: profileErr } = await supabase
      .from('gdrums_profiles')
      .select('name, subscription_status, subscription_plan, subscription_expires_at, created_at')
      .eq('id', user.id)
      .maybeSingle();

    if (profileErr) {
      console.warn('[account] profile fetch erro:', profileErr);
      // Seguir em frente com fallbacks do user.metadata
    }

    const name = profile?.name || user.user_metadata?.name || '';
    const email = user.email || '';
    const status = profile?.subscription_status || 'trial';
    const planId = profile?.subscription_plan || 'trial';
    const expiresAt = profile?.subscription_expires_at;
    const createdAt = profile?.created_at || user.created_at;

    // Info do plano
    const currentPlan = PLANS.find(p => p.id === planId);
    const planName = currentPlan?.displayName || (planId === 'trial' ? t('main.accountModal.trialPlanName') : planId);

    // Status formatado
    const statusMap: Record<string, { label: string; color: string }> = {
      active: { label: t('main.accountModal.status.active'), color: '#00E68C' },
      trial: { label: t('main.accountModal.status.trial'), color: '#FFB420' },
      expired: { label: t('main.accountModal.status.expired'), color: '#FF4466' },
      canceled: { label: t('main.accountModal.status.canceled'), color: '#FF4466' },
    };
    const statusInfo = statusMap[status] || statusMap.expired;

    // Datas
    const formatDate = (iso: string) => {
      const d = new Date(iso);
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    };

    const expiresFormatted = expiresAt ? formatDate(expiresAt) : '--';
    const memberSince = createdAt ? formatDate(createdAt) : '--';

    // Dias restantes
    let daysLeft = 0;
    let daysText = '';
    if (expiresAt) {
      daysLeft = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (daysLeft > 0) {
        daysText = daysLeft === 1 ? t('main.accountModal.daysLeftSingular', { days: daysLeft }) : t('main.accountModal.daysLeftPlural', { days: daysLeft });
      } else {
        daysText = t('main.accountModal.daysLeftExpired');
      }
    }

    // Barra de progresso (% consumida do plano)
    let progressPercent = 0;
    if (currentPlan && expiresAt) {
      // Plano curto (Modo Show 3 Dias) conta em dias, não meses
      const totalDays = currentPlan.durationDays && currentPlan.durationDays > 0
        ? currentPlan.durationDays
        : currentPlan.durationMonths * 30;
      if (totalDays > 0) {
        const elapsed = totalDays - daysLeft;
        progressPercent = Math.min(100, Math.max(0, (elapsed / totalDays) * 100));
      }
    }

    // ─── Upgrade: calcular crédito e planos disponíveis ─────────────

    let upgradeCredit = 0;
    let upgradeAvailable = false;
    // No iOS, "Rei dos Palcos" não existe (sem IAP submetido), então o Anual
    // é o teto — quem está no Anual não tem upgrade possível no app.
    const planOrder = isIOSNative()
      ? ['mensal', 'trimestral', 'semestral', 'anual']
      : ['mensal', 'trimestral', 'semestral', 'anual', 'rei-dos-palcos'];

    if (status === 'active' && currentPlan && daysLeft > 0) {
      const totalDays = currentPlan.durationDays && currentPlan.durationDays > 0
        ? currentPlan.durationDays
        : currentPlan.durationMonths * 30;
      if (totalDays > 0) {
        upgradeCredit = Math.round(currentPlan.priceCents * (daysLeft / totalDays));
      }
      const currentIdx = planOrder.indexOf(planId);
      upgradeAvailable = currentIdx >= 0 && currentIdx < planOrder.length - 1;
    }

    // Botão de ação inteligente.
    // iOS: SEMPRE leva ao /plans interno (StoreKit) — Apple 3.1.1 proíbe
    //   qualquer call-to-action ou link que aponte pra compra externa.
    //   Rótulos NÃO podem mencionar "site".
    // Android: pagamento acontece no site externo (Play permite checkout web).
    const native = isNativeApp();
    const ios = isIOSNative();
    let actionBtn = '';
    if (status === 'expired' || status === 'canceled') {
      const label = ios ? t('main.accountModal.renewButton') : (native ? t('main.accountModal.renewSiteButton') : t('main.accountModal.renewButton'));
      actionBtn = `<button class="account-action-btn" id="accountActionBtn">${label}</button>`;
    } else if (status === 'trial') {
      const label = ios ? t('main.accountModal.subscribeButton') : (native ? t('main.accountModal.subscribeSiteButton') : t('main.accountModal.subscribeButton'));
      actionBtn = `<button class="account-action-btn" id="accountActionBtn">${label}</button>`;
    } else if (upgradeAvailable) {
      const label = ios ? t('main.accountModal.upgradeButton') : (native ? t('main.accountModal.upgradeSiteButton') : t('main.accountModal.upgradeButton'));
      actionBtn = `<button class="account-action-btn account-action-upgrade" id="accountActionBtn">${label}</button>`;
    }

    // Verificar se já está instalado (PWA standalone ou Capacitor app nativo)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as any).standalone === true
      || isNativeApp();

    // Montar modal
    const overlay = document.createElement('div');
    overlay.className = 'account-modal-overlay';
    overlay.innerHTML = `
      <div class="account-modal">
        <button class="account-modal-close" id="accountModalClose">&times;</button>
        <div class="account-header">
          <div class="account-avatar">${(name || email).charAt(0).toUpperCase()}</div>
          <div class="account-name">${name || t('main.accountModal.userFallback')}</div>
          <div class="account-email">${email}</div>
        </div>

        <div class="account-card">
          <div class="account-row">
            <span class="account-label">${t('main.accountModal.planLabel')}</span>
            <span class="account-value">${planName}</span>
          </div>
          <div class="account-row">
            <span class="account-label">${t('main.accountModal.statusLabel')}</span>
            <span class="account-status" style="color:${statusInfo.color}">${statusInfo.label}</span>
          </div>
          ${expiresAt ? `
          <div class="account-row">
            <span class="account-label">${t('main.accountModal.expiresLabel')}</span>
            <span class="account-value">${expiresFormatted}</span>
          </div>
          ${daysLeft > 0 && currentPlan ? `
          <div class="account-progress-wrap">
            <div class="account-progress-bar">
              <div class="account-progress-fill" style="width:${progressPercent}%"></div>
            </div>
            <span class="account-days-left">${daysText}</span>
          </div>
          ` : ''}
          ` : ''}
          <div class="account-row">
            <span class="account-label">${t('main.accountModal.memberSinceLabel')}</span>
            <span class="account-value">${memberSince}</span>
          </div>
        </div>

        ${actionBtn ? `<div class="account-actions">${actionBtn}</div>` : ''}

        <div class="account-password-section">
          <button class="account-password-toggle" id="accountPasswordToggle">${t('main.accountModal.changePasswordButton')}</button>
          <div class="account-password-form" id="accountPasswordForm" style="display:none;">
            <input type="password" class="account-password-input" id="accountNewPassword" placeholder="${t('main.accountModal.newPasswordPlaceholder')}" minlength="6" />
            <input type="password" class="account-password-input" id="accountConfirmPassword" placeholder="${t('main.accountModal.confirmPasswordPlaceholder')}" minlength="6" />
            <div class="account-password-status" id="accountPasswordStatus"></div>
            <button class="account-password-save" id="accountPasswordSave">${t('main.accountModal.savePasswordButton')}</button>
          </div>
        </div>

        <!-- Excluir conta — obrigatório pelo Google Play (desde 2023) e App Store -->
        <div style="margin-top:1.25rem;padding-top:1.25rem;border-top:1px solid rgba(255,255,255,0.05);">
          <button id="accountDeleteToggle" style="
            width:100%;padding:0.6rem;border:none;border-radius:10px;
            background:transparent;
            color:rgba(255,68,102,0.6);font-size:0.75rem;font-weight:600;
            font-family:inherit;cursor:pointer;text-align:center;
          ">${t('main.accountModal.deleteAccountButton')}</button>
          <div id="accountDeleteConfirm" style="display:none;margin-top:0.75rem;padding:0.85rem;background:rgba(255,68,102,0.06);border:1px solid rgba(255,68,102,0.2);border-radius:10px;">
            <p style="color:rgba(255,255,255,0.7);font-size:0.78rem;line-height:1.5;margin:0 0 0.5rem;">
              ${t('main.accountModal.deleteWarning')}
            </p>
            <p style="color:rgba(255,255,255,0.4);font-size:0.7rem;line-height:1.4;margin:0 0 0.75rem;">
              ${t('main.accountModal.deleteWarningRefund')}
            </p>
            <div id="accountDeleteStatus" style="font-size:0.72rem;min-height:1rem;margin-bottom:0.5rem;text-align:center;"></div>
            <div style="display:flex;gap:0.5rem;">
              <button id="accountDeleteCancel" style="
                flex:1;padding:0.55rem;border:none;border-radius:8px;
                background:rgba(255,255,255,0.05);
                border:1px solid rgba(255,255,255,0.08);
                color:rgba(255,255,255,0.55);font-size:0.75rem;font-weight:600;
                font-family:inherit;cursor:pointer;
              ">${t('main.accountModal.deleteCancelButton')}</button>
              <button id="accountDeleteConfirmBtn" style="
                flex:1.3;padding:0.55rem;border:none;border-radius:8px;
                background:#FF4466;color:#fff;
                font-size:0.75rem;font-weight:700;
                font-family:inherit;cursor:pointer;
              ">${t('main.accountModal.deleteConfirmButton')}</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Animar entrada
    requestAnimationFrame(() => overlay.classList.add('active'));

    // Fechar
    const close = () => {
      overlay.classList.remove('active');
      overlay.classList.add('x-exit'); // hasModalOpen passa a ignorar
      (window as any).__refocusPedal?.(); // refocus síncrono p/ pedal iOS
      setTimeout(() => overlay.remove(), 200);
    };

    overlay.querySelector('#accountModalClose')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    // Instalar App — movido pro menu principal (setupEventListeners).
    // Código antigo mantido por legado mas ninguém dispara porque o
    // button #accountInstallBtn não existe mais no modal.
    overlay.querySelector('#accountInstallBtn')?.addEventListener('click', () => {
      if (this.installPrompt) {
        this.installPrompt.prompt();
        this.installPrompt.userChoice.then((choice: any) => {
          if (choice.outcome === 'accepted') {
            this.modalManager.show(t('main.modal.appInstalledTitle'), t('main.modal.appInstalledBody'), 'success');
          }
          this.installPrompt = null;
        });
      } else {
        this.showInstallTutorial();
      }
      close();
    });

    // Toggle formulário de senha
    overlay.querySelector('#accountPasswordToggle')?.addEventListener('click', () => {
      const form = overlay.querySelector('#accountPasswordForm') as HTMLElement;
      const toggle = overlay.querySelector('#accountPasswordToggle') as HTMLElement;
      if (form.style.display === 'none') {
        form.style.display = 'flex';
        toggle.textContent = t('main.accountModal.passwordToggleCancel');
        toggle.classList.add('cancel');
      } else {
        form.style.display = 'none';
        toggle.textContent = t('main.accountModal.changePasswordButton');
        toggle.classList.remove('cancel');
      }
    });

    // Salvar nova senha
    overlay.querySelector('#accountPasswordSave')?.addEventListener('click', async () => {
      const newPass = (overlay.querySelector('#accountNewPassword') as HTMLInputElement).value;
      const confirmPass = (overlay.querySelector('#accountConfirmPassword') as HTMLInputElement).value;
      const statusEl = overlay.querySelector('#accountPasswordStatus') as HTMLElement;

      if (!newPass || newPass.length < 6) {
        statusEl.textContent = t('main.accountModal.passwordTooShort');
        statusEl.style.color = 'var(--adm-red, #FF4466)';
        return;
      }
      if (newPass !== confirmPass) {
        statusEl.textContent = t('main.accountModal.passwordMismatch');
        statusEl.style.color = 'var(--adm-red, #FF4466)';
        return;
      }

      statusEl.textContent = t('main.accountModal.passwordSaving');
      statusEl.style.color = 'rgba(255,255,255,0.4)';

      const { error } = await supabase.auth.updateUser({ password: newPass });

      if (error) {
        statusEl.textContent = error.message || t('main.accountModal.passwordChangeError');
        statusEl.style.color = 'var(--adm-red, #FF4466)';
      } else {
        statusEl.textContent = t('main.accountModal.passwordChangedSuccess');
        statusEl.style.color = 'var(--adm-green, #00E68C)';
        (overlay.querySelector('#accountNewPassword') as HTMLInputElement).value = '';
        (overlay.querySelector('#accountConfirmPassword') as HTMLInputElement).value = '';
        setTimeout(() => {
          const form = overlay.querySelector('#accountPasswordForm') as HTMLElement;
          const toggle = overlay.querySelector('#accountPasswordToggle') as HTMLElement;
          form.style.display = 'none';
          toggle.textContent = t('main.accountModal.changePasswordButton');
          toggle.classList.remove('cancel');
        }, 2000);
      }
    });

    // ─── Excluir conta ───
    // Obrigatório Google Play (2023+) e App Store.
    overlay.querySelector('#accountDeleteToggle')?.addEventListener('click', () => {
      const confirm = overlay.querySelector('#accountDeleteConfirm') as HTMLElement;
      if (confirm) confirm.style.display = 'block';
    });
    overlay.querySelector('#accountDeleteCancel')?.addEventListener('click', () => {
      const confirm = overlay.querySelector('#accountDeleteConfirm') as HTMLElement;
      if (confirm) confirm.style.display = 'none';
    });
    overlay.querySelector('#accountDeleteConfirmBtn')?.addEventListener('click', async () => {
      const statusEl = overlay.querySelector('#accountDeleteStatus') as HTMLElement;
      const btn = overlay.querySelector('#accountDeleteConfirmBtn') as HTMLButtonElement;
      btn.disabled = true;
      btn.style.opacity = '0.6';
      statusEl.textContent = t('main.accountModal.deletingAccount');
      statusEl.style.color = 'rgba(255,255,255,0.5)';

      try {
        // Chama RPC que limpa dados pessoais + marca profile como deletado
        const { error } = await supabase.rpc('delete_my_account');
        if (error) throw error;

        statusEl.textContent = t('main.accountModal.accountDeleted');
        statusEl.style.color = '#00E68C';

        // Logout + redirect pro login
        setTimeout(async () => {
          const { authService } = await import('./auth/AuthService');
          await authService.logout();
        }, 1200);
      } catch (e: any) {
        statusEl.textContent = t('main.accountModal.deleteAccountError');
        statusEl.style.color = '#FF4466';
        btn.disabled = false;
        btn.style.opacity = '1';
        console.error('Delete account error:', e);
      }
    });

    // Ação do botão de upgrade/renovar.
    // App nativo: sempre abre o site (browser externo) — compliance Play/App Store.
    // Web: modal de upgrade in-app ou redirect pra /plans.
    const actionBtnEl = overlay.querySelector('#accountActionBtn');
    if (actionBtnEl) {
      actionBtnEl.addEventListener('click', () => {
        if (isNativeApp()) {
          // iOS: interno (IAP). Android: site externo (Chrome).
          gotoPlans();
          close();
        } else if (status === 'active' && upgradeAvailable) {
          close();
          this.showUpgradeModal(planId, upgradeCredit, daysLeft, PLANS, supabase, user!);
        } else {
          window.location.assign('/plans');
        }
      });
    }
  }

  // ─── Modal de Upgrade ──────────────────────────────────────────────

  private async showUpgradeModal(
    currentPlanId: string,
    credit: number,
    daysLeft: number,
    plans: any[],
    supabase: any,
    user: any
  ): Promise<void> {
    // App nativo NUNCA mostra modal de upgrade in-app (compliance Apple/
    // Google). iOS: /plans interno (StoreKit). Android: site externo.
    if (isNativeApp()) {
      gotoPlans('/plans?upgrade=true');
      return;
    }

    const { createCheckoutLink, generateOrderNsu } = await import('./auth/PaymentService');

    const planOrder = ['mensal', 'trimestral', 'semestral', 'anual', 'rei-dos-palcos'];
    const currentIdx = planOrder.indexOf(currentPlanId);

    // Só planos maiores que o atual
    const availablePlans = plans.filter(p => {
      const idx = planOrder.indexOf(p.id);
      return idx > currentIdx;
    });

    const overlay = document.createElement('div');
    overlay.className = 'account-modal-overlay';

    const buildCards = () => availablePlans.map(plan => {
      const finalPrice = Math.max(0, plan.priceCents - credit);
      const totalDisplay = (finalPrice / 100).toFixed(2).replace('.', ',');
      const originalDisplay = (plan.priceCents / 100).toFixed(2).replace('.', ',');
      const creditDisplay = (credit / 100).toFixed(2).replace('.', ',');
      const perMonth = plan.durationMonths > 0 ? (finalPrice / plan.durationMonths / 100).toFixed(0) : (finalPrice / 100).toFixed(0);

      return `
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:1rem;margin-bottom:0.6rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
            <span style="font-size:0.9rem;font-weight:700;color:#fff;">${plan.displayName}${plan.durationMonths >= 36 ? t('main.upgradeModal.threeYearsSuffix') : ''}</span>
            <span style="font-size:0.65rem;color:rgba(255,255,255,0.3);">${t('main.upgradeModal.perMonthPrice', { price: perMonth })}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:0.2rem;font-size:0.72rem;color:rgba(255,255,255,0.5);margin-bottom:0.6rem;">
            <div style="display:flex;justify-content:space-between;">
              <span>${t('main.upgradeModal.planValueLabel')}</span>
              <span>${t('main.upgradeModal.priceDisplay', { price: originalDisplay })}</span>
            </div>
            ${credit > 0 ? `<div style="display:flex;justify-content:space-between;color:#00E68C;">
              <span>${t('main.upgradeModal.creditLabel', { days: daysLeft })}</span>
              <span>${t('main.upgradeModal.creditPriceDisplay', { price: creditDisplay })}</span>
            </div>` : ''}
            <div style="display:flex;justify-content:space-between;font-weight:700;color:#fff;font-size:0.82rem;padding-top:0.3rem;border-top:1px solid rgba(255,255,255,0.06);">
              <span>${t('main.upgradeModal.youPayLabel')}</span>
              <span>${t('main.upgradeModal.priceDisplay', { price: totalDisplay })}</span>
            </div>
          </div>
          <button class="account-action-btn" data-upgrade-plan="${plan.id}" data-upgrade-price="${finalPrice}" style="font-size:0.8rem;padding:0.6rem;">${t('main.upgradeModal.upgradeCardButton')}</button>
        </div>
      `;
    }).join('');

    overlay.innerHTML = `
      <div class="account-modal" style="max-width:420px;max-height:85vh;overflow-y:auto;">
        <button class="account-modal-close" id="upgradeClose">&times;</button>
        <div class="account-header">
          <div class="account-name">${t('main.upgradeModal.title')}</div>
          <div class="account-email">${t('main.upgradeModal.subtitle')}</div>
        </div>
        <div style="padding:0 0.25rem;" id="upgradeCards">
          ${buildCards()}
        </div>
        <div id="upgradeStatus" style="text-align:center;font-size:0.75rem;min-height:1.5rem;padding:0.5rem;"></div>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    const close = () => {
      overlay.classList.remove('active');
      overlay.classList.add('x-exit'); // hasModalOpen passa a ignorar
      (window as any).__refocusPedal?.(); // refocus síncrono p/ pedal iOS
      setTimeout(() => overlay.remove(), 200);
    };

    overlay.querySelector('#upgradeClose')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // Bind botões de upgrade
    overlay.querySelectorAll('[data-upgrade-plan]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const targetPlanId = (btn as HTMLElement).dataset.upgradePlan!;
        const targetPrice = parseInt((btn as HTMLElement).dataset.upgradePrice || '0');
        const targetPlan = plans.find(p => p.id === targetPlanId);
        if (!targetPlan) return;

        const statusEl = overlay.querySelector('#upgradeStatus') as HTMLElement;
        statusEl.textContent = t('main.upgradeModal.generatingCheckout');
        statusEl.style.color = 'rgba(255,255,255,0.4)';

        // Desabilitar todos os botões
        overlay.querySelectorAll('[data-upgrade-plan]').forEach(b => {
          (b as HTMLButtonElement).disabled = true;
          (b as HTMLElement).style.opacity = '0.5';
        });

        try {
          const orderNsu = generateOrderNsu(user.id, targetPlanId);
          const redirectUrl = `${window.location.origin}/payment-success.html`;

          // Salvar transação pendente
          await supabase.from('gdrums_transactions').insert({
            user_id: user.id,
            order_nsu: orderNsu,
            plan: targetPlanId,
            amount_cents: targetPrice,
            original_amount_cents: targetPlan.priceCents,
            status: 'pending',
          });

          // Criar checkout com preço com crédito
          const checkoutPlan = { ...targetPlan, priceCents: targetPrice };
          const result = await createCheckoutLink(checkoutPlan, orderNsu, redirectUrl, {
            name: user.user_metadata?.name || '',
            email: user.email || '',
          });

          if (result.success && result.url) {
            window.location.href = result.url;
          } else {
            statusEl.textContent = result.error || t('main.upgradeModal.paymentError');
            statusEl.style.color = '#FF4466';
            overlay.querySelectorAll('[data-upgrade-plan]').forEach(b => {
              (b as HTMLButtonElement).disabled = false;
              (b as HTMLElement).style.opacity = '1';
            });
          }
        } catch (e) {
          statusEl.textContent = t('main.upgradeModal.processError');
          statusEl.style.color = '#FF4466';
          overlay.querySelectorAll('[data-upgrade-plan]').forEach(b => {
            (b as HTMLButtonElement).disabled = false;
            (b as HTMLElement).style.opacity = '1';
          });
        }
      });
    });
  }

  /** @param gain 1.0 no uso MANUAL (botão/pedal — performático); os
   *  disparos automáticos (ex: deixa do pause) passam AUTO_CYMBAL_GAIN. */
  private playCymbal(gain: number = 1.0): void {
    // Resume síncrono — essencial para iOS (não pode ter await antes)
    this.audioManager.resume();

    // Buffer já foi pré-carregado no init(). Se ainda não carregou, ignorar.
    if (this.cymbalBuffer) {
      const currentTime = this.audioManager.getCurrentTime();
      this.audioManager.playSound(this.cymbalBuffer, currentTime, gain);

      // Feedback visual
      const cymbalBtn = document.getElementById('cymbalBtn');
      if (cymbalBtn) {
        cymbalBtn.classList.add('active');
        setTimeout(() => {
          cymbalBtn.classList.remove('active');
        }, 300);
      }
    }
  }

  private toggleStep(channel: number, step: number): void {
    const pattern = this.stateManager.getEditingPattern();
    const state = this.stateManager.getState();
    this.stateManager.toggleStep(pattern, channel, step);

    // Se o step acabou de virar ativo e o volume estiver "quebrado" (0/NaN/undefined),
    // aplica um default pra não ficar começando zerado no popup (Ghost/Médio/Alto/Max).
    const isActive = state.patterns[pattern][channel][step];
    if (isActive) {
      const vol = state.volumes?.[pattern]?.[channel]?.[step];
      const volumeLooksInvalid = !Number.isFinite(vol) || vol <= 0;
      if (volumeLooksInvalid) {
        this.stateManager.setStepVolume(pattern, channel, step, 1.0);
      }
    }

    this.uiManager.updateStepVisual(channel, step);

    // Auto-salvar a variação atual
    const currentSlot = this.stateManager.getCurrentVariation(pattern);
    this.stateManager.saveVariation(pattern, currentSlot);
    this.uiManager.updateVariationButtons();
  }

  private showVolumeControl(channel: number, step: number, element: HTMLElement): void {
    const pattern = this.stateManager.getEditingPattern();
    const state = this.stateManager.getState();

    if (!state.patterns[pattern][channel][step]) return;

    const currentVolume = state.volumes[pattern][channel][step];
    const currentOffset = this.stateManager.getStepOffset(pattern, channel, step);

    // Remover popup anterior se existir
    document.querySelectorAll('.volume-popup').forEach(p => p.remove());

    const popup = document.createElement('div');
    popup.className = 'volume-popup';
    popup.innerHTML = `
      <div class="volume-popup-content">
        <label>${t('main.volumePopup.volumeLabel')} <span id="volumeValue">${Math.round(currentVolume * 100)}%</span></label>
        <div class="volume-presets">
          <button class="preset-btn" data-volume="20">${t('main.volumePopup.presetGhost')}</button>
          <button class="preset-btn" data-volume="50">${t('main.volumePopup.presetMedium')}</button>
          <button class="preset-btn" data-volume="80">${t('main.volumePopup.presetHigh')}</button>
          <button class="preset-btn" data-volume="100">${t('main.volumePopup.presetMax')}</button>
        </div>
        <input type="range" id="volumeSlider" min="0" max="100" value="${currentVolume * 100}" step="1">

        <label style="margin-top:0.8rem;display:block;">${t('main.volumePopup.grooveLabel')} <span id="offsetValue">${currentOffset > 0 ? '+' : ''}${Math.round(currentOffset * 100)}%</span></label>
        <div class="volume-presets">
          <button class="preset-btn" data-offset="-50">←½</button>
          <button class="preset-btn" data-offset="-25">←¼</button>
          <button class="preset-btn" data-offset="0">0</button>
          <button class="preset-btn" data-offset="25">¼→</button>
          <button class="preset-btn" data-offset="50">½→</button>
        </div>
        <input type="range" id="offsetSlider" min="-50" max="50" value="${currentOffset * 100}" step="1">
        <div style="font-size:0.7rem;color:rgba(255,255,255,0.4);text-align:center;margin-top:0.3rem;">
          ${t('main.volumePopup.grooveHint')}
        </div>

        <button class="volume-close">${t('main.volumePopup.closeButton')}</button>
      </div>
    `;

    document.body.appendChild(popup);

    const rect = element.getBoundingClientRect();
    popup.style.left = `${rect.left + window.scrollX}px`;
    popup.style.top = `${rect.top + window.scrollY - 10}px`;

    const slider = popup.querySelector('#volumeSlider') as HTMLInputElement;
    const valueDisplay = popup.querySelector('#volumeValue') as HTMLElement;
    const offsetSlider = popup.querySelector('#offsetSlider') as HTMLInputElement;
    const offsetDisplay = popup.querySelector('#offsetValue') as HTMLElement;

    const updateVolume = (value: number) => {
      this.stateManager.setStepVolume(pattern, channel, step, value);
      valueDisplay.textContent = `${Math.round(value * 100)}%`;
      slider.value = (value * 100).toString();
      this.uiManager.updateStepVisual(channel, step);

      const currentSlot = this.stateManager.getCurrentVariation(pattern);
      this.stateManager.saveVariation(pattern, currentSlot);
    };

    const updateOffset = (value: number) => {
      this.stateManager.setStepOffset(pattern, channel, step, value);
      offsetDisplay.textContent = `${value > 0 ? '+' : ''}${Math.round(value * 100)}%`;
      offsetSlider.value = (value * 100).toString();
      this.uiManager.updateStepVisual(channel, step);

      const currentSlot = this.stateManager.getCurrentVariation(pattern);
      this.stateManager.saveVariation(pattern, currentSlot);
    };

    slider.addEventListener('input', (e) => {
      const value = parseInt((e.target as HTMLInputElement).value) / 100;
      updateVolume(value);
    });

    offsetSlider.addEventListener('input', (e) => {
      const value = parseInt((e.target as HTMLInputElement).value) / 100;
      updateOffset(value);
    });

    // Preset buttons — separar volume vs offset pelo atributo
    popup.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.hasAttribute('data-volume')) {
          const v = parseInt(target.getAttribute('data-volume')!) / 100;
          updateVolume(v);
          popup.remove();
        } else if (target.hasAttribute('data-offset')) {
          const v = parseInt(target.getAttribute('data-offset')!) / 100;
          updateOffset(v);
        }
      });
    });

    const closeBtn = popup.querySelector('.volume-close') as HTMLButtonElement;
    closeBtn.addEventListener('click', () => popup.remove());

    setTimeout(() => {
      document.addEventListener('click', function closePopup(e) {
        if (!popup.contains(e.target as Node)) {
          popup.remove();
          document.removeEventListener('click', closePopup);
        }
      });
    }, 100);
  }

  private switchEditingPattern(patternType: PatternType): void {
    this.stateManager.setEditingPattern(patternType);

    document.querySelectorAll('.pattern-tab').forEach(tab => {
      tab.classList.remove('active');
    });
    const activeTab = document.querySelector(`[data-pattern="${patternType}"]`);
    activeTab?.classList.add('active');

    // Selecionar automaticamente o slot 0 (primeiro slot)
    this.stateManager.setCurrentVariation(patternType, 0);

    // Carregar a variação do slot 0
    const state = this.stateManager.getState();
    const variation = state.variations[patternType][0];
    if (variation && variation.pattern) {
      this.stateManager.loadVariation(patternType, 0);
    }

    // Regenerar grid com número correto de steps para o padrão
    this.generateChannelsHTML();

    // Recarregar MIDIs e reconectar event listeners
    this.loadAvailableMidi().then(() => {
      this.setupMIDISelectors();
      this.updateMIDISelectorsFromState();
    });

    // Atualizar variações UI
    this.updateVariationSlotsUI();

    // Atualizar seletor de steps
    this.updateStepsSelector();

    // Atualizar display
    this.uiManager.refreshGridDisplay();
  }

  private async handleMidiSelect(event: Event, channel: number): Promise<void> {
    const select = event.target as HTMLSelectElement;
    const filePath = select.value;
    if (!filePath) return;

    try {
      const buffer = await this.audioManager.loadAudioFromPath(filePath);
      const pattern = this.stateManager.getEditingPattern();
      const state = this.stateManager.getState();

      state.channels[pattern][channel].buffer = buffer;
      state.channels[pattern][channel].fileName = filePath.split('/').pop() || filePath;
      state.channels[pattern][channel].midiPath = filePath;

      void filePath;

      // Auto-salvar a variação atual
      const currentSlot = this.stateManager.getCurrentVariation(pattern);
      this.stateManager.saveVariation(pattern, currentSlot);
      this.uiManager.updateVariationButtons();
    } catch (error) {
      console.error('Error loading MIDI:', error);
      this.uiManager.showAlert(t('main.alert.midiLoadError'));
      select.value = '';
    }
  }

  private async handleCustomMidiUpload(event: Event, channel: number): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const buffer = await this.audioManager.loadAudioFromFile(file);
      const pattern = this.stateManager.getEditingPattern();
      const state = this.stateManager.getState();

      state.channels[pattern][channel].buffer = buffer;
      state.channels[pattern][channel].fileName = file.name;
      state.channels[pattern][channel].midiPath = '';

      void file.name;
    } catch (error) {
      console.error('Error loading audio:', error);
      this.uiManager.showAlert(t('main.alert.audioLoadError'));
    }
  }

  private async loadRhythmFromPath(filePath: string): Promise<void> {
    try {
      await this.fileManager.loadProjectFromPath(encodeURI(filePath));

      // Carregar a primeira variação do padrão sendo editado
      const patternType = this.stateManager.getEditingPattern();
      this.stateManager.loadVariation(patternType, 0);

      this.updateMIDISelectorsFromState();
      this.updateSpecialSoundsSelectors();
      this.updateBeatsPerBarUI();
      this.uiManager.refreshGridDisplay();
      this.uiManager.updateVariationButtons();
      this.uiManager.showAlert(t('main.alert.rhythmLoaded'));

      // Resetar selects para permitir re-seleção do mesmo ritmo
      const rhythmSelect = document.getElementById('rhythmSelect') as HTMLSelectElement;
      const rhythmSelectUser = document.getElementById('rhythmSelectUser') as HTMLSelectElement;
      if (rhythmSelect) rhythmSelect.value = '';
      if (rhythmSelectUser) rhythmSelectUser.value = '';
    } catch (error) {
      console.error('Error loading rhythm:', error);
      this.uiManager.showAlert(t('main.alert.rhythmLoadError'));
    }
  }

  private updateMIDISelectorsFromState(): void {
    const patternType = this.stateManager.getEditingPattern();
    const currentVariation = this.stateManager.getCurrentVariation(patternType);
    const state = this.stateManager.getState();
    const channels = state.variations?.[patternType]?.[currentVariation]?.channels;
    if (!channels) return;

    for (let i = 0; i < MAX_CHANNELS; i++) {
      const midiSelect = document.getElementById(`midiSelect${i + 1}`) as HTMLSelectElement;
      if (!midiSelect) continue;

      const midiPath = channels[i]?.midiPath || '';
      if (!midiPath) {
        midiSelect.value = '';
        continue;
      }

      // Normalizar path — garantir que começa com /midi/
      const normalized = normalizeMidiPath(midiPath);

      // Tentar setar diretamente
      midiSelect.value = normalized;

      // Se não encontrou, tentar match parcial pelo nome do arquivo
      if (!midiSelect.value && normalized) {
        const fileName = normalized.split('/').pop() || '';
        for (const option of Array.from(midiSelect.options)) {
          if (option.value.endsWith(fileName)) {
            midiSelect.value = option.value;
            break;
          }
        }
      }
    }
  }

  private updateSpecialSoundsSelectors(): void {
    const state = this.stateManager.getState();

    // Atualizar selector de som de início
    const fillStartSelect = document.getElementById('fillStartSelect') as HTMLSelectElement;
    if (fillStartSelect && state.fillStartSound.midiPath) {
      fillStartSelect.value = state.fillStartSound.midiPath;
    }

    // Atualizar selector de som de retorno
    const fillReturnSelect = document.getElementById('fillReturnSelect') as HTMLSelectElement;
    if (fillReturnSelect && state.fillReturnSound.midiPath) {
      fillReturnSelect.value = state.fillReturnSound.midiPath;
    }
  }

  private static midiManifestPromise: Promise<string[]> | null = null;
  private static rhythmManifestPromise: Promise<{ rhythms: string[]; version: number; categories: any }> | null = null;

  private async loadAvailableMidi(): Promise<void> {
    try {
      // Carregar lista de MIDIs do manifest (dinâmico — basta editar manifest.json).
      //
      // Dedup: se já tem promise em voo, reusa. Sem cache-bust: o SW + a
      // estratégia networkFirst do vite-plugin-pwa cuidam de pegar versão
      // nova quando volta online; mandar `?v=Date.now()` por chamada
      // gerava 3-4 fetches paralelos que travavam em CDN com soluço
      // (Vercel pendurando timeouts de 32-55s em URLs únicas).
      let midiFiles: string[] = [];
      try {
        if (!RhythmSequencer.midiManifestPromise) {
          RhythmSequencer.midiManifestPromise = (async () => {
            const res = await fetch('/midi/manifest.json');
            if (!res.ok) throw new Error('manifest fetch failed');
            const manifest = await res.json();
            return manifest.files || [];
          })().catch(err => {
            // Limpa pra próxima tentativa não ficar presa em erro velho
            RhythmSequencer.midiManifestPromise = null;
            throw err;
          });
        }
        midiFiles = await RhythmSequencer.midiManifestPromise;
      } catch {
        // Fallback hardcoded caso manifest não exista
        midiFiles = [
          'bumbo.wav', 'caixa.wav', 'chimbal_fechado.wav', 'chimbal_aberto.wav',
          'prato.mp3', 'surdo.wav', 'tom_1.wav', 'tom_2.wav'
        ];
      }

      // Preencher os selects dos canais (12 canais)
      for (let i = 1; i <= MAX_CHANNELS; i++) {
        const select = document.getElementById(`midiSelect${i}`) as HTMLSelectElement;
        if (select) {
          // Guardar valor atual antes de limpar
          const currentValue = select.value;

          select.innerHTML = `<option value="">${t('main.channel.selectOption')}</option>`;

          midiFiles.forEach(file => {
            const option = document.createElement('option');
            const normalizedPath = `/midi/${file}`;
            option.value = normalizedPath;
            // Nome bonito: remover extensão e underscores
            option.textContent = file.replace(/\.(wav|mp3|ogg)$/i, '').replace(/_/g, ' ');
            select.appendChild(option);
          });

          // Restaurar valor selecionado
          if (currentValue) {
            select.value = currentValue;
          }
        }
      }

      // Após popular os selects, setar os valores do state
      this.updateMIDISelectorsFromState();

      void 0;
    } catch (error) {
      void error;
    }
  }

  // ─── Setlist ─────────────────────────────────────────────────────────

  private setupSetlistUI(): void {
    // Botão editar setlist
    const editBtn = document.getElementById('setlistEditBtn');
    editBtn?.addEventListener('click', () => {
      // Gatilho de conversão: usou setlist = intenção de show profissional
      this.conversionManager.tryFireSetlistAdd();

      // Resolve rhythm data sob demanda — pra preview ler JSON real
      const resolveRhythmData = async (item: { userRhythmId?: string; path: string }): Promise<any | null> => {
        if (item.userRhythmId) {
          const ur = this.userRhythmService.getById(item.userRhythmId);
          return ur?.rhythm_data || null;
        }
        if (!item.path) return null;
        try {
          const res = await fetch(item.path);
          if (!res.ok) return null;
          return await res.json();
        } catch {
          return null;
        }
      };

      try {
        // Juntar ritmos da biblioteca + ritmos pessoais no catálogo
        const personalRhythms = (this.userRhythmService?.getAll() || []).map(r => ({
          name: r.name,
          path: '',
          userRhythmId: r.id,
          isPersonal: true,
          baseRhythmName: r.base_rhythm_name,
          bpm: r.bpm,
          rhythmData: r.rhythm_data,
        }));
        const libraryWithCategory = this.availableRhythms.map(r => ({
          name: r.name,
          path: r.path,
          category: r.category,
        }));
        const fullCatalog = [...personalRhythms, ...libraryWithCategory];

        this.setlistEditor.open(
          fullCatalog,
          this.setlistManager,
          () => this.onSetlistEditorClose(),
          {
            previewPlayer: this.previewPlayer,
            resolveRhythmData,
          }
        );
      } catch (err) {
        console.error('Erro ao abrir repertório:', err);
        // Fallback: abrir só com ritmos da biblioteca
        this.setlistEditor.open(
          this.availableRhythms,
          this.setlistManager,
          () => this.onSetlistEditorClose()
        );
      }
    });

    // Meus Ritmos
    const myRhythmsBtn = document.getElementById('myRhythmsBtn');
    myRhythmsBtn?.addEventListener('click', () => this.showMyRhythmsModal());

    // TODOS — bottom sheet fullheight com ritmos categorizados
    const allRhythmsBtn = document.getElementById('allRhythmsBtn');
    allRhythmsBtn?.addEventListener('click', () => this.showAllRhythmsSheet());

    // (Lupa removida 06/2026 — a busca vive dentro do modal TODOS)

    // Salvar como meu ritmo
    const saveAsBtn = document.getElementById('saveAsMyRhythmBtn');
    saveAsBtn?.addEventListener('click', () => this.showSaveRhythmModal());

    // Botão próximo
    const nextBtn = document.getElementById('setlistNext');
    nextBtn?.addEventListener('click', () => this.navigateSetlist('next'));

    // Botão anterior
    const prevBtn = document.getElementById('setlistPrev');
    prevBtn?.addEventListener('click', () => this.navigateSetlist('previous'));

    // Click no centro do fav-bar: abre picker do repertório (navegação rápida).
    // Se a setlist estiver vazia, abre o editor pro user montá-la.
    const favCenter = document.getElementById('favCenter');
    if (favCenter) {
      favCenter.classList.add('fav-center-clickable');
      favCenter.addEventListener('click', () => {
        if (this.setlistManager.isEmpty()) {
          document.getElementById('setlistEditBtn')?.click();
        } else {
          this.showSetlistPicker();
        }
      });
    }

    // Atualizar UI inicial
    this.updateSetlistUI();
  }

  /**
   * Modal de seleção rápida — mostra toda a setlist com o atual destacado.
   * Click num item pula pra ele (comportamento igual ao botão Próximo/Anterior:
   * loadSetlistItem respeita o estado de play).
   */
  /**
   * Modal "pular pro ritmo X" do repertório (v2).
   *
   * Design idêntico aos outros modais da experience layer:
   * - x-sheet (bottom-sheet em mobile, center em desktop)
   * - lista de ritmos com número grande, nome + meta
   * - "tocando" destacado em verde
   * - auto-scroll pro atual
   * - botão "Editar repertório" no rodapé pra abrir o editor completo
   */
  private showSetlistPicker(): void {
    const items = this.setlistManager.getItems();
    if (items.length === 0) return;
    const currentIdx = this.setlistManager.getCurrentIndex();

    // Limpar instâncias anteriores (click duplo)
    document.querySelectorAll('.x-overlay.x-picker').forEach(el => el.remove());

    const escapeHtml = (s: string): string =>
      s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

    const overlay = document.createElement('div');
    overlay.className = 'x-overlay x-picker';

    const rows = items.map((item, i) => {
      const isCurrent = i === currentIdx;
      const nameHtml = item.userRhythmId
        ? `<span class="x-picker-personal">${escapeHtml(item.name)}</span>`
        : escapeHtml(item.name);
      const metaParts: string[] = [];
      if (item.baseRhythmName) metaParts.push(t('main.setlistPicker.baseLabel', { name: escapeHtml(item.baseRhythmName) }));
      if (item.bpm) metaParts.push(`${item.bpm} BPM`);
      const metaHtml = metaParts.length
        ? `<span class="x-picker-meta">${metaParts.join(' · ')}</span>`
        : '';
      return `
        <button class="x-picker-row ${isCurrent ? 'x-picker-row-current' : ''}" data-index="${i}" type="button">
          <span class="x-picker-num">${i + 1}</span>
          <span class="x-picker-body">
            <span class="x-picker-name">${nameHtml}</span>
            ${metaHtml}
          </span>
          ${isCurrent
            ? `<span class="x-picker-now"><span class="x-picker-now-dot"></span>${t('main.setlistPicker.nowPlayingLabel')}</span>`
            : '<svg class="x-picker-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>'}
        </button>
      `;
    }).join('');

    overlay.innerHTML = `
      <div class="x-sheet" role="dialog" aria-label="${t('main.setlistPicker.dialogAriaLabel')}">
        <div class="x-grip"></div>
        <div class="x-head">
          <div>
            <h2 class="x-head-title">${t('main.setlistPicker.title')}</h2>
            <div class="x-head-sub">${items.length === 1 ? t('main.setlistPicker.countSingular', { count: items.length }) : t('main.setlistPicker.countPlural', { count: items.length })}</div>
          </div>
          <button class="x-close" id="xPickerClose" aria-label="${t('main.setlistPicker.closeAriaLabel')}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div class="x-body x-picker-body-wrap">
          <div class="catg-search-wrap">
            <svg class="catg-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" class="catg-search-input" id="xPickerSearch" placeholder="${t('main.setlistPicker.searchPlaceholder')}" autocomplete="off" />
          </div>
          <div class="x-picker-list">${rows}</div>
        </div>

        <div class="x-picker-foot">
          <button class="x-btn x-btn-ghost x-btn-full" id="xPickerEditBtn" type="button">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            ${t('main.setlistPicker.editButton')}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    const close = (): void => {
      overlay.classList.remove('active');
      overlay.classList.add('x-exit');
      (window as any).__refocusPedal?.(); // refocus síncrono p/ pedal iOS
      setTimeout(() => overlay.remove(), 220);
      document.removeEventListener('keydown', onEsc);
    };
    const onEsc = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onEsc);

    overlay.querySelector('#xPickerClose')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // Busca: filtra as linhas em tempo real (fuzzy pt-BR, ignora acento).
    // Input seguro no iPhone: x-overlay tá no hasModalOpen() do pedal.
    const normPick = (t: string): string =>
      t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const searchInput = overlay.querySelector('#xPickerSearch') as HTMLInputElement | null;
    searchInput?.addEventListener('input', () => {
      const q = normPick(searchInput.value.trim());
      overlay.querySelectorAll<HTMLElement>('.x-picker-row').forEach(row => {
        const name = row.querySelector('.x-picker-name')?.textContent || '';
        row.style.display = !q || normPick(name).includes(q) ? '' : 'none';
      });
    });

    // Scroll pro atual
    const list = overlay.querySelector('.x-picker-list') as HTMLElement | null;
    const currentRow = list?.querySelector('.x-picker-row-current') as HTMLElement | null;
    if (currentRow) {
      setTimeout(() => currentRow.scrollIntoView({ block: 'center', behavior: 'auto' }), 0);
    }

    // Click na linha → pular pro ritmo
    overlay.querySelectorAll<HTMLButtonElement>('.x-picker-row').forEach(row => {
      row.addEventListener('click', async () => {
        const targetIdx = parseInt(row.dataset.index || '-1');
        if (targetIdx < 0 || targetIdx === this.setlistManager.getCurrentIndex()) {
          close();
          return;
        }
        close();
        const target = this.setlistManager.goTo(targetIdx);
        if (target) await this.loadSetlistItem(target);
        HapticsService.light();
      });
    });

    // Editar repertório → fecha o picker e abre o editor completo
    overlay.querySelector('#xPickerEditBtn')?.addEventListener('click', () => {
      close();
      document.getElementById('setlistEditBtn')?.click();
    });
  }

  private async onSetlistEditorClose(): Promise<void> {
    this.updateSetlistUI();

    if (this.setlistManager.isEmpty()) {
      // Setlist esvaziado — resetar estado e re-renderizar strip de ritmos
      this.currentRhythmName = '';
      this.renderRhythmStrip();
      return;
    }

    const current = this.setlistManager.getCurrentItem();
    if (!current) return;

    // Tocando ritmo AVULSO (fora do repertório)? Fechar o editor não
    // interrompe o som — o user só foi espiar/editar.
    if (this.playingOutsideSetlist && this.stateManager.isPlaying()) return;

    // O ritmo carregado JÁ é o item atual do repertório? Não recarrega
    // nem para o som — fechar o modal sem mudar nada não pode parar o
    // ritmo no meio do show.
    const alreadyLoaded = current.userRhythmId
      ? current.userRhythmId === this.currentUserRhythmId
      : (!this.currentUserRhythmId && current.name === this.currentRhythmName);
    if (alreadyLoaded) {
      this.playingOutsideSetlist = false;
      this.updateSetlistUI();
      return;
    }

    // Mudou de fato (trocou repertório/posição): carrega o item atual
    if (this.stateManager.isPlaying()) this.stop();
    await this.loadSetlistItem(current);
  }

  private async navigateSetlist(direction: 'next' | 'previous', opts?: { silent?: boolean }): Promise<void> {
    const item = direction === 'next'
      ? this.setlistManager.next()
      : this.setlistManager.previous();

    if (!item) return;

    if (this.stateManager.isPlaying()) {
      this.stop();
    }

    await this.loadSetlistItem(item, opts);
  }

  /**
   * Avança pro PRÓXIMO item do repertório (parado, sem piscar a tela)
   * quando o AUTO está ligado e o ritmo atual é do repertório. Chamado ao
   * finalizar uma música — tanto pelo fim do "Final" (onStop) quanto quando
   * o FINAL está DESLIGADO e a finalização só para o som (stopAndMaybeAdvance).
   * Na última música fica parada (navigateSetlist não faz nada).
   */
  private maybeAutoAdvance(): void {
    const wasFromSetlist = !this.playingOutsideSetlist && !this.setlistManager.isEmpty();
    if (this.useAutoNext && wasFromSetlist) {
      void this.navigateSetlist('next', { silent: true });
    }
  }

  /**
   * Finalização com o toggle FINAL DESLIGADO: para na hora (sem tocar o
   * padrão de Final) e, se o AUTO estiver ligado, avança pro próximo do
   * repertório. Substitui o this.stop() puro nos pontos de finalização.
   */
  private stopAndMaybeAdvance(): void {
    this.stop();
    this.maybeAutoAdvance();
  }

  private async loadSetlistItem(item: { name: string; path: string; userRhythmId?: string }, opts?: { silent?: boolean }): Promise<void> {
    let loaded = false;
    // Veio do repertório: o fav-bar volta a mostrar a posição do show.
    // (loadRhythm/loadUserRhythm setam true por padrão; aqui a gente
    // desfaz DEPOIS do load — ver fim da função.)
    if (item.userRhythmId) {
      const rhythm = this.userRhythmService.getById(item.userRhythmId);
      if (rhythm) {
        await this.loadUserRhythm(rhythm.name, rhythm.bpm, rhythm.rhythm_data, rhythm.id);
        loaded = true;
      } else {
        // Ritmo personalizado FANTASMA — o usuário apagou o ritmo mas o
        // item ficou no setlist. Antes isso deixava o app aberto sem nada
        // carregado (grid esmaecido) e o user achava que travou.
        // Fix: remove o item do setlist e tenta o próximo (ou default).
        this.uiManager.showAlert(t('main.alert.rhythmRemoved', { name: item.name }));
        const idx = this.setlistManager.getCurrentIndex();
        this.setlistManager.removeItem(idx);
        const next = this.setlistManager.getCurrentItem();
        if (next && next !== item) {
          await this.loadSetlistItem(next, opts);
          return;
        }
        // Sem próximo: cai pro default pra app não ficar sem ritmo
        await this.loadDefaultRhythmIfNoSetlist();
        loaded = true;
      }
    } else {
      try {
        await this.loadRhythm(item.name, item.path, opts);
        loaded = true;
      } catch (e) {
        // Ritmo do catálogo não carregou (arquivo deletado, manifest novo,
        // versão antiga do APK). Mesmo tratamento: avisa e não trava.
        console.warn('[setlist] falhou ao carregar', item.path, e);
        this.uiManager.showAlert(t('main.alert.rhythmLoadFailed', { name: item.name }));
        await this.loadDefaultRhythmIfNoSetlist();
        loaded = true;
      }
    }
    void loaded;
    this.playingOutsideSetlist = false; // veio do repertório
    // Atualizar UI do setlist (posição, nomes dos vizinhos, strip)
    this.updateSetlistUI();
    this.uiManager.updatePerformanceGrid();
    this.uiManager.updateTempoUI(this.stateManager.getTempo());
    this.uiManager.updateVariationButtons();
  }

  /**
   * Atualiza o subtítulo "Ritmo-base · BPM" (ou só "BPM") no centro do fav-bar.
   * Chamado no load de ritmo, na troca de setlist e quando o tempo muda.
   */
  private updateCurrentRhythmMeta(): void {
    const metaEl = document.getElementById('currentRhythmMeta');
    if (!metaEl) return;
    if (this.setlistManager.isEmpty()) {
      // Sem repertório: se tem ritmo carregado, mantém o BPM vivo
      metaEl.textContent = this.currentRhythmName
        ? `${Math.round(this.stateManager.getTempo())} BPM`
        : '';
      return;
    }

    // Ritmo avulso (fora do repertório): meta é só o BPM atual — não
    // mistura com o "base" do item do setlist que NÃO está tocando
    if (this.playingOutsideSetlist) {
      metaEl.textContent = `${Math.round(this.stateManager.getTempo())} BPM`;
      return;
    }

    const current = this.setlistManager.getCurrentItem();
    const currentBpm = Math.round(this.stateManager.getTempo());
    const base = current?.baseRhythmName;
    metaEl.textContent = base
      ? `${base} · ${currentBpm} BPM`
      : `${currentBpm} BPM`;
  }

  private updateSetlistUI(): void {
    const numEl = document.getElementById('setlistNum');
    const positionEl = document.getElementById('setlistPosition');
    const nameEl = document.getElementById('currentRhythmName');
    const metaEl = document.getElementById('currentRhythmMeta');
    const prevNameEl = document.getElementById('favPrevName');
    const nextNameEl = document.getElementById('favNextName');
    const prevBtn = document.getElementById('setlistPrev') as HTMLButtonElement;
    const nextBtn = document.getElementById('setlistNext') as HTMLButtonElement;
    const stripCards = document.getElementById('rhythmStripCards');
    const favBar = document.querySelector('.fav-bar') as HTMLElement;

    // ✦ Listagem categorizada CENTRAL removida (06/2026): o modal TODOS
    // (com busca embutida) cobre a navegação — com ou sem repertório.
    if (stripCards) stripCards.style.display = 'none';

    if (this.setlistManager.isEmpty()) {
      if (this.currentRhythmName) {
        // SEM repertório mas COM ritmo carregado (TODOS/painel/Meus
        // Ritmos): mostra o que tá tocando em cima — antes a barra
        // sumia inteira e o user tocava "no escuro".
        if (favBar) favBar.style.display = '';
        if (numEl) numEl.textContent = '♪';
        if (positionEl) positionEl.textContent = t('main.setlistUI.noSetlistLabel');
        if (nameEl) nameEl.textContent = this.currentRhythmName;
        if (metaEl) metaEl.textContent = `${Math.round(this.stateManager.getTempo())} BPM`;
      } else {
        if (favBar) favBar.style.display = 'none';
        if (numEl) numEl.textContent = '#';
        if (positionEl) positionEl.textContent = '';
        if (nameEl) nameEl.textContent = t('main.setlistUI.emptyPrompt');
        if (metaEl) metaEl.textContent = '';
      }
      if (prevNameEl) prevNameEl.textContent = '--';
      if (nextNameEl) nextNameEl.textContent = '--';
      if (prevBtn) { prevBtn.disabled = true; prevBtn.style.opacity = '0.25'; }
      if (nextBtn) { nextBtn.disabled = true; nextBtn.style.opacity = '0.25'; }
      this.renderDesktopPanels();
      return;
    }

    // Tem setlist: fav-bar visível + categorias logo abaixo
    // Usa empty string pra herdar o display do CSS (.fav-bar é grid)
    if (favBar) favBar.style.display = '';

    const idx = this.setlistManager.getCurrentIndex();
    const total = this.setlistManager.getLength();
    const current = this.setlistManager.getCurrentItem();
    const prev = this.setlistManager.getPreviousItem();
    const next = this.setlistManager.getNextItem();

    if (this.playingOutsideSetlist && this.currentRhythmName) {
      // Ritmo AVULSO tocando (TODOS/painel/Meus Ritmos): o centro mostra
      // ele — não finge que o item do repertório continua. Anterior/
      // próximo seguem navegando o repertório (voltar é 1 toque).
      if (numEl) numEl.textContent = '♪';
      if (positionEl) positionEl.textContent = t('main.setlistUI.outsideSetlistLabel');
      if (nameEl) nameEl.textContent = this.currentRhythmName;
    } else {
      if (numEl) numEl.textContent = `${idx + 1}`;
      if (positionEl) positionEl.textContent = t('main.setlistUI.ofTotal', { total });
      if (nameEl && current) nameEl.textContent = current.name;
    }
    if (prevNameEl) prevNameEl.textContent = prev ? prev.name : '--';
    if (nextNameEl) nextNameEl.textContent = next ? next.name : '--';

    this.updateCurrentRhythmMeta();

    if (prevBtn) {
      const hasPrev = idx > 0;
      prevBtn.disabled = !hasPrev;
      prevBtn.style.opacity = hasPrev ? '1' : '0.25';
    }
    if (nextBtn) {
      const hasNext = idx < total - 1;
      nextBtn.disabled = !hasNext;
      nextBtn.style.opacity = hasNext ? '1' : '0.25';
    }

    // Painel direito do desktop (repertório) acompanha toda mudança
    this.renderDesktopPanels();
  }

  // ─── Rhythm loading ─────────────────────────────────────────────────

  private availableRhythms: Array<{name: string, path: string, category: string}> = [];
  private rhythmCategories: Record<string, string[]> = {};
  private currentRhythmName: string = '';
  private currentRhythmOriginalBpm: number = 0; // BPM original do JSON do ritmo
  /** Id do ritmo PESSOAL carregado (null se for da biblioteca). Habilita
   *  o "Atualizar 'X'" no salvar em vez de duplicar. */
  private currentUserRhythmId: string | null = null;
  /** True quando o ritmo tocando NÃO veio do repertório (TODOS, painel
   *  lateral, Meus Ritmos) — o fav-bar mostra ele como "fora do
   *  repertório" em vez de fingir que o item do setlist continua. */
  private playingOutsideSetlist = false;

  private async loadAvailableRhythms(): Promise<void> {
    try {
      // URL limpa, sem `?t=Date.now()`. A CDN da Vercel tem soluço com query
      // strings (timeouts de 30-55s); SW + manifest.version já versionam.
      // Promise compartilhada evita rajada quando vários callers chamam junto.
      let rhythmFiles: string[] = [];
      let manifestVersion = 0;

      try {
        if (!RhythmSequencer.rhythmManifestPromise) {
          RhythmSequencer.rhythmManifestPromise = (async () => {
            const res = await fetch('/rhythm/manifest.json');
            if (!res.ok) throw new Error('rhythm manifest fetch failed');
            return await res.json();
          })().catch(err => {
            RhythmSequencer.rhythmManifestPromise = null;
            throw err;
          });
        }
        const manifest = await RhythmSequencer.rhythmManifestPromise;
        rhythmFiles = manifest.rhythms || [];
        manifestVersion = manifest.version || 0;
        this.rhythmCategories = manifest.categories || {};
      } catch (e) {
        // Manifest indisponível — segue sem catálogo (fallback HEAD-probe abaixo)
      }

      // Se não tiver manifest, usar lista de tentativa
      if (rhythmFiles.length === 0) {
        const possibleRhythms = [
          'pop.json', 'pop-complete.json', 'guarania.json', 'samba.json',
          'bossa.json', 'rock.json', 'funk.json', 'jazz.json'
        ];

        for (const file of possibleRhythms) {
          try {
            const testResponse = await fetch(`/rhythm/${file}`, { method: 'HEAD' });
            if (testResponse.ok) {
              rhythmFiles.push(file);
            }
          } catch (e) {
            // Arquivo não existe
          }
        }
      }

      // Limpar array de ritmos
      this.availableRhythms = [];

      // Atualizar select do modo admin
      const select = document.getElementById('rhythmSelect') as HTMLSelectElement;
      if (select) {
        select.innerHTML = `<option value="">${t('main.rhythmSelect.placeholder')}</option>`;
      }

      // Guardar versão pra cache bust
      this.rhythmVersion = manifestVersion || Date.now();

      // Criar mapa reverso: arquivo → categoria
      const fileToCategory: Record<string, string> = {};
      for (const [cat, files] of Object.entries(this.rhythmCategories)) {
        for (const f of (files as string[])) {
          fileToCategory[f] = cat;
        }
      }

      // Processar todos os ritmos do manifest (confiamos que existem)
      for (const file of rhythmFiles) {
        const rhythmPath = `/rhythm/${file}`;
        const rhythmName = file.replace('.json', '').replace(/-/g, ' ');
        const category = fileToCategory[file] || 'Outros';

        // Adicionar à lista de ritmos disponíveis
        this.availableRhythms.push({ name: rhythmName, path: rhythmPath, category });

        // Adicionar opção no select do admin
        if (select) {
          const option = document.createElement('option');
          option.value = rhythmPath;
          option.textContent = rhythmName;
          select.appendChild(option);
        }
      }

      // Ordenar alfabeticamente
      this.availableRhythms.sort((a, b) => a.name.localeCompare(b.name));

      // Renderizar cards visuais e atualizar setlist
      this.renderRhythmStrip();
      this.populateDuplicateRhythmSelect();
      this.populateCloneRhythmSelect();
      this.updateSetlistUI();

      // Carregar ritmo atual do setlist ao iniciar (só no modo user)
      if (!this.isAdminMode) {
        if (!this.setlistManager.isEmpty()) {
          const current = this.setlistManager.getCurrentItem();
          if (current) {
            await this.loadSetlistItem(current);
          }
        } else {
          // Setlist vazio: carrega ritmo default pra app não abrir "vazio".
          // Suporte reportava muito user travando na lista sem entender que
          // precisa escolher um ritmo. Com isso, abre tocável.
          await this.loadDefaultRhythmIfNoSetlist();
        }
      }
    } catch (error) {
      void error;
    }
  }

  private async loadDefaultRhythmIfNoSetlist(): Promise<void> {
    const defaultName = 'Pop';
    const defaultPath = '/rhythm/Pop.json';
    try {
      await this.loadRhythm(defaultName, defaultPath);
      this.updateSetlistUI();
      this.uiManager.updatePerformanceGrid();
      this.uiManager.updateTempoUI(this.stateManager.getTempo());
      this.uiManager.updateVariationButtons();

      // Toast educativo só no primeiro acesso
      const seenKey = 'gdrums-default-rhythm-hint-seen';
      if (!localStorage.getItem(seenKey)) {
        setTimeout(() => {
          this.uiManager.showAlert?.(
            t('main.alert.defaultRhythmHint'),
            'info'
          );
          localStorage.setItem(seenKey, '1');
        }, 800);
      }
    } catch {
      // Se Pop falhar, não trava o boot — só loga (tipicamente offline 1ª vez)
    }
  }

  /**
   * SHIM (06/2026): a listagem categorizada CENTRAL e o modal de busca da
   * lupa foram removidos — o modal TODOS (busca embutida) cobre tudo.
   * Mantido como atualizador dos painéis laterais do desktop porque
   * dezenas de call sites chamam renderRhythmStrip() após carregar ritmo.
   */
  private renderRhythmStrip(): void {
    this.renderDesktopPanels();
  }

  // ─── TODOS os ritmos — bottom sheet com pills de categoria ──────────
  //
  // Pills no topo (Todos + categorias): "Todos" mostra TUDO em ordem
  // alfabética num grid único; pill de categoria mostra só ela com o
  // título destacado. Busca filtra a visão ativa em tempo real.

  /** Lista normalizada de ritmos com categoria efetiva ('Outros' se sem). */
  private getAllRhythmsWithCategory(): Array<{ name: string; path: string; cat: string }> {
    const cats = new Set(Object.keys(this.rhythmCategories));
    return this.availableRhythms.map(r => ({
      name: r.name,
      path: r.path,
      cat: r.category && cats.has(r.category) ? r.category : 'Outros',
    }));
  }

  private showAllRhythmsSheet(): void {
    const overlay = document.createElement('div');
    // x-overlay: hasModalOpen() do pedal detecta → foco liberado dentro
    // do sheet. __refocusPedal no close devolve o foco (regra sagrada).
    overlay.className = 'x-overlay';

    const esc = (s: string): string =>
      s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const norm = (s: string): string =>
      s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

    const all = this.getAllRhythmsWithCategory()
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const cats = Object.keys(this.rhythmCategories).sort();
    if (all.some(r => r.cat === 'Outros')) cats.push('Outros');
    const pills = ['Todos', ...cats];
    const countOf = (c: string): number =>
      c === 'Todos' ? all.length : all.filter(r => r.cat === c).length;

    let activeCat = 'Todos';

    const close = (): void => {
      overlay.classList.remove('active');
      overlay.classList.add('x-exit');
      (window as any).__refocusPedal?.();
      setTimeout(() => overlay.remove(), 220);
    };

    overlay.innerHTML = `
      <div class="x-sheet catg-sheet" role="dialog" aria-label="${t('main.allRhythms.dialogAriaLabel')}">
        <div class="x-grip"></div>
        <div class="x-head">
          <div>
            <h2 class="x-head-title">${t('main.allRhythms.title')}</h2>
            <div class="x-head-sub">${t('main.allRhythms.count', { count: all.length })}</div>
          </div>
          <button class="x-close" id="catgClose" aria-label="${t('main.allRhythms.closeAriaLabel')}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="x-body catg-body-wrap">
          <div class="catg-search-wrap">
            <svg class="catg-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" class="catg-search-input" id="catgSearch" placeholder="${t('main.rhythmSearch.placeholder')}" autocomplete="off" />
          </div>
          <div class="catg-pills">
            ${pills.map(c => `
              <button class="catg-pill ${c === activeCat ? 'active' : ''}" data-cat="${esc(c)}">
                ${esc(c === 'Todos' ? t('main.rhythmCategory.all') : c === 'Outros' ? t('main.rhythmCategory.others') : c)} <span class="catg-pill-count">${countOf(c)}</span>
              </button>
            `).join('')}
          </div>
          <div class="catg-body"></div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    overlay.querySelector('#catgClose')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const body = overlay.querySelector('.catg-body') as HTMLElement;
    const searchInput = overlay.querySelector('#catgSearch') as HTMLInputElement | null;

    const renderBody = (): void => {
      const q = norm((searchInput?.value || '').trim());
      let list = activeCat === 'Todos' ? all : all.filter(r => r.cat === activeCat);
      if (q) list = list.filter(r => norm(r.name).includes(q));

      const titleHtml = activeCat !== 'Todos'
        ? `<div class="catg-title">${esc(activeCat === 'Outros' ? t('main.rhythmCategory.others') : activeCat)} <span class="catg-count">${list.length}</span></div>`
        : '';

      body.innerHTML = list.length === 0
        ? `${titleHtml}<div class="catg-empty">${q ? t('main.allRhythms.emptyResultsQuery', { query: esc(searchInput!.value) }) : t('main.allRhythms.emptyResults')}</div>`
        : `${titleHtml}
           <div class="catg-row">
             ${list.map(r => `
               <button class="catg-card ${r.name === this.currentRhythmName ? 'active' : ''}"
                       data-name="${esc(r.name)}" data-path="${esc(r.path)}">${esc(r.name)}</button>
             `).join('')}
           </div>`;

      body.querySelectorAll<HTMLButtonElement>('.catg-card').forEach(btn => {
        btn.addEventListener('click', async () => {
          const name = btn.dataset.name!;
          const path = btn.dataset.path!;
          close();
          await this.loadRhythm(name, path);
          this.renderRhythmStrip();
        });
      });
    };

    overlay.querySelectorAll<HTMLButtonElement>('.catg-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        activeCat = pill.dataset.cat!;
        overlay.querySelectorAll('.catg-pill').forEach(p =>
          p.classList.toggle('active', p === pill));
        renderBody();
      });
    });

    // Busca em tempo real (input funciona no iPhone: x-overlay tá no
    // hasModalOpen() do pedal)
    searchInput?.addEventListener('input', renderBody);

    renderBody();
  }

  // ─── Painéis laterais DESKTOP (≥1024px) ─────────────────────────────
  //
  // Web/PC tem espaço sobrando: esquerda = ritmos com pills de categoria
  // no topo (clica na pill → grid de quadrados da categoria); direita =
  // repertório com seletor dos até 5 repertórios em cima. Centro continua
  // o app (igual mobile). Tablets (<1024px) não veem os painéis.

  /** Categoria selecionada no painel esquerdo do desktop. */
  private deskCategory = '';
  /** Busca ativa no painel esquerdo do desktop (filtra TODAS as categorias). */
  private deskSearch = '';

  private renderDesktopPanels(): void {
    const esc = (s: string): string =>
      s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const norm = (s: string): string =>
      s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

    // ── ESQUERDA: busca + pills de categoria + grid ──
    const left = document.getElementById('deskRhythmsBody');
    if (left) {
      const all = this.getAllRhythmsWithCategory()
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      const cats = Object.keys(this.rhythmCategories).sort();
      if (all.some(r => r.cat === 'Outros')) cats.push('Outros');
      // "Todos" primeiro (tudo em ordem alfabética), igual ao modal TODOS
      const allCats = ['Todos', ...cats];
      const countOf = (c: string): number =>
        c === 'Todos' ? all.length : all.filter(r => r.cat === c).length;

      if (!this.deskCategory || !allCats.includes(this.deskCategory)) {
        this.deskCategory = 'Todos';
      }

      // Com busca ativa, o grid mostra matches de TODAS as categorias
      const computeList = (): Array<{ name: string; path: string }> => {
        const q = norm(this.deskSearch.trim());
        if (q) return all.filter(r => norm(r.name).includes(q));
        if (this.deskCategory === 'Todos') return all;
        return all.filter(r => r.cat === this.deskCategory);
      };

      const gridHtml = (list: Array<{ name: string; path: string }>): string =>
        list.length === 0
          ? `<div class="desk-empty">${t('main.allRhythms.emptyResults')}</div>`
          : list.map(r => `
              <button class="desk-r-card ${r.name === this.currentRhythmName ? 'active' : ''}"
                      data-name="${esc(r.name)}" data-path="${esc(r.path)}">${esc(r.name)}</button>
            `).join('');

      const bindCards = (scope: HTMLElement): void => {
        scope.querySelectorAll<HTMLButtonElement>('.desk-r-card').forEach(btn => {
          btn.addEventListener('click', async () => {
            await this.loadRhythm(btn.dataset.name!, btn.dataset.path!);
            this.renderDesktopPanels();
          });
        });
      };

      // ⚠️ PEDAL: input inline FORA de modal não funciona em iOS (o
      // pedalInput sagrado disputa o foco — ver história do strip).
      // Painéis ≥1024px aparecem em iPad → lá a busca fica de fora
      // (iPad usa o TODOS, que é x-overlay e o pedal respeita).
      const isIOSDevice = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (/Mac/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

      left.innerHTML = `
        ${!isIOSDevice ? `
          <div class="desk-search-wrap">
            <svg class="desk-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" class="desk-search-input" id="deskRhythmSearch" placeholder="${t('main.rhythmSearch.placeholder')}" autocomplete="off" value="${esc(this.deskSearch)}" />
          </div>` : ''}
        <div class="desk-cat-pills">
          ${allCats.map(c => `
            <button class="desk-cat-pill ${c === this.deskCategory && !this.deskSearch ? 'active' : ''}" data-cat="${esc(c)}">
              ${esc(c === 'Todos' ? t('main.rhythmCategory.all') : c === 'Outros' ? t('main.rhythmCategory.others') : c)} <span class="desk-cat-count">${countOf(c)}</span>
            </button>
          `).join('')}
        </div>
        <div class="desk-rhythm-grid">${gridHtml(computeList())}</div>
      `;

      bindCards(left);

      left.querySelectorAll<HTMLButtonElement>('.desk-cat-pill').forEach(btn => {
        btn.addEventListener('click', () => {
          this.deskCategory = btn.dataset.cat!;
          this.deskSearch = '';
          this.renderDesktopPanels();
        });
      });

      // Busca re-renderiza SÓ o grid (re-render total mataria o foco do
      // input a cada tecla)
      const searchInput = left.querySelector<HTMLInputElement>('#deskRhythmSearch');
      searchInput?.addEventListener('input', () => {
        this.deskSearch = searchInput.value;
        const grid = left.querySelector<HTMLElement>('.desk-rhythm-grid');
        if (grid) {
          grid.innerHTML = gridHtml(computeList());
          bindCards(grid);
        }
        left.querySelectorAll<HTMLButtonElement>('.desk-cat-pill').forEach(p =>
          p.classList.toggle('active', p.dataset.cat === this.deskCategory && !this.deskSearch));
      });
    }

    // ── DIREITA: seletor de repertórios + itens do ativo ──
    const right = document.getElementById('deskSetlistBody');
    if (right) {
      const lists = this.setlistManager.getSetlists();
      const items = this.setlistManager.getItems();
      const cur = this.setlistManager.getCurrentIndex();

      const chipsHtml = lists.length > 1 ? `
        <div class="desk-setlists-chips">
          ${lists.map(l => `
            <button class="desk-setlist-chip ${l.active ? 'active' : ''}" data-setlist-id="${esc(l.id)}">
              <span class="desk-setlist-chip-name">${esc(l.name)}</span>
              <span class="desk-setlist-chip-count">${l.count}</span>
            </button>
          `).join('')}
        </div>
      ` : '';

      const itemsHtml = items.length === 0
        ? `<div class="desk-empty">${t('main.desktopPanel.setlistEmptyHint')}</div>`
        : `<div class="desk-setlist-list">${items.map((item, i) => `
            <button class="desk-setlist-item ${i === cur ? 'active' : ''}" data-idx="${i}">
              <span class="desk-setlist-num">${i + 1}</span>
              <span class="desk-setlist-name">${esc(item.name)}</span>
            </button>
          `).join('')}</div>`;

      right.innerHTML = chipsHtml + itemsHtml;

      // Trocar de repertório (não corta o som — item só carrega no clique)
      right.querySelectorAll<HTMLButtonElement>('.desk-setlist-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const id = chip.dataset.setlistId!;
          if (this.setlistManager.switchSetlist(id)) {
            this.updateSetlistUI(); // re-renderiza painéis + fav-bar
          }
        });
      });

      right.querySelectorAll<HTMLButtonElement>('.desk-setlist-item').forEach(btn => {
        btn.addEventListener('click', async () => {
          const idx = parseInt(btn.dataset.idx!, 10);
          const item = this.setlistManager.goTo(idx);
          if (item) {
            if (this.stateManager.isPlaying()) this.stop();
            await this.loadSetlistItem(item);
          }
        });
      });

      // Nome do repertório ativo no título do painel
      const title = document.getElementById('deskSetlistTitle');
      if (title) title.textContent = this.setlistManager.getName();
    }
  }

  private updateRhythmStripActive(): void {
    const container = document.getElementById('rhythmStripCards');
    if (!container) return;

    container.querySelectorAll('.rhythm-card-btn').forEach(btn => {
      btn.classList.remove('active');
      if (btn.textContent === this.currentRhythmName) {
        btn.classList.add('active');
        btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    });
  }

  private isLoadingRhythm = false;

  private showRhythmLoader(name: string): HTMLElement {
    const loader = document.createElement('div');
    loader.id = 'rhythmLoader';
    loader.innerHTML = `
      <div class="rhythm-loader-content">
        <div class="rhythm-loader-spinner"></div>
        <div class="rhythm-loader-name">${name}</div>
      </div>
    `;
    document.body.appendChild(loader);
    requestAnimationFrame(() => loader.classList.add('visible'));
    return loader;
  }

  private hideRhythmLoader(): void {
    const loader = document.getElementById('rhythmLoader');
    if (loader) {
      loader.classList.remove('visible');
      loader.addEventListener('transitionend', () => loader.remove(), { once: true });
      setTimeout(() => loader.remove(), 400);
    }
  }

  private async loadRhythm(name: string, path: string, opts?: { silent?: boolean }): Promise<void> {
    if (this.isLoadingRhythm) return;
    this.isLoadingRhythm = true;

    // No avanço automático do repertório (AUTO) NÃO mostramos o loader:
    // ele "pisca" na tela a cada troca. silent = troca limpa e instantânea.
    if (!opts?.silent) this.showRhythmLoader(name);

    try {
      if (this.stateManager.isPlaying()) {
        this.stop();
      }

      // Carregar ritmo — sem cache bust. Vercel CDN tem soluço com query
      // strings (`?v=`) gerando timeouts de 30-55s. O SW + manifest.version
      // já cuidam de invalidar cache quando ritmo muda. URL limpa = cache
      // do SW reusa em ms.
      const cleanPath = path.split('?')[0];
      const encodedPath = encodeURI(cleanPath);
      await this.fileManager.loadProjectFromPath(encodedPath);

      // Guardar BPM original do ritmo (antes de aplicar customização)
      this.currentRhythmOriginalBpm = this.stateManager.getTempo();

      // Aplicar BPM customizado do usuário se existir
      const customBpm = this.getCustomBpm(name);
      if (customBpm !== null) {
        this.stateManager.setTempo(customBpm);
      }

      // Carregar a primeira variação do padrão sendo editado
      const patternType = this.stateManager.getEditingPattern();
      this.stateManager.loadVariation(patternType, 0);

      this.updateMIDISelectorsFromState();
      this.updateSpecialSoundsSelectors();
      this.updateBeatsPerBarUI();
      this.uiManager.refreshGridDisplay();
      this.uiManager.updateVariationButtons();

      // Resetar selects para permitir re-seleção do mesmo ritmo
      const rhythmSelect = document.getElementById('rhythmSelect') as HTMLSelectElement;
      const rhythmSelectUser = document.getElementById('rhythmSelectUser') as HTMLSelectElement;
      if (rhythmSelect) rhythmSelect.value = '';
      if (rhythmSelectUser) rhythmSelectUser.value = '';

      if (this.isAdminMode) {
        // Admin: só atualizar project bar
        this.updateProjectBar(name);
      } else {
        // User: atualizar nome do ritmo, favoritos, strip
        this.currentRhythmName = name;
        this.currentUserRhythmId = null; // ritmo de biblioteca
        this.loadDisabledVariations(); // aplica as variações desativadas salvas deste ritmo
        // Carregado avulso (TODOS/painel) — o loadSetlistItem desfaz
        // essa flag logo depois quando o load veio do repertório
        this.playingOutsideSetlist = true;
        this.updateSetlistUI();
        const currentRhythmNameEl = document.getElementById('currentRhythmName');
        if (currentRhythmNameEl) {
          currentRhythmNameEl.textContent = name;
        }
        this.updateRhythmStripActive();
        // Notifica ConversionManager — trigger 'thirdRhythmExplored'
        // avalia se já explorou 3 ritmos diferentes
        this.conversionManager.onRhythmChange(name);
        this.updateSetlistUI();

        // Mostrar botão de salvar como meu ritmo
        const saveBtn = document.getElementById('saveAsMyRhythmBtn');
        if (saveBtn) saveBtn.style.display = 'flex';
      }
    } catch (error) {
      console.error(`Error loading rhythm ${name}:`, error);
      this.uiManager.showAlert(t('main.alert.rhythmLoadFailedNamed', { name }));
    } finally {
      this.isLoadingRhythm = false;
      this.hideRhythmLoader();
    }
  }

  // ─── Duplicate from Rhythm ───────────────────────────────────────────

  private setupDuplicateFromRhythm(): void {
    // Limitar variação de origem baseado no tipo
    const updateSlotOptions = (typeSelect: HTMLSelectElement, slotSelect: HTMLSelectElement) => {
      typeSelect.addEventListener('change', () => {
        const selectedType = typeSelect.value;
        slotSelect.innerHTML = '';
        const max = (selectedType === 'end' || selectedType === 'intro') ? 1 : 3;
        for (let i = 0; i < max; i++) {
          const o = document.createElement('option');
          o.value = String(i);
          o.textContent = t('main.duplicateFrom.varOption', { n: i + 1 });
          slotSelect.appendChild(o);
        }
      });
    };

    const srcType = document.getElementById('duplicatePatternType') as HTMLSelectElement;
    const srcSlot = document.getElementById('duplicateVariationSlot') as HTMLSelectElement;
    const dstType = document.getElementById('dupDestPatternType') as HTMLSelectElement;
    const dstSlot = document.getElementById('dupDestVariationSlot') as HTMLSelectElement;

    if (srcType && srcSlot) updateSlotOptions(srcType, srcSlot);
    if (dstType && dstSlot) updateSlotOptions(dstType, dstSlot);

    const duplicateBtn = document.getElementById('duplicateBtn');
    if (duplicateBtn) {
      duplicateBtn.addEventListener('click', () => this.duplicateFromRhythm());
    }

    // Duplicar slot atual para outro
    const dupSlotBtn = document.getElementById('duplicateSlotBtn');
    if (dupSlotBtn) {
      dupSlotBtn.addEventListener('click', () => this.duplicateCurrentSlot());
    }

    // Clonar ritmo inteiro
    const cloneBtn = document.getElementById('cloneRhythmBtn');
    if (cloneBtn) {
      cloneBtn.addEventListener('click', () => this.cloneEntireRhythm());
    }
  }

  private async duplicateFromRhythm(): Promise<void> {
    const rhythmSelect = document.getElementById('duplicateRhythmSelect') as HTMLSelectElement;
    const patternTypeSelect = document.getElementById('duplicatePatternType') as HTMLSelectElement;
    const variationSlotSelect = document.getElementById('duplicateVariationSlot') as HTMLSelectElement;
    const dstTypeSelect = document.getElementById('dupDestPatternType') as HTMLSelectElement;
    const dstSlotSelect = document.getElementById('dupDestVariationSlot') as HTMLSelectElement;

    if (!rhythmSelect || !patternTypeSelect || !variationSlotSelect || !dstTypeSelect || !dstSlotSelect) return;

    const rhythmPath = rhythmSelect.value;
    const sourcePatternType = patternTypeSelect.value as PatternType;
    const sourceSlotIndex = parseInt(variationSlotSelect.value, 10);

    if (!rhythmPath) {
      this.uiManager.showAlert(t('main.duplicateFrom.selectRhythmAlert'));
      return;
    }

    // Parar reprodução antes de duplicar
    if (this.stateManager.isPlaying()) {
      this.stop();
    }

    try {
      const response = await fetch(rhythmPath);
      const data = await response.json();

      const sourceVariation = data.variations?.[sourcePatternType]?.[sourceSlotIndex];

      if (!sourceVariation || !sourceVariation.pattern) {
        this.uiManager.showAlert(t('main.duplicateFrom.noVariationAlert'));
        return;
      }

      // Destino escolhido pelo usuário
      const targetPatternType = dstTypeSelect.value as PatternType;
      const targetSlot = parseInt(dstSlotSelect.value, 10);
      const state = this.stateManager.getState();

      const targetSteps = sourceVariation.steps || 16;

      // Deep-copy pattern and volumes
      state.variations[targetPatternType][targetSlot].pattern = expandPattern(sourceVariation.pattern, targetSteps);
      state.variations[targetPatternType][targetSlot].volumes = expandVolumes(sourceVariation.volumes, targetSteps);
      state.variations[targetPatternType][targetSlot].steps = targetSteps;
      state.variations[targetPatternType][targetSlot].speed = sourceVariation.speed || 1;

      // Load audio channels from source
      if (sourceVariation.audioFiles) {
        for (let i = 0; i < sourceVariation.audioFiles.length && i < MAX_CHANNELS; i++) {
          const audioFile = sourceVariation.audioFiles[i];
          if (!audioFile) continue;

          const midiPath = normalizeMidiPath(audioFile.midiPath || '');
          state.variations[targetPatternType][targetSlot].channels[i].midiPath = midiPath;
          state.variations[targetPatternType][targetSlot].channels[i].fileName = audioFile.fileName || '';

          if (midiPath) {
            try {
              const buffer = await this.audioManager.loadAudioFromPath(midiPath);
              state.variations[targetPatternType][targetSlot].channels[i].buffer = buffer;
            } catch (error) {
              console.error(`Erro ao carregar áudio do canal ${i}:`, error);
            }
          }
        }
      }

      // Navegar pro destino e ativar
      this.stateManager.setEditingPattern(targetPatternType);
      this.stateManager.setCurrentVariation(targetPatternType, targetSlot);
      this.stateManager.loadVariation(targetPatternType, targetSlot);
      this.stateManager.setPatternSteps(targetPatternType, targetSteps);

      // Atualizar tabs
      document.querySelectorAll('.pattern-tab').forEach(tab => tab.classList.remove('active'));
      document.querySelector(`[data-pattern="${targetPatternType}"]`)?.classList.add('active');

      // Regenerar grid completo
      this.generateChannelsHTML();
      this.loadAvailableMidi().then(() => {
        this.setupMIDISelectors();
        this.updateMIDISelectorsFromState();
      });
      this.updateVariationSlotsUI();
      this.updateStepsSelector();
      this.uiManager.refreshGridDisplay();
      this.uiManager.updateVariationButtons();

      this.uiManager.showAlert(t('main.duplicateFrom.copiedAlert', { pattern: targetPatternType.toUpperCase(), slot: targetSlot + 1 }));
    } catch (error) {
      console.error('Erro ao duplicar variação:', error);
      this.uiManager.showAlert(t('main.duplicateFrom.duplicateError'));
    }
  }

  private populateDuplicateRhythmSelect(): void {
    const select = document.getElementById('duplicateRhythmSelect') as HTMLSelectElement;
    if (!select) return;

    select.innerHTML = `<option value="">${t('main.rhythmSelect.placeholder')}</option>`;

    this.availableRhythms.forEach(rhythm => {
      const option = document.createElement('option');
      option.value = rhythm.path;
      option.textContent = rhythm.name;
      select.appendChild(option);
    });
  }

  private async cloneEntireRhythm(): Promise<void> {
    const select = document.getElementById('cloneRhythmSelect') as HTMLSelectElement;
    if (!select || !select.value) {
      this.uiManager.showAlert(t('main.cloneRhythm.selectAlert'));
      return;
    }

    if (this.stateManager.isPlaying()) this.stop();

    try {
      await this.fileManager.loadProjectFromPath(select.value);
      const rhythmName = select.options[select.selectedIndex].textContent || t('main.cloneRhythm.defaultName');

      // Carregar a primeira variação e atualizar tudo
      this.stateManager.setCurrentVariation('main', 0);
      this.stateManager.loadVariation('main', 0);
      this.stateManager.setEditingPattern('main');

      // Regenerar grid com novos dados
      this.generateChannelsHTML();
      await this.loadAvailableMidi();
      this.setupMIDISelectors();
      this.updateMIDISelectorsFromState();
      this.updateSpecialSoundsSelectors();
      this.updateVariationSlotsUI();
      this.updateStepsSelector();
      this.uiManager.refreshGridDisplay();
      this.uiManager.updateVariationButtons();

      this.updateProjectBar(rhythmName + t('main.cloneRhythm.copySuffix'));
      this.uiManager.showAlert(t('main.cloneRhythm.clonedAlert', { name: rhythmName }));
    } catch {
      this.uiManager.showAlert(t('main.cloneRhythm.cloneError'));
    }
  }

  private async duplicateCurrentSlot(): Promise<void> {
    const patternType = this.stateManager.getEditingPattern();
    const currentSlot = this.stateManager.getCurrentVariation(patternType);
    const state = this.stateManager.getState();
    const source = state.variations[patternType][currentSlot];

    if (!source || !source.pattern.some(row => row.some(s => s))) {
      this.uiManager.showAlert(t('main.duplicateSlot.emptySlotAlert'));
      return;
    }

    const maxSlots = (patternType === 'end' || patternType === 'intro') ? 1 : 3;
    if (maxSlots <= 1) {
      this.uiManager.showAlert(t('main.duplicateSlot.onlyOneVariationAlert'));
      return;
    }

    // Copiar para o próximo slot (ex: virada 1 -> virada 2).
    const targetSlot = (currentSlot + 1) % maxSlots;
    const destination = state.variations[patternType][targetSlot];
    const destinationHasData = !!destination?.pattern?.some(row => row.some(s => s));
    if (destinationHasData) {
      this.uiManager.showAlert(t('main.duplicateSlot.overwriteWarningAlert'));
    }

    // Deep copy
    state.variations[patternType][targetSlot] = {
      pattern: source.pattern.map(row => [...row]),
      volumes: source.volumes.map(row => [...row]),
      channels: source.channels.map(ch => ({ ...ch })),
      steps: source.steps,
      speed: source.speed,
    };

    // Salvar e navegar pro slot copiado
    this.stateManager.setCurrentVariation(patternType, targetSlot);
    this.stateManager.loadVariation(patternType, targetSlot);

    // Regenerar grid e recarregar selects MIDI (evita inconsistência após clone/duplicação)
    this.generateChannelsHTML();
    await this.loadAvailableMidi();
    this.setupMIDISelectors();
    this.updateMIDISelectorsFromState();
    this.updateSpecialSoundsSelectors();

    this.updateVariationSlotsUI();
    this.updateStepsSelector();
    this.uiManager.refreshGridDisplay();
    this.uiManager.updateVariationButtons();

    this.uiManager.showAlert(t('main.duplicateSlot.copiedAlert', { pattern: patternType.toUpperCase(), slot: targetSlot + 1 }));
  }

  private populateCloneRhythmSelect(): void {
    const select = document.getElementById('cloneRhythmSelect') as HTMLSelectElement;
    if (!select) return;

    select.innerHTML = `<option value="">${t('main.rhythmSelect.placeholder')}</option>`;
    this.availableRhythms.forEach(rhythm => {
      const option = document.createElement('option');
      option.value = rhythm.path;
      option.textContent = rhythm.name;
      select.appendChild(option);
    });
  }
}

// Inicializar quando a página carregar
window.addEventListener('DOMContentLoaded', () => {
  // Defesa: se chegou aqui com link de recovery do email (#type=recovery),
  // o Supabase processou a sessão automaticamente e o user vai cair no
  // app principal sem nunca ver a tela de "Nova senha". Redireciona pro
  // /login.html mantendo o hash. Nada mais roda nessa carga.
  if (redirectIfRecoveryHash()) return;

  // Captura de atribuição — cobre o caso do cara entrar em gdrums.com.br?ref=LUCAS10
  // diretamente na home do app (sem passar por landing/demo/register).
  // Se ele já é user logado, o ref sobrescreve atribuição antiga (intenção comercial clara).
  AttributionService.init();
  new RhythmSequencer();

  // Versão visível no menu — ajuda suporte a saber qual build o user tá.
  // Injetada em build time via Vite `define` (lê do package.json).
  const verLabel = document.getElementById('appVersionLabel');
  if (verLabel) verLabel.textContent = `v${__APP_VERSION__}`;

  void 0; // initialized
});
