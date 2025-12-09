// Lógica de padrões e transições

import type { StateManager } from './StateManager';
import type { PatternType } from '../types';

export class PatternEngine {
  private stateManager: StateManager;
  private currentFillRotation = 0;
  private pendingMainVariation = 0;
  private shouldChangeRhythmAfterFill = false;
  private onPatternChange?: (pattern: PatternType) => void;
  private onStop?: () => void;

  constructor(stateManager: StateManager) {
    this.stateManager = stateManager;
  }

  setOnPatternChange(callback: (pattern: PatternType) => void): void {
    this.onPatternChange = callback;
  }

  setOnStop(callback: () => void): void {
    this.onStop = callback;
  }

  checkPendingPatterns(): boolean {
    const state = this.stateManager.getState();
    const currentStep = this.stateManager.getCurrentStep();
    const activePattern = this.stateManager.getActivePattern();

    // Verificar fill pendente
    if (activePattern === 'main' && state.pendingFill) {
      if (currentStep === state.pendingFill.entryPoint) {
        this.stateManager.setActivePattern('fill');
        // Virada sempre começa do step 0 para tocar apenas 1 vez
        this.stateManager.setCurrentStep(0);
        this.stateManager.setPendingFill(null);
        this.onPatternChange?.('fill');
        return true;
      }
    }

    // Verificar end pendente
    if (activePattern === 'main' && state.pendingEnd) {
      if (currentStep === state.pendingEnd.entryPoint) {
        this.stateManager.setActivePattern('end');
        // Finalização sempre começa do step 0
        this.stateManager.setCurrentStep(0);
        this.stateManager.setPendingEnd(null);
        this.onPatternChange?.('end');
        return true;
      }
    }

    return false;
  }

  handlePatternCompletion(): void {
    const activePattern = this.stateManager.getActivePattern();

    if (activePattern === 'fill') {
      this.handleFillCompletion();
    } else if (activePattern === 'end') {
      this.handleEndCompletion();
    } else if (activePattern === 'intro') {
      this.handleIntroCompletion();
    } else if (activePattern === 'main') {
      this.handleMainCompletion();
    }
  }

  private handleFillCompletion(): void {
    this.stateManager.setShouldPlayReturnSound(true);
    this.stateManager.setShouldPlayStartSound(false);

    if (this.shouldChangeRhythmAfterFill) {
      this.shouldChangeRhythmAfterFill = false;
      this.activateRhythm(this.pendingMainVariation);
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

  // Pattern activation methods
  playIntroAndStart(): void {
    const state = this.stateManager.getState();
    const hasIntroPattern = state.patterns.intro.some(row => row.some(step => step));

    if (hasIntroPattern) {
      this.stateManager.setActivePattern('intro');
      this.stateManager.resetStep();
      this.stateManager.setShouldPlayStartSound(false);
    } else {
      this.stateManager.setShouldPlayStartSound(true);
    }
  }

  playFillToNextRhythm(): void {
    const state = this.stateManager.getState();

    // Contar quantos ritmos têm conteúdo
    const availableRhythms = state.variations.main.filter(v =>
      v.pattern.some(row => row.some(step => step === true))
    ).length;

    // Se só tem 1 ritmo, não faz nada
    if (availableRhythms <= 1) return;

    const nextMainVariation = (this.stateManager.getCurrentVariation('main') + 1) % 3;
    this.pendingMainVariation = nextMainVariation;
    this.shouldChangeRhythmAfterFill = true;
    this.playRotatingFill();
  }

  playRotatingFill(): void {
    const fillVariation = this.currentFillRotation;
    this.activateFillWithTiming(fillVariation);
    this.currentFillRotation = (this.currentFillRotation + 1) % 3;
  }

  playEndAndStop(): void {
    this.activateEndWithTiming(0);
  }

  activateRhythm(variationIndex: number): void {
    const variation = this.stateManager.getState().variations.main[variationIndex];
    if (!variation || !variation.pattern) return;

    const hasContent = variation.pattern.some(row => row.some(step => step === true));
    if (!hasContent) return;

    this.stateManager.setCurrentVariation('main', variationIndex);
    this.stateManager.loadVariation('main', variationIndex);

    if (this.stateManager.isPlaying()) {
      this.stateManager.setActivePattern('main');
      this.stateManager.clearQueue();
    }
  }

  activateFillWithTiming(variationIndex: number): void {
    if (!this.stateManager.isPlaying()) return;

    const state = this.stateManager.getState();

    // Prevenir múltiplos fills pendentes
    if (state.pendingFill) return;

    // Prevenir fill se já estamos em fill
    if (state.activePattern === 'fill') return;

    const variation = state.variations.fill[variationIndex];
    if (!variation || !variation.pattern) return;

    const hasContent = variation.pattern.some(row => row.some(step => step === true));
    if (!hasContent) return;

    this.stateManager.setCurrentVariation('fill', variationIndex);
    this.stateManager.loadVariation('fill', variationIndex);

    const entryPoint = this.getNextEntryPoint();
    const fillStartStep = entryPoint;

    this.stateManager.setPendingFill({
      variationIndex,
      entryPoint,
      startStep: fillStartStep
    });
  }

  activateEndWithTiming(variationIndex: number): void {
    if (!this.stateManager.isPlaying()) return;

    const state = this.stateManager.getState();

    // Prevenir end se já estamos em end
    if (state.activePattern === 'end') return;

    const variation = state.variations.end[0];
    if (!variation || !variation.pattern) return;

    const hasContent = variation.pattern.some(row => row.some(step => step === true));
    if (!hasContent) return;

    this.stateManager.setCurrentVariation('end', 0);
    this.stateManager.loadVariation('end', 0);

    const entryPoint = this.getNextEntryPoint();

    this.stateManager.setPendingEnd({
      variationIndex: 0,
      entryPoint,
      startStep: 0
    });
  }

  private getNextEntryPoint(): number {
    const currentStep = this.stateManager.getCurrentStep();
    const activePattern = this.stateManager.getActivePattern();
    const numSteps = this.stateManager.getPatternSteps(activePattern);

    // Determinar divisor baseado no número de steps
    // 16 steps = divisões de 4 (0, 4, 8, 12)
    // 12 steps = divisões de 3 (0, 3, 6, 9)
    // 8 steps = divisões de 4 (0, 4)
    let divisor = 4;
    if (numSteps === 12 || numSteps === 6) {
      divisor = 3;
    }

    // Calcular próximo ponto de entrada que seja múltiplo do divisor
    const nextMultiple = Math.ceil((currentStep + 1) / divisor) * divisor;
    const entryPoint = nextMultiple % numSteps;

    return entryPoint;
  }
}
