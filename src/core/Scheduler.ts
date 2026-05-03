// Scheduling preciso de steps — baseado exclusivamente no Web Audio clock

import type { StateManager } from './StateManager';
import type { IAudioEngine } from './audio/IAudioEngine';
import type { PatternEngine } from './PatternEngine';
import type { PatternType } from '../types';

export class Scheduler {
  private stateManager: StateManager;
  /** IAudioEngine — pode ser WebAudioEngine (web/PWA) ou NativeAudioEngine
   *  (Capacitor com flag native ativa). Comportamento idêntico do ponto de
   *  vista do Scheduler. */
  private audioManager: IAudioEngine;
  private patternEngine: PatternEngine;
  private timerId: number | null = null;
  private rafId: number | null = null;

  // Timing — todos os valores são em segundos do AudioContext clock
  private nextStepTime = 0;
  private readonly scheduleAheadTime: number;
  private readonly tickInterval: number;
  // Lookahead estendido em background (setTimeout throttle no Chrome
  // Android e iOS Safari para de chamar tick → silêncio se a fila acabar).
  // 5s cobre até throttle de 1Hz por ~5min sem buraco audível.
  private readonly backgroundScheduleAheadTime: number = 5.0;

  // Detectar mobile pra ajustar performance
  private static readonly isMobile = /Android|iPhone|iPad|iPod/i.test(
    typeof navigator !== 'undefined' ? navigator.userAgent : ''
  );

  // UI sync — usa rAF vinculado ao audio clock
  private pendingUISteps: Array<{ step: number; time: number; pattern: PatternType }> = [];
  private updateStepCallback?: (step: number, pattern: PatternType) => void;

  // Guard contra re-entrância
  private isScheduling = false;

  constructor(
    stateManager: StateManager,
    audioManager: IAudioEngine,
    patternEngine: PatternEngine
  ) {
    this.stateManager = stateManager;
    this.audioManager = audioManager;
    this.patternEngine = patternEngine;

    // Mobile: lookahead maior + tick mais leve (CPU fraca engasga com 12ms)
    // Desktop: mais preciso
    this.scheduleAheadTime = Scheduler.isMobile ? 0.5 : 0.25;
    this.tickInterval = Scheduler.isMobile ? 25 : 12;
  }

  /** Lookahead atual: maior em background pra cobrir setTimeout throttle */
  private getEffectiveLookahead(): number {
    if (typeof document !== 'undefined' && document.hidden) {
      return this.backgroundScheduleAheadTime;
    }
    return this.scheduleAheadTime;
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

  restart(): void {
    // Limpar timers antigos (podem ter morrido no background)
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.isScheduling = false;
    this.pendingUISteps = [];

    // Pular pro tempo atual (não tentar recuperar steps perdidos)
    this.nextStepTime = this.audioManager.getCurrentTime() + 0.05;

    // Reiniciar loops
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

      const effectiveLookahead = this.getEffectiveLookahead();
      while (this.nextStepTime < currentTime + effectiveLookahead) {
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

    // ═══ TIMING ═══
    // O intervalo entre o step recém-agendado e o próximo sempre usa a velocidade
    // do step que FOI AGENDADO (speedBefore), não do próximo step.
    this.nextStepTime += secondsPerStepBefore;

    // Verificar fim do padrão (quando volta ao step 0)
    // O prato de saída precisa do tempo APÓS o último step (nextStepTime já incrementado)
    if (!transitioned && nextStep === 0) {
      this.patternEngine.handlePatternCompletion(this.nextStepTime);
    }

    // Capturar velocidade APÓS transições
    const activePatternAfter = this.stateManager.getActivePattern();
    const variationIndexAfter = this.stateManager.getCurrentVariation(activePatternAfter);
    const speedAfter = this.stateManager.getVariationSpeed(activePatternAfter, variationIndexAfter);
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
    // Calcular stepDuration (usado pra aplicar offset por célula)
    const variationIndex = this.stateManager.getCurrentVariation(activePattern);
    const speed = this.stateManager.getVariationSpeed(activePattern, variationIndex);
    const secondsPerBeat = 60.0 / state.tempo;
    const stepDuration = (secondsPerBeat / 2) / (speed || 1);

    return {
      step,
      pattern: state.patterns[activePattern],
      channels: state.channels[activePattern],
      volumes: state.volumes[activePattern],
      offsets: state.offsets?.[activePattern],
      stepDuration,
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
