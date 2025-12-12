// Lógica de padrões e transições

import type { StateManager } from './StateManager';
import type { PatternType } from '../types';

export class PatternEngine {
  private stateManager: StateManager;
  private currentFillRotation = 0;
  private pendingMainVariation = 0;
  private shouldChangeRhythmAfterFill = false;
  private isTestMode = false;
  private onPatternChange?: (pattern: PatternType) => void;
  private onStop?: () => void;

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

  checkPendingPatterns(): boolean {
    const state = this.stateManager.getState();
    const currentStep = this.stateManager.getCurrentStep();
    const activePattern = this.stateManager.getActivePattern();

    // Verificar fill pendente
    if (activePattern === 'main' && state.pendingFill) {
      if (currentStep === state.pendingFill.entryPoint) {
        this.stateManager.setActivePattern('fill');
        // Virada começa do ponto onde foi agendada para tocar apenas o restante do ciclo
        this.stateManager.setCurrentStep(state.pendingFill.startStep);
        this.stateManager.setPendingFill(null);
        this.onPatternChange?.('fill');
        return true;
      }
    }

    // Verificar end pendente
    if (activePattern === 'main' && state.pendingEnd) {
      if (currentStep === state.pendingEnd.entryPoint) {
        this.stateManager.setActivePattern('end');
        // Finalização começa do ponto onde foi agendada
        this.stateManager.setCurrentStep(state.pendingEnd.startStep);
        this.stateManager.setPendingEnd(null);
        this.onPatternChange?.('end');
        return true;
      }
    }

    return false;
  }

  handlePatternCompletion(): void {
    // No modo de teste, não fazer transições - apenas continuar em loop
    if (this.isTestMode) {
      console.log('[PatternEngine] Test mode - skipping pattern transitions, continuing loop');
      return;
    }

    const activePattern = this.stateManager.getActivePattern();
    console.log(`[PatternEngine] handlePatternCompletion for ${activePattern}`);

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

    // Verificar se há intro carregada nas variações
    const introVariation = state.variations.intro[0];
    const hasIntroPattern = introVariation?.pattern.some(row => row.some(step => step));

    if (hasIntroPattern) {
      console.log('Intro detectada, carregando variação 0');
      this.stateManager.setCurrentVariation('intro', 0);
      this.stateManager.loadVariation('intro', 0);
      this.stateManager.setActivePattern('intro');
      this.stateManager.resetStep();
      this.stateManager.setShouldPlayStartSound(false);
      this.onPatternChange?.('intro');
    } else {
      console.log('Nenhuma intro detectada, iniciando direto no main');
      this.stateManager.setShouldPlayStartSound(true);
    }
  }

  playFillToNextRhythm(): void {
    const state = this.stateManager.getState();

    // Obter ritmos disponíveis com seus índices
    const availableRhythms = state.variations.main
      .map((v, index) => ({
        index,
        hasContent: v.pattern.some(row => row.some(step => step === true))
      }))
      .filter(r => r.hasContent);

    // Se só tem 1 ritmo, não faz nada
    if (availableRhythms.length <= 1) return;

    // Encontrar próximo ritmo com conteúdo
    const currentIndex = this.stateManager.getCurrentVariation('main');
    const currentPosition = availableRhythms.findIndex(r => r.index === currentIndex);
    const nextPosition = (currentPosition + 1) % availableRhythms.length;
    const nextMainVariation = availableRhythms[nextPosition].index;

    this.pendingMainVariation = nextMainVariation;
    this.shouldChangeRhythmAfterFill = true;
    this.playRotatingFill();
  }

  playRotatingFill(): void {
    const state = this.stateManager.getState();

    // Obter viradas disponíveis com seus índices
    const availableFills = state.variations.fill
      .map((v, index) => ({
        index,
        hasContent: v.pattern.some(row => row.some(step => step === true))
      }))
      .filter(f => f.hasContent);

    // Se não tem nenhuma virada, não faz nada
    if (availableFills.length === 0) return;

    // Encontrar próxima virada com conteúdo a partir da rotação atual
    let fillIndex = this.currentFillRotation;
    let attempts = 0;

    // Tentar encontrar uma virada com conteúdo
    while (attempts < 3) {
      const variation = state.variations.fill[fillIndex];
      const hasContent = variation?.pattern.some(row => row.some(step => step === true));

      if (hasContent) {
        this.activateFillWithTiming(fillIndex);
        this.currentFillRotation = (fillIndex + 1) % 3;
        return;
      }

      fillIndex = (fillIndex + 1) % 3;
      attempts++;
    }

    // Se chegou aqui, usar a primeira virada disponível
    if (availableFills.length > 0) {
      this.activateFillWithTiming(availableFills[0].index);
      this.currentFillRotation = (availableFills[0].index + 1) % 3;
    }
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
      // Notificar UI da mudança de pattern
      this.onPatternChange?.('main');
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
    // A virada começa do mesmo ponto onde vai entrar, tocando apenas o restante do ciclo
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
    // Finalização começa do mesmo ponto onde vai entrar
    const endStartStep = entryPoint;

    this.stateManager.setPendingEnd({
      variationIndex: 0,
      entryPoint,
      startStep: endStartStep
    });
  }

  private getNextEntryPoint(): number {
    const currentStep = this.stateManager.getCurrentStep();
    const activePattern = this.stateManager.getActivePattern();
    const numSteps = this.stateManager.getPatternSteps(activePattern);
    // Entra imediatamente no próximo step para transição fluida
    const nextEntry = (currentStep + 1) % numSteps;
    return nextEntry;
  }
}
