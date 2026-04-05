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
import { UserRhythmService } from './core/UserRhythmService';

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
  private userRhythmService: UserRhythmService;
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
    this.userRhythmService = new UserRhythmService();

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
    // Retomar áudio e scheduler quando volta do background
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.stateManager.isPlaying()) {
        this.audioManager.resume();
        // Reiniciar o scheduler (timers morrem no background)
        this.scheduler.restart();
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
    });
  }

  // ─── What's New ───────────────────────────────────────────────────

  private static readonly WHATS_NEW = {
    version: '2.3',
    title: 'Novidades do GDrums!',
    items: [
      { icon: '🎵', text: '50 ritmos na biblioteca — Anos 60, Pagodao, Salsa, Ska, Blues, Jazz e mais' },
      { icon: '📶', text: 'Modo offline completo — todos os ritmos funcionam sem internet' },
      { icon: '🎼', text: 'Repertorio — monte a setlist do show misturando ritmos da biblioteca com os seus' },
      { icon: '🎛️', text: 'Tap Tempo — toque no ritmo da musica e o BPM ajusta automaticamente' },
      { icon: '🤝', text: 'Programa de Afiliados — indique o GDrums e ganhe comissao por cada venda' },
    ],
  };

  private showWhatsNew(): void {
    const key = 'gdrums-whats-new-seen';
    const seen = localStorage.getItem(key);
    if (seen === RhythmSequencer.WHATS_NEW.version) return;

    const wn = RhythmSequencer.WHATS_NEW;

    const overlay = document.createElement('div');
    overlay.className = 'account-modal-overlay';
    overlay.innerHTML = `
      <div class="account-modal" style="max-width:400px;">
        <button class="account-modal-close" id="whatsNewClose">&times;</button>
        <div class="account-header">
          <div class="account-avatar" style="width:52px;height:52px;font-size:1.5rem;margin-bottom:0.6rem;background:linear-gradient(135deg,var(--cyan,#00D4FF),var(--purple,#8B5CF6));">
            🚀
          </div>
          <div class="account-name">${wn.title}</div>
          <div class="account-email">Versão ${wn.version}</div>
        </div>

        <div style="padding:0 0.25rem;display:flex;flex-direction:column;gap:0.5rem;margin-bottom:1rem;">
          ${wn.items.map(item => `
            <div style="display:flex;align-items:flex-start;gap:0.6rem;padding:0.55rem 0.7rem;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:10px;">
              <span style="font-size:1.1rem;flex-shrink:0;margin-top:0.05rem;">${item.icon}</span>
              <span style="font-size:0.8rem;color:rgba(255,255,255,0.6);line-height:1.4;">${item.text}</span>
            </div>
          `).join('')}
        </div>

        <button id="whatsNewOk" class="account-action-btn">Show! Vamos lá</button>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    const close = () => {
      localStorage.setItem(key, wn.version);
      overlay.classList.remove('active');
      setTimeout(() => overlay.remove(), 200);
    };

    overlay.querySelector('#whatsNewClose')?.addEventListener('click', close);
    overlay.querySelector('#whatsNewOk')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
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
        window.location.href = '/login.html';
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
        window.location.href = '/register.html';
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
      window.location.href = '/login.html';
      return false;
    }

    // Se não tem session ID local (primeiro acesso ou limpou cache), gerar um
    if (!localSessionId) {
      const newId = crypto.randomUUID();
      localStorage.setItem('gdrums-session-id', newId);
      supabase.from('gdrums_profiles')
        .update({ active_session_id: newId })
        .eq('id', session.user.id)
        .then();
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

    const urgentMsg = hoursLeft <= 6
      ? `Sua banda vai parar em <strong>${timeText}</strong>`
      : `<strong>${timeText}</strong> restantes do seu teste`;

    banner.innerHTML = `
      <span class="trial-banner-text">${urgentMsg}</span>
      <a href="/plans.html" class="trial-banner-btn">${hoursLeft <= 6 ? 'Manter a banda tocando' : 'Assinar agora'}</a>
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
    // capture:true + passive:false — essencial no iOS pra capturar antes do scroll do browser
    window.addEventListener('keydown', (e) => {
      // Identificar tecla — e.code é preferencial, e.key é fallback (iOS pedais BT)
      const keyId = e.code || e.key;
      if (!keyId) return;

      // Se um input/select está focado E a tecla é do pedal, tirar foco e processar
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        if (keyId === this.pedalLeft || keyId === this.pedalRight) {
          (target as HTMLElement).blur();
        } else {
          return; // Outra tecla dentro de input, deixar o browser tratar
        }
      }

      // Prevenir scroll/navegação do browser
      if (keyId === this.pedalLeft || keyId === this.pedalRight ||
          keyId === 'Space' || keyId === ' ' ||
          keyId === 'ArrowLeft' || keyId === 'ArrowRight' ||
          keyId === 'ArrowUp' || keyId === 'ArrowDown' ||
          keyId === 'PageUp' || keyId === 'PageDown') {
        e.preventDefault();
      }

      if (e.repeat) return;

      // ─── PEDAL TEM PRIORIDADE ─────────────────────────────────────
      // Checar pedal ANTES do Space, senão quem mapeia Space/Enter
      // como pedal nunca consegue usar (vira Play/Pause)
      if (keyId === this.pedalLeft) {
        this.handlePedalLeft();
        return;
      }
      if (keyId === this.pedalRight) {
        this.handlePedalRight();
        return;
      }

      // Space = Play/Pause (só se NÃO é pedal mapeado)
      if (keyId === 'Space' || keyId === ' ') {
        this.togglePlayStop();
        return;
      }

    }, { capture: true, passive: false } as AddEventListenerOptions);

    // ─── iOS: input oculto pra forçar keydown do pedal BT ───────────
    // No iOS, se nenhum elemento editável tem foco, o Safari consome
    // teclas como Space/setas pro scroll e NÃO dispara keydown.
    // Com um input focado, o iOS entrega o evento pro JavaScript.
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      const pedalInput = document.createElement('input');
      pedalInput.id = 'pedalBtInput';
      pedalInput.setAttribute('readonly', 'true');
      pedalInput.setAttribute('inputmode', 'none');
      pedalInput.setAttribute('autocomplete', 'off');
      pedalInput.setAttribute('autocorrect', 'off');
      pedalInput.setAttribute('autocapitalize', 'off');
      pedalInput.setAttribute('spellcheck', 'false');
      pedalInput.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;border:none;padding:0;margin:0;font-size:16px;';
      document.body.appendChild(pedalInput);

      const focusPedalInput = () => {
        const active = document.activeElement as HTMLElement;
        // Não roubar foco de inputs reais do usuário
        if (active && active !== pedalInput && active !== document.body &&
            (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;
        pedalInput.focus({ preventScroll: true });
      };

      // Manter foco no input oculto
      document.addEventListener('click', () => setTimeout(focusPedalInput, 150));
      document.addEventListener('touchend', () => setTimeout(focusPedalInput, 300));
      document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(focusPedalInput, 300); });
      setTimeout(focusPedalInput, 1000);

      // Limpar qualquer texto que o iOS possa inserir
      pedalInput.addEventListener('input', () => { pedalInput.value = ''; });
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
    const pedalMapBtn = document.getElementById('pedalMapBtn');
    if (pedalMapBtn) {
      pedalMapBtn.addEventListener('click', () => {
        if (fabDropdown) fabDropdown.style.display = 'none';
        this.showPedalMapper();
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
        this.showAccountModal();
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

    const close = () => overlay.remove();
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

      overlay.querySelector('#pedalLeftBtn')!.addEventListener('click', (ev) => { ev.stopPropagation(); listening = 'left'; render(); });
      overlay.querySelector('#pedalRightBtn')!.addEventListener('click', (ev) => { ev.stopPropagation(); listening = 'right'; render(); });

      overlay.querySelector('#pedalReset')!.addEventListener('click', () => {
        tempLeft = 'ArrowLeft';
        tempRight = 'ArrowRight';
        listening = null;
        render();
      });

      overlay.querySelector('#pedalSave')!.addEventListener('click', () => {
        this.pedalLeft = tempLeft;
        this.pedalRight = tempRight;
        localStorage.setItem('gdrums_pedal_keys', JSON.stringify({ left: tempLeft, right: tempRight }));
        close();
        this.modalManager.show('Pedal', 'Mapeamento salvo!', 'success');
      });
    };

    document.body.appendChild(overlay);
    render();

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

    // Capturar keydown (principal)
    const keyHandler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const code = e.code || e.key;
      if (!code) return;
      handleDetected(code, `keydown: code="${e.code || ''}" key="${e.key || ''}"`);
    };

    // Capturar keyup como fallback (alguns pedais BT no iOS só emitem keyup)
    const keyUpHandler = (e: KeyboardEvent) => {
      const code = e.code || e.key;
      if (!code || !listening) return;
      e.preventDefault();
      handleDetected(code, `keyup: code="${e.code || ''}" key="${e.key || ''}"`);
    };

    document.addEventListener('keydown', keyHandler, true);
    document.addEventListener('keyup', keyUpHandler, true);

    const close = () => {
      document.removeEventListener('keydown', keyHandler, true);
      document.removeEventListener('keyup', keyUpHandler, true);
      overlay.remove();
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
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

    const close = () => overlay.remove();
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

  // ─── Modal BPM ──────────────────────────────────────────────────────

  // ─── Modal de telefone (usuários antigos sem WhatsApp) ──────────

  // ─── Meus Ritmos ───────────────────────────────────────────────────

  private showSaveRhythmModal(): void {
    if (!this.currentRhythmName && !this.stateManager.getState().patterns.main.some(r => r.some(s => s))) {
      this.modalManager.show('Meus Ritmos', 'Carregue um ritmo antes de salvar.', 'warning');
      return;
    }

    const currentBpm = this.stateManager.getTempo();
    const suggestedName = this.currentRhythmName || 'Meu Ritmo';

    const overlay = document.createElement('div');
    overlay.className = 'account-modal-overlay';
    overlay.innerHTML = `
      <div class="account-modal" style="max-width:380px;">
        <button class="account-modal-close" id="saveRhythmClose">&times;</button>
        <div class="account-header">
          <div class="account-avatar" style="width:48px;height:48px;font-size:1.2rem;margin-bottom:0.5rem;background:linear-gradient(135deg,#8B5CF6,#EC4899);">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>
          </div>
          <div class="account-name">Salvar Meu Ritmo</div>
          <div class="account-email">Crie uma versão personalizada com seu nome e BPM</div>
        </div>

        <div style="padding:0 0.5rem;display:flex;flex-direction:column;gap:0.75rem;">
          <div>
            <label style="font-size:0.65rem;font-weight:600;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:0.3rem;">Nome do ritmo</label>
            <input type="text" id="saveRhythmName" class="account-password-input" value="${suggestedName}" placeholder="Ex: Vaneira do João" style="text-align:center;" />
          </div>
          <div>
            <label style="font-size:0.65rem;font-weight:600;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:0.3rem;">BPM</label>
            <input type="number" id="saveRhythmBpm" class="account-password-input" value="${currentBpm}" min="40" max="240" style="text-align:center;font-size:1.2rem;font-weight:700;" />
          </div>
          <div id="saveRhythmStatus" style="font-size:0.72rem;min-height:1rem;text-align:center;"></div>
          <button id="saveRhythmConfirm" class="account-action-btn" style="background:linear-gradient(135deg,#8B5CF6,#EC4899);box-shadow:0 4px 20px rgba(139,92,246,0.25);">Salvar</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    const close = () => {
      overlay.classList.remove('active');
      setTimeout(() => overlay.remove(), 200);
    };

    overlay.querySelector('#saveRhythmClose')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const nameInput = overlay.querySelector('#saveRhythmName') as HTMLInputElement;
    nameInput.select();

    overlay.querySelector('#saveRhythmConfirm')?.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const bpm = parseInt((overlay.querySelector('#saveRhythmBpm') as HTMLInputElement).value);
      const statusEl = overlay.querySelector('#saveRhythmStatus') as HTMLElement;

      if (!name) {
        statusEl.textContent = 'Dê um nome ao seu ritmo';
        statusEl.style.color = '#FF4466';
        return;
      }
      if (isNaN(bpm) || bpm < 40 || bpm > 240) {
        statusEl.textContent = 'BPM deve ser entre 40 e 240';
        statusEl.style.color = '#FF4466';
        return;
      }

      statusEl.textContent = 'Salvando...';
      statusEl.style.color = 'rgba(255,255,255,0.4)';

      // Capturar estado atual como JSON do ritmo
      const rhythmData = this.fileManager.exportProjectAsJSON();

      await this.userRhythmService.save(name, bpm, rhythmData);

      statusEl.textContent = 'Salvo!';
      statusEl.style.color = '#00E68C';
      setTimeout(close, 800);
    });
  }

  private showMyRhythmsModal(): void {
    const overlay = document.createElement('div');
    overlay.className = 'account-modal-overlay';

    const renderList = () => {
      const list = this.userRhythmService.getAll();
      const listHtml = list.length === 0
        ? '<div style="text-align:center;padding:2rem 0;color:rgba(255,255,255,0.2);font-size:0.82rem;">Nenhum ritmo salvo ainda.<br>Carregue um ritmo e toque no botão salvar.</div>'
        : list.map(r => `
          <div class="my-rhythm-item" data-id="${r.id}" style="display:flex;align-items:center;gap:0.75rem;padding:0.65rem 0.75rem;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;cursor:pointer;transition:all 0.12s;margin-bottom:0.4rem;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:0.85rem;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.name}</div>
              <div style="font-size:0.68rem;color:rgba(255,255,255,0.3);">${r.bpm} BPM${!r.synced ? ' · pendente sync' : ''}</div>
            </div>
            <button class="my-rhythm-delete" data-delete-id="${r.id}" style="background:none;border:none;color:rgba(255,68,102,0.5);cursor:pointer;padding:0.3rem;font-size:1rem;line-height:1;" title="Deletar">&times;</button>
          </div>
        `).join('');

      overlay.innerHTML = `
        <div class="account-modal" style="max-width:400px;max-height:85vh;display:flex;flex-direction:column;">
          <button class="account-modal-close" id="myRhythmsClose">&times;</button>
          <div class="account-header" style="flex-shrink:0;">
            <div class="account-avatar" style="width:48px;height:48px;font-size:1.2rem;margin-bottom:0.5rem;background:linear-gradient(135deg,#8B5CF6,#EC4899);">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <div class="account-name">Meus Ritmos</div>
            <div class="account-email">${list.length} ritmo${list.length !== 1 ? 's' : ''} salvo${list.length !== 1 ? 's' : ''}</div>
          </div>

          <div style="flex:1;overflow-y:auto;padding:0 0.5rem 0.5rem;-webkit-overflow-scrolling:touch;">
            ${listHtml}
          </div>
        </div>
      `;

      overlay.querySelector('#myRhythmsClose')?.addEventListener('click', close);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

      // Carregar ritmo ao clicar
      overlay.querySelectorAll('.my-rhythm-item').forEach(item => {
        item.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('.my-rhythm-delete')) return;
          const id = (item as HTMLElement).dataset.id!;
          const rhythm = this.userRhythmService.getById(id);
          if (!rhythm) return;

          this.loadUserRhythm(rhythm.name, rhythm.bpm, rhythm.rhythm_data);
          close();
        });
      });

      // Deletar
      overlay.querySelectorAll('.my-rhythm-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = (btn as HTMLElement).dataset.deleteId!;
          const rhythm = this.userRhythmService.getById(id);
          if (!rhythm) return;
          if (!confirm(`Deletar "${rhythm.name}"?`)) return;
          await this.userRhythmService.delete(id);
          renderList();
        });
      });
    };

    const close = () => {
      overlay.classList.remove('active');
      setTimeout(() => overlay.remove(), 200);
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

    // Máscara
    input.addEventListener('input', () => {
      let v = input.value.replace(/\D/g, '').slice(0, 11);
      if (v.length > 6) v = `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
      else if (v.length > 2) v = `(${v.slice(0,2)}) ${v.slice(2)}`;
      else if (v.length > 0) v = `(${v}`;
      input.value = v;
    });

    const close = () => {
      overlay.classList.remove('active');
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

  private showBpmModal(): void {
    const currentTempo = this.stateManager.getTempo();
    let tempTempo = currentTempo;

    const presets = [60, 70, 80, 90, 100, 110, 120, 140, 160, 180];

    const overlay = document.createElement('div');
    overlay.className = 'bpm-modal-overlay';
    overlay.innerHTML = `
      <div class="bpm-modal">
        <div class="bpm-modal-title">Ajustar BPM</div>

        <div class="bpm-display">
          <button class="bpm-display-btn" id="bpmMinus5">&minus;5</button>
          <button class="bpm-display-btn" id="bpmMinus1">&minus;</button>
          <div class="bpm-display-value">
            <input type="number" class="bpm-display-input" id="bpmInput" value="${currentTempo}" min="40" max="240" inputmode="numeric" />
            <div class="bpm-display-unit">BPM</div>
          </div>
          <button class="bpm-display-btn" id="bpmPlus1">+</button>
          <button class="bpm-display-btn" id="bpmPlus5">+5</button>
        </div>

        <div class="bpm-slider-wrap">
          <input type="range" class="bpm-slider" id="bpmSlider" min="40" max="240" value="${currentTempo}" />
        </div>

        <button class="bpm-tap-btn" id="bpmTapBtn">
          <span class="bpm-tap-icon">👆</span>
          <span class="bpm-tap-label">TAP TEMPO</span>
          <span class="bpm-tap-hint" id="bpmTapHint">Toque no ritmo da música</span>
        </button>

        <div class="bpm-presets" id="bpmPresets">
          ${presets.map(p => `<button class="bpm-preset${p === currentTempo ? ' active' : ''}" data-bpm="${p}">${p}</button>`).join('')}
        </div>

        ${this.currentRhythmOriginalBpm > 0 && currentTempo !== this.currentRhythmOriginalBpm ? `<button class="bpm-restore" id="bpmRestore">Restaurar padrão (${this.currentRhythmOriginalBpm} BPM)</button>` : ''}
        <button class="bpm-confirm" id="bpmConfirm">Confirmar</button>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    const input = overlay.querySelector('#bpmInput') as HTMLInputElement;
    const slider = overlay.querySelector('#bpmSlider') as HTMLInputElement;
    const presetsContainer = overlay.querySelector('#bpmPresets')!;

    const updateAll = (bpm: number, source?: string) => {
      tempTempo = Math.max(40, Math.min(240, bpm));
      if (source !== 'input') input.value = tempTempo.toString();
      if (source !== 'slider') slider.value = tempTempo.toString();

      // Atualizar preset ativo
      presetsContainer.querySelectorAll('.bpm-preset').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.getAttribute('data-bpm') || '0') === tempTempo);
      });

      // Aplicar em tempo real para ouvir a diferença imediatamente
      this.stateManager.setTempo(tempTempo);
    };

    // Botões +/- 1 e +/- 5
    overlay.querySelector('#bpmMinus5')!.addEventListener('click', () => updateAll(tempTempo - 5));
    overlay.querySelector('#bpmMinus1')!.addEventListener('click', () => updateAll(tempTempo - 1));
    overlay.querySelector('#bpmPlus1')!.addEventListener('click', () => updateAll(tempTempo + 1));
    overlay.querySelector('#bpmPlus5')!.addEventListener('click', () => updateAll(tempTempo + 5));

    // Slider
    slider.addEventListener('input', () => updateAll(parseInt(slider.value), 'slider'));

    // Input direto
    input.addEventListener('input', () => {
      const val = parseInt(input.value);
      if (!isNaN(val) && val >= 40 && val <= 240) {
        updateAll(val, 'input');
      }
    });
    input.addEventListener('focus', () => input.select());

    // Tap Tempo
    const tapBtn = overlay.querySelector('#bpmTapBtn') as HTMLElement;
    const tapHint = overlay.querySelector('#bpmTapHint') as HTMLElement;
    const tapTimes: number[] = [];
    let tapResetTimeout: number | null = null;

    tapBtn.addEventListener('click', () => {
      const now = performance.now();
      tapTimes.push(now);

      // Resetar se demorou mais de 2s entre taps
      if (tapResetTimeout) clearTimeout(tapResetTimeout);
      tapResetTimeout = window.setTimeout(() => {
        tapTimes.length = 0;
        tapHint.textContent = 'Toque no ritmo da música';
      }, 2000);

      // Precisa de pelo menos 2 taps pra calcular
      if (tapTimes.length < 2) {
        tapHint.textContent = 'Continue tocando...';
        return;
      }

      // Manter só os últimos 8 taps (média mais estável)
      if (tapTimes.length > 8) tapTimes.shift();

      // Calcular média dos intervalos
      let totalInterval = 0;
      for (let i = 1; i < tapTimes.length; i++) {
        totalInterval += tapTimes[i] - tapTimes[i - 1];
      }
      const avgInterval = totalInterval / (tapTimes.length - 1);
      const bpm = Math.round(60000 / avgInterval);

      if (bpm >= 40 && bpm <= 240) {
        updateAll(bpm);
        tapHint.textContent = `${bpm} BPM (${tapTimes.length - 1} taps)`;
      }

      // Feedback visual
      tapBtn.classList.add('bpm-tap-active');
      setTimeout(() => tapBtn.classList.remove('bpm-tap-active'), 100);
    });

    // Presets
    presetsContainer.querySelectorAll('.bpm-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        updateAll(parseInt(btn.getAttribute('data-bpm') || '80'));
      });
    });

    // Restaurar BPM padrão do ritmo
    overlay.querySelector('#bpmRestore')?.addEventListener('click', () => {
      updateAll(this.currentRhythmOriginalBpm);
    });

    // Fechar
    const close = () => {
      overlay.classList.remove('active');
      setTimeout(() => overlay.remove(), 200);
    };

    overlay.querySelector('#bpmConfirm')!.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    // ESC fecha
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Restaurar BPM original se cancelou com ESC
        this.stateManager.setTempo(currentTempo);
        close();
        document.removeEventListener('keydown', onEsc);
      }
    };
    document.addEventListener('keydown', onEsc);

    // Limpar listener de ESC e salvar BPM ao fechar normalmente
    overlay.querySelector('#bpmConfirm')!.addEventListener('click', () => {
      document.removeEventListener('keydown', onEsc);
      this.saveCustomBpm();
    });
  }

  // ─── Modal Minha Conta ───────────────────────────────────────────────

  private async showAccountModal(): Promise<void> {
    const { supabase } = await import('./auth/supabase');
    const { PLANS } = await import('./auth/PaymentService');

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
      .from('gdrums_profiles')
      .select('name, subscription_status, subscription_plan, subscription_expires_at, created_at')
      .eq('id', user.id)
      .single();

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

    // ─── Cálculo de upgrade proporcional ────────────────────────────
    // Crédito = valor pago × (dias restantes / dias totais do plano)
    // Upgrade = preço novo plano − crédito (mínimo R$ 0)
    // Prazo do novo plano começa do zero (não soma dias antigos)

    let upgradeCredit = 0;
    let upgradeNextPlan: typeof PLANS[0] | null = null;
    let upgradePrice = 0;
    let upgradeSection = '';

    const planOrder = ['mensal', 'trimestral', 'semestral', 'anual', 'rei-dos-palcos'];

    if (status === 'active' && currentPlan && daysLeft > 0) {
      const totalDays = currentPlan.durationMonths * 30;
      const paidCents = currentPlan.priceCents;
      // Crédito proporcional ao tempo não usado
      upgradeCredit = Math.round(paidCents * (daysLeft / totalDays));

      const currentIdx = planOrder.indexOf(planId);
      if (currentIdx < planOrder.length - 1) {
        upgradeNextPlan = PLANS.find(p => p.id === planOrder[currentIdx + 1]) || null;
        if (upgradeNextPlan) {
          upgradePrice = Math.max(0, upgradeNextPlan.priceCents - upgradeCredit);
          const creditDisplay = (upgradeCredit / 100).toFixed(2).replace('.', ',');
          const priceDisplay = (upgradePrice / 100).toFixed(2).replace('.', ',');

          upgradeSection = `
            <div class="account-upgrade-detail">
              <div class="account-upgrade-row">
                <span>${upgradeNextPlan.displayName}</span>
                <span>R$ ${(upgradeNextPlan.priceCents / 100).toFixed(2).replace('.', ',')}</span>
              </div>
              <div class="account-upgrade-row account-upgrade-credit">
                <span>Crédito do plano atual (${daysLeft}d restantes)</span>
                <span>− R$ ${creditDisplay}</span>
              </div>
              <div class="account-upgrade-divider"></div>
              <div class="account-upgrade-row account-upgrade-total">
                <span>Valor do upgrade</span>
                <span>R$ ${priceDisplay}</span>
              </div>
            </div>
          `;
        }
      }
    }

    // Botão de ação inteligente
    let actionBtn = '';
    if (status === 'expired' || status === 'canceled') {
      actionBtn = `<button class="account-action-btn" id="accountActionBtn">Renovar Assinatura</button>`;
    } else if (status === 'trial') {
      actionBtn = `<button class="account-action-btn" id="accountActionBtn">Assinar Agora</button>`;
    } else if (status === 'active' && upgradeNextPlan) {
      const priceDisplay = (upgradePrice / 100).toFixed(2).replace('.', ',');
      actionBtn = `<button class="account-action-btn account-action-upgrade" id="accountActionBtn">Fazer upgrade — ${upgradeNextPlan.displayName} por R$ ${priceDisplay}</button>`;
    }

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

        ${upgradeSection}
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
      </div>
    `;

    document.body.appendChild(overlay);

    // Animar entrada
    requestAnimationFrame(() => overlay.classList.add('active'));

    // Fechar
    const close = () => {
      overlay.classList.remove('active');
      setTimeout(() => overlay.remove(), 200);
    };

    overlay.querySelector('#accountModalClose')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
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

    // Ação do botão de upgrade/renovar
    const actionBtnEl = overlay.querySelector('#accountActionBtn');
    if (actionBtnEl) {
      actionBtnEl.addEventListener('click', () => {
        close();
        if (status === 'active' && upgradeNextPlan) {
          window.location.href = `/plans.html?upgrade=true&plan=${upgradeNextPlan.id}&credit=${upgradeCredit}`;
        } else {
          window.location.href = '/plans.html';
        }
      });
    }
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
        const midiManifestUrl = navigator.onLine ? `/midi/manifest.json?v=${Date.now()}` : '/midi/manifest.json';
        const res = await fetch(midiManifestUrl);
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
      try {
        // Juntar ritmos da biblioteca + ritmos pessoais no catálogo
        const personalRhythms = (this.userRhythmService?.getAll() || []).map(r => ({
          name: r.name,
          path: '',
          userRhythmId: r.id,
          isPersonal: true,
        }));
        const fullCatalog = [...personalRhythms, ...this.availableRhythms];

        this.setlistEditor.open(
          fullCatalog,
          this.setlistManager,
          () => this.onSetlistEditorClose()
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
  private currentRhythmOriginalBpm: number = 0; // BPM original do JSON do ritmo

  private async loadAvailableRhythms(): Promise<void> {
    try {
      // Carregar manifest com cache bust
      let rhythmFiles: string[] = [];
      let manifestVersion = 0;

      try {
        // Online: buscar com cache bust pra pegar versao mais recente
        // Offline: buscar sem cache bust pra usar o precache do SW
        const manifestUrl = navigator.onLine
          ? `/rhythm/manifest.json?t=${Date.now()}`
          : '/rhythm/manifest.json';
        const manifestResponse = await fetch(manifestUrl);
        if (manifestResponse.ok) {
          const manifest = await manifestResponse.json();
          rhythmFiles = manifest.rhythms || [];
          manifestVersion = manifest.version || 0;
          this.rhythmCategories = manifest.categories || {};
        }
      } catch (e) {
        // Manifest nao acessivel — tentar sem cache bust
        try {
          const fallback = await fetch('/rhythm/manifest.json');
          if (fallback.ok) {
            const manifest = await fallback.json();
            rhythmFiles = manifest.rhythms || [];
            manifestVersion = manifest.version || 0;
            this.rhythmCategories = manifest.categories || {};
          }
        } catch { /* sem manifest */ }
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
          await this.loadSetlistItem(current);
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
  new RhythmSequencer();
  void 0; // initialized
});
