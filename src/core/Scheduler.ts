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

    while (this.nextStepTime < currentTime + this.scheduleAheadTime) {
      const state = this.stateManager.getState();
      this.audioManager.scheduleStep(
        this.stateManager.getCurrentStep(),
        this.nextStepTime,
        state
      );
      this.nextStep();
    }

    if (this.stateManager.isPlaying()) {
      this.intervalId = window.setTimeout(() => this.schedule(), 25);
    }
  }

  private nextStep(): void {
    const state = this.stateManager.getState();
    const secondsPerBeat = 60.0 / this.stateManager.getTempo();

    // Aplicar multiplicador de velocidade
    let speedMultiplier = 1;
    const activePattern = this.stateManager.getActivePattern();

    if (activePattern === 'fill') {
      speedMultiplier = state.fillSpeed;
    } else if (activePattern === 'end') {
      speedMultiplier = state.endSpeed;
    }

    const secondsPerStep = (secondsPerBeat / 2) / speedMultiplier;
    this.nextStepTime += secondsPerStep;

    // Incrementar step temporariamente para calcular o próximo
    const currentStep = this.stateManager.getCurrentStep();
    const maxSteps = this.stateManager.getPatternSteps(activePattern);
    const nextStep = (currentStep + 1) % maxSteps;

    // Atualizar o step
    this.stateManager.setCurrentStep(nextStep);

    // Verificar padrões pendentes APÓS incrementar o step
    if (this.patternEngine.checkPendingPatterns()) {
      // Atualizar UI antes de retornar
      if (this.updateStepCallback) {
        const delay = (this.nextStepTime - this.audioManager.getCurrentTime()) * 1000;
        setTimeout(() => this.updateStepCallback!(), Math.max(0, delay));
      }
      return;
    }

    // Verificar fim do padrão (quando volta ao step 0)
    if (nextStep === 0) {
      this.patternEngine.handlePatternCompletion();
    }

    // Atualizar UI
    if (this.updateStepCallback) {
      const delay = (this.nextStepTime - this.audioManager.getCurrentTime()) * 1000;
      setTimeout(() => this.updateStepCallback!(), Math.max(0, delay));
    }
  }
}
