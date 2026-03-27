// Scheduling preciso de steps — baseado exclusivamente no Web Audio clock

import type { StateManager } from './StateManager';
import type { AudioManager } from './AudioManager';
import type { PatternEngine } from './PatternEngine';
import type { PatternType } from '../types';

export class Scheduler {
  private stateManager: StateManager;
  private audioManager: AudioManager;
  private patternEngine: PatternEngine;
  private timerId: number | null = null;
  private rafId: number | null = null;

  // Timing — todos os valores são em segundos do AudioContext clock
  private nextStepTime = 0;
  private readonly scheduleAheadTime = 0.25; // 250ms lookahead (seguro para mobile)
  private readonly tickInterval = 12;         // 12ms tick (mais preciso que 25ms)

  // UI sync — usa rAF vinculado ao audio clock
  private pendingUISteps: Array<{ step: number; time: number; pattern: PatternType }> = [];
  private updateStepCallback?: (step: number, pattern: PatternType) => void;

  // Guard contra re-entrância
  private isScheduling = false;

  constructor(
    stateManager: StateManager,
    audioManager: AudioManager,
    patternEngine: PatternEngine
  ) {
    this.stateManager = stateManager;
    this.audioManager = audioManager;
    this.patternEngine = patternEngine;
  }

  setUpdateStepCallback(callback: (step: number, pattern: PatternType) => void): void {
    this.updateStepCallback = callback;
  }

  start(): void {
    // Pequeno delay inicial para evitar clique no primeiro sample
    this.nextStepTime = this.audioManager.getCurrentTime() + 0.05;
    this.pendingUISteps = [];
    this.tick();
    this.startUISync();
  }

  stop(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingUISteps = [];
    this.isScheduling = false;
  }

  // ─── Core scheduling loop ───────────────────────────────────────────

  private tick(): void {
    if (!this.stateManager.isPlaying()) return;

    // Guard contra re-entrância (setTimeout pode sobrepor)
    if (this.isScheduling) return;
    this.isScheduling = true;

    try {
      const currentTime = this.audioManager.getCurrentTime();

      // Se voltou do background e o scheduling ficou muito atrasado,
      // pular pro tempo atual em vez de tentar agendar tudo de uma vez (causa estralos)
      if (this.nextStepTime < currentTime - 0.5) {
        this.nextStepTime = currentTime + 0.05;
      }

      while (this.nextStepTime < currentTime + this.scheduleAheadTime) {
        if (!this.stateManager.isPlaying()) break;

        // 1. Capturar snapshot do estado ANTES de qualquer mutação
        const step = this.stateManager.getCurrentStep();
        const activePattern = this.stateManager.getActivePattern();
        const state = this.stateManager.getState();
        const snapshot = this.createSnapshot(step, activePattern, state);

        // 2. Limpar flags de som one-shot IMEDIATAMENTE após snapshot
        //    para evitar que toquem novamente no próximo ciclo
        if (snapshot.shouldPlayStartSound) {
          this.stateManager.setShouldPlayStartSound(false);
        }
        if (snapshot.shouldPlayReturnSound) {
          this.stateManager.setShouldPlayReturnSound(false);
        }

        // 3. Agendar áudio com snapshot imutável
        this.audioManager.scheduleStepFromSnapshot(snapshot, this.nextStepTime);

        // 4. Enfileirar atualização visual vinculada ao audio clock
        this.pendingUISteps.push({
          step,
          time: this.nextStepTime,
          pattern: activePattern
        });

        // 5. Avançar para próximo step (pode causar transição de padrão)
        this.advanceStep();
      }
    } finally {
      this.isScheduling = false;
    }

    // Reagendar tick
    if (this.stateManager.isPlaying()) {
      this.timerId = window.setTimeout(() => this.tick(), this.tickInterval);
    }
  }

  // ─── Avanço de step com cálculo de timing correto ───────────────────

  private advanceStep(): void {
    // Capturar velocidade ANTES de qualquer transição
    const activePatternBefore = this.stateManager.getActivePattern();
    const variationIndexBefore = this.stateManager.getCurrentVariation(activePatternBefore);
    const speedBefore = this.stateManager.getVariationSpeed(activePatternBefore, variationIndexBefore);

    // Calcular tempo por step com a velocidade atual
    const secondsPerBeat = 60.0 / this.stateManager.getTempo();
    const secondsPerStepBefore = (secondsPerBeat / 2) / speedBefore;

    // Incrementar step
    const currentStep = this.stateManager.getCurrentStep();
    const maxSteps = this.getCurrentMaxSteps();

    // Guard: evitar divisão por zero ou loop infinito
    if (maxSteps <= 0) {
      this.stateManager.setPlaying(false);
      return;
    }

    const nextStep = (currentStep + 1) % maxSteps;
    this.stateManager.setCurrentStep(nextStep);

    // Verificar padrões pendentes (fill/end agendados)
    const transitioned = this.patternEngine.checkPendingPatterns();

    // Verificar fim do padrão (quando volta ao step 0)
    if (!transitioned && nextStep === 0) {
      this.patternEngine.handlePatternCompletion();
    }

    // Capturar velocidade APÓS transições
    const activePatternAfter = this.stateManager.getActivePattern();
    const variationIndexAfter = this.stateManager.getCurrentVariation(activePatternAfter);
    const speedAfter = this.stateManager.getVariationSpeed(activePatternAfter, variationIndexAfter);

    // ═══ TIMING ═══
    // O intervalo entre o step recém-agendado e o próximo sempre usa a velocidade
    // do step que FOI AGENDADO (speedBefore), não do próximo step.
    // A nova velocidade (speedAfter) só afeta os steps SEGUINTES.
    // Isso garante que a transição fill 2x → main 1x não "estica" o último step.
    this.nextStepTime += secondsPerStepBefore;
  }

  // ─── UI sync via requestAnimationFrame ──────────────────────────────

  private startUISync(): void {
    const sync = () => {
      if (!this.stateManager.isPlaying()) {
        this.rafId = null;
        return;
      }

      const currentTime = this.audioManager.getCurrentTime();

      // Processar steps cuja hora de áudio já passou (com margem de 10ms)
      while (this.pendingUISteps.length > 0) {
        const next = this.pendingUISteps[0];
        if (currentTime >= next.time - 0.01) {
          this.pendingUISteps.shift();
          this.updateStepCallback?.(next.step, next.pattern);
        } else {
          break;
        }
      }

      // Limitar fila para evitar memory leak se UI travar
      if (this.pendingUISteps.length > 64) {
        this.pendingUISteps = this.pendingUISteps.slice(-16);
      }

      this.rafId = requestAnimationFrame(sync);
    };

    this.rafId = requestAnimationFrame(sync);
  }

  // ─── Snapshot imutável para scheduling ──────────────────────────────

  private createSnapshot(step: number, activePattern: PatternType, state: any) {
    return {
      step,
      pattern: state.patterns[activePattern],
      channels: state.channels[activePattern],
      volumes: state.volumes[activePattern],
      masterVolume: state.masterVolume,
      shouldPlayStartSound: step === 0 && state.shouldPlayStartSound,
      shouldPlayReturnSound: step === 0 && state.shouldPlayReturnSound,
      fillStartBuffer: state.fillStartSound.buffer,
      fillReturnBuffer: state.fillReturnSound.buffer
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private getCurrentMaxSteps(): number {
    const activePattern = this.stateManager.getActivePattern();
    return this.stateManager.getPatternSteps(activePattern);
  }

  getCurrentSpeed(): number {
    const activePattern = this.stateManager.getActivePattern();
    const variationIndex = this.stateManager.getCurrentVariation(activePattern);
    return this.stateManager.getVariationSpeed(activePattern, variationIndex);
  }
}
