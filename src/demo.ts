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
import { RHYTHM_COUNT, LOCKED_RHYTHM_COUNT, updateRhythmCountInDom } from './utils/rhythmCount';

// Só 3 ritmos ficam liberados. O resto aparece bloqueado na tira
// pra mostrar ao user o tamanho REAL da biblioteca — peça central pra
// evitar o engano de "só tem 3 ritmos, o app é fraco".
// Seleção: estilos populares entre públicos distintos (forró/nordeste,
// gospel, gaúcho) pra cada perfil sentir que tem algo familiar.
const DEMO_RHYTHMS = [
  { name: 'Arrocha', path: '/rhythm/Arrocha.json' },
  { name: 'Gospel', path: '/rhythm/Gospel.json' },
  { name: 'Xote Nordestino', path: '/rhythm/Xote Nordestino.json' },
];

// Demo curta de propósito: 3 ritmos + 5min CORRIDOS (não inatividade)
// forçam o user a se cadastrar enquanto a curiosidade está em alta.
// O timer só começa no PRIMEIRO PLAY (dar tempo do cara ler e entender
// a tela), não ao abrir a página.
// Aos 4min (1min restante) aparece um aviso discreto. Aos 5min, showExpired.
const MAX_RHYTHMS = 3;
const DEMO_TOTAL_MS = 5 * 60 * 1000;      // tempo total depois do 1º play
const DEMO_WARN_AT_MS = 4 * 60 * 1000;    // aviso em 1 min restante
const STORAGE_KEY = 'gdrums_demo_used';
const FP_KEY = 'gdrums_demo_fp';

// Passos do tour guiado — cada um aponta pra um elemento e avança
// quando o user FAZ a ação pedida. Nada bloqueia o usuário: se ele
// já souber usar o app, pode ignorar e os tooltips somem sozinhos.
type TourStep = {
  target: string;              // CSS selector do elemento-alvo
  title: string;               // copy curto
  body: string;                // instrução
  advanceOn: 'click' | 'auto'; // como o passo avança
  autoDelayMs?: number;        // pra steps 'auto'
  position?: 'top' | 'bottom' | 'right' | 'left'; // posição do tooltip
};

const TOUR_STEPS: TourStep[] = [
  {
    target: '.grid-cell[data-type="main"][data-variation="0"]',
    title: 'Comece tocando',
    body: 'Aperte o Ritmo 1 pra ouvir a banda entrar.',
    advanceOn: 'click',
    position: 'top',
  },
  {
    target: '.grid-cell[data-type="fill"][data-variation="1"]',
    title: 'Agora solte uma virada',
    body: 'Toque a Virada 2 — ela entra no tempo certo, como baterista de verdade.',
    advanceOn: 'click',
    position: 'top',
  },
  {
    target: '.grid-cell[data-type="main"][data-variation="2"]',
    title: 'Troque de ritmo',
    body: 'Aperte o Ritmo 3. O app faz a virada automática na transição.',
    advanceOn: 'click',
    position: 'top',
  },
  {
    target: '.grid-cell[data-type="end"][data-variation="0"]',
    title: 'Finalize a música',
    body: 'O Final encerra a música no tempo certo — com direito a prato de saída. Aperte pra ver.',
    advanceOn: 'click',
    position: 'top',
  },
];

class DemoPlayer {
  private audioContext!: AudioContext;
  private stateManager!: StateManager;
  private audioManager!: AudioManager;
  private scheduler!: Scheduler;
  private patternEngine!: PatternEngine;
  private fileManager!: FileManager;
  private uiManager!: UIManager;
  private rhythmsUsed = new Set<string>();
  private demoTimer: number | null = null;         // timer de expiração
  private demoWarnTimer: number | null = null;     // timer do aviso de 1min
  private demoStartedAt: number | null = null;     // timestamp do 1º play
  private expired = false;
  private cymbalBuffer: AudioBuffer | null = null;
  private currentRhythmName = '';
  private tourIdx = 0;
  private tourDone = false;
  private tourTooltip: HTMLElement | null = null;
  private rhythmsTrocados = 0;
  private conversionShown = false;
  // Lido do manifest real em runtime. RHYTHM_COUNT é fallback (fonte única)
  private totalRhythms = RHYTHM_COUNT;

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
    updateRhythmCountInDom();           // atualiza .js-rhythm-count imediatamente
    this.loadManifestCount();            // e também o contador dinâmico do demo
    this.updateCounter();
    // Timer da demo só inicia no 1º play — não ao abrir a página
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

  /**
   * Inicia o timer corrido da demo no primeiro play. Depois disso o
   * relógio não para — quando acabar, showExpired independente do que
   * o user esteja fazendo.
   * Se já foi iniciado, não reinicia (não acumula tempo em reloads).
   */
  private startDemoTimer(): void {
    if (this.demoStartedAt !== null) return; // já rodando
    if (this.expired) return;

    this.demoStartedAt = Date.now();

    // Aviso de 1 min restante
    this.demoWarnTimer = window.setTimeout(() => {
      if (!this.expired) this.showOneMinuteWarning();
    }, DEMO_WARN_AT_MS);

    // Expiração total
    this.demoTimer = window.setTimeout(() => {
      if (!this.expired) {
        this.markExpired();
        this.showExpired();
      }
    }, DEMO_TOTAL_MS);
  }

  private clearDemoTimers(): void {
    if (this.demoTimer !== null) { clearTimeout(this.demoTimer); this.demoTimer = null; }
    if (this.demoWarnTimer !== null) { clearTimeout(this.demoWarnTimer); this.demoWarnTimer = null; }
  }

  /**
   * Banner sutil: '1 minuto restante da prévia'. Aparece no topo do
   * counter do header, gerando pressão real mas sem bloquear a experiência.
   */
  private showOneMinuteWarning(): void {
    const el = document.getElementById('demoCounter');
    if (!el) return;
    el.innerHTML = `<strong>1 min restante da prévia</strong> · crie conta pra continuar`;
    el.classList.add('low');
  }

  /**
   * Busca o manifest real pra pegar o número de ritmos do catálogo.
   * Em caso de falha (offline, manifest quebrado), mantém fallback RHYTHM_COUNT.
   */
  private async loadManifestCount(): Promise<void> {
    try {
      const res = await fetch('/rhythm/manifest.json');
      const m = await res.json();
      if (m && Array.isArray(m.rhythms) && m.rhythms.length > 0) {
        this.totalRhythms = m.rhythms.length;
        this.updateCounter();
      }
    } catch {
      // mantém fallback
    }
  }

  private updateCounter(): void {
    const remaining = MAX_RHYTHMS - this.rhythmsUsed.size;
    const total = this.totalRhythms;
    const el = document.getElementById('demoCounter');
    const bar = document.getElementById('demoBar');
    if (el) {
      // Mensagem foca no tamanho do CATÁLOGO (lido do manifest), não na
      // cota da demo. Usuário precisa saber que tem muito mais esperando.
      // Quando resta 1 ou acabou, muda pra tom de pressão.
      if (remaining <= 0) {
        el.innerHTML = `Prévia encerrada · <strong>${total} ritmos no plano</strong>`;
      } else if (remaining === 1) {
        el.innerHTML = `Último ritmo da prévia · <strong>${total} no catálogo</strong>`;
      } else {
        el.innerHTML = `Prévia com ${MAX_RHYTHMS} ritmos · <strong>${total} no catálogo</strong>`;
      }
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
            this.rhythmsTrocados += 1;
            // 3 trocas sem ter visto ainda → mostra modal (aha moment confirmado)
            if (this.rhythmsTrocados >= 3 && !this.conversionShown) {
              this.maybeShowConversionModal();
            }
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

    // Iniciar tour guiado depois que a UI terminou de montar
    // (espera um tick pra CSS aplicar posicionamento das células)
    setTimeout(() => this.startTour(), 800);
  }

  // ─── Tour guiado ──────────────────────────────────────────────────

  private startTour(): void {
    if (this.tourDone) return;
    // Se user já deu play antes do tour começar, pula o primeiro passo
    if (this.stateManager.isPlaying() && this.tourIdx === 0) this.tourIdx = 1;
    this.renderTourStep();
  }

  private renderTourStep(): void {
    this.clearTourTooltip();
    if (this.tourIdx >= TOUR_STEPS.length) {
      this.tourDone = true;
      this.maybeShowConversionModal();
      return;
    }
    const step = TOUR_STEPS[this.tourIdx];
    const target = document.querySelector(step.target) as HTMLElement | null;
    if (!target) {
      // Elemento não achado → pula pro próximo (defensive)
      this.tourIdx += 1;
      setTimeout(() => this.renderTourStep(), 100);
      return;
    }

    // Tooltip
    const tip = document.createElement('div');
    tip.className = 'demo-tour-tip';
    tip.innerHTML = `
      <div class="demo-tour-tip-title">${step.title}</div>
      <div class="demo-tour-tip-body">${step.body}</div>
      <div class="demo-tour-tip-skip" role="button" tabindex="0">Pular tour</div>
    `;
    document.body.appendChild(tip);
    this.tourTooltip = tip;

    // Posicionar tooltip acima do target
    requestAnimationFrame(() => {
      const rect = target.getBoundingClientRect();
      const tipRect = tip.getBoundingClientRect();
      const pos = step.position || 'top';
      let top = 0, left = 0;
      if (pos === 'top') {
        top = rect.top + window.scrollY - tipRect.height - 14;
        left = rect.left + window.scrollX + (rect.width / 2) - (tipRect.width / 2);
      } else if (pos === 'bottom') {
        top = rect.bottom + window.scrollY + 14;
        left = rect.left + window.scrollX + (rect.width / 2) - (tipRect.width / 2);
      }
      // Guard: não deixar sair da tela
      left = Math.max(12, Math.min(window.innerWidth - tipRect.width - 12, left));
      top = Math.max(12, top);
      tip.style.top = `${top}px`;
      tip.style.left = `${left}px`;
      tip.classList.add('visible');
    });

    // Pulse no target
    target.classList.add('demo-tour-pulse');

    // Skip button
    tip.querySelector('.demo-tour-tip-skip')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.tourDone = true;
      this.clearTourTooltip();
      target.classList.remove('demo-tour-pulse');
    });

    // Avanço
    if (step.advanceOn === 'click') {
      const onClick = () => {
        target.removeEventListener('click', onClick);
        target.classList.remove('demo-tour-pulse');
        this.tourIdx += 1;
        // Espera o step musical acontecer antes de pular pro próximo (1.5s)
        setTimeout(() => this.renderTourStep(), 1500);
      };
      target.addEventListener('click', onClick, { once: true });
    } else if (step.advanceOn === 'auto') {
      setTimeout(() => {
        target.classList.remove('demo-tour-pulse');
        this.tourIdx += 1;
        this.renderTourStep();
      }, step.autoDelayMs || 2500);
    }
  }

  private clearTourTooltip(): void {
    if (this.tourTooltip) {
      this.tourTooltip.remove();
      this.tourTooltip = null;
    }
  }

  // ─── Modal de conversão progressivo ──────────────────────────────
  // Aparece após o tour completar OU após 3 trocas de ritmo (sinal forte
  // de que o user entendeu o app e tá extraindo valor). Não trava, só
  // aparece elegante por cima e pode ser dispensado.

  private maybeShowConversionModal(): void {
    if (this.conversionShown) return;
    if (this.expired) return;
    this.conversionShown = true;
    setTimeout(() => this.showConversionModal(), 500);
  }

  private showConversionModal(): void {
    if (this.expired) return;
    document.querySelectorAll('.demo-convert-modal').forEach(el => el.remove());

    const overlay = document.createElement('div');
    overlay.className = 'demo-convert-modal';
    overlay.innerHTML = `
      <div class="demo-convert-card">
        <div class="demo-convert-overline">Gostou?</div>
        <h3 class="demo-convert-title">Isso é só uma prévia.</h3>
        <p class="demo-convert-body">
          Você acabou de tocar com acompanhamento profissional.
          Cria conta pra liberar os outros ${LOCKED_RHYTHM_COUNT} ritmos, conectar pedal
          Bluetooth e montar sua setlist.
        </p>
        <div class="demo-convert-offer">
          <span class="demo-convert-offer-badge">Grátis</span>
          <span class="demo-convert-offer-head">48 horas de acesso total</span>
          <span class="demo-convert-offer-sub">Sem cartão. Cancele quando quiser.</span>
        </div>
        <div class="demo-convert-actions">
          <a href="/register" class="demo-convert-primary">Começar grátis</a>
          <button class="demo-convert-secondary">Continuar testando</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));

    overlay.querySelector('.demo-convert-secondary')?.addEventListener('click', () => {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 220);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('visible');
        setTimeout(() => overlay.remove(), 220);
      }
    });
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
    // Inicia o timer corrido no PRIMEIRO play (se já iniciou, no-op)
    this.startDemoTimer();
    this.audioManager.resume();
    this.stateManager.setPlaying(true);

    this.uiManager.updatePlayStopUI(true);
    this.uiManager.updateStatusUI(this.stateManager.getActivePattern());
    this.uiManager.updatePerformanceGrid();
    this.scheduler.start();

    // Mostra banner de reforço assim que o user começa a tocar
    // (primeiro play = ele sentiu o valor, aí reforça o cadastro).
    const banner = document.getElementById('demoValueBanner');
    if (banner && banner.style.display === 'none') {
      setTimeout(() => {
        banner.style.display = 'flex';
        document.body.classList.add('with-banner');
      }, 3000);
    }
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
    this.clearDemoTimers();
    if (this.stateManager?.isPlaying()) this.stop();

    document.querySelectorAll('.demo-expired-overlay').forEach(el => el.remove());

    const overlay = document.createElement('div');
    overlay.className = 'demo-expired-overlay';
    overlay.innerHTML = `
      <div class="demo-expired-card">
        <div class="demo-expired-overline">Você tocou bem</div>
        <h2>Agora é pegar a banda completa.</h2>
        <p>
          Você tocou 3 ritmos. A biblioteca tem <strong>${this.totalRhythms}</strong> —
          Vaneira, Sertanejo, Gospel, Pagode, Forró, Reggae, Rock e muito
          mais, cada um com viradas, intros e finais prontos pra palco.
        </p>

        <!-- Preview do catálogo: lista dos ritmos bloqueados passando -->
        <div class="demo-expired-catalog">
          <div class="demo-expired-catalog-track" id="demoCatalogTrack"></div>
        </div>

        <div class="demo-expired-features">
          <div class="demo-expired-feature"><span>${this.totalRhythms}</span>ritmos completos</div>
          <div class="demo-expired-feature"><span>BT</span>pedal Bluetooth</div>
          <div class="demo-expired-feature"><span>∞</span>offline no palco</div>
        </div>

        <!-- Oferta do trial em destaque: 48h grátis ANTES do preço.
             Remove a objeção 'quanto custa' na hora do click. O preço
             aparece abaixo, como referência secundária. -->
        <div class="demo-expired-offer">
          <div class="demo-expired-offer-main">
            <span class="demo-expired-offer-badge">Grátis</span>
            <span class="demo-expired-offer-head">48 horas de acesso total</span>
          </div>
          <div class="demo-expired-offer-sub">Sem cartão. Sem cobrança automática. Cancela a hora que quiser.</div>
          <div class="demo-expired-offer-price">Depois, R$ 29/mês</div>
        </div>
        <!-- Campo inline de e-mail: reduz fricção do cadastro.
             O user digita aqui, a gente leva pro /register com o email
             pré-preenchido via ?email= na URL. Um input = uma fricção
             a menos. -->
        <form id="demoQuickSignup" class="demo-expired-quick">
          <input
            type="email"
            id="demoEmailInput"
            class="demo-expired-email"
            placeholder="Seu e-mail"
            autocomplete="email"
            required
          />
          <button type="submit" class="demo-expired-cta">Criar conta grátis</button>
        </form>

        <div class="demo-expired-sub">
          Já tem conta? <a href="/login">Entrar</a>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Popular o carrossel com os ritmos bloqueados reais
    this.populateExpiredCatalog();

    // Quick signup: leva pro /register com email pré-preenchido
    const quickForm = document.getElementById('demoQuickSignup') as HTMLFormElement | null;
    quickForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('demoEmailInput') as HTMLInputElement | null;
      const email = input?.value.trim() || '';
      const q = email ? `?email=${encodeURIComponent(email)}` : '';
      window.location.href = `/register${q}`;
    });
  }

  /**
   * Preenche a faixa horizontal com os nomes dos ritmos bloqueados
   * (usa o manifest real). Sinaliza visualmente o tamanho da biblioteca
   * pro cara que tá vendo a tela de fim.
   */
  private async populateExpiredCatalog(): Promise<void> {
    const track = document.getElementById('demoCatalogTrack');
    if (!track) return;
    try {
      const res = await fetch('/rhythm/manifest.json');
      const manifest = await res.json();
      const freeNames = new Set(DEMO_RHYTHMS.map(r => r.name));
      const names = (manifest.rhythms || [])
        .map((f: string) => f.replace(/\.json$/, ''))
        .filter((n: string) => !freeNames.has(n));
      // Duplica pra animação loop ficar contínua
      const html = [...names, ...names].map((n: string) => `<span>${n}</span>`).join('');
      track.innerHTML = html;
    } catch {
      // Se falhar, só não mostra a faixa
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  AttributionService.init();
  new DemoPlayer();
});
