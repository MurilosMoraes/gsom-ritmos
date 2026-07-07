// Lógica de padrões e transições — com timing matemático corrigido

import type { StateManager } from './StateManager';
import type { PatternType } from '../types';

export class PatternEngine {
  private stateManager: StateManager;
  private currentFillRotation = 0;
  private pendingMainVariation = 0;
  private shouldChangeRhythmAfterFill = false;
  private isTestMode = false;
  private transitionInProgress = false;
  private onPatternChange?: (pattern: PatternType) => void;
  private onStop?: () => void;
  private onEndCymbal?: (time: number) => void;
  /** Fura-fila do lookahead (Scheduler.resyncForCommand): chamado ANTES
   *  de todo cálculo de timing de comando (virada/finalização/troca) pra
   *  rebobinar a cabeça de agendamento pro audível — senão a entrada é
   *  calculada 0.25-0.5s no futuro e o comando soa atrasado. Opcional:
   *  testes (engine-test) rodam sem Scheduler e caem no comportamento
   *  clássico. */
  private beforeTimingCommand?: () => void;
  /** Voltas completas restantes da fill ativa (virada imediata em loop
   *  até desembocar no downbeat). Setado pelo checkPendingPatterns ao
   *  ativar a fill; decrementado/consumido pelo handleFillCompletion. */
  private fillLoopsRemaining = 0;

  constructor(stateManager: StateManager) {
    this.stateManager = stateManager;
  }

  setTestMode(enabled: boolean): void {
    this.isTestMode = enabled;
  }

  setOnPatternChange(callback: (pattern: PatternType) => void): void {
    this.onPatternChange = callback;
  }

  setOnStop(callback: () => void): void {
    this.onStop = callback;
  }

  setOnEndCymbal(callback: (time: number) => void): void {
    this.onEndCymbal = callback;
  }

  setBeforeTimingCommand(callback: () => void): void {
    this.beforeTimingCommand = callback;
  }

  // ─── Verificação de padrões pendentes (chamado pelo Scheduler) ──────

  checkPendingPatterns(): boolean {
    const state = this.stateManager.getState();
    const currentStep = this.stateManager.getCurrentStep();
    const activePattern = this.stateManager.getActivePattern();

    // Guard: não processar durante transição
    if (this.transitionInProgress) return false;

    // Verificar fill pendente
    if (activePattern === 'main' && state.pendingFill) {
      if (currentStep === state.pendingFill.entryPoint) {
        this.transitionInProgress = true;
        try {
          // Guardar as voltas de loop ANTES de limpar o pending — o
          // handleFillCompletion repete a fill até desembocar no downbeat.
          this.fillLoopsRemaining = state.pendingFill.loops ?? 0;
          this.stateManager.setActivePattern('fill');
          this.stateManager.setCurrentStep(state.pendingFill.startStep);
          this.stateManager.setPendingFill(null);
          this.onPatternChange?.('fill');
        } finally {
          this.transitionInProgress = false;
        }
        return true;
      }
    }

    // Verificar end pendente — o entryPoint vive no espaço do padrão em
    // que foi agendado (space): 'main' clássico, ou 'fill' quando a
    // finalização foi pisada durante a virada e ASSUME ela.
    if (state.pendingEnd && activePattern === (state.pendingEnd.space ?? 'main')) {
      if (currentStep === state.pendingEnd.entryPoint) {
        this.transitionInProgress = true;
        try {
          this.stateManager.setActivePattern('end');
          this.stateManager.setCurrentStep(state.pendingEnd.startStep);
          this.stateManager.setPendingEnd(null);
          this.onPatternChange?.('end');
        } finally {
          this.transitionInProgress = false;
        }
        return true;
      }
    }

    return false;
  }

  // ─── Completude de padrão (chamado quando step volta a 0) ──────────

  handlePatternCompletion(scheduledTime?: number): void {
    if (this.isTestMode) return;
    if (this.transitionInProgress) return;

    this.transitionInProgress = true;
    try {
      const activePattern = this.stateManager.getActivePattern();

      switch (activePattern) {
        case 'fill':
          this.handleFillCompletion();
          break;
        case 'end':
          this.handleEndCompletion(scheduledTime);
          break;
        case 'intro':
          this.handleIntroCompletion();
          break;
        case 'main':
          this.handleMainCompletion();
          break;
      }
    } finally {
      this.transitionInProgress = false;
    }
  }

  private handleFillCompletion(): void {
    // LOOP da virada imediata: se ainda restam voltas pra preencher o
    // espaço até o downbeat, repete a fill do começo — SEM prato de
    // retorno, SEM voltar pro main. O prato e a volta acontecem só na
    // última volta, exatamente no beat 1.
    if (this.fillLoopsRemaining > 0) {
      this.fillLoopsRemaining--;
      this.stateManager.resetStep();
      // Continua em 'fill' — o scheduler segue agendando a mesma variação
      return;
    }

    this.stateManager.setShouldPlayReturnSound(true);
    this.stateManager.setShouldPlayStartSound(false);
    this.stateManager.resetStep();

    if (this.shouldChangeRhythmAfterFill) {
      this.shouldChangeRhythmAfterFill = false;
      this.activateRhythmFromStart(this.pendingMainVariation);
    } else if (this.stateManager.getState().patternQueue.length > 0) {
      const nextPattern = this.stateManager.shiftQueue();
      if (nextPattern) {
        this.stateManager.setActivePattern(nextPattern);
        this.onPatternChange?.(nextPattern);
      }
    } else {
      this.stateManager.setActivePattern('main');
      this.onPatternChange?.('main');
    }
  }

  handleEndCompletion(scheduledTime?: number): void {
    if (scheduledTime) {
      this.onEndCymbal?.(scheduledTime);
    }
    this.onStop?.();
  }

  private handleIntroCompletion(): void {
    this.stateManager.setActivePattern('main');
    this.stateManager.setShouldPlayStartSound(true);
    this.onPatternChange?.('main');
  }

  private handleMainCompletion(): void {
    this.stateManager.setShouldPlayStartSound(false);
    this.stateManager.setShouldPlayReturnSound(false);

    if (this.stateManager.getState().patternQueue.length > 0) {
      const nextPattern = this.stateManager.shiftQueue();
      if (nextPattern) {
        this.stateManager.setActivePattern(nextPattern);
        this.onPatternChange?.(nextPattern);
      }
    }
  }

  // ─── Ativação de padrões ────────────────────────────────────────────

  playIntroAndStart(): void {
    const state = this.stateManager.getState();
    const introVariation = state.variations.intro[0];
    const hasIntroPattern = introVariation?.pattern.some(row => row.some(step => step));

    if (hasIntroPattern) {
      this.stateManager.setCurrentVariation('intro', 0);
      this.stateManager.loadVariation('intro', 0);
      this.stateManager.setActivePattern('intro');
      this.stateManager.resetStep();
      this.stateManager.setShouldPlayStartSound(false);
      this.onPatternChange?.('intro');
    } else {
      this.stateManager.setShouldPlayStartSound(true);
    }
  }

  playFillToNextRhythm(targetVariationIndex?: number): void {
    const state = this.stateManager.getState();

    let nextMainVariation: number;

    if (targetVariationIndex !== undefined) {
      nextMainVariation = targetVariationIndex;
    } else {
      const availableRhythms = state.variations.main
        .map((v, index) => ({
          index,
          hasContent: v.pattern.some(row => row.some(step => step === true))
        }))
        .filter(r => r.hasContent);

      if (availableRhythms.length <= 1) return;

      const currentIndex = this.stateManager.getCurrentVariation('main');
      const currentPosition = availableRhythms.findIndex(r => r.index === currentIndex);
      const nextPosition = (currentPosition + 1) % availableRhythms.length;
      nextMainVariation = availableRhythms[nextPosition].index;
    }

    // Verificar fills disponíveis
    const availableFills = state.variations.fill
      .filter(f => f.pattern.some(row => row.some(step => step === true)));

    if (availableFills.length === 0) {
      this.activateRhythm(nextMainVariation);
      return;
    }

    this.pendingMainVariation = nextMainVariation;
    this.shouldChangeRhythmAfterFill = true;
    // Troca de ritmo IMEDIATA (era 'cycle-end'): a virada entra já, com
    // o pedaço que falta, e o ritmo novo continua entrando exatamente no
    // downbeat — a troca acontece na CONCLUSÃO da fill, que no modo
    // immediate sempre desemboca no 1. Detalhe útil: se já tem fill
    // tocando, o activateFillWithTiming recusa (guard) mas o retarget de
    // pendingMainVariation acima JÁ aconteceu — pisadas seguidas só
    // redirecionam o destino da troca, sem reiniciar a virada.
    this.playRotatingFill('immediate');
  }

  playRotatingFill(mode: 'immediate' | 'cycle-end' = 'immediate'): void {
    const state = this.stateManager.getState();

    const availableFills = state.variations.fill
      .map((v, index) => ({
        index,
        hasContent: v.pattern.some(row => row.some(step => step === true))
      }))
      .filter(f => f.hasContent);

    if (availableFills.length === 0) return;

    // Encontrar próxima virada disponível
    let found = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const fillIndex = (this.currentFillRotation + attempt) % 3;
      const variation = state.variations.fill[fillIndex];
      const hasContent = variation?.pattern.some(row => row.some(step => step === true));

      if (hasContent) {
        this.activateFillWithTiming(fillIndex, mode);
        this.currentFillRotation = (fillIndex + 1) % 3;
        found = true;
        break;
      }
    }

    if (!found && availableFills.length > 0) {
      this.activateFillWithTiming(availableFills[0].index, mode);
      this.currentFillRotation = (availableFills[0].index + 1) % 3;
    }
  }

  playEndAndStop(): void {
    this.activateEndWithTiming(0);
  }

  // ─── Ativação de ritmo (troca de variação main) ────────────────────

  private activateRhythmFromStart(variationIndex: number): void {
    const variation = this.stateManager.getState().variations.main[variationIndex];
    if (!variation || !variation.pattern) return;
    if (!this.hasContent(variation.pattern)) return;

    this.stateManager.setCurrentVariation('main', variationIndex);
    this.stateManager.loadVariation('main', variationIndex);

    if (this.stateManager.isPlaying()) {
      this.stateManager.setActivePattern('main');
      this.stateManager.clearQueue();
      this.onPatternChange?.('main');
    }
  }

  activateRhythm(variationIndex: number): void {
    const state = this.stateManager.getState();
    const variation = state.variations.main[variationIndex];
    if (!variation || !variation.pattern) return;
    if (!this.hasContent(variation.pattern)) return;

    // Fura-fila do lookahead (ver activateFillWithTiming) — troca direta
    // de ritmo também deve soar no audível, não na cabeça.
    this.beforeTimingCommand?.();

    // Capturar posição musical atual
    const currentStep = this.stateManager.getCurrentStep();
    const currentVariationIndex = this.stateManager.getCurrentVariation('main');
    const currentVariation = state.variations.main[currentVariationIndex];
    const currentSteps = currentVariation?.steps || 16;
    const currentSpeed = currentVariation?.speed || 1;

    // Posição dentro do ciclo atual (0 a 1)
    const cyclePosition = currentSteps > 0 ? currentStep / currentSteps : 0;

    this.stateManager.setCurrentVariation('main', variationIndex);
    this.stateManager.loadVariation('main', variationIndex);

    if (this.stateManager.isPlaying()) {
      this.stateManager.setActivePattern('main');
      this.stateManager.clearQueue();

      // Calcular step equivalente no novo ritmo
      const newSteps = variation.steps || 16;
      const newSpeed = variation.speed || 1;

      const speedRatio = currentSpeed > 0 ? newSpeed / currentSpeed : 1;
      const adjustedPosition = (cyclePosition * speedRatio) % 1;
      const equivalentStep = Math.min(
        Math.floor(adjustedPosition * newSteps),
        newSteps - 1
      );

      this.stateManager.setCurrentStep(equivalentStep);
      this.onPatternChange?.('main');
    }
  }

  // ─── Fill com timing corrigido ──────────────────────────────────────

  /**
   * @param mode Estratégia de entrada da virada:
   *
   * 'immediate' (default — virada avulsa do pedal/células):
   *   A virada entra no PRÓXIMO step agendável E SEMPRE termina no
   *   downbeat (beat 1) com o prato de retorno. Pra preencher o espaço
   *   quando a fill é curta e a pisada foi cedo no compasso, a fill
   *   REPETE (loop) quantas voltas precisar até desembocar no 1 —
   *   como baterista real fazendo virada longa. Sequência: [pedaço
   *   parcial][voltas completas] → o final é sempre uma volta inteira
   *   acabando exata no downbeat.
   *
   *   v1 dessa feature tinha "retorno em fase" (fill completa voltando
   *   pro main no meio do compasso). REJEITADO em teste: o prato de
   *   retorno só dispara no step 0 (snapshot: step===0 && shouldPlay
   *   ReturnSound), então a volta em fase ficava SEM PRATO e o user
   *   sentia a virada "voltando no 3/4". Não reintroduzir.
   *
   * 'cycle-end' (troca de ritmo — playFillToNextRhythm):
   *   Comportamento clássico: espera o ponto ideal pra fill terminar
   *   exatamente no fim do ciclo. O ritmo NOVO precisa começar do step 0
   *   no downbeat, senão a troca soa quebrada.
   */
  activateFillWithTiming(variationIndex: number, mode: 'immediate' | 'cycle-end' = 'immediate'): void {
    if (!this.stateManager.isPlaying()) return;

    const state = this.stateManager.getState();

    // Guards
    if (state.pendingFill) return;
    if (state.pendingEnd) return; // end tem prioridade
    if (state.activePattern === 'fill') return;
    if (state.activePattern === 'end') return;
    if (this.transitionInProgress) return;

    const variation = state.variations.fill[variationIndex];
    if (!variation || !variation.pattern) return;
    if (!this.hasContent(variation.pattern)) return;

    // Fura-fila: rebobina a cabeça pro audível ANTES de calcular a
    // entrada — senão o "próximo step" está lookahead à frente do que
    // o user está ouvindo e a virada soa atrasada (~0.5s no mobile).
    this.beforeTimingCommand?.();

    this.stateManager.setCurrentVariation('fill', variationIndex);
    this.stateManager.loadVariation('fill', variationIndex);

    const mainVariationIndex = this.stateManager.getCurrentVariation('main');
    const mainVariation = state.variations.main[mainVariationIndex];
    const mainSteps = mainVariation?.steps || 16;
    const mainSpeed = mainVariation?.speed || 1;

    const fillSteps = variation.steps || 16;
    const fillSpeed = variation.speed || 1;

    const nextStep = this.getNextEntryPoint();

    // Quantos main steps a fill inteira ocupa em tempo musical
    const fillDurationInMainSteps = Math.round(fillSteps * mainSpeed / fillSpeed);

    // Entry point ideal: fill começa aqui e termina exatamente no fim do ciclo
    const idealEntry = mainSteps - fillDurationInMainSteps;

    const fillStepsPerMainStep = mainSpeed > 0 ? fillSpeed / mainSpeed : 1;

    let entryPoint: number;
    let fillStartStep: number;
    let loops = 0;

    if (mode === 'cycle-end' && idealEntry >= nextStep) {
      // TROCA DE RITMO com ponto ideal no futuro: espera o ideal —
      // fill completa terminando no fim do ciclo, ritmo novo no downbeat.
      entryPoint = idealEntry;
      fillStartStep = 0;
    } else if (nextStep === 0) {
      // Pisou no ÚLTIMO step do ciclo: o próximo step agendável já é o
      // downbeat. Virada imediata aqui ocuparia o PRÓXIMO ciclo inteiro
      // (exagero). Agenda a virada completa no final do próximo ciclo
      // ("virada no próximo tempo") — caso raro, 1 step em N.
      entryPoint = Math.max(0, idealEntry);
      fillStartStep = 0;
    } else {
      // VIRADA IMEDIATA: entra no próximo step e SEMPRE termina no
      // downbeat — quando o material da fill cobre o que resta do ciclo.
      entryPoint = nextStep;
      const remainingMainSteps = mainSteps - entryPoint;
      const needed = Math.max(1, Math.round(remainingMainSteps * fillStepsPerMainStep));

      if (needed > fillSteps) {
        // Pisou CEDO (resta mais ciclo que a fill tem de material):
        // groove continua e a virada COMPLETA (única) entra no ponto
        // exato pra desembocar no beat 1 — como baterista real.
        //
        // v2 preenchia esse caso LOOPANDO a fill ([parcial][completa]).
        // REJEITADO em teste: pisando no tempo 1, o parcial saía quase
        // do tamanho da fill inteira e soava como VIRADA DUPLA
        // ("termina a primeira e faz mais uma"). Não reintroduzir.
        entryPoint = idealEntry; // garantido > nextStep neste ramo
        fillStartStep = 0;
      } else {
        // Cabe em uma volta: imediata, do pedaço final, acaba no 1.
        fillStartStep = fillSteps - needed;
      }
    }

    this.stateManager.setPendingFill({
      variationIndex,
      entryPoint,
      startStep: fillStartStep,
      loops
    });
  }

  // ─── End com timing corrigido ───────────────────────────────────────

  /**
   * Agenda a finalização com a MESMA lógica da virada v3:
   * - Entra no próximo step quando o material do end cobre o que resta
   *   do ciclo (imediata, parcial), SEMPRE acabando no downbeat com o
   *   prato final.
   * - Pisou cedo demais: groove segue e o end COMPLETO entra no ponto
   *   ideal pra desembocar no beat 1.
   * - Pisada DURANTE a virada (duplo tap com a fill já tocando — comum
   *   agora que a virada entra imediata): o end ASSUME a virada. Como a
   *   fill v3 sempre termina no downbeat, a posição dela mapeia direto
   *   pro compasso; o entryPoint fica no espaço da FILL (space: 'fill').
   */
  activateEndWithTiming(variationIndex: number): void {
    if (!this.stateManager.isPlaying()) return;

    const state = this.stateManager.getState();

    // Guards
    if (state.activePattern === 'end') return;
    if (this.transitionInProgress) return;

    const variation = state.variations.end[0];
    if (!variation || !variation.pattern) return;
    if (!this.hasContent(variation.pattern)) return;

    this.stateManager.setCurrentVariation('end', 0);
    this.stateManager.loadVariation('end', 0);

    // End cancela fill pendente e troca de ritmo agendada
    this.stateManager.setPendingFill(null);
    this.shouldChangeRhythmAfterFill = false;
    this.fillLoopsRemaining = 0;

    // Fura-fila do lookahead (ver activateFillWithTiming). Durante a
    // virada o resync recusa (janela não é groove main puro) e o end
    // assume a fill pelo comportamento clássico — a fill acabou de
    // entrar audível, a cabeça está perto.
    this.beforeTimingCommand?.();

    const mainVariationIndex = this.stateManager.getCurrentVariation('main');
    const mainVariation = state.variations.main[mainVariationIndex];
    const mainSteps = mainVariation?.steps || 16;
    const mainSpeed = mainVariation?.speed || 1;

    const endSteps = variation.steps || 8;
    const endSpeed = variation.speed || 1;

    const nextStep = this.getNextEntryPoint();
    const endDurationInMainSteps = Math.round(endSteps * mainSpeed / endSpeed);
    const idealEntry = mainSteps - endDurationInMainSteps;

    let entryPoint: number;
    let endStartStep: number;

    if (state.activePattern === 'fill' && nextStep !== 0) {
      // FINALIZAÇÃO DURANTE A VIRADA: assume a fill. nextStep está no
      // espaço da fill; a fill v3 acaba no downbeat, então o que resta
      // dela É o que resta do compasso.
      const fillVariation =
        state.variations.fill[this.stateManager.getCurrentVariation('fill')];
      const fillSteps = fillVariation?.steps || 16;
      const fillSpeed = fillVariation?.speed || 1;
      const remainingFillSteps = fillSteps - nextStep;
      const needed = Math.max(1, Math.round(remainingFillSteps * endSpeed / fillSpeed));

      if (needed > endSteps) {
        // End não cobre o resto da virada: entra mais à frente DA fill,
        // completo, desembocando no beat 1.
        const endDurationInFillSteps = Math.max(1, Math.round(endSteps * fillSpeed / endSpeed));
        entryPoint = Math.min(
          Math.max(nextStep, fillSteps - endDurationInFillSteps),
          fillSteps - 1
        );
        endStartStep = 0;
      } else {
        // Cabe: assume a virada JÁ, do pedaço final, acaba no 1.
        entryPoint = nextStep;
        endStartStep = endSteps - needed;
      }

      this.stateManager.setPendingEnd({
        variationIndex: 0,
        entryPoint,
        startStep: endStartStep,
        space: 'fill'
      });
      return;
    }

    if (nextStep === 0) {
      // Pisou no último step (do main OU da fill terminando): o próximo
      // step agendável já é o downbeat — end completo no final do
      // próximo ciclo do main ("finalização no próximo tempo").
      entryPoint = Math.max(0, idealEntry);
      endStartStep = 0;
    } else {
      // Mesma lógica da virada v3 (espaço do main).
      entryPoint = nextStep;
      const remainingMainSteps = mainSteps - entryPoint;
      const endStepsPerMainStep = mainSpeed > 0 ? endSpeed / mainSpeed : 1;
      const needed = Math.max(1, Math.round(remainingMainSteps * endStepsPerMainStep));

      if (needed > endSteps) {
        // Pisou cedo: groove segue, end completo no ponto ideal.
        entryPoint = idealEntry;
        endStartStep = 0;
      } else {
        // Cabe em uma volta: imediata, do pedaço final, acaba no 1.
        endStartStep = endSteps - needed;
      }
    }

    this.stateManager.setPendingEnd({
      variationIndex: 0,
      entryPoint,
      startStep: endStartStep
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private getNextEntryPoint(): number {
    const currentStep = this.stateManager.getCurrentStep();
    const activePattern = this.stateManager.getActivePattern();
    const numSteps = this.stateManager.getPatternSteps(activePattern);
    if (numSteps <= 0) return 0;
    return (currentStep + 1) % numSteps;
  }

  private hasContent(pattern: boolean[][]): boolean {
    return pattern.some(row => row.some(step => step === true));
  }
}
