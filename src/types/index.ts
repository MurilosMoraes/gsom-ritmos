// Tipos principais do sequenciador

export interface AudioChannel {
  buffer: AudioBuffer | null;
  fileName: string;
  midiPath: string;
}

export type PatternType = 'main' | 'fill' | 'end' | 'intro' | 'transition';

export interface PendingPattern {
  variationIndex: number;
  entryPoint: number;
  startStep: number;
}

export interface PatternSteps {
  main: number;
  fill: number;
  end: number;
  intro: number;
}

export interface PatternVariation {
  pattern: boolean[][];
  volumes: number[][];
  channels: AudioChannel[];
  steps: number;
  speed: number; // Velocidade individual da variação (1 = normal, 2 = 2x mais rápido, etc)
}

export interface SequencerState {
  isPlaying: boolean;
  currentStep: number;
  tempo: number;
  fillSpeed: number;
  endSpeed: number;
  masterVolume: number;
  patternSteps: PatternSteps;
  fillSteps: number;
  patterns: Record<PatternType, boolean[][]>;
  volumes: Record<PatternType, number[][]>;
  activePattern: PatternType;
  editingPattern: PatternType;
  nextPattern: PatternType | null;
  patternQueue: PatternType[];
  variations: {
    main: PatternVariation[];
    fill: PatternVariation[];
    end: PatternVariation[];
    intro: PatternVariation[];
    transition: PatternVariation[];
  };
  currentMainVariation: number;
  currentFillVariation: number;
  currentEndVariation: number;
  fillStartSound: {
    buffer: AudioBuffer | null;
    fileName: string;
    midiPath: string;
  };
  fillReturnSound: {
    buffer: AudioBuffer | null;
    fileName: string;
    midiPath: string;
  };
  shouldPlayStartSound: boolean;
  shouldPlayReturnSound: boolean;
  channels: Record<PatternType, AudioChannel[]>;
  pendingFill: PendingPattern | null;
  pendingEnd: PendingPattern | null;
}

export interface AudioFileData {
  fileName: string;
  audioData: string;
  midiPath?: string;
}

export interface SavedPattern {
  version: string;
  type: PatternType;
  tempo: number;
  pattern: boolean[][];
  volumes?: number[][];
  audioFiles: AudioFileData[];
  timestamp: string;
  name?: string;
}

export interface SavedVariation {
  pattern: boolean[][];
  volumes: number[][];
  audioFiles: AudioFileData[];
  steps: number;
  speed?: number; // Opcional para compatibilidade com arquivos antigos
}

export interface SavedProject {
  version: string;
  tempo: number;
  patternSteps?: PatternSteps;
  // Legacy support - padrões únicos (será removido em versões futuras)
  patterns?: {
    main?: boolean[][];
    fill?: boolean[][];
    end?: boolean[][];
    intro?: boolean[][];
    transition?: boolean[][];
  };
  volumes?: {
    main?: number[][];
    fill?: number[][];
    end?: number[][];
    intro?: number[][];
    transition?: number[][];
  };
  audioFiles?: {
    main?: AudioFileData[];
    fill?: AudioFileData[];
    end?: AudioFileData[];
    intro?: AudioFileData[];
    transition?: AudioFileData[];
  };
  // Novo formato com variações
  variations?: {
    main: SavedVariation[];
    fill: SavedVariation[];
    end: SavedVariation[];
    intro?: SavedVariation[];
  };
  fillStartSound?: {
    fileName: string;
    midiPath: string;
  };
  fillReturnSound?: {
    fileName: string;
    midiPath: string;
  };
  timestamp: string;
  name?: string;
}
