// Entry point principal - GSOM Rhythm Sequencer

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
import { MAX_CHANNELS, type PatternType, type SequencerState } from './types';
import { expandPattern, expandVolumes, normalizeMidiPath } from './utils/helpers';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { HapticsService } from './native/HapticsService';
import { OfflineCache } from './native/OfflineCache';
import { StatusBarService } from './native/StatusBarService';
import { AttributionService } from './native/AttributionService';
import { PushService } from './native/PushService';
import { isNativeApp, openExternal, internalNav } from './native/Platform';
import { NowPlayingService } from './native/NowPlayingService';
import { UserRhythmService } from './core/UserRhythmService';
import { PreviewPlayer } from './core/PreviewPlayer';

// Pra Google Play / App Store: app nativo não pode ter fluxo de pagamento
// de produto digital (teria que usar Play Billing / IAP com taxa 30%).
// Assinaturas do GDrums são feitas no SITE (https://gdrums.com.br/plans),
// o app é "reader" — só mostra conteúdo pago fora dele.
const PLANS_URL_EXTERNAL = 'https://gdrums.com.br/plans';

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
  // Pedal fixo — esquerdo e direito
  private pedalLeft = 'ArrowLeft';
  private pedalRight = 'ArrowRight';
  private pedalMapperOpen = false;
  private installPrompt: any = null;

  constructor() {
    // Inicializar contexto de áudio
    this.audioContext = new AudioContext();

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
          artist: 'Sequenciador de Ritmos',
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
            <h2 style="color:#fff;font-size:1.3rem;font-weight:700;margin:0 0 0.5rem;letter-spacing:-0.3px;">Tudo pronto</h2>
            <p style="color:rgba(255,255,255,0.5);font-size:0.9rem;line-height:1.6;margin:0 0 2rem;">
              Toque pra começar a tocar. Seu pedal Bluetooth já vai estar funcionando.
            </p>
            <button id="iosStartupBtn" style="
              width:100%;padding:1rem;border:none;border-radius:14px;
              background:linear-gradient(135deg,#00D4FF,#8B5CF6);
              color:#fff;font-size:1rem;font-weight:700;
              font-family:inherit;cursor:pointer;
              box-shadow:0 8px 24px rgba(0,212,255,0.25);
            ">Começar</button>
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
      }
    });

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
    // PushService.init(); // desativado até configurar Firebase — estava crashando Android

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
        if (this.stateManager.isPlaying()) {
          // resume() é seguro em qualquer plataforma — no-op se contexto já
          // tá running (web/Android nativo nunca pausaram de verdade).
          this.audioManager.resume();

          // SÓ iOS precisa do tratamento abaixo. WKWebView pausa JS thread
          // de verdade em background — fila de samples agendados é processada
          // sozinha pelo audio thread, e ao voltar:
          //   1) scheduler.restart() agendaria NOVOS samples em cima dos
          //      antigos da fila → "música sobre música"
          //   2) currentStep congelou → ciclo musical fora de fase
          // Fix iOS: cancela fila + reset downbeat se bg longo + restart.
          //
          // Web/Android: NÃO mexer. Chrome desktop não throttle agressivo
          // aba com áudio rolando, Android nativo tem FGS. Áudio segue
          // limpo, cancelar/restart aqui = acavalamento (bug reportado).
          if (isIOSVis) {
            this.audioManager.cancelAllScheduled();
            const bgDuration = backgroundStartedAt > 0
              ? performance.now() - backgroundStartedAt
              : 0;
            if (bgDuration > 1000) {
              this.stateManager.resetStep();
            }
            this.scheduler.restart();
          }
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

    this.patternEngine.setOnEndCymbal((time: number) => {
      // Agendar prato no tempo exato após o último step do end
      if (this.cymbalBuffer) {
        this.audioManager.playSound(this.cymbalBuffer, time, this.stateManager.getState().masterVolume);
      } else {
        // Buffer ainda não carregado — carregar e tocar
        this.audioManager.loadAudioFromPath('/midi/prato.mp3').then(buffer => {
          this.cymbalBuffer = buffer;
          this.audioManager.playSound(buffer, time, this.stateManager.getState().masterVolume);
        });
      }
    });

    this.patternEngine.setOnStop(() => {
      this.stop();
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
      statusUser.textContent = state.isPlaying ? 'Tocando' : 'Parado';
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
        intro: 'Intro',
        main: 'Principal',
        fill: 'Virada',
        end: 'Final',
        transition: 'Transição'
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
            <h2 style="color:#fff;font-size:1.1rem;margin:0 0 0.75rem;">Abra no navegador</h2>
            <p style="color:rgba(255,255,255,0.5);font-size:0.85rem;line-height:1.6;margin:0 0 1.5rem;">
              O GDrums precisa ser aberto no Safari ou Chrome pra funcionar corretamente.
              Toque no icone de abrir no navegador (canto superior direito).
            </p>
            <div style="background:rgba(0,212,255,0.06);border:1px solid rgba(0,212,255,0.15);border-radius:12px;padding:0.85rem;margin-bottom:1rem;">
              <p style="color:rgba(0,212,255,0.8);font-size:0.8rem;margin:0;">No iPhone: toque nos 3 pontinhos e depois em "Abrir no Safari"</p>
            </div>
            <a href="https://gdrums.com.br" style="display:inline-block;padding:0.7rem 2rem;background:linear-gradient(135deg,#00D4FF,#8B5CF6);color:#fff;text-decoration:none;border-radius:12px;font-weight:700;font-size:0.9rem;">Copiar link</a>
          </div>
        </div>
      `;
      // Copiar link ao clicar
      document.querySelector('a')?.addEventListener('click', (e) => {
        e.preventDefault();
        navigator.clipboard?.writeText('https://gdrums.com.br').catch(() => {});
        const btn = e.target as HTMLElement;
        btn.textContent = 'Link copiado!';
        setTimeout(() => { btn.textContent = 'Copiar link'; }, 2000);
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
        }
      } catch {
        // Offline — setlist usa cache local automaticamente
      }

      // Carregar teclas do pedal
      const savedPedal = localStorage.getItem('gdrums_pedal_keys');
      if (savedPedal) {
        try {
          const parsed = JSON.parse(savedPedal);
          if (parsed.left) this.pedalLeft = parsed.left;
          if (parsed.right) this.pedalRight = parsed.right;
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
    });
  }

  // ─── What's New ───────────────────────────────────────────────────

  private static readonly WHATS_NEW = {
    version: '2.8',
    overline: 'Atualização',
    title: 'Biblioteca chegou aos 100 ritmos.',
    subtitle: 'Mais 6 ritmos novos: Arrasta Pé, Maxixe, Pagode Romântico, Congas, Rock (cajón) e Gospel (cajón). E samples de cajón em vários ritmos foram refinados.',
    sections: [
      {
        label: '+6 ritmos novos',
        featured: true,
        body: 'Arrasta Pé, Maxixe, Pagode Romântico, Congas (latinos), Rock (cajón) e Gospel (cajón). Cada um com viradas, intros e finalizações.',
      },
      {
        label: 'Ritmos refinados',
        body: 'Arrocha, Bachata, Boi Bumbá, Bolero, Partido Alto, Seresta (Canindé) e Gospel 2 ganharam ajustes finos no padrão e nos samples.',
      },
      {
        label: 'Preview e Modo Show',
        body: 'Lembra do botão verde ▶ no editor pra ouvir antes de adicionar? E do Modo Show pra palco com tela cheia? Tudo continua melhor.',
      },
    ],
  };

  private showWhatsNew(): void {
    const key = 'gdrums-whats-new-seen';
    const seen = localStorage.getItem(key);
    if (seen === RhythmSequencer.WHATS_NEW.version) return;

    const wn = RhythmSequencer.WHATS_NEW;

    const overlay = document.createElement('div');
    overlay.className = 'wn-modal-overlay';
    overlay.innerHTML = `
      <div class="wn-modal">
        <button class="wn-close" aria-label="Fechar">×</button>
        <div class="wn-overline">${wn.overline} — versão ${wn.version}</div>
        <h2 class="wn-title">${wn.title}</h2>
        <p class="wn-subtitle">${wn.subtitle}</p>
        <div class="wn-sections">
          ${wn.sections.map((s: any) => `
            <div class="wn-section${s.featured ? ' wn-section-featured' : ''}">
              <div class="wn-section-label">
                ${s.featured ? '<span class="wn-badge">Destaque</span>' : ''}
                ${s.label}
              </div>
              <p class="wn-section-body">${s.body}</p>
            </div>
          `).join('')}
        </div>
        <button class="wn-cta" id="whatsNewOk">Continuar</button>
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
      let reason = 'Você precisa estar conectado para acessar o GDrums.';
      if (cached) {
        const expires = cached.subscriptionExpiresAt ? new Date(cached.subscriptionExpiresAt) : null;
        const cacheAge = Date.now() - cached.cachedAt;
        const maxAge = 7 * 24 * 60 * 60 * 1000;

        if (expires && expires <= new Date()) {
          reason = 'Sua assinatura expirou. Conecte-se à internet para renovar seu plano.';
        } else if (cacheAge > maxAge) {
          reason = 'Faz mais de 7 dias sem conexão. Conecte-se à internet para revalidar seu acesso.';
        }
      }

      // Mostrar mensagem antes de redirecionar
      document.body.innerHTML = `
        <div style="position:fixed;inset:0;background:#030014;display:flex;align-items:center;justify-content:center;padding:2rem;">
          <div style="text-align:center;max-width:400px;">
            <div style="font-size:2.5rem;margin-bottom:1rem;">📡</div>
            <h2 style="color:#fff;font-size:1.2rem;margin:0 0 0.75rem;">Sem conexão</h2>
            <p style="color:rgba(255,255,255,0.5);font-size:0.85rem;line-height:1.6;margin:0 0 1.5rem;">${reason}</p>
            <button onclick="window.location.reload()" style="
              padding:0.7rem 2rem;border:none;border-radius:12px;
              background:linear-gradient(135deg,#00D4FF,#8B5CF6);
              color:#fff;font-size:0.85rem;font-weight:600;cursor:pointer;font-family:inherit;
            ">Tentar novamente</button>
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

    // Bloquear contas sem CPF criadas após 03/04/2026 (trial farming)
    // Contas antigas sem CPF passam (cadastraram antes da exigência)
    if (profile && !profile.cpf_hash && profile.role !== 'admin') {
      const created = new Date(session.user.created_at || 0);
      const cutoff = new Date('2026-04-03T00:00:00Z');

      if (created >= cutoff) {
        // Conta nova sem CPF = criada por API burlando a UI
        fetch('https://qsfziivubwdgtmwyztfw.supabase.co/functions/v1/security-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: session.user.id,
            email: session.user.email,
            name: session.user.user_metadata?.name || '',
            event: 'blocked_no_cpf',
            details: 'Conta sem CPF bloqueada — possível trial farming',
          }),
        }).catch(() => {});
        await supabase.auth.signOut();
        internalNav('/register');
        return false;
      }
    }

    // Pedir telefone se não tem (usuários antigos)
    if (profile && !profile.phone) {
      this.showPhoneModal(session.user.id);
    }

    // Sessão única — verificar se este device é o ativo
    const localSessionId = localStorage.getItem('gdrums-session-id');
    if (profile?.active_session_id && localSessionId && localSessionId !== profile.active_session_id) {
      // Outra sessão está ativa — deslogar este device
      await supabase.auth.signOut();
      localStorage.clear();
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
    // App nativo: mostra aviso pro user assinar no site (compliance Play/App Store).
    // Web: redireciona pra plans.html normal.
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
          <h2 style="color:#fff;font-size:1.2rem;font-weight:700;margin:0 0 0.75rem;letter-spacing:-0.3px;">Seu teste acabou</h2>
          <p style="color:rgba(255,255,255,0.55);font-size:0.9rem;line-height:1.6;margin:0 0 1.75rem;">
            Pra continuar tocando com sua banda, assine no nosso site. Depois é só voltar aqui e fazer login.
          </p>
          <button id="goToSiteBtn" style="
            width:100%;padding:1rem;border:none;border-radius:14px;
            background:linear-gradient(135deg,#00D4FF,#8B5CF6);
            color:#fff;font-size:0.95rem;font-weight:700;
            font-family:inherit;cursor:pointer;margin-bottom:0.75rem;
            box-shadow:0 8px 24px rgba(0,212,255,0.25);
          ">Abrir gdrums.com.br</button>
          <button id="logoutFromNoticeBtn" style="
            width:100%;padding:0.85rem;border:none;border-radius:12px;
            background:rgba(255,255,255,0.05);
            border:1px solid rgba(255,255,255,0.08);
            color:rgba(255,255,255,0.5);font-size:0.85rem;font-weight:600;
            font-family:inherit;cursor:pointer;
          ">Sair da conta</button>
        </div>
      </div>
    `;
    document.getElementById('goToSiteBtn')?.addEventListener('click', () => {
      openExternal(PLANS_URL_EXTERNAL);
    });
    document.getElementById('logoutFromNoticeBtn')?.addEventListener('click', async () => {
      const { authService } = await import('./auth/AuthService');
      await authService.logout();
    });
  }

  private showSubscriptionBanner(status: string, expires: Date, plan: string): void {
    const isPaidPlan = status === 'active' && plan !== 'trial';

    // ─── Plano pago próximo do vencimento ───────────────────────────────
    // Antes ficava silencioso até quebrar. User reclamava de "vencer e
    // não saber" — banner aparece a partir de 7 dias antes pra dar tempo
    // de renovar com calma.
    if (isPaidPlan) {
      this.conversionManager.setTrialActive(false);

      const now = new Date();
      const daysLeft = Math.floor((expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      const hoursLeftPaid = Math.max(0, Math.floor((expires.getTime() - now.getTime()) / (1000 * 60 * 60)));

      // Só mostra banner com 7 dias ou menos pra renovar
      if (daysLeft > 7) return;

      const banner = document.createElement('div');
      banner.className = 'trial-banner trial-banner-renew';

      // Urgente se for hoje/amanhã
      if (daysLeft <= 1) banner.classList.add('trial-banner-urgent');

      let renewMsg: string;
      if (daysLeft <= 0 && hoursLeftPaid <= 24) {
        renewMsg = `Sua assinatura vence <strong>hoje</strong>`;
      } else if (daysLeft === 1) {
        renewMsg = `Sua assinatura vence <strong>amanhã</strong>`;
      } else {
        renewMsg = `Sua assinatura vence em <strong>${daysLeft} dias</strong>`;
      }

      banner.innerHTML = `
        <span class="trial-banner-text">${renewMsg}</span>
        <a href="${isNativeApp() ? '#' : '/plans?renew=true'}" class="trial-banner-btn" id="trialBannerCta">Renovar agora</a>
      `;
      document.body.appendChild(banner);

      if (isNativeApp()) {
        banner.querySelector('#trialBannerCta')?.addEventListener('click', (e) => {
          e.preventDefault();
          openExternal(PLANS_URL_EXTERNAL + '?renew=true');
        });
      }

      this.injectTrialBannerStyles();
      return;
    }

    // ─── Trial — comportamento original ─────────────────────────────────
    this.conversionManager.setTrialActive(true);

    const now = new Date();
    const hoursLeft = Math.max(0, Math.floor((expires.getTime() - now.getTime()) / (1000 * 60 * 60)));
    const minutesLeft = Math.max(0, Math.floor((expires.getTime() - now.getTime()) / (1000 * 60)) % 60);

    // Notifica ConversionManager sobre horas restantes — dispara
    // gatilhos trialHalfway (24h), trialEndingSoon (12h) ou
    // trialLastHour (1h) conforme a janela. Cada um tem cooldown
    // próprio + cooldown global de 20min.
    this.conversionManager.tick(hoursLeft);

    const banner = document.createElement('div');
    banner.className = 'trial-banner';

    if (hoursLeft <= 6) {
      banner.classList.add('trial-banner-urgent');
    }

    const timeText = hoursLeft > 0 ? `${hoursLeft}h` : `${minutesLeft}min`;

    const urgentMsg = hoursLeft <= 6
      ? `Teste expira em <strong>${timeText}</strong>`
      : `Restam <strong>${timeText}</strong> do período de teste`;

    // App nativo: link com data-native pra abrir site no navegador externo
    // (Play Store / App Store não permite fluxo de pagamento in-app).
    const ctaLabel = 'Ver planos';
    banner.innerHTML = `
      <span class="trial-banner-text">${urgentMsg}</span>
      <a href="${isNativeApp() ? '#' : '/plans'}" class="trial-banner-btn" id="trialBannerCta">${ctaLabel}</a>
    `;

    document.body.appendChild(banner);

    // Se nativo, interceptar clique e abrir no browser externo
    if (isNativeApp()) {
      banner.querySelector('#trialBannerCta')?.addEventListener('click', (e) => {
        e.preventDefault();
        openExternal(PLANS_URL_EXTERNAL);
      });
    }

    this.injectTrialBannerStyles();
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
        <div class="channel-number">Canal ${channel + 1}</div>
        <select id="midiSelect${channel + 1}" class="channel-sound">
          <option value="">Selecione...</option>
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
    this.setupIntroButton();
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
          this.uiManager.showAlert('Selecione um ritmo primeiro');
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
    const pedalLeftCode = KEY_CODES[this.pedalLeft] || 0;
    const pedalRightCode = KEY_CODES[this.pedalRight] || 0;

    // capture:true + passive:false — essencial no iOS pra capturar antes do scroll do browser
    window.addEventListener('keydown', (e) => {
      // Se o mapper de pedal está aberto, deixar ele capturar
      if (this.pedalMapperOpen) return;

      // Identificar via keyCode (funciona em TUDO, inclusive pedais BT)
      // Fallback pra e.code/e.key só se keyCode não veio
      const kc = e.keyCode || e.which || 0;
      const keyId = e.code || e.key || '';

      // Se um input/select está focado, só processar se for tecla de pedal/seta
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        const isPedal = kc === pedalLeftCode || kc === pedalRightCode ||
                        kc === 37 || kc === 38 || kc === 39 || kc === 40 ||
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

      // Todas as setas ativam pedal (pedais BT enviam Up/Down ou Left/Right)
      // Down/Left = pedal esquerdo, Up/Right = pedal direito
      if (kc === 40 || kc === 37) { this.handlePedalLeft(); return; }  // ArrowDown(40) ArrowLeft(37)
      if (kc === 38 || kc === 39) { this.handlePedalRight(); return; } // ArrowUp(38) ArrowRight(39)

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
      pedalInput.placeholder = 'Pedal BT';
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

  private pedalLeftLastPress = 0;
  private pedalLeftTimeout: number | null = null;
  private pedalRightLastPress = 0;
  private pedalRightTimeout: number | null = null;

  private handlePedalLeft(): void {
    if (!this.stateManager.isPlaying()) {
      if (!this.hasRhythmLoaded()) return;
      this.patternEngine.activateRhythm(0);
      if (this.useIntro) {
        this.patternEngine.playIntroAndStart();
      } else {
        this.stateManager.setShouldPlayStartSound(true);
      }
      this.play();
    } else {
      const now = Date.now();
      if (now - this.pedalLeftLastPress < 500 && this.pedalLeftLastPress > 0) {
        if (this.pedalLeftTimeout) { clearTimeout(this.pedalLeftTimeout); this.pedalLeftTimeout = null; }
        this.playFillToPreviousRhythm();
        this.pedalLeftLastPress = 0;
      } else {
        this.pedalLeftLastPress = now;
        if (this.pedalLeftTimeout) clearTimeout(this.pedalLeftTimeout);
        this.pedalLeftTimeout = window.setTimeout(() => {
          this.patternEngine.playFillToNextRhythm();
          this.pedalLeftTimeout = null;
        }, 500);
      }
    }
  }

  private handlePedalRight(): void {
    if (!this.stateManager.isPlaying()) {
      this.playCymbal();
    } else {
      const now = Date.now();
      if (now - this.pedalRightLastPress < 500 && this.pedalRightLastPress > 0) {
        if (this.pedalRightTimeout) { clearTimeout(this.pedalRightTimeout); this.pedalRightTimeout = null; }
        if (this.useFinal) { this.patternEngine.playEndAndStop(); } else { this.stop(); }
        this.pedalRightLastPress = 0;
      } else {
        this.pedalRightLastPress = now;
        if (this.pedalRightTimeout) clearTimeout(this.pedalRightTimeout);
        this.pedalRightTimeout = window.setTimeout(() => {
          this.patternEngine.playRotatingFill();
          this.pedalRightTimeout = null;
        }, 500);
      }
    }
  }

  private setupPerformanceGrid(): void {
    document.querySelectorAll('.grid-cell').forEach((cell) => {
      cell.addEventListener('click', (e) => {
        HapticsService.medium();
        const element = e.currentTarget as HTMLElement;
        const cellType = element.getAttribute('data-type');
        const variationIndex = parseInt(element.getAttribute('data-variation') || '0');

        if (cellType === 'main') {
          const currentVariation = this.stateManager.getCurrentVariation('main');

          if (!this.stateManager.isPlaying()) {
            // Verificar se a variação clicada tem conteúdo
            const variation = this.stateManager.getState().variations.main[variationIndex];
            const hasContent = variation?.pattern.some(row => row.some(step => step === true));
            if (!hasContent) {
              this.modalManager.show(
                'Nenhum Ritmo Carregado',
                'Selecione um ritmo na lista antes de iniciar a reprodução.',
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
            // Tocando outro ritmo → fazer virada antes de mudar
            this.patternEngine.playFillToNextRhythm(variationIndex);
          }
        } else if (cellType === 'fill') {
          if (this.stateManager.isPlaying()) {
            this.patternEngine.activateFillWithTiming(variationIndex);
          }
        } else if (cellType === 'end') {
          if (this.stateManager.isPlaying()) {
            // Respeitar toggle de finalização (mesma regra do pedal direito duplo-tap)
            if (this.useFinal) {
              this.patternEngine.activateEndWithTiming(variationIndex);
            } else {
              this.stop();
            }
          }
        }
      });
    });
  }

  private setupIntroButton(): void {
    const introBtn = document.getElementById('introBtnUser');
    if (introBtn) {
      introBtn.addEventListener('click', () => {
        if (!this.stateManager.isPlaying() && this.hasRhythmLoaded()) {
          HapticsService.medium();
          this.patternEngine.playIntroAndStart();
          this.play();
        }
      });
    }
  }

  // ─── Toggles Intro/Final (persistidos) ───────────────────────────

  private useIntro = true;
  private useFinal = true;

  private setupToggles(): void {
    // Carregar do localStorage
    const savedIntro = localStorage.getItem('gdrums-toggle-intro');
    const savedFinal = localStorage.getItem('gdrums-toggle-final');
    if (savedIntro !== null) this.useIntro = savedIntro === 'true';
    if (savedFinal !== null) this.useFinal = savedFinal === 'true';

    const introToggle = document.getElementById('toggleIntro');
    const finalToggle = document.getElementById('toggleFinal');

    // Aplicar estado inicial
    if (introToggle) introToggle.classList.toggle('active', this.useIntro);
    if (finalToggle) finalToggle.classList.toggle('active', this.useFinal);

    introToggle?.addEventListener('click', () => {
      this.useIntro = !this.useIntro;
      introToggle.classList.toggle('active', this.useIntro);
      localStorage.setItem('gdrums-toggle-intro', String(this.useIntro));
    });

    finalToggle?.addEventListener('click', () => {
      this.useFinal = !this.useFinal;
      finalToggle.classList.toggle('active', this.useFinal);
      localStorage.setItem('gdrums-toggle-final', String(this.useFinal));
    });
  }

  private setupFileOperations(): void {
    // Novo Projeto
    const newProjectBtn = document.getElementById('newProject');
    if (newProjectBtn) {
      newProjectBtn.addEventListener('click', async () => {
        const confirmed = await this.uiManager.showConfirm('Novo Projeto', 'Isso vai limpar o editor. Deseja continuar?');
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
          this.uiManager.showAlert('Novo projeto criado!');
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
            this.uiManager.showAlert('Projeto carregado!');
          } catch (error) {
            void error;
            this.uiManager.showAlert('Erro ao carregar projeto');
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
            this.uiManager.showAlert('Padrão carregado com sucesso!');
          } catch (error) {
            console.error('Error loading pattern:', error);
            this.uiManager.showAlert('Erro ao carregar padrão');
          }
        }
      });
    }

    // Clear Pattern
    const clearPatternBtn = document.getElementById('clearPattern');
    if (clearPatternBtn) {
      clearPatternBtn.addEventListener('click', () => {
        if (confirm('Tem certeza que deseja limpar o padrão atual?')) {
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
          this.uiManager.showAlert('Padrão limpo!');
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
        this.uiManager.showAlert('Lista de ritmos atualizada!');
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
    // Info pedal
    const pedalInfoBtn = document.getElementById('pedalInfoBtn');
    if (pedalInfoBtn) {
      pedalInfoBtn.addEventListener('click', () => {
        if (fabDropdown) fabDropdown.style.display = 'none';
        this.showPedalInfo();
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

    // Modo Show — toggle palco profissional
    const stageModeBtn = document.getElementById('stageModeBtn');
    if (stageModeBtn) {
      stageModeBtn.addEventListener('click', () => {
        if (fabDropdown) fabDropdown.style.display = 'none';
        this.enterStageMode();
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
          this.modalManager.show('Erro', 'Não foi possível abrir sua conta. Tente recarregar a página.', 'warning');
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
    const isStandalonePWA = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as any).standalone === true;
    if (menuInstallBtn) {
      // Sempre mostra se não-standalone (iOS, Android, desktop)
      menuInstallBtn.style.display = isStandalonePWA ? 'none' : '';

      menuInstallBtn.addEventListener('click', () => {
        const fabDropdown = document.getElementById('fabDropdown');
        if (fabDropdown) fabDropdown.style.display = 'none';

        if (this.installPrompt) {
          // Android/Desktop com prompt capturado — dispara nativo
          this.installPrompt.prompt();
          this.installPrompt.userChoice.then((choice: any) => {
            if (choice.outcome === 'accepted') {
              this.modalManager.show('App', 'App instalado com sucesso!', 'success');
              menuInstallBtn.style.display = 'none';
            }
            this.installPrompt = null;
          });
        } else {
          // iOS OU Android sem prompt disponível — tutorial manual
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
        modeLabel.textContent = 'Modo Admin';
      }

      adminModeToggle.addEventListener('change', (e) => {
        const isAdmin = (e.target as HTMLInputElement).checked;
        this.isAdminMode = isAdmin;

        if (isAdmin) {
          userMode.classList.remove('active');
          adminMode.classList.add('active');
          modeLabel.textContent = 'Modo Admin';
        } else {
          adminMode.classList.remove('active');
          userMode.classList.add('active');
          modeLabel.textContent = 'Modo Usuário';
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
        fillStartSelect.innerHTML = '<option value="">Nenhum</option>';
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
        fillReturnSelect.innerHTML = '<option value="">Nenhum</option>';
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
          testVariationBtn.innerHTML = '<span>Parar</span>';
        } else {
          testVariationBtn.innerHTML = '<span>Testar</span>';
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
          currentStepsDisplay.textContent = `${steps} steps`;
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
      currentStepsDisplay.textContent = `${steps} steps`;
    }
  }

  private selectVariationSlot(slotIndex: number): void {
    const patternType = this.stateManager.getEditingPattern();
    const maxSlots = patternType === 'end' ? 1 : 3;

    if (slotIndex >= maxSlots) {
      this.uiManager.showAlert(`O padrão ${patternType.toUpperCase()} permite apenas ${maxSlots} variações`);
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
      this.uiManager.showAlert('Nenhuma variação para testar neste slot');
      return;
    }

    // Verificar se há conteúdo na variação
    const hasContent = variation.pattern.some(row => row.some(step => step === true));
    if (!hasContent) {
      this.uiManager.showAlert('Esta variação está vazia');
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
      this.uiManager.showAlert(`${patternType.toUpperCase()} ${variationIndex + 1} não está disponível. Configure no modo Admin primeiro.`);
      return;
    }

    // Verificar se tem conteúdo
    const hasContent = variation.pattern.some(row => row.some(step => step === true));
    if (!hasContent) {
      this.uiManager.showAlert(`${patternType.toUpperCase()} ${variationIndex + 1} está vazio. Configure no modo Admin primeiro.`);
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
      <span class="x-stage-banner-label">Modo Show</span>
      <button class="x-stage-banner-exit" id="xStageExit" type="button">Sair</button>
    `;
    document.body.appendChild(banner);

    banner.querySelector('#xStageExit')?.addEventListener('click', () => this.exitStageMode());

    HapticsService.success();
    Toast.show('Modo Show ativo · tela não vai apagar', { type: 'success' });
  }

  private exitStageMode(): void {
    if (!document.body.classList.contains('stage-mode')) return;
    document.body.classList.remove('stage-mode');

    // Só libera sleep se não estiver tocando (scheduler também controla)
    if (!this.stateManager.isPlaying()) {
      KeepAwake.allowSleep().catch(() => { /* noop */ });
    }

    document.getElementById('xStageBanner')?.remove();
    HapticsService.light();
  }

  // Core methods
  private showPedalInfo(): void {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(2,2,12,0.85);backdrop-filter:blur(16px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem;';

    overlay.innerHTML = `
      <div style="background:rgba(10,10,30,0.95);border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:2rem;max-width:440px;width:100%;max-height:85vh;overflow-y:auto;">
        <h2 style="font-size:1.2rem;font-weight:700;color:#fff;margin:0 0 0.5rem;text-align:center;">Controles do Pedal</h2>
        <p style="font-size:0.75rem;color:rgba(255,255,255,0.3);text-align:center;margin:0 0 1.25rem;">Configure as setas do teclado no seu pedal</p>

        <div style="display:flex;flex-direction:column;gap:1rem;">
          <div style="background:rgba(139,92,246,0.06);border:1px solid rgba(139,92,246,0.2);border-radius:12px;padding:1rem;">
            <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:rgba(139,92,246,0.7);margin-bottom:0.5rem;">Pedal Esquerdo</div>
            <div style="font-size:0.8rem;color:rgba(255,255,255,0.5);line-height:1.7;">
              <strong style="color:#fff;">Parado:</strong> Inicia a música<br>
              <strong style="color:#fff;">1 toque:</strong> Faz virada e vai pro próximo ritmo<br>
              <strong style="color:#fff;">2 toques rápidos:</strong> Faz virada e volta pro ritmo anterior
            </div>
          </div>

          <div style="background:rgba(249,115,22,0.06);border:1px solid rgba(249,115,22,0.2);border-radius:12px;padding:1rem;">
            <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:rgba(249,115,22,0.7);margin-bottom:0.5rem;">Pedal Direito</div>
            <div style="font-size:0.8rem;color:rgba(255,255,255,0.5);line-height:1.7;">
              <strong style="color:#fff;">Parado:</strong> Toca prato<br>
              <strong style="color:#fff;">1 toque:</strong> Faz uma virada<br>
              <strong style="color:#fff;">2 toques rápidos:</strong> Finaliza e para a música
            </div>
          </div>

          <div style="background:rgba(0,212,255,0.05);border:1px solid rgba(0,212,255,0.15);border-radius:12px;padding:1rem;">
            <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:rgba(0,212,255,0.6);margin-bottom:0.5rem;">Configuração do Pedal BT</div>
            <div style="font-size:0.8rem;color:rgba(255,255,255,0.5);line-height:1.7;">
              <strong style="color:#fff;">M-VAVE / similares:</strong> Use o modo <strong style="color:var(--cyan,#00D4FF);">Left/Right</strong> (4º LED)<br>
              <strong style="color:#fff;">Outros pedais:</strong> Coloque no modo que emita setas (←→)<br>
              <strong style="color:#fff;">Não funciona?</strong> Vá em "Mapear pedal" e pise no pedal para ver o que ele envia. Use qualquer modo que o app detectar.
            </div>
          </div>

          <div style="background:rgba(0,230,140,0.05);border:1px solid rgba(0,230,140,0.15);border-radius:12px;padding:1rem;">
            <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:rgba(0,230,140,0.6);margin-bottom:0.5rem;">Dicas</div>
            <div style="font-size:0.8rem;color:rgba(255,255,255,0.5);line-height:1.7;">
              <strong style="color:#fff;">INTRO ligado:</strong> Toca contagem antes de iniciar<br>
              <strong style="color:#fff;">FINAL ligado:</strong> Toca finalização antes de parar<br>
              <strong style="color:#fff;">Desligados:</strong> Início e parada instantâneos
            </div>
          </div>
        </div>

        <button id="closePedalInfo" style="width:100%;margin-top:1.25rem;padding:0.7rem;border:none;border-radius:12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.6);font-size:0.85rem;font-weight:600;font-family:inherit;cursor:pointer;">Entendi</button>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => { overlay.remove(); (window as any).__refocusPedal?.(); };
    overlay.querySelector('#closePedalInfo')!.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  }

  private showPedalMapper(): void {
    const keyLabels: Record<string, string> = {
      // e.code values
      'ArrowLeft': 'Seta Esquerda', 'ArrowRight': 'Seta Direita',
      'ArrowUp': 'Seta Cima', 'ArrowDown': 'Seta Baixo',
      'Space': 'Espaco', 'Enter': 'Enter',
      'PageUp': 'Page Up', 'PageDown': 'Page Down',
      // e.key values (fallback iOS pedais BT)
      ' ': 'Espaco',
    };
    const getLabel = (code: string) => keyLabels[code] || code;

    let tempLeft = this.pedalLeft;
    let tempRight = this.pedalRight;
    let listening: 'left' | 'right' | null = null;

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(2,2,12,0.92);backdrop-filter:blur(20px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem;';

    const render = () => {
      overlay.innerHTML = `
        <div style="background:rgba(10,10,30,0.95);border:1px solid rgba(255,255,255,0.08);border-radius:24px;padding:2rem;max-width:400px;width:100%;">
          <h2 style="font-size:1.1rem;font-weight:700;color:#fff;margin:0 0 0.3rem;text-align:center;">Mapear Pedal</h2>
          <p style="font-size:0.65rem;color:rgba(255,255,255,0.3);text-align:center;margin:0 0 1.5rem;">Clique no pedal e pressione o botao do seu controlador</p>

          <div style="display:flex;gap:2rem;justify-content:center;margin-bottom:1.5rem;">
            <div style="text-align:center;">
              <div style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:rgba(139,92,246,0.6);margin-bottom:0.5rem;">Esquerdo</div>
              <button id="pedalLeftBtn" style="width:90px;height:120px;border-radius:16px;border:2px solid rgba(139,92,246,${listening === 'left' ? '0.8' : '0.3'});background:rgba(139,92,246,0.08);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.5rem;font-family:inherit;${listening === 'left' ? 'box-shadow:0 0 20px rgba(139,92,246,0.3);transform:scale(1.05);' : ''}">
                <div style="font-size:0.75rem;font-weight:700;color:rgba(139,92,246,0.9);background:rgba(139,92,246,0.15);padding:0.25rem 0.6rem;border-radius:8px;">${getLabel(tempLeft)}</div>
              </button>
              <div style="font-size:0.5rem;color:rgba(255,255,255,0.2);margin-top:0.5rem;line-height:1.4;">Parado: play<br>1x prox ritmo<br>2x anterior</div>
            </div>

            <div style="width:1px;background:rgba(255,255,255,0.05);"></div>

            <div style="text-align:center;">
              <div style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:rgba(249,115,22,0.6);margin-bottom:0.5rem;">Direito</div>
              <button id="pedalRightBtn" style="width:90px;height:120px;border-radius:16px;border:2px solid rgba(249,115,22,${listening === 'right' ? '0.8' : '0.3'});background:rgba(249,115,22,0.08);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.5rem;font-family:inherit;${listening === 'right' ? 'box-shadow:0 0 20px rgba(249,115,22,0.3);transform:scale(1.05);' : ''}">
                <div style="font-size:0.75rem;font-weight:700;color:rgba(249,115,22,0.9);background:rgba(249,115,22,0.15);padding:0.25rem 0.6rem;border-radius:8px;">${getLabel(tempRight)}</div>
              </button>
              <div style="font-size:0.5rem;color:rgba(255,255,255,0.2);margin-top:0.5rem;line-height:1.4;">Parado: prato<br>1x virada<br>2x finaliza</div>
            </div>
          </div>

          <div id="pedalStatus" style="text-align:center;font-size:0.7rem;color:rgba(255,255,255,0.2);min-height:1.5rem;margin-bottom:1rem;">${listening ? `Pressione a tecla para o pedal ${listening === 'left' ? 'esquerdo' : 'direito'}...` : ''}</div>

          <div style="display:flex;gap:0.5rem;">
            <button id="pedalReset" style="flex:1;padding:0.6rem;border:none;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.4);font-size:0.8rem;font-weight:600;font-family:inherit;cursor:pointer;">Resetar</button>
            <button id="pedalSave" style="flex:2;padding:0.6rem;border:none;border-radius:10px;background:rgba(0,230,140,0.12);border:1px solid rgba(0,230,140,0.25);color:rgba(0,230,140,0.9);font-size:0.8rem;font-weight:600;font-family:inherit;cursor:pointer;">Salvar</button>
          </div>
        </div>
      `;

      // Focar mapperInput SÍNCRONO no click (iOS exige user gesture pra focus)
      overlay.querySelector('#pedalLeftBtn')!.addEventListener('click', (ev) => {
        ev.stopPropagation(); listening = 'left'; render();
        mapperInput.focus({ preventScroll: true });
      });
      overlay.querySelector('#pedalRightBtn')!.addEventListener('click', (ev) => {
        ev.stopPropagation(); listening = 'right'; render();
        mapperInput.focus({ preventScroll: true });
      });

      overlay.querySelector('#pedalReset')!.addEventListener('click', () => {
        tempLeft = 'ArrowLeft'; tempRight = 'ArrowRight'; listening = null; render();
        mapperInput.focus({ preventScroll: true });
      });

      overlay.querySelector('#pedalSave')!.addEventListener('click', () => {
        this.pedalLeft = tempLeft;
        this.pedalRight = tempRight;
        localStorage.setItem('gdrums_pedal_keys', JSON.stringify({ left: tempLeft, right: tempRight }));
        close();
        this.modalManager.show('Pedal', 'Mapeamento salvo!', 'success');
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
    mapperInput.placeholder = 'Pise no pedal...';
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
      else tempRight = code;

      const statusEl = overlay.querySelector('#pedalStatus');
      if (statusEl) {
        statusEl.innerHTML = `<span style="color:rgba(0,230,140,0.8);">Mapeado! ${debugInfo}</span>`;
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
    // Não mostrar se já instalado
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
    if (isStandalone) return;

    // Não mostrar se já viu
    if (localStorage.getItem('gdrums_install_seen')) return;
    localStorage.setItem('gdrums_install_seen', '1');

    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
                  (/Mac/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(2,2,12,0.88);backdrop-filter:blur(16px);z-index:99999;display:flex;align-items:flex-end;justify-content:center;padding:1rem;';

    overlay.innerHTML = `
      <div style="background:rgba(10,10,30,0.97);border:1px solid rgba(255,255,255,0.08);border-radius:20px 20px 0 0;padding:1.5rem 1.5rem 2rem;max-width:400px;width:100%;animation:slideUp 0.3s ease-out;">
        <style>@keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}</style>
        <div style="text-align:center;margin-bottom:1rem;">
          <img src="/img/icon-192.png" alt="GDrums" style="width:56px;height:56px;border-radius:14px;margin-bottom:0.75rem;">
          <h2 style="font-size:1.1rem;font-weight:700;color:#fff;margin:0 0 0.25rem;">Instale o GDrums</h2>
          <p style="font-size:0.75rem;color:rgba(255,255,255,0.4);margin:0;">Acesso rapido, tela cheia e funciona offline</p>
        </div>

        ${isIOS ? `
        <div style="display:flex;flex-direction:column;gap:0.55rem;margin-bottom:1rem;">
          <div style="display:flex;align-items:center;gap:0.6rem;font-size:0.78rem;color:rgba(255,255,255,0.55);">
            <span style="width:22px;height:22px;border-radius:6px;background:rgba(0,212,255,0.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:0.68rem;font-weight:700;color:rgba(0,212,255,0.85);">1</span>
            Toque em <strong style="color:#fff;">Compartilhar</strong> <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(0,212,255,0.7)" stroke-width="2" style="flex-shrink:0;"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
          </div>
          <div style="display:flex;align-items:center;gap:0.6rem;font-size:0.78rem;color:rgba(255,255,255,0.55);">
            <span style="width:22px;height:22px;border-radius:6px;background:rgba(139,92,246,0.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:0.68rem;font-weight:700;color:rgba(139,92,246,0.85);">2</span>
            No menu do iOS, toque em <strong style="color:#fff;">Ver mais</strong> e role
          </div>
          <div style="display:flex;align-items:center;gap:0.6rem;font-size:0.78rem;color:rgba(255,255,255,0.55);">
            <span style="width:22px;height:22px;border-radius:6px;background:rgba(62,232,167,0.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:0.68rem;font-weight:700;color:rgba(62,232,167,0.9);">3</span>
            <strong style="color:#fff;">Adicionar à Tela de Início</strong>
          </div>
        </div>
        ` : `
        <div style="font-size:0.78rem;color:rgba(255,255,255,0.5);text-align:center;margin-bottom:1rem;">
          Toque em <strong style="color:#fff;">Instalar</strong> abaixo para adicionar a tela inicial
        </div>
        `}

        <div style="display:flex;gap:0.5rem;">
          <button id="installDismiss" style="flex:1;padding:0.65rem;border:none;border-radius:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.4);font-size:0.8rem;font-weight:600;font-family:inherit;cursor:pointer;">Agora nao</button>
          ${!isIOS && this.installPrompt ? `
          <button id="installAccept" style="flex:2;padding:0.65rem;border:none;border-radius:12px;background:rgba(0,212,255,0.15);border:1px solid rgba(0,212,255,0.3);color:rgba(0,212,255,0.9);font-size:0.8rem;font-weight:700;font-family:inherit;cursor:pointer;">Instalar App</button>
          ` : `
          <button id="installDismiss2" style="flex:2;padding:0.65rem;border:none;border-radius:12px;background:rgba(0,212,255,0.15);border:1px solid rgba(0,212,255,0.3);color:rgba(0,212,255,0.9);font-size:0.8rem;font-weight:700;font-family:inherit;cursor:pointer;">Entendi</button>
          `}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => { overlay.remove(); (window as any).__refocusPedal?.(); };
    overlay.querySelector('#installDismiss')?.addEventListener('click', close);
    overlay.querySelector('#installDismiss2')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

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
        { n: '01', body: 'Toque no botão <strong>Compartilhar</strong> na barra do Safari (ícone de caixa com seta pra cima).' },
        { n: '02', body: 'Vai abrir o menu do iOS. Toque em <strong>Ver mais</strong> e role até encontrar <strong>Adicionar à Tela de Início</strong>.' },
        { n: '03', body: 'Toque em <strong>Adicionar à Tela de Início</strong>.' },
        { n: '04', body: 'Confirme tocando em <strong>Adicionar</strong> no canto superior direito.' },
      ],
      'ios-chrome': [
        { n: '01', body: 'Toque no botão <strong>Compartilhar</strong> no canto direito da barra de endereço do Chrome.' },
        { n: '02', body: 'Vai abrir o menu do iOS. Toque em <strong>Ver mais</strong> e role até encontrar <strong>Adicionar à Tela de Início</strong>.' },
        { n: '03', body: 'Toque em <strong>Adicionar à Tela de Início</strong>.' },
        { n: '04', body: 'Confirme tocando em <strong>Adicionar</strong> no canto superior direito.' },
      ],
      'android': [
        { n: '01', body: 'Toque no menu <strong>⋮</strong> (três pontos) no canto superior do Chrome.' },
        { n: '02', body: 'Toque em <strong>Instalar aplicativo</strong> ou <strong>Adicionar à tela inicial</strong>.' },
        { n: '03', body: 'Confirme e o GDrums vai aparecer como app normal no seu celular.' },
      ],
    };

    const tabsDef = isIOS
      ? [
          { key: 'ios-safari' as TutKey, label: 'Safari' },
          { key: 'ios-chrome' as TutKey, label: 'Chrome' },
        ]
      : [
          { key: 'android' as TutKey, label: 'Chrome / Android' },
        ];

    const deviceLabel = isIOS ? 'no seu iPhone' : 'no seu celular';

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
          <button class="install-tut-close" aria-label="Fechar">×</button>
          <div class="install-tut-overline">Instalar o app</div>
          <h2 class="install-tut-title">Tenha o GDrums ${deviceLabel}.</h2>
          <p class="install-tut-body">
            O app fica na tela inicial como qualquer outro. Abre rápido,
            funciona offline e não precisa de loja.
          </p>
          ${renderTabs()}
          <ul class="install-tut-steps">${renderSteps()}</ul>
          <button class="install-tut-cta" id="installTutorialClose">Entendi</button>
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
    if (nameEl) nameEl.value = name || 'Novo Projeto';
    if (dotEl) {
      dotEl.classList.toggle('loaded', !!name);
    }
  }

  private togglePlayStop(): void {
    if (this.stateManager.isPlaying()) {
      if (this.useFinal) {
        this.patternEngine.playEndAndStop();
      } else {
        this.stop();
      }
    } else {
      if (!this.hasRhythmLoaded()) {
        this.modalManager.show(
          'Nenhum Ritmo Carregado',
          'Por favor, carregue um ritmo antes de iniciar a reprodução.',
          'warning'
        );
        return;
      }

      if (this.useIntro) {
        this.patternEngine.playIntroAndStart();
      } else {
        this.stateManager.setShouldPlayStartSound(true);
      }
      this.play();
    }
  }

  private playFillToPreviousRhythm(): void {
    const state = this.stateManager.getState();
    const availableRhythms = state.variations.main
      .map((v, index) => ({
        index,
        hasContent: v.pattern.some(row => row.some(step => step === true))
      }))
      .filter(r => r.hasContent);

    if (availableRhythms.length <= 1) return;

    const currentIndex = this.stateManager.getCurrentVariation('main');
    const currentPosition = availableRhythms.findIndex(r => r.index === currentIndex);
    const prevPosition = (currentPosition - 1 + availableRhythms.length) % availableRhythms.length;
    const prevVariation = availableRhythms[prevPosition].index;

    this.patternEngine.playFillToNextRhythm(prevVariation);
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

        // Se sum é 0, o iOS está em modo silencioso
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
        <h3 style="color:#fff;font-size:1.1rem;font-weight:700;margin:0 0 0.5rem;">Sem som?</h3>
        <p style="color:rgba(255,255,255,0.5);font-size:0.85rem;line-height:1.6;margin:0 0 1.25rem;">
          Verifique a <strong style="color:#FFB420;">chave de silencioso</strong> na lateral do seu iPhone.
          Ela precisa estar desativada (sem a faixa laranja visivel) para o som funcionar.
        </p>
        <div style="background:rgba(255,180,32,0.06);border:1px solid rgba(255,180,32,0.15);border-radius:10px;padding:0.75rem;margin-bottom:1.25rem;">
          <p style="color:rgba(255,255,255,0.4);font-size:0.75rem;margin:0;line-height:1.5;">
            Tambem verifique se o volume do aparelho nao esta no minimo.
          </p>
        </div>
        <button id="silentModeOk" style="width:100%;padding:0.75rem;border:none;border-radius:12px;background:linear-gradient(135deg,#FFB420,#F97316);color:#fff;font-size:0.9rem;font-weight:700;font-family:inherit;cursor:pointer;">Entendi</button>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => { overlay.remove(); (window as any).__refocusPedal?.(); };
    overlay.querySelector('#silentModeOk')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  private play(): void {
    // IMPORTANTE: resume() DEVE ser chamado sincronamente dentro do gesto do usuário.
    // No iOS, qualquer await antes do resume() quebra a cadeia de gesto
    // e o AudioContext fica permanentemente suspenso (mudo).
    this.audioManager.resume();

    this.stateManager.setPlaying(true);

    const activePattern = this.stateManager.getActivePattern();
    this.uiManager.updateStatusUI(activePattern);
    this.uiManager.updatePerformanceGrid();

    this.scheduler.start();

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
    this.stateManager.setPlaying(false);
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
    if (statusAdmin) statusAdmin.textContent = 'Parado';
    if (statusUser) statusUser.textContent = 'Parado';

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
      // Reiniciar animação: remover + reflow + readicionar classe
      this.countdownNumEl.classList.remove('countdown-animate');
      void this.countdownNumEl.offsetHeight;
      this.countdownNumEl.classList.add('countdown-animate');
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

      /* iOS Safari crashava com filter:drop-shadow + background-clip:text +
         animação simultânea — rendering em GPU surface estourava limite de
         textura no WebKit (mesmo em iPhone 16). Solução: text-shadow (CPU,
         sem inflar surface) + animar só transform/opacity (cheap, GPU compose). */
      .countdown-num {
        font-size: clamp(8rem, 30vw, 16rem);
        font-weight: 900;
        color: transparent;
        background: linear-gradient(135deg, #F97316 0%, #FF6B35 40%, #FFB020 100%);
        -webkit-background-clip: text;
        background-clip: text;
        line-height: 1;
        opacity: 0;
        transform: scale(0.5);
        text-shadow:
          0 0 30px rgba(249, 115, 22, 0.55),
          0 0 60px rgba(249, 115, 22, 0.25);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif;
        letter-spacing: -0.05em;
        will-change: transform, opacity;
      }

      .countdown-num.countdown-animate {
        animation: countdownPop 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }

      @keyframes countdownPop {
        0%   { opacity: 0;    transform: scale(0.4); }
        30%  { opacity: 1;    transform: scale(1.1); }
        60%  { opacity: 1;    transform: scale(1);   }
        100% { opacity: 0.15; transform: scale(0.95); }
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
      this.modalManager.show('Meus Ritmos', 'Carregue um ritmo antes de salvar.', 'warning');
      return;
    }

    // User em trial: salvar é feature do plano pago — bloqueia com modal de conversão
    if (this.conversionManager.tryFireSaveRhythm()) {
      return;
    }

    const currentBpm = this.stateManager.getTempo();
    // Auto-nome: "Vaneira · 21:42" ou "Meu ritmo · 21:42"
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const base = this.currentRhythmName || 'Meu ritmo';
    const suggestedName = `${base} · ${hh}:${mm}`;

    const overlay = document.createElement('div');
    overlay.className = 'x-overlay';
    overlay.innerHTML = `
      <div class="x-sheet" role="dialog" aria-label="Salvar ritmo">
        <div class="x-grip"></div>
        <div class="x-head">
          <div>
            <h2 class="x-head-title">Salvar ritmo</h2>
            <div class="x-head-sub">Crie sua versão com nome e BPM</div>
          </div>
          <button class="x-close" id="xSaveClose" aria-label="Fechar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div class="x-body">
          <div class="x-save-fields">
            <div class="x-save-field">
              <label for="xSaveName">Nome do ritmo</label>
              <input type="text" id="xSaveName" class="x-save-input" value="${suggestedName.replace(/"/g, '&quot;')}" maxlength="60" placeholder="Ex: Vaneira do João" autocomplete="off" />
              <div class="x-save-hint">Vai aparecer na sua lista de "Meus Ritmos"</div>
            </div>
            <div class="x-save-field">
              <label for="xSaveBpm">BPM</label>
              <input type="number" id="xSaveBpm" class="x-save-input x-save-input-bpm" value="${currentBpm}" min="40" max="240" inputmode="numeric" />
            </div>
          </div>
          <div class="x-save-actions">
            <button class="x-btn x-btn-ghost" id="xSaveCancel" type="button">Cancelar</button>
            <button class="x-btn x-btn-primary" id="xSaveConfirm" type="button">Salvar ritmo</button>
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
    const bpmInput = overlay.querySelector('#xSaveBpm') as HTMLInputElement;
    setTimeout(() => { nameInput.focus(); nameInput.select(); }, 50);

    const doSave = async (): Promise<void> => {
      const name = nameInput.value.trim();
      const bpm = parseInt(bpmInput.value);

      if (!name) {
        nameInput.focus();
        nameInput.style.borderColor = 'rgba(255, 107, 131, 0.5)';
        Toast.show('Dê um nome ao ritmo', { type: 'warn' });
        return;
      }
      if (isNaN(bpm) || bpm < 40 || bpm > 240) {
        bpmInput.focus();
        Toast.show('BPM precisa ser entre 40 e 240', { type: 'warn' });
        return;
      }

      const rhythmData = this.fileManager.exportProjectAsJSON();
      const isLibraryRhythm = this.availableRhythms.some(r => r.name === this.currentRhythmName);
      const baseRhythmName = isLibraryRhythm ? this.currentRhythmName : undefined;

      const saved = await this.userRhythmService.save(name, bpm, rhythmData, baseRhythmName);
      close();
      HapticsService.success();

      Toast.show(`"${name}" salvo`, {
        type: 'success',
        durationMs: 5000,
        action: {
          label: 'Renomear',
          onClick: () => this.renameRhythmInline(saved.id),
        },
      });
    };

    overlay.querySelector('#xSaveConfirm')?.addEventListener('click', doSave);
    // Enter em qualquer input salva
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSave(); });
    bpmInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSave(); });

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

      const showSearch = total > 5;

      const listHtml = filtered.length === 0
        ? (q
            ? `<div class="x-empty">
                 <svg class="x-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                 <div class="x-empty-title">Nada achado</div>
                 <div class="x-empty-desc">Tenta outro nome ou limpa a busca.</div>
               </div>`
            : `<div class="x-empty">
                 <svg class="x-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                 <div class="x-empty-title">Nenhum ritmo salvo</div>
                 <div class="x-empty-desc">Carregue um ritmo da biblioteca, ajuste do seu jeito e use o botão de salvar pra criar seu primeiro.</div>
               </div>`)
        : `<div class="x-rhythms-list">${
            filtered.map(r => `
              <div class="x-rhythm-card" data-id="${r.id}">
                <span class="x-rhythm-accent"></span>
                <div class="x-rhythm-body">
                  <div class="x-rhythm-name" data-name="${escapeHtml(r.name)}">${escapeHtml(r.name)}</div>
                  <div class="x-rhythm-meta">
                    <span class="x-rhythm-bpm">${r.bpm} BPM</span>
                    ${r.base_rhythm_name ? `<span class="x-rhythm-meta-dot"></span><span class="x-rhythm-base">baseado em ${escapeHtml(r.base_rhythm_name)}</span>` : ''}
                    ${!r.synced ? `<span class="x-rhythm-meta-dot"></span><span class="x-rhythm-pending">pendente sync</span>` : ''}
                  </div>
                </div>
                <div class="x-rhythm-actions">
                  <button class="x-rhythm-action" data-rename="${r.id}" aria-label="Renomear">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                  </button>
                  <button class="x-rhythm-action danger" data-delete="${r.id}" aria-label="Deletar">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                  </button>
                </div>
              </div>
            `).join('')
          }</div>`;

      overlay.innerHTML = `
        <div class="x-sheet" role="dialog" aria-label="Meus Ritmos">
          <div class="x-grip"></div>
          <div class="x-head">
            <div>
              <h2 class="x-head-title">Meus Ritmos</h2>
              <div class="x-head-sub">${total === 0 ? 'Nada salvo ainda' : `${total} ritmo${total !== 1 ? 's' : ''} ${total !== 1 ? 'salvos' : 'salvo'}`}</div>
            </div>
            <button class="x-close" id="xMyRhClose" aria-label="Fechar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <div class="x-body">
            ${showSearch ? `
              <div class="x-search-wrap">
                <div class="x-search-input-wrap">
                  <svg class="x-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input type="text" class="x-search-input" id="xMyRhSearch" placeholder="Buscar no meu acervo..." value="${escapeHtml(searchQuery)}" autocomplete="off" />
                  <button class="x-search-clear ${searchQuery ? 'visible' : ''}" id="xMyRhSearchClear" aria-label="Limpar busca">
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
          // Ignora cliques nos botões de ação ou em inputs de rename
          if (target.closest('.x-rhythm-action, .x-rhythm-name-input')) return;
          const id = card.dataset.id!;
          const rhythm = this.userRhythmService.getById(id);
          if (!rhythm) return;
          this.loadUserRhythm(rhythm.name, rhythm.bpm, rhythm.rhythm_data);
          close();
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
              Toast.show(`"${newName}" salvo`, { type: 'success' });
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

      // Deletar com undo
      overlay.querySelectorAll<HTMLElement>('[data-delete]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = btn.dataset.delete!;
          const rhythm = this.userRhythmService.getById(id);
          if (!rhythm) return;

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

          Toast.show(`"${snapshot.name}" deletado`, {
            type: 'info',
            durationMs: 5000,
            action: {
              label: 'Desfazer',
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
  }

  private async loadUserRhythm(name: string, bpm: number, rhythmData: any): Promise<void> {
    try {
      if (this.stateManager.isPlaying()) this.stop();

      await this.fileManager.loadProjectFromData(rhythmData);
      this.stateManager.setTempo(bpm);
      this.currentRhythmOriginalBpm = bpm;

      const patternType = this.stateManager.getEditingPattern();
      this.stateManager.loadVariation(patternType, 0);

      this.updateMIDISelectorsFromState();
      this.updateSpecialSoundsSelectors();
      this.updateBeatsPerBarUI();
      this.uiManager.refreshGridDisplay();
      this.uiManager.updateVariationButtons();

      this.currentRhythmName = name;
      const nameEl = document.getElementById('currentRhythmName');
      if (nameEl) nameEl.textContent = name;

      this.updateRhythmStripActive();

      // Mostrar botão de salvar
      const saveBtn = document.getElementById('saveAsMyRhythmBtn');
      if (saveBtn) saveBtn.style.display = 'flex';

      this.modalManager.show('Meus Ritmos', `${name} carregado!`, 'success');
    } catch (err) {
      this.modalManager.show('Erro', 'Não foi possível carregar o ritmo.', 'error');
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
          <div class="account-name">Atualize seu WhatsApp</div>
          <div class="account-email" style="max-width:280px;">Precisamos do seu número para enviar novidades e suporte. Leva 5 segundos.</div>
        </div>

        <div style="padding:0 0.5rem;">
          <input type="tel" id="phoneModalInput" class="account-password-input" placeholder="(00) 00000-0000" inputmode="tel" maxlength="15" style="text-align:center;font-size:1.1rem;margin-bottom:0.5rem;" />
          <div id="phoneModalStatus" style="font-size:0.72rem;min-height:1rem;text-align:center;"></div>
          <button id="phoneModalSave" class="account-action-btn" style="margin-top:0.5rem;">Salvar</button>
          <button id="phoneModalSkip" style="width:100%;background:none;border:none;color:rgba(255,255,255,0.2);font-size:0.72rem;font-family:inherit;cursor:pointer;padding:0.6rem 0;margin-top:0.25rem;">Depois</button>
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
        statusEl.textContent = 'Número inválido';
        statusEl.style.color = '#FF4466';
        return;
      }

      statusEl.textContent = 'Salvando...';
      statusEl.style.color = 'rgba(255,255,255,0.4)';

      const { supabase } = await import('./auth/supabase');
      const { error } = await supabase
        .from('gdrums_profiles')
        .update({ phone })
        .eq('id', userId);

      if (error) {
        statusEl.textContent = 'Erro ao salvar. Tente novamente.';
        statusEl.style.color = '#FF4466';
      } else {
        statusEl.textContent = 'Salvo!';
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
      <div class="x-sheet" role="dialog" aria-label="Ajustar BPM">
        <div class="x-grip"></div>
        <div class="x-head">
          <div>
            <h2 class="x-head-title">BPM · Tap Tempo</h2>
            <div class="x-head-sub">Toque no pad no ritmo da música</div>
          </div>
          <button class="x-close" id="xBpmClose" aria-label="Fechar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div class="x-body">
          <div class="x-tap-wrap">
            <div class="x-tap-display">
              <div class="x-tap-bpm" id="xBpmValue">${currentBpm}</div>
              <div class="x-tap-unit">BPM</div>
            </div>

            <button class="x-tap-pad" id="xTapPad" type="button" aria-label="Tocar no ritmo">
              TAP
            </button>

            <div class="x-tap-hint" id="xTapHint">Toque 2 vezes no ritmo pra calcular</div>

            <div class="x-tap-nudge">
              <button class="x-tap-nudge-btn" data-nudge="-5" aria-label="Diminuir 5 BPM">−5</button>
              <button class="x-tap-nudge-btn" data-nudge="-1" aria-label="Diminuir 1 BPM">−1</button>
              <input type="number" class="x-tap-nudge-input" id="xBpmInput" min="40" max="240" inputmode="numeric" value="${currentBpm}" aria-label="BPM" />
              <button class="x-tap-nudge-btn" data-nudge="1" aria-label="Aumentar 1 BPM">+1</button>
              <button class="x-tap-nudge-btn" data-nudge="5" aria-label="Aumentar 5 BPM">+5</button>
            </div>

            <input type="range" class="x-tap-slider" id="xBpmSlider" min="40" max="240" value="${currentBpm}" aria-label="Ajuste fino do BPM" />

            ${this.currentRhythmOriginalBpm > 0 && currentBpm !== this.currentRhythmOriginalBpm
              ? `<button class="x-tap-restore" id="xBpmRestore">Restaurar ${this.currentRhythmOriginalBpm} BPM</button>`
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
      hintEl.innerHTML = 'Toque 2 vezes no ritmo pra calcular';
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
        hintEl.innerHTML = 'Continue tocando — mais <strong>1 tap</strong>';
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
          ? `<strong>${bpm}</strong> BPM · ${taps} taps`
          : `<strong>${bpm}</strong> BPM · continue pra afinar`;
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
      this.modalManager.show('Sessão expirada', 'Entre novamente pra acessar sua conta.', 'warning');
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
    const planName = currentPlan?.displayName || (planId === 'trial' ? 'Teste Grátis' : planId);

    // Status formatado
    const statusMap: Record<string, { label: string; color: string }> = {
      active: { label: 'Ativo', color: '#00E68C' },
      trial: { label: 'Teste Grátis', color: '#FFB420' },
      expired: { label: 'Expirado', color: '#FF4466' },
      canceled: { label: 'Cancelado', color: '#FF4466' },
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
        daysText = `${daysLeft} dia${daysLeft !== 1 ? 's' : ''} restante${daysLeft !== 1 ? 's' : ''}`;
      } else {
        daysText = 'Expirado';
      }
    }

    // Barra de progresso (% consumida do plano)
    let progressPercent = 0;
    if (currentPlan && expiresAt) {
      const totalDays = currentPlan.durationMonths * 30;
      const elapsed = totalDays - daysLeft;
      progressPercent = Math.min(100, Math.max(0, (elapsed / totalDays) * 100));
    }

    // ─── Upgrade: calcular crédito e planos disponíveis ─────────────

    let upgradeCredit = 0;
    let upgradeAvailable = false;
    const planOrder = ['mensal', 'trimestral', 'semestral', 'anual', 'rei-dos-palcos'];

    if (status === 'active' && currentPlan && daysLeft > 0) {
      const totalDays = currentPlan.durationMonths * 30;
      upgradeCredit = Math.round(currentPlan.priceCents * (daysLeft / totalDays));
      const currentIdx = planOrder.indexOf(planId);
      upgradeAvailable = currentIdx < planOrder.length - 1;
    }

    // Botão de ação inteligente.
    // App nativo: rótulos mudam pra indicar abertura no site (Google Play / App
    // Store exige que pagamento aconteça fora do WebView).
    const native = isNativeApp();
    let actionBtn = '';
    if (status === 'expired' || status === 'canceled') {
      const label = native ? 'Renovar no site' : 'Renovar Assinatura';
      actionBtn = `<button class="account-action-btn" id="accountActionBtn">${label}</button>`;
    } else if (status === 'trial') {
      const label = native ? 'Assinar no site' : 'Assinar Agora';
      actionBtn = `<button class="account-action-btn" id="accountActionBtn">${label}</button>`;
    } else if (upgradeAvailable) {
      const label = native ? 'Fazer upgrade no site' : 'Fazer upgrade de plano';
      actionBtn = `<button class="account-action-btn account-action-upgrade" id="accountActionBtn">${label}</button>`;
    }

    // Verificar se já está instalado como PWA
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;

    // Montar modal
    const overlay = document.createElement('div');
    overlay.className = 'account-modal-overlay';
    overlay.innerHTML = `
      <div class="account-modal">
        <button class="account-modal-close" id="accountModalClose">&times;</button>
        <div class="account-header">
          <div class="account-avatar">${(name || email).charAt(0).toUpperCase()}</div>
          <div class="account-name">${name || 'Usuário'}</div>
          <div class="account-email">${email}</div>
        </div>

        <div class="account-card">
          <div class="account-row">
            <span class="account-label">Plano</span>
            <span class="account-value">${planName}</span>
          </div>
          <div class="account-row">
            <span class="account-label">Status</span>
            <span class="account-status" style="color:${statusInfo.color}">${statusInfo.label}</span>
          </div>
          ${expiresAt ? `
          <div class="account-row">
            <span class="account-label">Expira em</span>
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
            <span class="account-label">Membro desde</span>
            <span class="account-value">${memberSince}</span>
          </div>
        </div>

        ${actionBtn ? `<div class="account-actions">${actionBtn}</div>` : ''}

        <div class="account-password-section">
          <button class="account-password-toggle" id="accountPasswordToggle">Alterar senha</button>
          <div class="account-password-form" id="accountPasswordForm" style="display:none;">
            <input type="password" class="account-password-input" id="accountNewPassword" placeholder="Nova senha (mín. 6 caracteres)" minlength="6" />
            <input type="password" class="account-password-input" id="accountConfirmPassword" placeholder="Confirmar nova senha" minlength="6" />
            <div class="account-password-status" id="accountPasswordStatus"></div>
            <button class="account-password-save" id="accountPasswordSave">Salvar nova senha</button>
          </div>
        </div>

        <!-- Excluir conta — obrigatório pelo Google Play (desde 2023) e App Store -->
        <div style="margin-top:1.25rem;padding-top:1.25rem;border-top:1px solid rgba(255,255,255,0.05);">
          <button id="accountDeleteToggle" style="
            width:100%;padding:0.6rem;border:none;border-radius:10px;
            background:transparent;
            color:rgba(255,68,102,0.6);font-size:0.75rem;font-weight:600;
            font-family:inherit;cursor:pointer;text-align:center;
          ">Excluir minha conta</button>
          <div id="accountDeleteConfirm" style="display:none;margin-top:0.75rem;padding:0.85rem;background:rgba(255,68,102,0.06);border:1px solid rgba(255,68,102,0.2);border-radius:10px;">
            <p style="color:rgba(255,255,255,0.7);font-size:0.78rem;line-height:1.5;margin:0 0 0.5rem;">
              <strong style="color:#FF4466;">Esta ação é irreversível.</strong>
              Seus ritmos pessoais, favoritos e dados de cadastro serão apagados. Você não poderá recuperar a conta depois.
            </p>
            <p style="color:rgba(255,255,255,0.4);font-size:0.7rem;line-height:1.4;margin:0 0 0.75rem;">
              Se você tem assinatura ativa, ela não é automaticamente cancelada — fale conosco pelo WhatsApp pra solicitar reembolso se aplicável.
            </p>
            <div id="accountDeleteStatus" style="font-size:0.72rem;min-height:1rem;margin-bottom:0.5rem;text-align:center;"></div>
            <div style="display:flex;gap:0.5rem;">
              <button id="accountDeleteCancel" style="
                flex:1;padding:0.55rem;border:none;border-radius:8px;
                background:rgba(255,255,255,0.05);
                border:1px solid rgba(255,255,255,0.08);
                color:rgba(255,255,255,0.55);font-size:0.75rem;font-weight:600;
                font-family:inherit;cursor:pointer;
              ">Cancelar</button>
              <button id="accountDeleteConfirmBtn" style="
                flex:1.3;padding:0.55rem;border:none;border-radius:8px;
                background:#FF4466;color:#fff;
                font-size:0.75rem;font-weight:700;
                font-family:inherit;cursor:pointer;
              ">Excluir para sempre</button>
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
            this.modalManager.show('App', 'App instalado com sucesso!', 'success');
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
        toggle.textContent = 'Cancelar';
        toggle.classList.add('cancel');
      } else {
        form.style.display = 'none';
        toggle.textContent = 'Alterar senha';
        toggle.classList.remove('cancel');
      }
    });

    // Salvar nova senha
    overlay.querySelector('#accountPasswordSave')?.addEventListener('click', async () => {
      const newPass = (overlay.querySelector('#accountNewPassword') as HTMLInputElement).value;
      const confirmPass = (overlay.querySelector('#accountConfirmPassword') as HTMLInputElement).value;
      const statusEl = overlay.querySelector('#accountPasswordStatus') as HTMLElement;

      if (!newPass || newPass.length < 6) {
        statusEl.textContent = 'A senha deve ter pelo menos 6 caracteres';
        statusEl.style.color = 'var(--adm-red, #FF4466)';
        return;
      }
      if (newPass !== confirmPass) {
        statusEl.textContent = 'As senhas não coincidem';
        statusEl.style.color = 'var(--adm-red, #FF4466)';
        return;
      }

      statusEl.textContent = 'Salvando...';
      statusEl.style.color = 'rgba(255,255,255,0.4)';

      const { error } = await supabase.auth.updateUser({ password: newPass });

      if (error) {
        statusEl.textContent = error.message || 'Erro ao alterar senha';
        statusEl.style.color = 'var(--adm-red, #FF4466)';
      } else {
        statusEl.textContent = 'Senha alterada com sucesso!';
        statusEl.style.color = 'var(--adm-green, #00E68C)';
        (overlay.querySelector('#accountNewPassword') as HTMLInputElement).value = '';
        (overlay.querySelector('#accountConfirmPassword') as HTMLInputElement).value = '';
        setTimeout(() => {
          const form = overlay.querySelector('#accountPasswordForm') as HTMLElement;
          const toggle = overlay.querySelector('#accountPasswordToggle') as HTMLElement;
          form.style.display = 'none';
          toggle.textContent = 'Alterar senha';
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
      statusEl.textContent = 'Excluindo conta...';
      statusEl.style.color = 'rgba(255,255,255,0.5)';

      try {
        // Chama RPC que limpa dados pessoais + marca profile como deletado
        const { error } = await supabase.rpc('delete_my_account');
        if (error) throw error;

        statusEl.textContent = 'Conta excluída. Até mais!';
        statusEl.style.color = '#00E68C';

        // Logout + redirect pro login
        setTimeout(async () => {
          const { authService } = await import('./auth/AuthService');
          await authService.logout();
        }, 1200);
      } catch (e: any) {
        statusEl.textContent = 'Erro ao excluir. Tente novamente ou contate o suporte.';
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
          openExternal(PLANS_URL_EXTERNAL);
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
            <span style="font-size:0.9rem;font-weight:700;color:#fff;">${plan.displayName}${plan.durationMonths >= 36 ? ' — 3 Anos' : ''}</span>
            <span style="font-size:0.65rem;color:rgba(255,255,255,0.3);">R$ ${perMonth}/mês</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:0.2rem;font-size:0.72rem;color:rgba(255,255,255,0.5);margin-bottom:0.6rem;">
            <div style="display:flex;justify-content:space-between;">
              <span>Valor do plano</span>
              <span>R$ ${originalDisplay}</span>
            </div>
            ${credit > 0 ? `<div style="display:flex;justify-content:space-between;color:#00E68C;">
              <span>Crédito (${daysLeft}d restantes)</span>
              <span>- R$ ${creditDisplay}</span>
            </div>` : ''}
            <div style="display:flex;justify-content:space-between;font-weight:700;color:#fff;font-size:0.82rem;padding-top:0.3rem;border-top:1px solid rgba(255,255,255,0.06);">
              <span>Você paga</span>
              <span>R$ ${totalDisplay}</span>
            </div>
          </div>
          <button class="account-action-btn" data-upgrade-plan="${plan.id}" data-upgrade-price="${finalPrice}" style="font-size:0.8rem;padding:0.6rem;">Fazer upgrade</button>
        </div>
      `;
    }).join('');

    overlay.innerHTML = `
      <div class="account-modal" style="max-width:420px;max-height:85vh;overflow-y:auto;">
        <button class="account-modal-close" id="upgradeClose">&times;</button>
        <div class="account-header">
          <div class="account-name">Upgrade de plano</div>
          <div class="account-email">Escolha o plano que deseja migrar</div>
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
        statusEl.textContent = 'Gerando checkout...';
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
            statusEl.textContent = result.error || 'Erro ao gerar pagamento';
            statusEl.style.color = '#FF4466';
            overlay.querySelectorAll('[data-upgrade-plan]').forEach(b => {
              (b as HTMLButtonElement).disabled = false;
              (b as HTMLElement).style.opacity = '1';
            });
          }
        } catch (e) {
          statusEl.textContent = 'Erro ao processar. Tente novamente.';
          statusEl.style.color = '#FF4466';
          overlay.querySelectorAll('[data-upgrade-plan]').forEach(b => {
            (b as HTMLButtonElement).disabled = false;
            (b as HTMLElement).style.opacity = '1';
          });
        }
      });
    });
  }

  private playCymbal(): void {
    // Resume síncrono — essencial para iOS (não pode ter await antes)
    this.audioManager.resume();

    // Buffer já foi pré-carregado no init(). Se ainda não carregou, ignorar.
    if (this.cymbalBuffer) {
      const currentTime = this.audioManager.getCurrentTime();
      this.audioManager.playSound(this.cymbalBuffer, currentTime, 1.0);

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
        <label>Volume: <span id="volumeValue">${Math.round(currentVolume * 100)}%</span></label>
        <div class="volume-presets">
          <button class="preset-btn" data-volume="20">Ghost</button>
          <button class="preset-btn" data-volume="50">Médio</button>
          <button class="preset-btn" data-volume="80">Alto</button>
          <button class="preset-btn" data-volume="100">Max</button>
        </div>
        <input type="range" id="volumeSlider" min="0" max="100" value="${currentVolume * 100}" step="1">

        <label style="margin-top:0.8rem;display:block;">Groove: <span id="offsetValue">${currentOffset > 0 ? '+' : ''}${Math.round(currentOffset * 100)}%</span></label>
        <div class="volume-presets">
          <button class="preset-btn" data-offset="-50">←½</button>
          <button class="preset-btn" data-offset="-25">←¼</button>
          <button class="preset-btn" data-offset="0">0</button>
          <button class="preset-btn" data-offset="25">¼→</button>
          <button class="preset-btn" data-offset="50">½→</button>
        </div>
        <input type="range" id="offsetSlider" min="-50" max="50" value="${currentOffset * 100}" step="1">
        <div style="font-size:0.7rem;color:rgba(255,255,255,0.4);text-align:center;margin-top:0.3rem;">
          Adianta ou atrasa em até meio step
        </div>

        <button class="volume-close">Fechar</button>
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
      this.uiManager.showAlert('Erro ao carregar arquivo MIDI');
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
      this.uiManager.showAlert('Erro ao carregar arquivo de áudio');
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
      this.uiManager.showAlert('Ritmo carregado com sucesso!');

      // Resetar selects para permitir re-seleção do mesmo ritmo
      const rhythmSelect = document.getElementById('rhythmSelect') as HTMLSelectElement;
      const rhythmSelectUser = document.getElementById('rhythmSelectUser') as HTMLSelectElement;
      if (rhythmSelect) rhythmSelect.value = '';
      if (rhythmSelectUser) rhythmSelectUser.value = '';
    } catch (error) {
      console.error('Error loading rhythm:', error);
      this.uiManager.showAlert('Erro ao carregar ritmo');
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

          select.innerHTML = '<option value="">Selecione...</option>';

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
      if (item.baseRhythmName) metaParts.push(`base: ${escapeHtml(item.baseRhythmName)}`);
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
            ? '<span class="x-picker-now"><span class="x-picker-now-dot"></span>tocando</span>'
            : '<svg class="x-picker-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>'}
        </button>
      `;
    }).join('');

    overlay.innerHTML = `
      <div class="x-sheet" role="dialog" aria-label="Repertório">
        <div class="x-grip"></div>
        <div class="x-head">
          <div>
            <h2 class="x-head-title">Repertório</h2>
            <div class="x-head-sub">${items.length} ritmo${items.length !== 1 ? 's' : ''} · toque pra pular</div>
          </div>
          <button class="x-close" id="xPickerClose" aria-label="Fechar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div class="x-body x-picker-body-wrap">
          <div class="x-picker-list">${rows}</div>
        </div>

        <div class="x-picker-foot">
          <button class="x-btn x-btn-ghost x-btn-full" id="xPickerEditBtn" type="button">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            Editar repertório
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

    // Sempre carregar o ritmo da posição atual ao fechar o editor
    const current = this.setlistManager.getCurrentItem();
    if (current) {
      if (this.stateManager.isPlaying()) this.stop();
      await this.loadSetlistItem(current);
    }
  }

  private async navigateSetlist(direction: 'next' | 'previous'): Promise<void> {
    const item = direction === 'next'
      ? this.setlistManager.next()
      : this.setlistManager.previous();

    if (!item) return;

    if (this.stateManager.isPlaying()) {
      this.stop();
    }

    await this.loadSetlistItem(item);
  }

  private async loadSetlistItem(item: { name: string; path: string; userRhythmId?: string }): Promise<void> {
    if (item.userRhythmId) {
      const rhythm = this.userRhythmService.getById(item.userRhythmId);
      if (rhythm) {
        await this.loadUserRhythm(rhythm.name, rhythm.bpm, rhythm.rhythm_data);
      } else {
        this.uiManager.showAlert(`Ritmo "${item.name}" não encontrado`);
      }
    } else {
      await this.loadRhythm(item.name, item.path);
    }
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
    if (this.setlistManager.isEmpty()) { metaEl.textContent = ''; return; }

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

    if (this.setlistManager.isEmpty()) {
      if (numEl) numEl.textContent = '#';
      if (positionEl) positionEl.textContent = '';
      if (nameEl) nameEl.textContent = 'Monte seus favoritos';
      if (metaEl) metaEl.textContent = '';
      if (prevNameEl) prevNameEl.textContent = '--';
      if (nextNameEl) nextNameEl.textContent = '--';
      if (prevBtn) { prevBtn.disabled = true; prevBtn.style.opacity = '0.25'; }
      if (nextBtn) { nextBtn.disabled = true; nextBtn.style.opacity = '0.25'; }
      if (stripCards) stripCards.style.display = 'flex';
      if (favBar) favBar.style.display = 'none';
      return;
    }

    if (stripCards) stripCards.style.display = 'none';
    // Usa empty string pra herdar o display do CSS (.fav-bar é grid)
    if (favBar) favBar.style.display = '';

    const idx = this.setlistManager.getCurrentIndex();
    const total = this.setlistManager.getLength();
    const current = this.setlistManager.getCurrentItem();
    const prev = this.setlistManager.getPreviousItem();
    const next = this.setlistManager.getNextItem();

    if (numEl) numEl.textContent = `${idx + 1}`;
    if (positionEl) positionEl.textContent = `de ${total}`;
    if (nameEl && current) nameEl.textContent = current.name;
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
  }

  // ─── Rhythm loading ─────────────────────────────────────────────────

  private availableRhythms: Array<{name: string, path: string, category: string}> = [];
  private rhythmCategories: Record<string, string[]> = {};
  private activeCategory: string = '';
  private rhythmStripQuery: string = '';
  private currentRhythmName: string = '';
  private currentRhythmOriginalBpm: number = 0; // BPM original do JSON do ritmo

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
        select.innerHTML = '<option value="">Selecione um ritmo...</option>';
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
            'Carregamos o Pop pra você começar. Escolha outro ritmo na lista abaixo 👇',
            'info'
          );
          localStorage.setItem(seenKey, '1');
        }, 800);
      }
    } catch {
      // Se Pop falhar, não trava o boot — só loga (tipicamente offline 1ª vez)
    }
  }

  private renderRhythmStrip(): void {
    const container = document.getElementById('rhythmStripCards');
    if (!container) return;

    container.innerHTML = '';

    // Normaliza pra busca fuzzy pt-BR (ignora acento e caixa)
    const norm = (s: string): string =>
      s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // ── Search input + chips de categoria ──
    const searchBar = document.createElement('div');
    searchBar.className = 'rhythm-strip-search';
    searchBar.innerHTML = `
      <div class="rhythm-strip-search-wrap">
        <svg class="rhythm-strip-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" class="rhythm-strip-search-input" placeholder="Buscar ritmo..." value="${this.rhythmStripQuery.replace(/"/g, '&quot;')}" autocomplete="off" />
        ${this.rhythmStripQuery ? '<button class="rhythm-strip-search-clear" aria-label="Limpar"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' : ''}
      </div>
    `;
    container.appendChild(searchBar);
    const searchInput = searchBar.querySelector('.rhythm-strip-search-input') as HTMLInputElement;
    searchInput.addEventListener('input', () => {
      this.rhythmStripQuery = searchInput.value;
      // Re-render só os cards + chips (mantém foco)
      const caret = searchInput.selectionStart;
      this.renderRhythmStrip();
      const newInput = document.querySelector('.rhythm-strip-search-input') as HTMLInputElement | null;
      if (newInput) {
        newInput.focus();
        if (caret !== null) newInput.setSelectionRange(caret, caret);
      }
    });
    searchBar.querySelector('.rhythm-strip-search-clear')?.addEventListener('click', () => {
      this.rhythmStripQuery = '';
      this.renderRhythmStrip();
    });

    // ── Filtros de categoria ──
    const categories = Object.keys(this.rhythmCategories).sort();
    if (categories.length > 0) {
      const filterBar = document.createElement('div');
      filterBar.className = 'rhythm-category-filters';

      // Botão "Todos"
      const allBtn = document.createElement('button');
      allBtn.className = 'rhythm-cat-btn' + (!this.activeCategory ? ' active' : '');
      allBtn.textContent = 'Todos';
      allBtn.addEventListener('click', () => {
        this.activeCategory = '';
        this.renderRhythmStrip();
      });
      filterBar.appendChild(allBtn);

      categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'rhythm-cat-btn' + (this.activeCategory === cat ? ' active' : '');
        btn.textContent = cat;
        btn.addEventListener('click', () => {
          this.activeCategory = cat;
          this.renderRhythmStrip();
        });
        filterBar.appendChild(btn);
      });

      container.appendChild(filterBar);
    }

    // ── Cards de ritmos (filtrados) ──
    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'rhythm-cards-wrap';

    const query = norm(this.rhythmStripQuery.trim());
    let filtered = this.activeCategory
      ? this.availableRhythms.filter(r => r.category === this.activeCategory)
      : this.availableRhythms;
    if (query) {
      filtered = filtered.filter(r => norm(r.name).includes(query));
    }

    filtered.forEach(rhythm => {
      const card = document.createElement('button');
      card.className = 'rhythm-card-btn';
      if (rhythm.name === this.currentRhythmName) {
        card.classList.add('active');
      }
      card.setAttribute('data-rhythm-path', rhythm.path);
      card.textContent = rhythm.name;

      card.addEventListener('click', async () => {
        await this.loadRhythm(rhythm.name, rhythm.path);
      });

      cardsWrap.appendChild(card);
    });

    if (filtered.length === 0) {
      cardsWrap.innerHTML = query
        ? `<span class="rhythm-strip-empty">Nada achado pra "${this.rhythmStripQuery}"</span>`
        : '<span class="rhythm-strip-empty">Nenhum ritmo nesta categoria</span>';
    }

    container.appendChild(cardsWrap);
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

  private async loadRhythm(name: string, path: string): Promise<void> {
    if (this.isLoadingRhythm) return;
    this.isLoadingRhythm = true;

    const loader = this.showRhythmLoader(name);

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
      this.uiManager.showAlert(`Erro ao carregar ritmo "${name}"`);
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
        const t = typeSelect.value;
        slotSelect.innerHTML = '';
        const max = (t === 'end' || t === 'intro') ? 1 : 3;
        for (let i = 0; i < max; i++) {
          const o = document.createElement('option');
          o.value = String(i);
          o.textContent = `Var ${i + 1}`;
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
      this.uiManager.showAlert('Selecione um ritmo para duplicar.');
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
        this.uiManager.showAlert('A variação selecionada não existe ou não tem padrão.');
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

      this.uiManager.showAlert(`Copiado para ${targetPatternType.toUpperCase()} Var ${targetSlot + 1}!`);
    } catch (error) {
      console.error('Erro ao duplicar variação:', error);
      this.uiManager.showAlert('Erro ao duplicar variação do ritmo.');
    }
  }

  private populateDuplicateRhythmSelect(): void {
    const select = document.getElementById('duplicateRhythmSelect') as HTMLSelectElement;
    if (!select) return;

    select.innerHTML = '<option value="">Selecione um ritmo...</option>';

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
      this.uiManager.showAlert('Selecione um ritmo para clonar.');
      return;
    }

    if (this.stateManager.isPlaying()) this.stop();

    try {
      await this.fileManager.loadProjectFromPath(select.value);
      const rhythmName = select.options[select.selectedIndex].textContent || 'Projeto';

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

      this.updateProjectBar(rhythmName + ' (cópia)');
      this.uiManager.showAlert(`"${rhythmName}" clonado! Edite e salve.`);
    } catch {
      this.uiManager.showAlert('Erro ao clonar ritmo.');
    }
  }

  private async duplicateCurrentSlot(): Promise<void> {
    const patternType = this.stateManager.getEditingPattern();
    const currentSlot = this.stateManager.getCurrentVariation(patternType);
    const state = this.stateManager.getState();
    const source = state.variations[patternType][currentSlot];

    if (!source || !source.pattern.some(row => row.some(s => s))) {
      this.uiManager.showAlert('Slot atual está vazio.');
      return;
    }

    const maxSlots = (patternType === 'end' || patternType === 'intro') ? 1 : 3;
    if (maxSlots <= 1) {
      this.uiManager.showAlert('Este padrão só tem uma variação.');
      return;
    }

    // Copiar para o próximo slot (ex: virada 1 -> virada 2).
    const targetSlot = (currentSlot + 1) % maxSlots;
    const destination = state.variations[patternType][targetSlot];
    const destinationHasData = !!destination?.pattern?.some(row => row.some(s => s));
    if (destinationHasData) {
      this.uiManager.showAlert('O slot de destino já tem conteúdo. Ele será sobrescrito.');
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

    this.uiManager.showAlert(`Copiado para ${patternType.toUpperCase()} Var ${targetSlot + 1}. Edite à vontade!`);
  }

  private populateCloneRhythmSelect(): void {
    const select = document.getElementById('cloneRhythmSelect') as HTMLSelectElement;
    if (!select) return;

    select.innerHTML = '<option value="">Selecione um ritmo...</option>';
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
  // Captura de atribuição — cobre o caso do cara entrar em gdrums.com.br?ref=LUCAS10
  // diretamente na home do app (sem passar por landing/demo/register).
  // Se ele já é user logado, o ref sobrescreve atribuição antiga (intenção comercial clara).
  AttributionService.init();
  new RhythmSequencer();
  void 0; // initialized
});
