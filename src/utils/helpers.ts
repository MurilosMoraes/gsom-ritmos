// Funções auxiliares

import { MAX_CHANNELS, type AudioChannel } from '../types';

export function createEmptyPattern(numSteps: number = 16): boolean[][] {
  return Array(MAX_CHANNELS).fill(null).map(() =>
    Array(numSteps).fill(false)
  );
}

export function createEmptyVolumes(numSteps: number = 16): number[][] {
  return Array(MAX_CHANNELS).fill(null).map(() =>
    Array(numSteps).fill(0.8)
  );
}

export function createEmptyOffsets(numSteps: number = 16): number[][] {
  return Array(MAX_CHANNELS).fill(null).map(() =>
    Array(numSteps).fill(0)
  );
}

export function expandOffsets(offsets: number[][] | undefined, targetSteps: number = 16): number[][] {
  if (!offsets || offsets.length === 0) return createEmptyOffsets(targetSteps);
  const rows = offsets.length;
  const cols = offsets[0]?.length || 0;

  if (rows === MAX_CHANNELS && cols === targetSteps) return offsets;

  const expanded: number[][] = [];
  for (let i = 0; i < MAX_CHANNELS; i++) {
    const row: number[] = [];
    for (let j = 0; j < targetSteps; j++) {
      if (i < rows && j < cols) {
        row.push(offsets[i][j] || 0);
      } else {
        row.push(0);
      }
    }
    expanded.push(row);
  }
  return expanded;
}

export function createEmptyChannels(): AudioChannel[] {
  return Array(MAX_CHANNELS).fill(null).map(() => ({
    buffer: null,
    fileName: '',
    midiPath: ''
  }));
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function normalizeMidiPath(path: string): string {
  if (!path) return '';
  return path.replace(/^\.\//, '');
}

export function expandPattern(pattern: boolean[][], targetSteps: number = 16): boolean[][] {
  const rows = pattern.length;
  const cols = pattern[0]?.length || 0;

  // Se já tem o tamanho correto, retornar o padrão original
  if (rows === MAX_CHANNELS && cols === targetSteps) {
    return pattern;
  }

  const expanded: boolean[][] = [];
  for (let i = 0; i < MAX_CHANNELS; i++) {
    const row: boolean[] = [];
    for (let j = 0; j < targetSteps; j++) {
      if (i < rows && j < cols) {
        row.push(pattern[i][j]);
      } else {
        row.push(false);
      }
    }
    expanded.push(row);
  }

  return expanded;
}

export function expandVolumes(volumes: number[][], targetSteps: number = 16): number[][] {
  const rows = volumes.length;
  const cols = volumes[0]?.length || 0;

  // Se já tem o tamanho correto, retornar os volumes originais
  if (rows === MAX_CHANNELS && cols === targetSteps) {
    return volumes;
  }

  const expanded: number[][] = [];
  for (let i = 0; i < MAX_CHANNELS; i++) {
    const row: number[] = [];
    for (let j = 0; j < targetSteps; j++) {
      if (i < rows && j < cols) {
        row.push(volumes[i][j]);
      } else {
        row.push(1.0);
      }
    }
    expanded.push(row);
  }

  return expanded;
}
