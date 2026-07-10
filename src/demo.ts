// Demo mode — app identico ao real mas com limite de ritmos
// Usa mesma UI (styles.css), mesmos IDs, mesma experiencia

import { StateManager } from './core/StateManager';
import { WebAudioEngine } from './core/audio/WebAudioEngine';
import { Scheduler } from './core/Scheduler';
import { PatternEngine } from './core/PatternEngine';
import { FileManager } from './io/FileManager';
import { UIManager } from './ui/UIManager';
import { MAX_CHANNELS, type PatternType } from './types';
import { HapticsService } from './native/HapticsService';
import { AttributionService } from './native/AttributionService';
import { RHYTHM_COUNT, LOCKED_RHYTHM_COUNT, updateRhythmCountInDom } from './utils/rhythmCount';
import { redirectIfRecoveryHash } from './auth/recoveryGuard';
import { t, hydrate } from './i18n';

// Hidrata o HTML estático (data-i18n) ANTES de qualquer render dinâmico —
// pra pt-BR é no-op visual (valores byte-idênticos ao HTML).
hydrate();

// Só estes ritmos ficam liberados. O resto aparece bloqueado no catálogo
// (botão TODOS) pra mostrar ao user o tamanho REAL da biblioteca — peça
// central pra evitar o engano de "só tem uns poucos, o app é fraco".
// Seleção: estilos populares entre públicos distintos (forró/nordeste,
// gospel, gaúcho, samba) pra cada perfil sentir que tem algo familiar.
// ATENÇÃO: MAX_RHYTHMS (a cota de créditos) deriva do tamanho desta lista.
const DEMO_RHYTHMS = [
  { name: 'Arrocha', path: '/rhythm/Arrocha.json' },
  { name: 'Gospel', path: '/rhythm/Gospel.json' },
  { name: 'Xote Nordestino', path: '/rhythm/Xote Nordestino.json' },
  { name: 'Vaneira', path: '/rhythm/Vaneira.json' },
  { name: 'Samba (pandeiro)', path: '/rhythm/Samba (pandeiro).json' },
];

// Demo curta de propósito: cota de ritmos + 5min CORRIDOS (não inatividade)
// forçam o user a se cadastrar enquanto a curiosidade está em alta.
// O timer só começa no PRIMEIRO PLAY (dar tempo do cara ler e entender
// a tela), não ao abrir a página.
// Aos 4min (1min restante) aparece um aviso discreto. Aos 5min, showExpired.
//
// CRÉDITOS: um por ritmo liberado, então a barra desce de 20 em 20%.
// O PRIMEIRO ritmo distinto é de graça — é o que já vem carregado e serve
// pro tour guiado. A cota só desconta do segundo em diante (ver
// creditsUsed()). Recarregar um ritmo já usado nunca desconta.
// Percurso da barra: 100% → 80% → 60% → 40% → 20% (último ritmo).
const MAX_RHYTHMS = DEMO_RHYTHMS.length;   // 5

// Restando ESTE tanto de créditos (ou menos), abre a janela "Isso é só uma
// prévia". Com 5 ritmos e o 1º grátis, restar 1 = o 5º e ÚLTIMO ritmo foi
// ativado (barra em 20%) — o visitante já esgotou a demo, é a hora da
// pressão de cadastro.
const CONVERT_AT_REMAINING = 1;
const DEMO_TOTAL_MS = 5 * 60 * 1000;      // tempo total depois do 1º play
const DEMO_WARN_AT_MS = 4 * 60 * 1000;    // aviso em 1 min restante
const STORAGE_KEY = 'gdrums_demo_used';
const FP_KEY = 'gdrums_demo_fp';

// ─── Bypass de TESTE (só desenvolvimento) ────────────────────────────────
// Com `?nolimit=1` a demo não expira, não inicia o timer e ignora a marca de
// "demo já usada" — pra testar a tela sem queimar a demo a cada reload.
// Trava dupla: só vale em localhost / rede local (192.168.x). Em produção
// (gdrums.com.br) o hostname nunca casa, então é SEMPRE false.
const IS_LOCAL_DEV =
  ['localhost', '127.0.0.1'].includes(location.hostname) || /^192\.168\./.test(location.hostname);
const DEV_NO_LIMIT = IS_LOCAL_DEV && new URLSearchParams(location.search).has('nolimit');

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
    title: t('demo.tour.step1.title'),
    body: t('demo.tour.step1.body'),
    advanceOn: 'click',
    position: 'top',
  },
  {
    target: '.grid-cell[data-type="fill"][data-variation="1"]',
    title: t('demo.tour.step2.title'),
    body: t('demo.tour.step2.body'),
    advanceOn: 'click',
    position: 'top',
  },
  {
    target: '.grid-cell[data-type="main"][data-variation="2"]',
    title: t('demo.tour.step3.title'),
    body: t('demo.tour.step3.body'),
    advanceOn: 'click',
    position: 'top',
  },
  {
    target: '.grid-cell[data-type="end"][data-variation="0"]',
    title: t('demo.tour.step4.title'),
    body: t('demo.tour.step4.body'),
    advanceOn: 'click',
    position: 'top',
  },
];

class DemoPlayer {
  private audioContext!: AudioContext;
  private stateManager!: StateManager;
  private audioManager!: WebAudioEngine;
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

  // ─── Pausa com contagem (mesmo comportamento do app) ──────────────────
  private isPaused = false;
  private resuming = false;                 // CONTINUAR apertado, aguardando o tempo
  private countActive = false;              // loop da contagem (chimbal) rodando
  private countLoopTimer: number | null = null;
  private countGridStart = 0;               // t0 da grade da contagem (relógio de áudio)
  private countSpb = 0;                     // segundos por tempo da contagem
  private lastStepTime = 0;                 // tempo de áudio do último step (fase do ritmo)
  private lastStepIndex = 0;                // índice do último step tocado
  private countFlashTimers: number[] = [];  // timers do pisca laranja do botão
  private countVolume = 0.6;                // volume do chimbal da contagem
  private pendingResumeAction: { type: 'fill' | 'end'; variationIndex: number } | null = null;
  private currentRhythmName = '';
  private tourIdx = 0;
  private tourDone = false;
  private tourTooltip: HTMLElement | null = null;
  private tourMask: HTMLElement[] = [];              // 4 painéis do desfoque
  private tourMaskReposition: (() => void) | null = null;
  private conversionShown = false;
  // Lido do manifest real em runtime. RHYTHM_COUNT é fallback (fonte única)
  private totalRhythms = RHYTHM_COUNT;

  constructor() {
    if (this.isDemoExpired()) {
      this.showExpired();
      return;
    }

    // latencyHint 'playback' no mobile — mesmo fix do app principal:
    // buffer maior elimina estralos (underrun) em aparelhos com áudio fraco.
    const isMobileCtx = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    this.audioContext = new AudioContext(
      isMobileCtx ? { latencyHint: 'playback' } : undefined
    );
    this.stateManager = new StateManager();
    // Demo é web-only: força WebAudioEngine direto (sem flag, sem nativo).
    this.audioManager = new WebAudioEngine(this.audioContext);
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
    if (DEV_NO_LIMIT) return false; // teste local: nunca considera expirada
    return localStorage.getItem(STORAGE_KEY) === 'expired' || document.cookie.includes('gdrums_demo_used=expired');
  }

  private markExpired(): void {
    if (DEV_NO_LIMIT) return; // teste local: não queima a demo
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
    if (DEV_NO_LIMIT) return;                // teste local: sem relógio correndo
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
    el.innerHTML = `<strong>${t('demo.counter.oneMinLeft')}</strong> · ${t('demo.counter.createAccountToContinue')}`;
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

  /**
   * Créditos realmente gastos. O 1º ritmo distinto é cortesia (vem carregado
   * de fábrica e é o do tour), então só desconta do 2º em diante.
   * `rhythmsUsed` continua sendo o conjunto de DISTINTOS — assim voltar num
   * ritmo já tocado (inclusive o primeiro) nunca cobra de novo.
   */
  private creditsUsed(): number {
    return Math.max(0, this.rhythmsUsed.size - 1);
  }

  private updateCounter(): void {
    const remaining = MAX_RHYTHMS - this.creditsUsed();
    const total = this.totalRhythms;
    const el = document.getElementById('demoCounter');
    const bar = document.getElementById('demoBar');
    if (el) {
      // Mensagem foca no tamanho do CATÁLOGO (lido do manifest), não na
      // cota da demo. Usuário precisa saber que tem muito mais esperando.
      // Quando resta 1 ou acabou, muda pra tom de pressão.
      if (remaining <= 0) {
        el.innerHTML = `${t('demo.counter.ended')} · <strong>${t('demo.counter.endedPlanCount', { total })}</strong>`;
      } else if (remaining === 1) {
        el.innerHTML = `${t('demo.counter.lastRhythm')} · <strong>${t('demo.counter.catalogCount', { total })}</strong>`;
      } else {
        el.innerHTML = `${t('demo.counter.previewCount', { max: MAX_RHYTHMS })} · <strong>${t('demo.counter.catalogCount', { total })}</strong>`;
      }
      el.classList.toggle('low', remaining <= 1);
    }
    if (bar) bar.style.width = `${(remaining / MAX_RHYTHMS) * 100}%`;
  }

  // ─── Callbacks ────────────────────────────────────────────────────

  private setupCallbacks(): void {
    this.scheduler.setUpdateStepCallback((step: number, pattern: PatternType) => {
      // Fase da grade no TEMPO REAL do step (este callback dispara no drain de
      // áudio, ~no instante em que o step toca) — a contagem da pausa usa isso
      // pra cair no tempo do ritmo, e não no instante do agendamento.
      this.lastStepTime = this.audioManager.getCurrentTime();
      this.lastStepIndex = step;
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

    // Retomar ao voltar do background.
    // NÃO usar scheduler.restart() aqui: ele limpa os timers e rebobina
    // nextStepTime pra "agora", mas NÃO cancela o áudio já agendado. Como em
    // background o lookahead cresce, os samples antigos continuavam tocando
    // nos horários deles ENQUANTO o scheduler reiniciado agendava novos —
    // resultado: som sobreposto/acumulado ao voltar pra aba.
    // resyncHeadToAudible() cancela só o áudio futuro e re-agenda os MESMOS
    // steps nos MESMOS tempos (é o que o app faz em produção).
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.stateManager.isPlaying()) {
        this.audioManager.resume();
        this.scheduler.resyncHeadToAudible();
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

    // Botão de PAUSA (mesma célula/comportamento do app)
    document.getElementById('pauseBtnUser')?.addEventListener('click', () => {
      if (this.expired) { this.showExpired(); return; }
      HapticsService.medium();
      this.togglePauseInstant();
    });

    // Performance grid cells
    document.querySelectorAll('.grid-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        if ((cell as HTMLElement).id === 'pauseBtnUser') return; // tem handler próprio
        if (this.expired) { this.showExpired(); return; }
        if (this.resuming) return;             // re-entrada da pausa em andamento
        HapticsService.medium();

        const cellType = (cell as HTMLElement).getAttribute('data-type');
        const variation = parseInt((cell as HTMLElement).getAttribute('data-variation') || '0');

        if (cellType === 'main') {
          if (this.isPaused) {
            // Pausado: seleciona o ritmo e RETOMA nele, cravado no tempo —
            // sem reiniciar do zero (mesmo comportamento do app).
            this.patternEngine.activateRhythm(variation);
            this.resumeFromPause();
          } else if (!this.stateManager.isPlaying()) {
            this.patternEngine.activateRhythm(variation);
            this.stateManager.setShouldPlayStartSound(true);
            this.play();
          } else if (variation === this.stateManager.getCurrentVariation('main')) {
            this.stop();
          } else {
            this.patternEngine.playFillToNextRhythm(variation);
          }
        } else if (cellType === 'fill') {
          if (this.isPaused) this.resumeWithAction('fill', variation);
          else if (this.stateManager.isPlaying()) this.patternEngine.activateFillWithTiming(variation);
        } else if (cellType === 'end') {
          if (this.isPaused) this.resumeWithAction('end', variation);
          else if (this.stateManager.isPlaying()) this.patternEngine.playEndAndStop();
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
    // Pulou o tour → não volta mais. Sem esta guarda, o listener de clique
    // que ficou no alvo (once) reagenda o próximo passo e o tour ressuscita.
    if (this.tourDone) return;
    if (this.tourIdx >= TOUR_STEPS.length) {
      this.tourDone = true;
      // Fim do tour: janela própria (o "Isso é só uma prévia" fica pro
      // momento em que os créditos estiverem quase acabando).
      setTimeout(() => this.showTourEndModal(), 500);
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
      <div class="demo-tour-tip-skip" role="button" tabindex="0">${t('demo.tour.skip')}</div>
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

      // Seta apontando pro centro REAL do alvo. Como o balão é clampado na
      // tela, o centro dele nem sempre coincide com o do alvo — por isso a
      // seta é posicionada em px, e não fixa em 50%. Alvo na coluna da
      // esquerda → seta na esquerda; na da direita → seta na direita.
      const targetCenterX = rect.left + window.scrollX + rect.width / 2;
      const arrowX = Math.max(16, Math.min(tipRect.width - 16, targetCenterX - left));
      tip.style.setProperty('--arrow-x', `${arrowX}px`);

      tip.classList.add('visible');
    });

    // Alvo em foco: brilho + desfoque em tudo em volta
    target.classList.add('demo-tour-pulse');
    this.showTourSpotlight(target);

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
        // Apertou → solta o foco na hora: tira o brilho e o desfoque em volta.
        target.classList.remove('demo-tour-pulse');
        this.clearTourTooltip();
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

  /**
   * Desfoca/escurece tudo em volta do alvo com 4 painéis fixos (cima, baixo,
   * esquerda, direita). O alvo fica no "buraco" — nítido, em foco e o único
   * clicável, até o passo ser cumprido. Preferido a um overlay com máscara
   * (mask/clip-path) por compatibilidade e por não roubar o clique do alvo.
   */
  private showTourSpotlight(target: HTMLElement): void {
    this.clearTourSpotlight();

    const panels: HTMLElement[] = [];
    for (let i = 0; i < 4; i++) {
      const p = document.createElement('div');
      p.className = 'demo-tour-mask-panel';
      document.body.appendChild(p);
      panels.push(p);
    }
    this.tourMask = panels;

    const place = () => {
      const r = target.getBoundingClientRect();
      const pad = 8;
      const top = Math.max(0, r.top - pad);
      const left = Math.max(0, r.left - pad);
      const right = r.right + pad;
      const bottom = r.bottom + pad;
      const [pT, pB, pL, pR] = panels;
      pT.style.cssText = `top:0;left:0;right:0;height:${top}px;`;
      pB.style.cssText = `top:${bottom}px;left:0;right:0;bottom:0;`;
      pL.style.cssText = `top:${top}px;left:0;width:${left}px;height:${bottom - top}px;`;
      pR.style.cssText = `top:${top}px;left:${right}px;right:0;height:${bottom - top}px;`;
    };
    place();

    this.tourMaskReposition = place;
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, { passive: true });
  }

  private clearTourSpotlight(): void {
    if (this.tourMaskReposition) {
      window.removeEventListener('resize', this.tourMaskReposition);
      window.removeEventListener('scroll', this.tourMaskReposition);
      this.tourMaskReposition = null;
    }
    this.tourMask.forEach(p => p.remove());
    this.tourMask = [];
  }

  private clearTourTooltip(): void {
    this.clearTourSpotlight();
    if (this.tourTooltip) {
      this.tourTooltip.remove();
      this.tourTooltip = null;
    }
  }

  /**
   * Janela do FIM DO TOUR — mostra o tamanho do app logo depois que o
   * visitante cumpriu os 4 passos guiados. É diferente do modal de conversão
   * ("Isso é só uma prévia"), que continua servindo aos outros gatilhos
   * (3 trocas de ritmo, clique em ritmo bloqueado).
   */
  private showTourEndModal(): void {
    if (this.expired) return;
    document.querySelectorAll('.demo-convert-modal').forEach(el => el.remove());

    const check = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    const features = [
      t('demo.tourEnd.feature.rhythmCount', { count: RHYTHM_COUNT }),
      t('demo.tourEnd.feature.pedal'),
      t('demo.tourEnd.feature.setlist'),
      t('demo.tourEnd.feature.toggle'),
      t('demo.tourEnd.feature.eq'),
    ];

    const overlay = document.createElement('div');
    overlay.className = 'demo-convert-modal';
    overlay.innerHTML = `
      <div class="demo-convert-card" role="dialog" aria-label="${t('demo.tourEnd.ariaLabel')}">
        <h3 class="demo-convert-title">${t('demo.tourEnd.title')}</h3>
        <ul class="demo-tourend-list">
          ${features.map(f => `<li>${check}<span>${f}</span></li>`).join('')}
        </ul>
        <div class="demo-tourend-close">${t('demo.tourEnd.footerText')}</div>
        <div class="demo-convert-offer">
          <span class="demo-convert-offer-badge">${t('demo.offer.badge')}</span>
          <span class="demo-convert-offer-head">${t('demo.offer.head')}</span>
          <span class="demo-convert-offer-sub">${t('demo.convert.offerSub')}</span>
        </div>
        <div class="demo-convert-actions">
          <a href="/register" class="demo-convert-primary">${t('demo.tourEnd.primaryCta')}</a>
          <button class="demo-convert-secondary">${t('demo.tourEnd.secondary')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));

    const close = () => {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 220);
      document.removeEventListener('keydown', onEsc);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onEsc);
    overlay.querySelector('.demo-convert-secondary')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  // ─── Modal de conversão progressivo ──────────────────────────────
  // Aparece após 3 trocas de ritmo (sinal forte de que o user entendeu o app
  // e tá extraindo valor) ou ao clicar num ritmo bloqueado. Não trava, só
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
        <div class="demo-convert-overline">${t('demo.convert.overline')}</div>
        <h3 class="demo-convert-title">${t('demo.convert.title')}</h3>
        <p class="demo-convert-body">
          ${t('demo.convert.body', { count: LOCKED_RHYTHM_COUNT })}
        </p>
        <div class="demo-convert-offer">
          <span class="demo-convert-offer-badge">${t('demo.offer.badge')}</span>
          <span class="demo-convert-offer-head">${t('demo.offer.head')}</span>
          <span class="demo-convert-offer-sub">${t('demo.convert.offerSub')}</span>
        </div>
        <div class="demo-convert-actions">
          <a href="/register" class="demo-convert-primary">${t('demo.cta.createAccount')}</a>
          <button class="demo-convert-secondary">${t('demo.convert.secondary')}</button>
        </div>
        <div class="demo-convert-reassure">${t('demo.convert.reassure')}</div>
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
   * Tira com os 5 ritmos liberados. Sem rolagem lateral (o CSS da demo faz
   * flex-wrap), então os 5 aparecem de cara na tela inicial. O catálogo
   * completo abre pelo botão TODOS, ao lado do nome do ritmo.
   */
  private async renderRhythmStrip(): Promise<void> {
    const strip = document.getElementById('demoRhythmStrip');
    if (!strip) return;

    DEMO_RHYTHMS.forEach(r => {
      const btn = document.createElement('button');
      btn.className = 'rhythm-card-btn';
      btn.textContent = r.name;
      btn.addEventListener('click', () => this.loadRhythm(r));
      strip.appendChild(btn);
    });

    const allBtn = document.getElementById('demoAllRhythmsBtn');
    allBtn?.setAttribute('title', t('demo.allRhythms.buttonTitle', { count: RHYTHM_COUNT }));
    allBtn?.addEventListener('click', () => this.openAllRhythmsModal());

    this.injectLockedStyles();
  }

  /** Catálogo completo (nomes), cacheado — evita refetch do manifest. */
  private allRhythmNames: string[] | null = null;

  private async fetchCatalog(): Promise<string[]> {
    if (this.allRhythmNames) return this.allRhythmNames;
    const res = await fetch('/rhythm/manifest.json');
    const manifest = await res.json();
    this.allRhythmNames = ((manifest.rhythms || []) as string[])
      .map(f => f.replace(/\.json$/, ''))
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return this.allRhythmNames;
  }

  /**
   * Catálogo completo, categorizado como no app — porém TODOS com cadeado.
   * Clicar num ritmo aqui NÃO queima a demo: mostra o convite de cadastro.
   */
  private async openAllRhythmsModal(): Promise<void> {
    if (this.expired) { this.showExpired(); return; }
    HapticsService.light();
    this.injectAllRhythmsStyles();

    const overlay = document.createElement('div');
    overlay.className = 'demo-all-overlay';
    overlay.innerHTML = `
      <div class="demo-all-panel" role="dialog" aria-label="${t('demo.allRhythms.title')}">
        <div class="demo-all-head">
          <div>
            <div class="demo-all-title">${t('demo.allRhythms.title')}</div>
            <div class="demo-all-sub">${t('demo.allRhythms.subtitle', { count: RHYTHM_COUNT })}</div>
          </div>
          <button class="demo-all-close" aria-label="${t('demo.allRhythms.closeAriaLabel')}">&#10005;</button>
        </div>
        <div class="demo-all-body"></div>
        <div class="demo-all-foot">
          <a href="/register" class="demo-all-cta">${t('demo.allRhythms.cta')}</a>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));

    const close = () => {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 200);
      document.removeEventListener('keydown', onEsc);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onEsc);
    overlay.querySelector('.demo-all-close')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const body = overlay.querySelector('.demo-all-body') as HTMLElement;
    try {
      // Lista única, alfabética, cards do mesmo tamanho — sem categorias.
      const names = await this.fetchCatalog();
      const grid = document.createElement('div');
      grid.className = 'demo-all-grid';
      names.forEach(name => {
        // Card apenas informativo: não abre modal nem gasta crédito. A janela
        // "Isso é só uma prévia" fica reservada pro fim dos créditos, e o
        // convite de cadastro aqui é o CTA fixo do rodapé do catálogo.
        const btn = document.createElement('div');
        btn.className = 'rhythm-card-btn rhythm-card-locked';
        btn.title = t('demo.allRhythms.lockedTitle');
        btn.innerHTML = `
          <svg class="rhythm-lock-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="4" y="11" width="16" height="10" rx="2"></rect>
            <path d="M8 11V8a4 4 0 018 0v3"></path>
          </svg>
          <span>${name}</span>
        `;
        grid.appendChild(btn);
      });
      body.appendChild(grid);
    } catch {
      body.innerHTML = `<div class="demo-all-empty">${t('demo.allRhythms.loadError')}</div>`;
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
        cursor: default;   /* informativo: cadastrar é pelo CTA do rodapé */
      }
      .rhythm-card-locked .rhythm-lock-icon {
        color: rgba(255, 255, 255, 0.5);
        flex-shrink: 0;
      }
    `;
    document.head.appendChild(style);
  }

  private injectAllRhythmsStyles(): void {
    if (document.getElementById('demo-all-css')) return;
    const style = document.createElement('style');
    style.id = 'demo-all-css';
    style.textContent = `
      .demo-all-overlay {
        position: fixed; inset: 0; z-index: 10002;
        background: rgba(3, 0, 20, 0.82);
        backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
        display: flex; align-items: center; justify-content: center;
        padding: 1rem;
        opacity: 0; transition: opacity 0.2s ease;
      }
      .demo-all-overlay.visible { opacity: 1; }
      .demo-all-panel {
        width: 100%; max-width: 640px; max-height: 84vh;
        display: flex; flex-direction: column;
        background: rgba(12, 12, 28, 0.97);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 16px; overflow: hidden;
        transform: translateY(10px); transition: transform 0.2s ease;
      }
      .demo-all-overlay.visible .demo-all-panel { transform: translateY(0); }
      .demo-all-head {
        display: flex; align-items: center; justify-content: space-between;
        gap: 1rem; padding: 1rem 1.25rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      }
      .demo-all-title { font-size: 1.05rem; font-weight: 800; color: #fff; }
      .demo-all-sub { font-size: 0.75rem; color: rgba(255, 255, 255, 0.45); margin-top: 0.15rem; }
      .demo-all-close {
        background: none; border: none; cursor: pointer; font-size: 1rem;
        color: rgba(255, 255, 255, 0.5); padding: 0.4rem 0.55rem; border-radius: 8px;
      }
      .demo-all-close:hover { color: #fff; background: rgba(255, 255, 255, 0.07); }
      .demo-all-body { overflow-y: auto; padding: 1rem 1.25rem; }
      .demo-all-empty { color: rgba(255, 255, 255, 0.45); font-size: 0.85rem; }
      /* Cards do MESMO tamanho, numa grade única (sem categorias). */
      .demo-all-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 0.5rem;
      }
      .demo-all-grid .rhythm-card-btn {
        width: 100%;
        justify-content: center;
        padding: 0.6rem 0.7rem;
        font-size: 0.8rem;
        min-height: 46px;
        overflow: hidden;
      }
      .demo-all-grid .rhythm-card-btn span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .demo-all-foot {
        padding: 0.9rem 1.25rem; border-top: 1px solid rgba(255, 255, 255, 0.07);
      }
      .demo-all-cta {
        display: block; text-align: center; text-decoration: none;
        padding: 0.8rem 1rem; border-radius: 10px; font-weight: 800;
        color: #05010f; background: linear-gradient(135deg, #00D4FF, #8B5CF6);
      }
    `;
    document.head.appendChild(style);
  }

  private async loadRhythm(rhythm: { name: string; path: string }): Promise<void> {
    if (this.expired) { this.showExpired(); return; }

    // Verificar limite (só ritmos DISTINTOS gastam; o 1º é cortesia)
    if (!this.rhythmsUsed.has(rhythm.name)) {
      if (this.creditsUsed() >= MAX_RHYTHMS) {
        this.stop();
        this.markExpired();
        this.showExpired();
        return;
      }
      this.rhythmsUsed.add(rhythm.name);
      this.updateCounter();

      // Créditos quase no fim → janela "Isso é só uma prévia".
      if (MAX_RHYTHMS - this.creditsUsed() <= CONVERT_AT_REMAINING) {
        this.maybeShowConversionModal();
      }
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
      if (nameEl) nameEl.textContent = t('demo.rhythm.loadError');
    }
  }

  // ─── Play/Stop ────────────────────────────────────────────────────

  /** `comp` = compensação de latência, usada pela re-entrada cravada da pausa. */
  private play(comp: number = 0): void {
    if (this.expired) { this.showExpired(); return; }
    // Inicia o timer corrido no PRIMEIRO play (se já iniciou, no-op)
    this.startDemoTimer();
    this.audioManager.resume();
    this.stateManager.setPlaying(true);
    this.isPaused = false;
    this.updatePauseButtonUI();

    this.uiManager.updatePlayStopUI(true);
    this.uiManager.updateStatusUI(this.stateManager.getActivePattern());
    this.uiManager.updatePerformanceGrid();
    this.scheduler.start(comp);

    // Mostra banner de reforço assim que o user começa a tocar
    // (primeiro play = ele sentiu o valor, aí reforça o cadastro).
    // O espaço dele já está reservado no CSS (.app-container), então ele só
    // aparece — sem reflow, sem empurrar a tela, sem criar rolagem.
    const banner = document.getElementById('demoValueBanner');
    if (banner && banner.style.display === 'none') {
      setTimeout(() => { banner.style.display = 'flex'; }, 3000);
    }
  }

  private stop(): void {
    // Sai de qualquer estado de pausa/contagem antes de parar de vez.
    this.stopCountLoop();
    this.isPaused = false;
    this.resuming = false;
    this.pendingResumeAction = null;
    this.updatePauseButtonUI();

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

  // ═══════════════════════════════════════════════════════════════════════
  // PAUSA COM CONTAGEM — porte do comportamento do app (src/main.ts).
  //
  // Cópia deliberada, e não um módulo compartilhado: o bloco de pausa do app
  // é sensível a timing e está estável em produção. Extrair pra um módulo
  // comum exigiria mexer no main.ts e arriscar o app por causa da demo.
  //
  // Enquanto pausado, o chimbal fechado toca 1x por tempo, em loop, na grade
  // REAL do ritmo (metrônomo vivo), e o botão pisca laranja. Ao continuar, o
  // ritmo re-entra CRAVADO no próximo tempo. O motor não é alterado.
  // ═══════════════════════════════════════════════════════════════════════

  /** Toggle exclusivo pause/resume — é o que o botão de pausa chama. */
  private togglePauseInstant(): void {
    if (this.resuming) return;                 // já a caminho de voltar
    if (this.isPaused) {
      this.resumeFromPause();
    } else if (this.stateManager.isPlaying()) {
      this.pauseInstant();
    }
  }

  private pauseInstant(): void {
    if (!this.stateManager.isPlaying()) return;
    this.isPaused = true;
    this.audioManager.fadeOutAllActive(0.04);  // evita clique ao cortar sample
    this.scheduler.stop();
    this.stateManager.setPlaying(false);
    this.stateManager.resetStep();             // ao retomar, começa do downbeat

    this.uiManager.updatePerformanceGrid();
    this.updatePauseButtonUI();

    // Pausa NÃO fica muda: começa a contagem (chimbal) em loop, no tempo.
    this.resuming = false;
    this.startCountLoop();
  }

  private resumeFromPause(): void {
    if (!this.isPaused) return;
    this.isPaused = false;
    // A contagem SEGUE tocando até o ritmo re-entrar no próximo tempo — sem
    // buraco no metrônomo. `resuming` trava toque duplo nesse meio-tempo.
    this.resuming = true;
    this.audioManager.resume();

    const spb = this.countSpb || (60 / this.stateManager.getTempo());
    const now = this.audioManager.getCurrentTime();
    // Volta no PRÓXIMO TEMPO da grade (não espera o compasso reiniciar).
    const k = Math.ceil((now + 0.05 - this.countGridStart) / spb);
    this.scheduleRhythmEntryAt(this.countGridStart + k * spb);
  }

  /** Sai da pausa já aplicando virada/finalização (cliques durante a pausa). */
  private resumeWithAction(type: 'fill' | 'end', variationIndex: number): void {
    if (!this.isPaused || this.resuming) return;
    this.pendingResumeAction = { type, variationIndex };
    this.resumeFromPause();
  }

  /**
   * Espera o relógio de áudio chegar em `downbeatTime` e faz o ritmo entrar
   * cravado (o `comp` absorve o jitter do timer). Ao entrar, corta a contagem.
   */
  private scheduleRhythmEntryAt(downbeatTime: number): void {
    const SCHED_LEAD = 0.05; // = lead interno do scheduler.start()
    const tick = () => {
      // Aborta se algo já retomou a reprodução no meio (outro botão).
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
          if (action.type === 'fill') this.patternEngine.activateFillWithTiming(action.variationIndex);
          else this.patternEngine.playEndAndStop();
        } else if (this.cymbalBuffer) {
          // Resume normal: prato de "deixa" no re-entry pra não voltar do nada.
          this.audioManager.playSound(this.cymbalBuffer, downbeatTime, this.stateManager.getState().masterVolume);
        }
      } else {
        setTimeout(tick, Math.max(0, (target - now) * 1000 - 4));
      }
    };
    tick();
  }

  private startCountLoop(): void {
    this.stopCountLoop();
    this.countActive = true;
    this.audioManager.loadAudioFromPath('/midi/chimbal_fechado.wav')
      .then(b => this.runCountLoop(b))
      .catch(() => this.runCountLoop(null));
  }

  private runCountLoop(buf: AudioBuffer | null): void {
    if (!this.countActive || !this.isPaused) return;
    // Grade REAL do ritmo: stepsPerBeat = floor(totalSteps / beatsPerBar) —
    // MESMA definição do updateBeatMarker. Assumir 2 steps por batida deixaria
    // a contagem 2x rápida em ritmos de 16 steps.
    const tempo = this.stateManager.getTempo();
    const ap = this.stateManager.getActivePattern();
    const vi = this.stateManager.getCurrentVariation(ap);
    const speed = this.stateManager.getVariationSpeed(ap, vi) || 1;
    const beats = Math.max(1, this.stateManager.getState().beatsPerBar || 4);
    const totalSteps = Math.max(1, this.stateManager.getPatternSteps(ap));
    const stepsPerBeat = Math.max(1, Math.floor(totalSteps / beats));
    const secondsPerStep = (60 / tempo / 2) / speed;
    const spb = stepsPerBeat * secondsPerStep;   // 1 tempo = stepsPerBeat steps
    const masterVol = this.stateManager.getState().masterVolume;
    const LOOKAHEAD = 0.3;

    // Fase: recua do último step até o começo do TEMPO em que ele caiu.
    const posInBeat = ((this.lastStepIndex % stepsPerBeat) + stepsPerBeat) % stepsPerBeat;
    const beatPhase = this.lastStepTime - posInBeat * secondsPerStep;
    const beatIdxAtPhase = Math.floor(this.lastStepIndex / stepsPerBeat) % beats;
    const now0 = this.audioManager.getCurrentTime();
    const kStart = Math.ceil((now0 + 0.08 - beatPhase) / spb);
    const t0 = beatPhase + kStart * spb;         // 1ª batida, no tempo
    const beatIdxStart = (((beatIdxAtPhase + kStart) % beats) + beats) % beats;
    this.countGridStart = t0;
    this.countSpb = spb;

    let nextHit = 0;
    const schedule = () => {
      if (!this.countActive) return;
      const now = this.audioManager.getCurrentTime();
      while (buf && t0 + nextHit * spb < now + LOOKAHEAD) {
        const ht = t0 + nextHit * spb;
        const beatIdx = (beatIdxStart + nextHit) % beats;
        const strong = (beatIdx % 2 === 0);      // tempos 1,3,5 fortes
        if (ht >= now - 0.005) {
          const gain = this.countVolume * (strong ? 1 : 0.6);
          this.audioManager.playSound(buf, ht, masterVol * gain);
          this.schedulePauseFlash(ht, now, strong);
        }
        nextHit++;
      }
      this.countLoopTimer = window.setTimeout(schedule, 60);
    };
    schedule();
  }

  /** Agenda o pisca laranja do botão de pausa pra bater no tempo `atTime`. */
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

  private updatePauseButtonUI(): void {
    const cell = document.getElementById('pauseBtnUser');
    const label = document.getElementById('pauseBtnLabel');
    if (cell) cell.classList.toggle('active', this.isPaused);
    if (label) label.textContent = this.isPaused ? t('demo.pause.resumeLabel') : t('demo.pause.pauseLabel');
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
        <div class="demo-expired-overline">${t('demo.expired.overline')}</div>
        <h2>${t('demo.expired.title')}</h2>
        <p>
          ${t('demo.expired.bodyPre', { count: DEMO_RHYTHMS.length })} <strong>${this.totalRhythms}</strong> ${t('demo.expired.bodyPost')}
        </p>

        <!-- Preview do catálogo: lista dos ritmos bloqueados passando -->
        <div class="demo-expired-catalog">
          <div class="demo-expired-catalog-track" id="demoCatalogTrack"></div>
        </div>

        <div class="demo-expired-features">
          <div class="demo-expired-feature"><span>${this.totalRhythms}</span>${t('demo.expired.featureRhythmsCount')}</div>
          <div class="demo-expired-feature"><span>${t('demo.expired.featureBluetoothBadge')}</span>${t('demo.expired.featureBluetoothLabel')}</div>
          <div class="demo-expired-feature"><span>${t('demo.expired.featureOfflineBadge')}</span>${t('demo.expired.featureOfflineLabel')}</div>
        </div>

        <!-- Oferta do trial em destaque: 48h grátis ANTES do preço.
             Remove a objeção 'quanto custa' na hora do click. O preço
             aparece abaixo, como referência secundária. -->
        <div class="demo-expired-offer">
          <div class="demo-expired-offer-main">
            <span class="demo-expired-offer-badge">${t('demo.offer.badge')}</span>
            <span class="demo-expired-offer-head">${t('demo.offer.head')}</span>
          </div>
          <div class="demo-expired-offer-sub">${t('demo.expired.offerSub')}</div>
          <div class="demo-expired-offer-price">${t('demo.expired.offerPrice')}</div>
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
            placeholder="${t('demo.expired.emailPlaceholder')}"
            autocomplete="email"
            required
          />
          <button type="submit" class="demo-expired-cta">${t('demo.cta.createAccount')}</button>
        </form>

        <div class="demo-expired-sub">
          ${t('demo.expired.hasAccount')} <a href="/login">${t('demo.expired.loginLink')}</a>
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
  if (redirectIfRecoveryHash()) return;
  AttributionService.init();
  new DemoPlayer();
});
