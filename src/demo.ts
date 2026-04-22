// Demo mode — app identico ao real mas com limite de ritmos
// Usa mesma UI (styles.css), mesmos IDs, mesma experiencia

import { StateManager } from './core/StateManager';
import { AudioManager } from './core/AudioManager';
import { Scheduler } from './core/Scheduler';
import { PatternEngine } from './core/PatternEngine';
import { FileManager } from './io/FileManager';
import { UIManager } from './ui/UIManager';
import { MAX_CHANNELS, type PatternType } from './types';
import { HapticsService } from './native/HapticsService';
import { AttributionService } from './native/AttributionService';

// Só 3 ritmos ficam liberados. O resto (69) aparece bloqueado na tira
// pra mostrar ao user o tamanho REAL da biblioteca — peça central pra
// evitar o engano de "só tem 3 ritmos, o app é fraco".
const DEMO_RHYTHMS = [
  { name: 'Vaneira', path: '/rhythm/Vaneira.json' },
  { name: 'Samba', path: '/rhythm/Samba.json' },
  { name: 'Sertanejo Universitário', path: '/rhythm/Sertanejo Universitário.json' },
];

// Demo curta de propósito: 3 ritmos + 8min forçam o user a se
// cadastrar enquanto a curiosidade tá em alta. Demo longa faz o cara
// "se satisfazer" no gratuito e nunca converter.
const MAX_RHYTHMS = 3;
const IDLE_TIMEOUT = 8 * 60 * 1000;
const STORAGE_KEY = 'gdrums_demo_used';
const FP_KEY = 'gdrums_demo_fp';

class DemoPlayer {
  private audioContext!: AudioContext;
  private stateManager!: StateManager;
  private audioManager!: AudioManager;
  private scheduler!: Scheduler;
  private patternEngine!: PatternEngine;
  private fileManager!: FileManager;
  private uiManager!: UIManager;
  private rhythmsUsed = new Set<string>();
  private idleTimer: number | null = null;
  private expired = false;
  private cymbalBuffer: AudioBuffer | null = null;
  private currentRhythmName = '';

  constructor() {
    if (this.isDemoExpired()) {
      this.showExpired();
      return;
    }

    this.audioContext = new AudioContext();
    this.stateManager = new StateManager();
    this.audioManager = new AudioManager(this.audioContext);
    this.patternEngine = new PatternEngine(this.stateManager);
    this.scheduler = new Scheduler(this.stateManager, this.audioManager, this.patternEngine);
    this.fileManager = new FileManager(this.stateManager, this.audioManager);
    this.uiManager = new UIManager(this.stateManager);

    this.setupCallbacks();
    this.setupUI();
    this.updateCounter();
    this.resetIdleTimer();
    this.saveFingerprint();
    this.trackDemoAccess();

    // Pre-carregar prato
    this.audioManager.loadAudioFromPath('/midi/prato.mp3').then(b => { this.cymbalBuffer = b; }).catch(() => {});
  }

  // ─── Persistencia ─────────────────────────────────────────────────

  private getFingerprint(): string {
    const nav = [navigator.language, screen.width, screen.height, screen.colorDepth, new Date().getTimezoneOffset()].join('_');
    return btoa(nav).slice(0, 24);
  }

  private saveFingerprint(): void {
    try {
      localStorage.setItem(FP_KEY, this.getFingerprint());
      document.cookie = `gdrums_fp=${this.getFingerprint()};max-age=31536000;path=/`;
    } catch {}
  }

  private trackDemoAccess(): void {
    try {
      fetch('https://qsfziivubwdgtmwyztfw.supabase.co/rest/v1/gdrums_demo_access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': 'sb_publishable_qjW2fGXMHtQvqVKgyyiiUg_HczRwmXy',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          fingerprint: this.getFingerprint(),
          user_agent: navigator.userAgent.substring(0, 200),
        }),
      }).catch(() => {});
    } catch {}
  }

  private isDemoExpired(): boolean {
    return localStorage.getItem(STORAGE_KEY) === 'expired' || document.cookie.includes('gdrums_demo_used=expired');
  }

  private markExpired(): void {
    this.expired = true;
    try {
      localStorage.setItem(STORAGE_KEY, 'expired');
      document.cookie = 'gdrums_demo_used=expired;max-age=31536000;path=/';
    } catch {}
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      if (!this.stateManager.isPlaying() && !this.expired) {
        this.markExpired();
        this.showExpired();
      }
    }, IDLE_TIMEOUT);
  }

  private updateCounter(): void {
    const remaining = MAX_RHYTHMS - this.rhythmsUsed.size;
    const el = document.getElementById('demoCounter');
    const bar = document.getElementById('demoBar');
    if (el) {
      el.textContent = remaining > 0
        ? `${remaining} ritmo${remaining !== 1 ? 's' : ''} restante${remaining !== 1 ? 's' : ''}`
        : 'Limite atingido';
      el.classList.toggle('low', remaining <= 1);
    }
    if (bar) bar.style.width = `${(remaining / MAX_RHYTHMS) * 100}%`;
  }

  // ─── Callbacks ────────────────────────────────────────────────────

  private setupCallbacks(): void {
    this.scheduler.setUpdateStepCallback((step: number, pattern: PatternType) => {
      this.uiManager.updateCurrentStepVisual();
      this.updateBeatMarker(step, pattern);
    });

    this.patternEngine.setOnPatternChange((pattern: PatternType) => {
      this.uiManager.updateStatusUI(pattern);
      this.uiManager.updatePerformanceGrid();
    });

    this.patternEngine.setOnStop(() => {
      this.stop();
    });

    this.patternEngine.setOnEndCymbal((time: number) => {
      if (this.cymbalBuffer) {
        this.audioManager.playSound(this.cymbalBuffer, time, this.stateManager.getState().masterVolume);
      }
    });

    // Retomar ao voltar do background
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.stateManager.isPlaying()) {
        this.audioManager.resume();
        this.scheduler.restart();
      }
    });
  }

  private updateBeatMarker(step: number, pattern: PatternType): void {
    const totalSteps = this.stateManager.getPatternSteps(pattern);
    const beatsPerBar = this.stateManager.getState().beatsPerBar || 4;
    const stepsPerBeat = Math.max(1, Math.floor(totalSteps / beatsPerBar));
    const currentBeat = Math.floor(step / stepsPerBeat) % beatsPerBar;

    document.querySelectorAll('.beat-dot').forEach((dot, i) => {
      dot.classList.toggle('beat-active', i === currentBeat);
      if (i === currentBeat) {
        dot.classList.remove('beat-pulse');
        void (dot as HTMLElement).offsetHeight;
        dot.classList.add('beat-pulse');
      }
    });
  }

  // ─── UI ───────────────────────────────────────────────────────────

  private setupUI(): void {
    // Ritmos strip — 3 liberados + 69 bloqueados (biblioteca completa)
    this.renderRhythmStrip();

    // Performance grid cells
    document.querySelectorAll('.grid-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        if (this.expired) { this.showExpired(); return; }
        this.resetIdleTimer();
        HapticsService.medium();

        const cellType = (cell as HTMLElement).getAttribute('data-type');
        const variation = parseInt((cell as HTMLElement).getAttribute('data-variation') || '0');

        if (cellType === 'main') {
          if (!this.stateManager.isPlaying()) {
            this.patternEngine.activateRhythm(variation);
            this.stateManager.setShouldPlayStartSound(true);
            this.play();
          } else if (variation === this.stateManager.getCurrentVariation('main')) {
            this.stop();
          } else {
            this.patternEngine.playFillToNextRhythm(variation);
          }
        } else if (cellType === 'fill' && this.stateManager.isPlaying()) {
          this.patternEngine.activateFillWithTiming(variation);
        } else if (cellType === 'end' && this.stateManager.isPlaying()) {
          this.patternEngine.playEndAndStop();
        }
      });
    });

    // Prato
    document.getElementById('cymbalBtn')?.addEventListener('click', () => {
      this.resetIdleTimer();
      HapticsService.heavy();
      if (this.cymbalBuffer) {
        this.audioManager.resume();
        this.audioManager.playSound(this.cymbalBuffer, this.audioManager.getCurrentTime(), 1.0);
      }
    });

    // BPM
    document.getElementById('tempoUpUser')?.addEventListener('click', () => {
      this.stateManager.setTempo(Math.min(240, this.stateManager.getTempo() + 1));
      this.uiManager.updateTempoUI(this.stateManager.getTempo());
    });
    document.getElementById('tempoDownUser')?.addEventListener('click', () => {
      this.stateManager.setTempo(Math.max(40, this.stateManager.getTempo() - 1));
      this.uiManager.updateTempoUI(this.stateManager.getTempo());
    });

    // Volume
    const volSlider = document.getElementById('masterVolumeUser') as HTMLInputElement;
    const volDisplay = document.getElementById('volumeDisplayUser');
    if (volSlider) {
      volSlider.addEventListener('input', () => {
        const val = parseInt(volSlider.value);
        this.stateManager.getState().masterVolume = val / 100;
        if (volDisplay) volDisplay.textContent = `${Math.round(val / 2)}%`;
      });
    }

    // Carregar primeiro ritmo
    this.loadRhythm(DEMO_RHYTHMS[0]);
  }

  // ─── Ritmo ────────────────────────────────────────────────────────

  /**
   * Renderiza tira de ritmos com os 3 liberados + o resto bloqueado.
   * Mostra ao visitante o tamanho REAL da biblioteca (72 ritmos) pra ele
   * não sair achando que 3 é tudo que existe. Cards bloqueados têm ícone
   * de cadeado e clicar neles mostra a tela de fim antecipadamente.
   */
  private async renderRhythmStrip(): Promise<void> {
    const strip = document.getElementById('demoRhythmStrip');
    if (!strip) return;

    // Monta os 3 liberados primeiro, na ordem
    DEMO_RHYTHMS.forEach(r => {
      const btn = document.createElement('button');
      btn.className = 'rhythm-card-btn';
      btn.textContent = r.name;
      btn.addEventListener('click', () => this.loadRhythm(r));
      strip.appendChild(btn);
    });

    // Depois busca o manifest real e adiciona o resto como locked
    try {
      const res = await fetch('/rhythm/manifest.json');
      const manifest = await res.json();
      const allNames: string[] = (manifest.rhythms || [])
        .map((f: string) => f.replace(/\.json$/, ''));
      const freeNames = new Set(DEMO_RHYTHMS.map(r => r.name));

      // Ordena alfabético pra dar sensação de biblioteca completa
      const lockedNames = allNames
        .filter(n => !freeNames.has(n))
        .sort((a, b) => a.localeCompare(b, 'pt-BR'));

      lockedNames.forEach(name => {
        const btn = document.createElement('button');
        btn.className = 'rhythm-card-btn rhythm-card-locked';
        btn.innerHTML = `
          <svg class="rhythm-lock-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="4" y="11" width="16" height="10" rx="2"></rect>
            <path d="M8 11V8a4 4 0 018 0v3"></path>
          </svg>
          <span>${name}</span>
        `;
        btn.title = 'Disponível após cadastro';
        btn.addEventListener('click', () => this.handleLockedClick());
        strip.appendChild(btn);
      });

      // Marcador no final da tira: total da biblioteca
      const total = document.createElement('div');
      total.className = 'rhythm-strip-total';
      total.textContent = `+${lockedNames.length} ritmos com cadastro`;
      strip.appendChild(total);

      // CSS dos locked + marcador (injetado uma vez)
      this.injectLockedStyles();
    } catch {
      // Manifest falhou: segue sem os locked (pior cenário = igual antes)
    }
  }

  private injectLockedStyles(): void {
    if (document.getElementById('demo-locked-css')) return;
    const style = document.createElement('style');
    style.id = 'demo-locked-css';
    style.textContent = `
      .rhythm-card-btn.rhythm-card-locked {
        opacity: 0.55;
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        cursor: pointer;
      }
      .rhythm-card-btn.rhythm-card-locked:hover {
        opacity: 0.85;
      }
      .rhythm-card-locked .rhythm-lock-icon {
        color: rgba(255, 255, 255, 0.5);
        flex-shrink: 0;
      }
      .rhythm-strip-total {
        display: inline-flex;
        align-items: center;
        padding: 0 0.9rem;
        margin-left: 0.3rem;
        font-size: 0.72rem;
        letter-spacing: 0.02em;
        color: rgba(255, 255, 255, 0.4);
        white-space: nowrap;
        border-left: 1px solid rgba(255, 255, 255, 0.08);
      }
    `;
    document.head.appendChild(style);
  }

  private handleLockedClick(): void {
    if (this.expired) { this.showExpired(); return; }
    HapticsService.light();
    // Se ainda tem cota, mostra a tela de fim antecipadamente
    // com tom de "isso é só uma prévia"
    this.markExpired();
    this.showExpired();
  }

  private async loadRhythm(rhythm: { name: string; path: string }): Promise<void> {
    if (this.expired) { this.showExpired(); return; }

    // Verificar limite
    if (!this.rhythmsUsed.has(rhythm.name)) {
      if (this.rhythmsUsed.size >= MAX_RHYTHMS) {
        this.stop();
        this.markExpired();
        this.showExpired();
        return;
      }
      this.rhythmsUsed.add(rhythm.name);
      this.updateCounter();
    }

    this.resetIdleTimer();
    if (this.stateManager.isPlaying()) this.stop();

    try {
      await this.fileManager.loadProjectFromPath(rhythm.path);
      this.stateManager.loadVariation('main', 0);
      this.currentRhythmName = rhythm.name;

      const nameEl = document.getElementById('currentRhythmName');
      if (nameEl) nameEl.textContent = rhythm.name;

      this.uiManager.updateTempoUI(this.stateManager.getTempo());
      this.uiManager.refreshGridDisplay();
      this.uiManager.updateVariationButtons();
      this.uiManager.updatePerformanceGrid();

      // Highlight
      document.querySelectorAll('#demoRhythmStrip .rhythm-card-btn').forEach(btn => {
        btn.classList.toggle('active', btn.textContent === rhythm.name);
      });
    } catch {
      const nameEl = document.getElementById('currentRhythmName');
      if (nameEl) nameEl.textContent = 'Erro ao carregar';
    }
  }

  // ─── Play/Stop ────────────────────────────────────────────────────

  private play(): void {
    if (this.expired) { this.showExpired(); return; }
    this.resetIdleTimer();
    this.audioManager.resume();
    this.stateManager.setPlaying(true);

    this.uiManager.updatePlayStopUI(true);
    this.uiManager.updateStatusUI(this.stateManager.getActivePattern());
    this.uiManager.updatePerformanceGrid();
    this.scheduler.start();
  }

  private stop(): void {
    this.stateManager.setPlaying(false);
    this.stateManager.resetStep();
    this.stateManager.setActivePattern('main');
    this.scheduler.stop();

    this.uiManager.updatePlayStopUI(false);
    this.uiManager.updatePerformanceGrid();

    document.querySelectorAll('.beat-dot').forEach(d => {
      d.classList.remove('beat-active', 'beat-pulse');
    });
  }

  // ─── Expired ──────────────────────────────────────────────────────

  private showExpired(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.stateManager?.isPlaying()) this.stop();

    document.querySelectorAll('.demo-expired-overlay').forEach(el => el.remove());

    const overlay = document.createElement('div');
    overlay.className = 'demo-expired-overlay';
    overlay.innerHTML = `
      <div class="demo-expired-card">
        <div class="demo-expired-overline">Fim da demonstração</div>
        <h2>Os outros 69 ritmos estão aqui.</h2>
        <p>
          A demonstração é uma prévia curta. A biblioteca completa tem
          72 ritmos com viradas, intros e finais — o material que segura
          uma música do começo ao fim.
        </p>
        <p>
          Pedal Bluetooth, setlist de palco e modo offline também
          fazem parte do plano. O teste de 48 horas é gratuito e não
          pede cartão.
        </p>
        <div class="demo-expired-price">
          <span class="demo-expired-price-amount">R$ 29</span>
          <span class="demo-expired-price-unit">por mês</span>
          <span class="demo-expired-price-note">ou 48h grátis</span>
        </div>
        <a href="/register.html" class="demo-expired-cta">Criar minha conta</a>
        <div class="demo-expired-sub">
          Já tem conta? <a href="/login.html">Entrar</a>
        </div>
        <div class="demo-expired-support">
          <a href="https://chat.whatsapp.com/CnTLQogcUNFEVeFkyKzkyK" target="_blank">
            Falar com o suporte
          </a>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  AttributionService.init();
  new DemoPlayer();
});
