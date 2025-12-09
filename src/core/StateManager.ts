// Gerenciamento centralizado de estado

import type { SequencerState, PatternType, AudioChannel, PendingPattern } from '../types';
import { createEmptyPattern, createEmptyVolumes, createEmptyChannels } from '../utils/helpers';

export class StateManager {
  private state: SequencerState;
  private listeners: Map<string, Set<(state: SequencerState) => void>> = new Map();

  constructor() {
    this.state = this.createInitialState();
  }

  private createInitialState(): SequencerState {
    const emptyPattern = createEmptyPattern;
    const emptyVolumes = createEmptyVolumes;
    const emptyChannels = createEmptyChannels;

    return {
      isPlaying: false,
      currentStep: 0,
      tempo: 80,
      fillSpeed: 1,
      endSpeed: 1,
      masterVolume: 1.0,
      patternSteps: {
        main: 16,
        fill: 16,
        end: 8,
        intro: 16
      },
      fillSteps: 16,
      patterns: {
        main: emptyPattern(),
        fill: emptyPattern(),
        end: emptyPattern(),
        intro: emptyPattern(),
        transition: emptyPattern()
      },
      volumes: {
        main: emptyVolumes(),
        fill: emptyVolumes(),
        end: emptyVolumes(),
        intro: emptyVolumes(),
        transition: emptyVolumes()
      },
      activePattern: 'main',
      editingPattern: 'main',
      nextPattern: null,
      patternQueue: [],
      variations: {
        main: [
          { pattern: emptyPattern(), volumes: emptyVolumes(), channels: emptyChannels(), steps: 16 },
          { pattern: emptyPattern(), volumes: emptyVolumes(), channels: emptyChannels(), steps: 16 },
          { pattern: emptyPattern(), volumes: emptyVolumes(), channels: emptyChannels(), steps: 16 }
        ],
        fill: [
          { pattern: emptyPattern(), volumes: emptyVolumes(), channels: emptyChannels(), steps: 16 },
          { pattern: emptyPattern(), volumes: emptyVolumes(), channels: emptyChannels(), steps: 16 },
          { pattern: emptyPattern(), volumes: emptyVolumes(), channels: emptyChannels(), steps: 16 }
        ],
        end: [
          { pattern: emptyPattern(), volumes: emptyVolumes(), channels: emptyChannels(), steps: 8 }
        ],
        intro: [
          { pattern: emptyPattern(), volumes: emptyVolumes(), channels: emptyChannels(), steps: 16 }
        ],
        transition: [
          { pattern: emptyPattern(), volumes: emptyVolumes(), channels: emptyChannels(), steps: 16 }
        ]
      },
      currentMainVariation: 0,
      currentFillVariation: 0,
      currentEndVariation: 0,
      fillStartSound: { buffer: null, fileName: '', midiPath: '' },
      fillReturnSound: { buffer: null, fileName: '', midiPath: '' },
      shouldPlayStartSound: false,
      shouldPlayReturnSound: false,
      channels: {
        main: emptyChannels(),
        fill: emptyChannels(),
        end: emptyChannels(),
        intro: emptyChannels(),
        transition: emptyChannels()
      },
      pendingFill: null,
      pendingEnd: null
    };
  }

  // Getters
  getState(): SequencerState {
    return this.state;
  }

  isPlaying(): boolean {
    return this.state.isPlaying;
  }

  getTempo(): number {
    return this.state.tempo;
  }

  getMasterVolume(): number {
    return this.state.masterVolume;
  }

  getActivePattern(): PatternType {
    return this.state.activePattern;
  }

  getEditingPattern(): PatternType {
    return this.state.editingPattern;
  }

  getCurrentStep(): number {
    return this.state.currentStep;
  }

  getPatternSteps(pattern: PatternType): number {
    if (pattern === 'main' || pattern === 'fill' || pattern === 'end' || pattern === 'intro') {
      return this.state.patternSteps[pattern];
    }
    return 16;
  }

  // Obter steps da variação atual
  getCurrentVariationSteps(pattern: PatternType): number {
    const variationIndex = this.getCurrentVariation(pattern);
    const variation = this.state.variations[pattern][variationIndex];
    return variation?.steps || 16;
  }

  // Definir steps para uma variação específica
  setVariationSteps(pattern: PatternType, variationIndex: number, steps: number): void {
    const variation = this.state.variations[pattern][variationIndex];
    if (variation) {
      variation.steps = steps;
      this.notify('variationSteps');
    }
  }

  // Setters
  setPlaying(isPlaying: boolean): void {
    this.state.isPlaying = isPlaying;
    this.notify('playState');
  }

  setTempo(tempo: number): void {
    this.state.tempo = tempo;
    this.notify('tempo');
  }

  setMasterVolume(volume: number): void {
    this.state.masterVolume = Math.max(0, Math.min(2, volume));
    this.notify('masterVolume');
  }

  setActivePattern(pattern: PatternType): void {
    this.state.activePattern = pattern;
    this.notify('activePattern');
  }

  setEditingPattern(pattern: PatternType): void {
    this.state.editingPattern = pattern;
    this.notify('editingPattern');
  }

  setCurrentStep(step: number): void {
    this.state.currentStep = step;
    this.notify('currentStep');
  }

  incrementStep(): void {
    this.state.currentStep++;
    this.notify('currentStep');
  }

  resetStep(): void {
    this.state.currentStep = 0;
    this.notify('currentStep');
  }

  // Pattern operations
  toggleStep(pattern: PatternType, channel: number, step: number): void {
    this.state.patterns[pattern][channel][step] = !this.state.patterns[pattern][channel][step];
    this.notify('patterns');
  }

  setStepVolume(pattern: PatternType, channel: number, step: number, volume: number): void {
    this.state.volumes[pattern][channel][step] = Math.max(0, Math.min(1, volume));
    this.notify('volumes');
  }

  setPatternSteps(pattern: PatternType, steps: number): void {
    if (pattern === 'main' || pattern === 'fill' || pattern === 'end' || pattern === 'intro') {
      this.state.patternSteps[pattern] = steps;
      if (pattern === 'fill') {
        this.state.fillSteps = steps;
      }
      this.notify('patternSteps');
    }
  }

  // Variation management
  getCurrentVariation(pattern: PatternType): number {
    if (pattern === 'main') return this.state.currentMainVariation;
    if (pattern === 'fill') return this.state.currentFillVariation;
    if (pattern === 'end') return this.state.currentEndVariation;
    return 0;
  }

  setCurrentVariation(pattern: PatternType, index: number): void {
    if (pattern === 'main') this.state.currentMainVariation = index;
    if (pattern === 'fill') this.state.currentFillVariation = index;
    if (pattern === 'end') this.state.currentEndVariation = index;
    this.notify('variations');
  }

  saveVariation(pattern: PatternType, index: number): void {
    const patternClone = this.state.patterns[pattern].map(row => [...row]);
    const volumesClone = this.state.volumes[pattern].map(row => [...row]);
    const channelsClone = this.state.channels[pattern].map(ch => ({ ...ch }));
    const currentSteps = this.getPatternSteps(pattern);

    this.state.variations[pattern][index] = {
      pattern: patternClone,
      volumes: volumesClone,
      channels: channelsClone,
      steps: currentSteps
    };
    this.notify('variations');
  }

  loadVariation(pattern: PatternType, index: number): boolean {
    const variation = this.state.variations[pattern][index];
    if (!variation || !variation.pattern) return false;

    this.state.patterns[pattern] = variation.pattern.map(row => [...row]);
    this.state.volumes[pattern] = variation.volumes.map(row => [...row]);
    this.state.channels[pattern] = variation.channels.map(ch => ({ ...ch }));

    // Carregar steps da variação
    if (pattern === 'main' || pattern === 'fill' || pattern === 'end' || pattern === 'intro') {
      this.state.patternSteps[pattern] = variation.steps || 16;
    }

    this.notify('patterns');
    this.notify('volumes');
    this.notify('channels');
    this.notify('patternSteps');
    return true;
  }

  // Queue management
  addToQueue(pattern: PatternType): void {
    this.state.patternQueue.push(pattern);
    this.notify('queue');
  }

  shiftQueue(): PatternType | undefined {
    const pattern = this.state.patternQueue.shift();
    this.notify('queue');
    return pattern;
  }

  clearQueue(): void {
    this.state.patternQueue = [];
    this.notify('queue');
  }

  // Pending patterns
  setPendingFill(pending: PendingPattern | null): void {
    this.state.pendingFill = pending;
    this.notify('pendingFill');
  }

  setPendingEnd(pending: PendingPattern | null): void {
    this.state.pendingEnd = pending;
    this.notify('pendingEnd');
  }

  // Sound flags
  setShouldPlayStartSound(should: boolean): void {
    this.state.shouldPlayStartSound = should;
  }

  setShouldPlayReturnSound(should: boolean): void {
    this.state.shouldPlayReturnSound = should;
  }

  // Observer pattern
  subscribe(event: string, callback: (state: SequencerState) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  unsubscribe(event: string, callback: (state: SequencerState) => void): void {
    this.listeners.get(event)?.delete(callback);
  }

  private notify(event: string): void {
    this.listeners.get(event)?.forEach(callback => callback(this.state));
    this.listeners.get('*')?.forEach(callback => callback(this.state));
  }
}
