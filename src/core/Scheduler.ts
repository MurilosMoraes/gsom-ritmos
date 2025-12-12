// Scheduling preciso de steps

import type { StateManager } from './StateManager';
import type { AudioManager } from './AudioManager';
import type { PatternEngine } from './PatternEngine';

export class Scheduler {
  private stateManager: StateManager;
  private audioManager: AudioManager;
  private patternEngine: PatternEngine;
  private intervalId: number | null = null;
  private scheduleAheadTime = 0.1;
  private nextStepTime = 0;
  private updateStepCallback?: () => void;

  constructor(
    stateManager: StateManager,
    audioManager: AudioManager,
    patternEngine: PatternEngine
  ) {
    this.stateManager = stateManager;
    this.audioManager = audioManager;
    this.patternEngine = patternEngine;
  }

  setUpdateStepCallback(callback: () => void): void {
    this.updateStepCallback = callback;
  }

  start(): void {
    this.nextStepTime = this.audioManager.getCurrentTime();
    this.schedule();
  }

  stop(): void {
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }
  }

  private schedule(): void {
    const currentTime = this.audioManager.getCurrentTime();

    let stepsScheduled = 0;
    while (this.nextStepTime < currentTime + this.scheduleAheadTime) {
      const state = this.stateManager.getState();
      this.audioManager.scheduleStep(
        this.stateManager.getCurrentStep(),
        this.nextStepTime,
        state
      );
      this.nextStep();
      stepsScheduled++;
    }

    if (stepsScheduled > 0) {
      console.log(`[Scheduler.schedule] Scheduled ${stepsScheduled} steps`);
    }

    if (this.stateManager.isPlaying()) {
      this.intervalId = window.setTimeout(() => this.schedule(), 25);
    }
  }

  private nextStep(): void {
    const state = this.stateManager.getState();
    const secondsPerBeat = 60.0 / this.stateManager.getTempo();

    // Obter velocidade da variação ativa
    const activePattern = this.stateManager.getActivePattern();
    const currentVariationIndex = this.stateManager.getCurrentVariation(activePattern);
    const speedMultiplier = this.stateManager.getVariationSpeed(activePattern, currentVariationIndex);

    const secondsPerStep = (secondsPerBeat / 2) / speedMultiplier;
    this.nextStepTime += secondsPerStep;

    // Incrementar step temporariamente para calcular o próximo
    const currentStep = this.stateManager.getCurrentStep();
    const maxSteps = this.stateManager.getPatternSteps(activePattern);
    const nextStep = (currentStep + 1) % maxSteps;

    console.log(`[Scheduler] currentStep=${currentStep}, maxSteps=${maxSteps}, nextStep=${nextStep}, activePattern=${activePattern}`);

    // Atualizar o step
    this.stateManager.setCurrentStep(nextStep);

    // Verificar padrões pendentes APÓS incrementar o step
    const hasPending = this.patternEngine.checkPendingPatterns();
    console.log(`[Scheduler] checkPendingPatterns returned: ${hasPending}`);
    if (hasPending) {
      // Atualizar UI antes de retornar
      if (this.updateStepCallback) {
        const delay = (this.nextStepTime - this.audioManager.getCurrentTime()) * 1000;
        setTimeout(() => this.updateStepCallback!(), Math.max(0, delay));
      }
      return;
    }

    // Verificar fim do padrão (quando volta ao step 0)
    if (nextStep === 0) {
      console.log(`[Scheduler] Pattern completed, calling handlePatternCompletion()`);
      this.patternEngine.handlePatternCompletion();
    }

    // Atualizar UI
    if (this.updateStepCallback) {
      const delay = (this.nextStepTime - this.audioManager.getCurrentTime()) * 1000;
      setTimeout(() => this.updateStepCallback!(), Math.max(0, delay));
    }

    console.log(`[Scheduler] isPlaying=${this.stateManager.isPlaying()}`);
  }
}
