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
  private onEndCymbal?: () => void;

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

  setOnEndCymbal(callback: () => void): void {
    this.onEndCymbal = callback;
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

    // Verificar end pendente
    if (activePattern === 'main' && state.pendingEnd) {
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

  handlePatternCompletion(): void {
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
          this.handleEndCompletion();
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

  private handleEndCompletion(): void {
    this.onEndCymbal?.();
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
    this.playRotatingFill();
  }

  playRotatingFill(): void {
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
        this.activateFillWithTiming(fillIndex);
        this.currentFillRotation = (fillIndex + 1) % 3;
        found = true;
        break;
      }
    }

    if (!found && availableFills.length > 0) {
      this.activateFillWithTiming(availableFills[0].index);
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

  activateFillWithTiming(variationIndex: number): void {
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

    this.stateManager.setCurrentVariation('fill', variationIndex);
    this.stateManager.loadVariation('fill', variationIndex);

    const mainVariationIndex = this.stateManager.getCurrentVariation('main');
    const mainVariation = state.variations.main[mainVariationIndex];
    const mainSteps = mainVariation?.steps || 16;
    const mainSpeed = mainVariation?.speed || 1;

    const fillSteps = variation.steps || 16;
    const fillSpeed = variation.speed || 1;

    // ═══ CÁLCULO DE ENTRY POINT E START STEP ═══
    //
    // Regra: a fill deve TERMINAR exatamente no fim do ciclo do main.
    // Isso garante que ao voltar pro main, o step 0 cai no tempo certo.

    const currentStep = this.stateManager.getCurrentStep();
    const nextStep = this.getNextEntryPoint();

    // Quantos main steps a fill inteira ocupa em tempo musical
    const fillDurationInMainSteps = Math.round(fillSteps * mainSpeed / fillSpeed);

    // Entry point ideal: fill começa aqui e termina exatamente no fim do ciclo
    const idealEntry = mainSteps - fillDurationInMainSteps;

    let entryPoint: number;
    let fillStartStep: number;

    if (idealEntry >= nextStep) {
      // O ponto ideal está no futuro — agendar fill completa nesse ponto
      entryPoint = idealEntry;
      fillStartStep = 0;
    } else {
      // Já passou do ponto ideal — entrar agora e tocar apenas o que cabe
      entryPoint = nextStep;
      const remainingMainSteps = mainSteps - entryPoint;
      const fillStepsPerMainStep = mainSpeed > 0 ? fillSpeed / mainSpeed : 1;
      const actualToPlay = Math.min(Math.round(remainingMainSteps * fillStepsPerMainStep), fillSteps);
      fillStartStep = Math.max(0, fillSteps - actualToPlay);
    }

    this.stateManager.setPendingFill({
      variationIndex,
      entryPoint,
      startStep: fillStartStep
    });
  }

  // ─── End com timing corrigido ───────────────────────────────────────

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

    // End cancela fill pendente
    this.stateManager.setPendingFill(null);

    const mainVariationIndex = this.stateManager.getCurrentVariation('main');
    const mainVariation = state.variations.main[mainVariationIndex];
    const mainSteps = mainVariation?.steps || 16;
    const mainSpeed = mainVariation?.speed || 1;

    const endSteps = variation.steps || 8;
    const endSpeed = variation.speed || 1;

    const currentStep = this.stateManager.getCurrentStep();
    const nextStep = this.getNextEntryPoint();
    const endDurationInMainSteps = Math.round(endSteps * mainSpeed / endSpeed);
    const idealEntry = mainSteps - endDurationInMainSteps;

    let entryPoint: number;
    let endStartStep: number;

    if (idealEntry >= nextStep) {
      entryPoint = idealEntry;
      endStartStep = 0;
    } else {
      entryPoint = nextStep;
      const remainingMainSteps = mainSteps - entryPoint;
      const endStepsPerMainStep = mainSpeed > 0 ? endSpeed / mainSpeed : 1;
      const actualToPlay = Math.min(Math.round(remainingMainSteps * endStepsPerMainStep), endSteps);
      endStartStep = Math.max(0, endSteps - actualToPlay);
    }
    void currentStep;

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
