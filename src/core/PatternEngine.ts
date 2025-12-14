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

    // Reset step para 0 ao voltar para o main após a fill
    this.stateManager.resetStep();

    if (this.shouldChangeRhythmAfterFill) {
      this.shouldChangeRhythmAfterFill = false;
      // Após fill, sempre começa do step 0 - usar ativação simples
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

  playFillToNextRhythm(targetVariationIndex?: number): void {
    const state = this.stateManager.getState();

    let nextMainVariation: number;

    if (targetVariationIndex !== undefined) {
      // Se foi especificado um ritmo alvo, usar ele
      nextMainVariation = targetVariationIndex;
    } else {
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
      nextMainVariation = availableRhythms[nextPosition].index;
    }

    // Verificar se há fills disponíveis
    const availableFills = state.variations.fill
      .filter(f => f.pattern.some(row => row.some(step => step === true)));

    if (availableFills.length === 0) {
      // Sem fills disponíveis: trocar diretamente com sincronização musical
      console.log('[PatternEngine] No fills available, switching rhythm directly');
      this.activateRhythm(nextMainVariation);
      return;
    }

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

  // Ativar ritmo começando do step 0 (após fill, intro, etc)
  private activateRhythmFromStart(variationIndex: number): void {
    const variation = this.stateManager.getState().variations.main[variationIndex];
    if (!variation || !variation.pattern) return;

    const hasContent = variation.pattern.some(row => row.some(step => step === true));
    if (!hasContent) return;

    this.stateManager.setCurrentVariation('main', variationIndex);
    this.stateManager.loadVariation('main', variationIndex);

    if (this.stateManager.isPlaying()) {
      this.stateManager.setActivePattern('main');
      this.stateManager.clearQueue();
      // Step já foi resetado para 0 antes de chamar este método
      this.onPatternChange?.('main');
    }
  }

  activateRhythm(variationIndex: number): void {
    const variation = this.stateManager.getState().variations.main[variationIndex];
    if (!variation || !variation.pattern) return;

    const hasContent = variation.pattern.some(row => row.some(step => step === true));
    if (!hasContent) return;

    // Antes de trocar, calcular a posição musical atual
    const currentStep = this.stateManager.getCurrentStep();
    const currentVariationIndex = this.stateManager.getCurrentVariation('main');
    const currentVariation = this.stateManager.getState().variations.main[currentVariationIndex];
    const currentSteps = currentVariation?.steps || 16;
    const currentSpeed = currentVariation?.speed || 1;

    // Posição dentro do ciclo atual (0 a 1)
    const cyclePosition = currentStep / currentSteps;

    this.stateManager.setCurrentVariation('main', variationIndex);
    this.stateManager.loadVariation('main', variationIndex);

    if (this.stateManager.isPlaying()) {
      this.stateManager.setActivePattern('main');
      this.stateManager.clearQueue();

      // Calcular o step equivalente no novo ritmo
      const newSteps = variation.steps || 16;
      const newSpeed = variation.speed || 1;

      // Converter posição do ciclo considerando a diferença de velocidade
      // Se vou de 1x para 2x: cyclePosition 0.5 no 1x = cyclePosition 0 no 2x (já completou um ciclo)
      // Se vou de 2x para 1x: cyclePosition 0.5 no 2x = cyclePosition 0.25 no 1x
      const speedRatio = newSpeed / currentSpeed;
      const adjustedPosition = (cyclePosition * speedRatio) % 1;
      const equivalentStep = Math.floor(adjustedPosition * newSteps);

      console.log(`[PatternEngine] Rhythm sync: step ${currentStep}/${currentSteps} @${currentSpeed}x -> step ${equivalentStep}/${newSteps} @${newSpeed}x (cycle: ${cyclePosition.toFixed(3)}, adjusted: ${adjustedPosition.toFixed(3)})`);

      this.stateManager.setCurrentStep(equivalentStep);

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

    // Obter informações do main atual
    const mainVariationIndex = this.stateManager.getCurrentVariation('main');
    const mainVariation = state.variations.main[mainVariationIndex];
    const mainSteps = mainVariation?.steps || 16;
    const mainSpeed = mainVariation?.speed || 1;

    // Informações da fill
    const fillSteps = variation.steps;
    const fillSpeed = variation.speed;

    // Calcular tempo musical restante (em "beats base")
    // remainingMainSteps / mainSpeed = tempo musical restante em beats base
    const remainingMainSteps = mainSteps - entryPoint;
    const remainingMusicalBeats = remainingMainSteps / mainSpeed;

    // Quantos steps da fill cabem nesse tempo musical?
    // steps = beats * speed
    const fillStepsToPlay = Math.round(remainingMusicalBeats * fillSpeed) % fillSteps;

    // Se fillStepsToPlay é 0, toca fill completa; senão, começa no step certo
    const fillStartStep = fillStepsToPlay === 0 ? 0 : fillSteps - fillStepsToPlay;

    console.log(`[PatternEngine] Fill timing: main ${entryPoint}/${mainSteps} @${mainSpeed}x, ` +
      `remaining beats: ${remainingMusicalBeats.toFixed(2)}, ` +
      `fill starts at step ${fillStartStep}/${fillSteps} @${fillSpeed}x`);

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

    // Obter informações do main atual
    const mainVariationIndex = this.stateManager.getCurrentVariation('main');
    const mainVariation = state.variations.main[mainVariationIndex];
    const mainSteps = mainVariation?.steps || 16;
    const mainSpeed = mainVariation?.speed || 1;

    // Informações do end
    const endSteps = variation.steps;
    const endSpeed = variation.speed;

    // Calcular tempo musical restante (em "beats base")
    const remainingMainSteps = mainSteps - entryPoint;
    const remainingMusicalBeats = remainingMainSteps / mainSpeed;

    // Quantos steps do end cabem nesse tempo musical?
    const endStepsToPlay = Math.round(remainingMusicalBeats * endSpeed) % endSteps;

    // Se endStepsToPlay é 0, toca end completo; senão, começa no step certo
    const endStartStep = endStepsToPlay === 0 ? 0 : endSteps - endStepsToPlay;

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
