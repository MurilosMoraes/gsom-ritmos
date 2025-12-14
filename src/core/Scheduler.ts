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
    // Capturar velocidade ANTES de qualquer transição
    const activePatternBefore = this.stateManager.getActivePattern();
    const variationIndexBefore = this.stateManager.getCurrentVariation(activePatternBefore);
    const speedBefore = this.stateManager.getVariationSpeed(activePatternBefore, variationIndexBefore);

    // Incrementar step
    const currentStep = this.stateManager.getCurrentStep();
    const maxSteps = this.stateManager.getPatternSteps(activePatternBefore);
    const nextStep = (currentStep + 1) % maxSteps;

    // Atualizar o step
    this.stateManager.setCurrentStep(nextStep);

    // Verificar padrões pendentes (pode mudar o padrão ativo)
    const hasPending = this.patternEngine.checkPendingPatterns();

    // Verificar fim do padrão (quando volta ao step 0)
    if (!hasPending && nextStep === 0) {
      this.patternEngine.handlePatternCompletion();
    }

    // Capturar velocidade APÓS transições
    const activePatternAfter = this.stateManager.getActivePattern();
    const variationIndexAfter = this.stateManager.getCurrentVariation(activePatternAfter);
    const speedAfter = this.stateManager.getVariationSpeed(activePatternAfter, variationIndexAfter);

    const secondsPerBeat = 60.0 / this.stateManager.getTempo();

    // Se a velocidade mudou, precisamos ressincronizar o tempo
    if (speedBefore !== speedAfter) {
      // O próximo step deve começar baseado no tempo atual, não acumulado
      // Isso evita "drift" quando a velocidade muda
      const currentTime = this.audioManager.getCurrentTime();
      const secondsPerStepNew = (secondsPerBeat / 2) / speedAfter;
      this.nextStepTime = currentTime + secondsPerStepNew;

      console.log(`[Scheduler] Speed changed: ${speedBefore}x -> ${speedAfter}x, resync time`);
    } else {
      // Velocidade não mudou, calcular normalmente
      const secondsPerStep = (secondsPerBeat / 2) / speedAfter;
      this.nextStepTime += secondsPerStep;
    }

    // Atualizar UI
    if (this.updateStepCallback) {
      const delay = (this.nextStepTime - this.audioManager.getCurrentTime()) * 1000;
      setTimeout(() => this.updateStepCallback!(), Math.max(0, delay));
    }
  }
}
