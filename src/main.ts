// Entry point principal - GSOM Rhythm Sequencer

import { StateManager } from './core/StateManager';
import { AudioManager } from './core/AudioManager';
import { Scheduler } from './core/Scheduler';
import { PatternEngine } from './core/PatternEngine';
import { FileManager } from './io/FileManager';
import { UIManager } from './ui/UIManager';
import { ModalManager } from './ui/ModalManager';
import { SetlistManager } from './core/SetlistManager';
import { SetlistEditorUI } from './ui/SetlistEditorUI';
import { MAX_CHANNELS, type PatternType, type SequencerState } from './types';
import { expandPattern, expandVolumes, normalizeMidiPath } from './utils/helpers';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { HapticsService } from './native/HapticsService';
import { OfflineCache } from './native/OfflineCache';
import { StatusBarService } from './native/StatusBarService';
import { PushService } from './native/PushService';

class RhythmSequencer {
  private audioContext: AudioContext;
  private stateManager: StateManager;
  private audioManager: AudioManager;
  private scheduler: Scheduler;
  private patternEngine: PatternEngine;
  private fileManager: FileManager;
  private uiManager: UIManager;
  private modalManager: ModalManager;
  private setlistManager: SetlistManager;
  private setlistEditor: SetlistEditorUI;
  private isAdminMode = false;
  private userRole: 'user' | 'admin' = 'user';
  private rhythmVersion: number = 0;
  // Pedal fixo — esquerdo e direito
  private pedalLeft = 'ArrowLeft';
  private pedalRight = 'ArrowRight';

  constructor() {
    // Inicializar contexto de áudio
    this.audioContext = new AudioContext();

    // Inicializar gerenciadores
    this.stateManager = new StateManager();
    this.audioManager = new AudioManager(this.audioContext);
    this.patternEngine = new PatternEngine(this.stateManager);
    this.scheduler = new Scheduler(this.stateManager, this.audioManager, this.patternEngine);
    this.fileManager = new FileManager(this.stateManager, this.audioManager);
    this.uiManager = new UIManager(this.stateManager);
    this.modalManager = new ModalManager();
    this.setlistManager = new SetlistManager();
    this.setlistEditor = new SetlistEditorUI();

    // Setlist onChange — não atualizar UI automaticamente durante navegação
    // A UI é atualizada explicitamente após cada ação

    // Configurar callbacks
    this.setupCallbacks();

    // Inicializar serviços nativos (iOS/Android)
    StatusBarService.init();
    PushService.init();

    // Inicializar UI
    this.init();
  }

  private setupCallbacks(): void {
    // Resume AudioContext quando volta do background (evita estralos no mobile)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.stateManager.isPlaying()) {
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
    this.checkAccess().then(async (allowed) => {
      if (!allowed) return;

      // Inicializar favoritos — online: Supabase, offline: cache local
      try {
        const { supabase } = await import('./auth/supabase');
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          await this.setlistManager.initWithUser(session.user.id, supabase);
        }
      } catch {
        // Offline — setlist usa cache local automaticamente
      }

      // Limpar mapeamento antigo de pedal (agora é fixo)
      localStorage.removeItem('gdrums_pedal_map');

      this.generateChannelsHTML();
      this.setupEventListeners();
      this.setupSetlistUI();
      this.loadAvailableMidi();
      this.loadAvailableRhythms();
    });
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
      window.location.href = '/login.html';
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
      window.location.href = '/login.html';
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
      window.location.href = '/login.html';
      return false;
    }

    if (userError) {
      await supabase.auth.signOut();
      window.location.href = '/login.html';
      return false;
    }

    const { data: profile } = await supabase
      .from('gdrums_profiles')
      .select('role, subscription_status, subscription_expires_at, subscription_plan, active_session_id')
      .eq('id', session.user.id)
      .single();

    // Guardar role do usuário (vindo do banco, não do client)
    this.userRole = (profile?.role === 'admin') ? 'admin' : 'user';

    // Sessão única — verificar se este device é o ativo
    const localSessionId = localStorage.getItem('gdrums-session-id');
    if (profile?.active_session_id && localSessionId !== profile.active_session_id) {
      // Outra sessão está ativa — deslogar este device
      await supabase.auth.signOut();
      localStorage.clear();
      window.location.href = '/login.html';
      return false;
    }

    const status = profile?.subscription_status;
    const expires = profile?.subscription_expires_at;

    if ((status === 'active' || status === 'trial') && expires) {
      const expiresDate = new Date(expires);
      if (expiresDate > new Date()) {
        // Rotacionar session ID a cada acesso online (invalida sessões copiadas)
        const newSessionId = crypto.randomUUID();
        localStorage.setItem('gdrums-session-id', newSessionId);
        supabase.from('gdrums_profiles')
          .update({ active_session_id: newSessionId })
          .eq('id', session.user.id)
          .then(); // fire-and-forget

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

    if (pendingTx?.order_nsu) {
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

    window.location.href = '/plans.html';
    return false;
  }

  private showSubscriptionBanner(status: string, expires: Date, plan: string): void {
    if (status === 'active' && plan !== 'trial') return; // Assinante pago, sem banner

    const now = new Date();
    const hoursLeft = Math.max(0, Math.floor((expires.getTime() - now.getTime()) / (1000 * 60 * 60)));
    const minutesLeft = Math.max(0, Math.floor((expires.getTime() - now.getTime()) / (1000 * 60)) % 60);

    const banner = document.createElement('div');
    banner.className = 'trial-banner';

    if (hoursLeft <= 6) {
      banner.classList.add('trial-banner-urgent');
    }

    const timeText = hoursLeft > 0 ? `${hoursLeft}h ${minutesLeft}min` : `${minutesLeft}min`;

    banner.innerHTML = `
      <span class="trial-banner-text">
        ${status === 'trial' ? 'Teste grátis' : 'Seu plano'}: <strong>${timeText} restantes</strong>
      </span>
      <a href="/plans.html" class="trial-banner-btn">Assinar agora</a>
    `;

    document.body.appendChild(banner);

    // Injetar CSS
    if (!document.getElementById('trial-banner-css')) {
      const style = document.createElement('style');
      style.id = 'trial-banner-css';
      style.textContent = `
        .trial-banner {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          background: rgba(10, 10, 30, 0.9);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-top: 1px solid rgba(0, 212, 255, 0.15);
          padding: 0.6rem 1rem;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
          z-index: 9999;
          animation: bannerSlideUp 0.3s ease;
        }
        .trial-banner-urgent {
          border-top-color: rgba(255, 68, 68, 0.3);
          background: rgba(30, 5, 5, 0.9);
        }
        .trial-banner-text {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.6);
        }
        .trial-banner-text strong {
          color: #00D4FF;
        }
        .trial-banner-urgent .trial-banner-text strong {
          color: #FF6B6B;
        }
        .trial-banner-btn {
          font-size: 0.7rem;
          font-weight: 700;
          color: #fff;
          background: linear-gradient(135deg, #00D4FF, #8B5CF6);
          padding: 0.35rem 0.8rem;
          border-radius: 8px;
          text-decoration: none;
          white-space: nowrap;
          transition: all 0.15s;
        }
        .trial-banner-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0, 212, 255, 0.3);
        }
        @keyframes bannerSlideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `;
      document.head.appendChild(style);
    }
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

  private setupTempoControls(): void {
    // Controles do modo usuário
    const tempoUpUser = document.getElementById('tempoUpUser');
    const tempoDownUser = document.getElementById('tempoDownUser');

    if (tempoUpUser) {
      tempoUpUser.addEventListener('click', () => {
        const newTempo = Math.min(240, this.stateManager.getTempo() + 1);
        this.stateManager.setTempo(newTempo);
      });
    }

    if (tempoDownUser) {
      tempoDownUser.addEventListener('click', () => {
        const newTempo = Math.max(40, this.stateManager.getTempo() - 1);
        this.stateManager.setTempo(newTempo);
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
    let leftLastPress = 0;
    let leftTimeout: number | null = null;
    let rightLastPress = 0;
    let rightTimeout: number | null = null;

    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;

      // Space = Play/Pause
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        this.togglePlayStop();
        return;
      }

      if (e.repeat) return;

      // ─── ESQUERDO ─────────────────────────────────────────────────
      // Parado: 1x = play (com intro se ligada)
      // Tocando: 1x = virada + próximo ritmo, 2x = virada + ritmo anterior
      if (e.code === this.pedalLeft) {
        e.preventDefault();
        if (!this.stateManager.isPlaying()) {
          this.patternEngine.activateRhythm(0);
          if (this.useIntro) {
            this.patternEngine.playIntroAndStart();
          } else {
            this.stateManager.setShouldPlayStartSound(true);
          }
          this.play();
        } else {
          const now = Date.now();
          if (now - leftLastPress < 500 && leftLastPress > 0) {
            if (leftTimeout) { clearTimeout(leftTimeout); leftTimeout = null; }
            this.playFillToPreviousRhythm();
            leftLastPress = 0;
          } else {
            leftLastPress = now;
            if (leftTimeout) clearTimeout(leftTimeout);
            leftTimeout = window.setTimeout(() => {
              this.patternEngine.playFillToNextRhythm();
              leftTimeout = null;
            }, 500);
          }
        }
        return;
      }

      // ─── DIREITO ───────────────────────────────────────────────────
      // Parado: 1x = prato
      // Tocando: 1x = virada (volta pro mesmo ritmo), 2x = finalização
      if (e.code === this.pedalRight) {
        e.preventDefault();
        if (!this.stateManager.isPlaying()) {
          this.playCymbal();
        } else {
          const now = Date.now();
          if (now - rightLastPress < 500 && rightLastPress > 0) {
            if (rightTimeout) { clearTimeout(rightTimeout); rightTimeout = null; }
            if (this.useFinal) { this.patternEngine.playEndAndStop(); } else { this.stop(); }
            rightLastPress = 0;
          } else {
            rightLastPress = now;
            if (rightTimeout) clearTimeout(rightTimeout);
            rightTimeout = window.setTimeout(() => {
              this.patternEngine.playRotatingFill();
              rightTimeout = null;
            }, 500);
          }
        }
        return;
      }

    });
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
            // Parado → ativar ritmo e dar play
            this.patternEngine.activateRhythm(variationIndex);
            if (this.useIntro) {
              this.patternEngine.playIntroAndStart();
            } else {
              this.stateManager.setShouldPlayStartSound(true);
            }
            this.play();
          } else if (variationIndex === currentVariation) {
            // Tocando o mesmo ritmo → parar (com ou sem final)
            if (this.useFinal) {
              this.patternEngine.playEndAndStop();
            } else {
              this.stop();
            }
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
            this.patternEngine.activateEndWithTiming(variationIndex);
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
    // Botão de mapear pedal removido (pedal fixo por enquanto)

    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        if (this.stateManager.isPlaying()) this.stop();
        const { authService } = await import('./auth/AuthService');
        await authService.logout();
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

    const close = () => overlay.remove();
    overlay.querySelector('#closePedalInfo')!.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
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

  private async play(): Promise<void> {
    await this.audioManager.resume();
    this.stateManager.setPlaying(true);

    // Manter tela ativa para evitar problemas de áudio em background
    try {
      await KeepAwake.keepAwake();
      console.log('[KeepAwake] Screen will stay awake');
    } catch (error) {
      console.warn('[KeepAwake] Failed to keep awake:', error);
    }

    const activePattern = this.stateManager.getActivePattern();
    this.uiManager.updateStatusUI(activePattern);
    this.uiManager.updatePerformanceGrid();

    this.scheduler.start();
  }

  private stop(): void {
    this.stateManager.setPlaying(false);
    this.stateManager.resetStep();
    this.stateManager.setActivePattern('main');
    this.stateManager.clearQueue();
    this.stateManager.setPendingFill(null);
    this.stateManager.setPendingEnd(null);

    this.scheduler.stop();

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

    if (!this.countdownOverlay) {
      this.countdownOverlay = document.createElement('div');
      this.countdownOverlay.className = 'countdown-overlay';
      document.body.appendChild(this.countdownOverlay);
    }

    this.countdownOverlay.style.display = 'flex';
    this.countdownOverlay.innerHTML = `<span class="countdown-num" key="${beatNum}">${beatNum}</span>`;

    // Force reflow para reiniciar animação
    const numEl = this.countdownOverlay.querySelector('.countdown-num') as HTMLElement;
    void numEl.offsetHeight;
    numEl.classList.add('countdown-animate');
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
        filter: drop-shadow(0 0 40px rgba(249, 115, 22, 0.6))
                drop-shadow(0 0 80px rgba(249, 115, 22, 0.3));
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif;
        letter-spacing: -0.05em;
      }

      .countdown-num.countdown-animate {
        animation: countdownPop 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }

      @keyframes countdownPop {
        0% {
          opacity: 0;
          transform: scale(0.4);
          filter: drop-shadow(0 0 20px rgba(249, 115, 22, 0.3));
        }
        30% {
          opacity: 1;
          transform: scale(1.1);
          filter: drop-shadow(0 0 60px rgba(249, 115, 22, 0.8))
                  drop-shadow(0 0 120px rgba(249, 115, 22, 0.4));
        }
        60% {
          opacity: 1;
          transform: scale(1);
          filter: drop-shadow(0 0 50px rgba(249, 115, 22, 0.6))
                  drop-shadow(0 0 100px rgba(249, 115, 22, 0.3));
        }
        100% {
          opacity: 0.15;
          transform: scale(0.95);
          filter: drop-shadow(0 0 30px rgba(249, 115, 22, 0.2));
        }
      }
    `;
    document.head.appendChild(style);
  }

  private cymbalBuffer: AudioBuffer | null = null;

  private async playCymbal(): Promise<void> {
    // Cache do buffer do prato
    if (!this.cymbalBuffer) {
      try {
        this.cymbalBuffer = await this.audioManager.loadAudioFromPath('/midi/prato.mp3');
      } catch {
        return;
      }
    }

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
        <button class="volume-close">Fechar</button>
      </div>
    `;

    document.body.appendChild(popup);

    const rect = element.getBoundingClientRect();
    popup.style.left = `${rect.left + window.scrollX}px`;
    popup.style.top = `${rect.top + window.scrollY - 10}px`;

    const slider = popup.querySelector('#volumeSlider') as HTMLInputElement;
    const valueDisplay = popup.querySelector('#volumeValue') as HTMLElement;

    const updateVolume = (value: number) => {
      this.stateManager.setStepVolume(pattern, channel, step, value);
      valueDisplay.textContent = `${Math.round(value * 100)}%`;
      slider.value = (value * 100).toString();
      this.uiManager.updateStepVisual(channel, step);

      // Auto-salvar a variação atual
      const currentSlot = this.stateManager.getCurrentVariation(pattern);
      this.stateManager.saveVariation(pattern, currentSlot);
    };

    slider.addEventListener('input', (e) => {
      const value = parseInt((e.target as HTMLInputElement).value) / 100;
      updateVolume(value);
    });

    // Preset buttons — fecha imediatamente ao clicar
    popup.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const presetValue = parseInt((e.target as HTMLElement).getAttribute('data-volume')!) / 100;
        updateVolume(presetValue);
        popup.remove();
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

  private async loadAvailableMidi(): Promise<void> {
    try {
      // Carregar lista de MIDIs do manifest (dinâmico — basta editar manifest.json)
      let midiFiles: string[] = [];
      try {
        const res = await fetch(`/midi/manifest.json?v=${Date.now()}`);
        if (res.ok) {
          const manifest = await res.json();
          midiFiles = manifest.files || [];
        }
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
      this.setlistEditor.open(
        this.availableRhythms,
        this.setlistManager,
        () => this.onSetlistEditorClose()
      );
    });

    // Botão próximo
    const nextBtn = document.getElementById('setlistNext');
    nextBtn?.addEventListener('click', () => this.navigateSetlist('next'));

    // Botão anterior
    const prevBtn = document.getElementById('setlistPrev');
    prevBtn?.addEventListener('click', () => this.navigateSetlist('previous'));

    // Atualizar UI inicial
    this.updateSetlistUI();
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
      await this.loadRhythm(current.name, current.path);
    }
  }

  private async navigateSetlist(direction: 'next' | 'previous'): Promise<void> {
    const item = direction === 'next'
      ? this.setlistManager.next()
      : this.setlistManager.previous();

    if (!item) return;

    // Parar reprodução antes de trocar
    if (this.stateManager.isPlaying()) {
      this.stop();
    }

    await this.loadRhythm(item.name, item.path);
  }

  private updateSetlistUI(): void {
    const numEl = document.getElementById('setlistNum');
    const positionEl = document.getElementById('setlistPosition');
    const nameEl = document.getElementById('currentRhythmName');
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
      if (prevNameEl) prevNameEl.textContent = '--';
      if (nextNameEl) nextNameEl.textContent = '--';
      if (prevBtn) { prevBtn.disabled = true; prevBtn.style.opacity = '0.25'; }
      if (nextBtn) { nextBtn.disabled = true; nextBtn.style.opacity = '0.25'; }
      if (stripCards) stripCards.style.display = 'flex';
      if (favBar) favBar.style.display = 'none';
      return;
    }

    if (stripCards) stripCards.style.display = 'none';
    if (favBar) favBar.style.display = 'flex';

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
  private currentRhythmName: string = '';

  private async loadAvailableRhythms(): Promise<void> {
    try {
      // Carregar manifest com cache bust
      let rhythmFiles: string[] = [];
      let manifestVersion = 0;

      try {
        const manifestResponse = await fetch(`/rhythm/manifest.json?t=${Date.now()}`);
        if (manifestResponse.ok) {
          const manifest = await manifestResponse.json();
          rhythmFiles = manifest.rhythms || [];
          manifestVersion = manifest.version || 0;
          this.rhythmCategories = manifest.categories || {};
        }
      } catch (e) {
        // Manifest não existe
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
      if (!this.isAdminMode && !this.setlistManager.isEmpty()) {
        const current = this.setlistManager.getCurrentItem();
        if (current) {
          await this.loadRhythm(current.name, current.path);
        }
      }
    } catch (error) {
      void error;
    }
  }

  private renderRhythmStrip(): void {
    const container = document.getElementById('rhythmStripCards');
    if (!container) return;

    container.innerHTML = '';

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

    const filtered = this.activeCategory
      ? this.availableRhythms.filter(r => r.category === this.activeCategory)
      : this.availableRhythms;

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
      cardsWrap.innerHTML = '<span class="rhythm-strip-empty">Nenhum ritmo nesta categoria</span>';
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

      // Carregar ritmo — sem cache bust no offline (Service Worker precisa da URL limpa)
      const cleanPath = path.split('?')[0];
      const encodedPath = encodeURI(cleanPath);
      const finalPath = navigator.onLine ? `${encodedPath}?v=${this.rhythmVersion || Date.now()}` : encodedPath;
      await this.fileManager.loadProjectFromPath(finalPath);

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
        this.updateSetlistUI();
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
  new RhythmSequencer();
  void 0; // initialized
});
