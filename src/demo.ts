// Demo mode — sequenciador limitado sem auth
// 4 ritmos, 5 minutos de reproducao, fingerprint pra evitar reset

import { StateManager } from './core/StateManager';
import { AudioManager } from './core/AudioManager';
import { Scheduler } from './core/Scheduler';
import { PatternEngine } from './core/PatternEngine';
import { FileManager } from './io/FileManager';
import { MAX_CHANNELS, type PatternType } from './types';

const DEMO_RHYTHMS = [
  { name: 'Vaneira', path: '/rhythm/Vaneira.json' },
  { name: 'Samba', path: '/rhythm/Samba.json' },
  { name: 'Seresta', path: '/rhythm/Seresta.json' },
  { name: 'Pop Rock', path: '/rhythm/Pop Rock.json' },
];

const MAX_RHYTHMS = 2; // Maximo de ritmos que pode testar
const IDLE_TIMEOUT = 3 * 60 * 1000; // 3 minutos sem tocar = expira
const STORAGE_KEY = 'gdrums_demo_used';
const FP_KEY = 'gdrums_demo_fp';

class DemoPlayer {
  private audioContext!: AudioContext;
  private stateManager!: StateManager;
  private audioManager!: AudioManager;
  private scheduler!: Scheduler;
  private patternEngine!: PatternEngine;
  private fileManager!: FileManager;
  private currentRhythm = '';
  private rhythmsUsed = new Set<string>();
  private idleTimer: number | null = null;
  private isPlaying = false;
  private expired = false;

  constructor() {
    // Verificar se ja usou o demo
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

    this.setupCallbacks();
    this.setupUI();
    this.updateCounterDisplay();
    this.resetIdleTimer();
    this.saveFingerprint();
  }

  // ─── Fingerprint + persistencia ────────────────────────────────────

  private getFingerprint(): string {
    const nav = [
      navigator.language, screen.width, screen.height,
      screen.colorDepth, new Date().getTimezoneOffset(),
    ].join('_');
    return btoa(nav).slice(0, 24);
  }

  private saveFingerprint(): void {
    const fp = this.getFingerprint();
    try {
      localStorage.setItem(FP_KEY, fp);
      document.cookie = `gdrums_fp=${fp};max-age=31536000;path=/`;
    } catch {}
  }

  private isDemoExpired(): boolean {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'expired') return true;
    // Cookie fallback
    if (document.cookie.includes('gdrums_demo_used=expired')) return true;
    return false;
  }

  private markExpired(): void {
    this.expired = true;
    try {
      localStorage.setItem(STORAGE_KEY, 'expired');
      document.cookie = 'gdrums_demo_used=expired;max-age=31536000;path=/';
    } catch {}
  }

  // ─── Idle timer ───────────────────────────────────────────────────

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      if (!this.isPlaying && !this.expired) {
        this.markExpired();
        this.showExpired();
      }
    }, IDLE_TIMEOUT);
  }

  // ─── Counter display ─────────────────────────────────────────────

  private updateCounterDisplay(): void {
    const clock = document.getElementById('demoTimerClock');
    const bar = document.getElementById('demoTimerBar');
    const remaining = MAX_RHYTHMS - this.rhythmsUsed.size;

    if (clock) {
      clock.textContent = `${remaining} ritmo${remaining !== 1 ? 's' : ''} restante${remaining !== 1 ? 's' : ''}`;
      if (remaining <= 1) clock.style.color = '#f04466';
    }
    if (bar) {
      bar.style.width = `${(remaining / MAX_RHYTHMS) * 100}%`;
    }
  }

  // ─── Callbacks ────────────────────────────────────────────────────

  private setupCallbacks(): void {
    this.scheduler.setUpdateStepCallback((step: number, pattern: PatternType) => {
      this.updateBeatMarker(step, pattern);
    });

    this.patternEngine.setOnPatternChange((pattern: PatternType) => {
      // noop no demo
    });

    this.patternEngine.setOnStop(() => {
      this.stop();
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
    // Ritmos
    const strip = document.getElementById('demoRhythmStrip');
    if (strip) {
      DEMO_RHYTHMS.forEach(r => {
        const btn = document.createElement('button');
        btn.style.cssText = 'padding:0.5rem 1rem;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;color:rgba(255,255,255,0.7);font-size:0.82rem;font-weight:600;font-family:inherit;cursor:pointer;white-space:nowrap;transition:all 0.12s;flex-shrink:0;';
        btn.textContent = r.name;
        btn.addEventListener('click', () => this.loadRhythm(r));
        strip.appendChild(btn);
      });
    }

    // Play/Stop
    const playBtn = document.getElementById('demoPlayBtn');
    playBtn?.addEventListener('click', () => {
      if (this.isPlaying) {
        this.stop();
      } else {
        this.play();
      }
    });

    // BPM
    document.getElementById('tempoUp')?.addEventListener('click', () => {
      const newTempo = Math.min(240, this.stateManager.getTempo() + 1);
      this.stateManager.setTempo(newTempo);
      this.updateTempoDisplay();
    });

    document.getElementById('tempoDown')?.addEventListener('click', () => {
      const newTempo = Math.max(40, this.stateManager.getTempo() - 1);
      this.stateManager.setTempo(newTempo);
      this.updateTempoDisplay();
    });

    // Carregar primeiro ritmo
    this.loadRhythm(DEMO_RHYTHMS[0]);
  }

  private updateTempoDisplay(): void {
    const el = document.getElementById('tempoDisplay');
    if (el) el.textContent = this.stateManager.getTempo().toString();
  }

  // ─── Ritmo ────────────────────────────────────────────────────────

  private async loadRhythm(rhythm: { name: string; path: string }): Promise<void> {
    if (this.expired) { this.showExpired(); return; }

    // Verificar limite de ritmos
    if (!this.rhythmsUsed.has(rhythm.name)) {
      if (this.rhythmsUsed.size >= MAX_RHYTHMS) {
        // Limite atingido
        this.stop();
        this.markExpired();
        this.showExpired();
        return;
      }
      this.rhythmsUsed.add(rhythm.name);
      this.updateCounterDisplay();
    }

    this.resetIdleTimer();
    if (this.isPlaying) this.stop();

    try {
      await this.fileManager.loadProjectFromPath(rhythm.path);
      this.stateManager.loadVariation('main', 0);
      this.currentRhythm = rhythm.name;

      const nameEl = document.getElementById('demoRhythmName');
      if (nameEl) nameEl.textContent = rhythm.name;

      this.updateTempoDisplay();

      // Highlight botao ativo
      document.querySelectorAll('#demoRhythmStrip button').forEach(btn => {
        const isActive = btn.textContent === rhythm.name;
        (btn as HTMLElement).style.borderColor = isActive ? 'rgba(0,212,255,0.4)' : 'rgba(255,255,255,0.08)';
        (btn as HTMLElement).style.color = isActive ? '#00D4FF' : 'rgba(255,255,255,0.7)';
        (btn as HTMLElement).style.background = isActive ? 'rgba(0,212,255,0.08)' : 'rgba(255,255,255,0.04)';
      });

      // Build performance grid
      this.buildPerformanceGrid();
    } catch {
      const nameEl = document.getElementById('demoRhythmName');
      if (nameEl) nameEl.textContent = 'Erro ao carregar';
    }
  }

  private buildPerformanceGrid(): void {
    const grid = document.getElementById('performanceGrid');
    if (!grid) return;

    const state = this.stateManager.getState();
    const hasMain = state.variations.main.filter((v, i) =>
      v.pattern.some(row => row.some(s => s))
    );

    grid.innerHTML = '';

    hasMain.forEach((_, i) => {
      const cell = document.createElement('div');
      cell.className = 'grid-cell main-cell';
      cell.innerHTML = `<span class="cell-label">RITMO ${i + 1}</span><div class="cell-indicator"></div>`;
      cell.addEventListener('click', () => {
        if (!this.isPlaying) {
          this.patternEngine.activateRhythm(i);
          this.play();
        } else if (i === this.stateManager.getCurrentVariation('main')) {
          this.stop();
        } else {
          this.patternEngine.playFillToNextRhythm(i);
        }
      });
      grid.appendChild(cell);
    });

    // Fill
    const hasFill = state.variations.fill.some(v =>
      v.pattern.some(row => row.some(s => s))
    );
    if (hasFill) {
      const cell = document.createElement('div');
      cell.className = 'grid-cell fill-cell';
      cell.innerHTML = '<span class="cell-label">VIRADA</span><div class="cell-indicator"></div>';
      cell.addEventListener('click', () => {
        if (this.isPlaying) this.patternEngine.playRotatingFill();
      });
      grid.appendChild(cell);
    }

    // End
    const hasEnd = state.variations.end.some(v =>
      v.pattern.some(row => row.some(s => s))
    );
    if (hasEnd) {
      const cell = document.createElement('div');
      cell.className = 'grid-cell end-cell';
      cell.innerHTML = '<span class="cell-label">FINAL</span><div class="cell-indicator"></div>';
      cell.addEventListener('click', () => {
        if (this.isPlaying) this.patternEngine.playEndAndStop();
      });
      grid.appendChild(cell);
    }
  }

  // ─── Play/Stop ────────────────────────────────────────────────────

  private play(): void {
    if (this.expired) { this.showExpired(); return; }

    this.resetIdleTimer();
    this.audioManager.resume();
    this.stateManager.setPlaying(true);
    this.isPlaying = true;

    this.stateManager.setShouldPlayStartSound(true);
    this.scheduler.start();

    const btn = document.getElementById('demoPlayBtn');
    if (btn) {
      btn.innerHTML = '<span class="play-icon">&#9632;</span><span class="play-label">PARAR</span>';
      btn.classList.add('playing');
    }
  }

  private stop(): void {
    this.stateManager.setPlaying(false);
    this.stateManager.resetStep();
    this.stateManager.setActivePattern('main');
    this.scheduler.stop();
    this.isPlaying = false;

    const btn = document.getElementById('demoPlayBtn');
    if (btn) {
      btn.innerHTML = '<span class="play-icon">&#9654;</span><span class="play-label">TOCAR</span>';
      btn.classList.remove('playing');
    }

    // Resetar beat dots
    document.querySelectorAll('.beat-dot').forEach(d => {
      d.classList.remove('beat-active', 'beat-pulse');
    });
  }

  // ─── Expired ──────────────────────────────────────────────────────

  private showExpired(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.isPlaying) this.stop();

    // Remover overlay anterior se existir
    document.querySelectorAll('.demo-expired-overlay').forEach(el => el.remove());

    const overlay = document.createElement('div');
    overlay.className = 'demo-expired-overlay';
    overlay.innerHTML = `
      <div class="demo-expired-card">
        <img src="/img/logo.png" alt="GDrums" style="height:36px;opacity:0.7;margin-bottom:1.5rem;">
        <h2>Sentiu a diferenca?</h2>
        <p>Isso e so o comeco. Sao 50 ritmos profissionais que seguram sua musica do comeco ao fim. Viradas, intros, finalizacoes — tudo no seu controle.</p>
        <a href="/register.html" class="demo-expired-cta">LIBERAR A BANDA COMPLETA</a>
        <div class="demo-expired-sub">
          Ja tem conta? <a href="/login.html">Fazer login</a>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new DemoPlayer();
});
