// Gerenciamento de arquivos (salvar/carregar projetos)

import type { SavedProject, SavedPattern, AudioFileData, PatternType } from '../types';
import type { StateManager } from '../core/StateManager';
import type { AudioManager } from '../core/AudioManager';
import { arrayBufferToBase64, expandPattern, expandVolumes, normalizeMidiPath } from '../utils/helpers';

export class FileManager {
  private stateManager: StateManager;
  private audioManager: AudioManager;

  constructor(stateManager: StateManager, audioManager: AudioManager) {
    this.stateManager = stateManager;
    this.audioManager = audioManager;
  }

  async saveProject(): Promise<void> {
    const state = this.stateManager.getState();
    const project: SavedProject = {
      version: '1.3',
      tempo: state.tempo,
      patternSteps: state.patternSteps,
      patterns: {
        main: state.patterns.main,
        fill: state.patterns.fill,
        end: state.patterns.end,
        intro: state.patterns.intro
      },
      volumes: {
        main: state.volumes.main,
        fill: state.volumes.fill,
        end: state.volumes.end,
        intro: state.volumes.intro
      },
      audioFiles: {
        main: state.channels.main.map(ch => ({
          fileName: ch.fileName,
          audioData: '',
          midiPath: ch.midiPath
        })),
        fill: state.channels.fill.map(ch => ({
          fileName: ch.fileName,
          audioData: '',
          midiPath: ch.midiPath
        })),
        end: state.channels.end.map(ch => ({
          fileName: ch.fileName,
          audioData: '',
          midiPath: ch.midiPath
        })),
        intro: state.channels.intro.map(ch => ({
          fileName: ch.fileName,
          audioData: '',
          midiPath: ch.midiPath
        }))
      },
      timestamp: new Date().toISOString()
    };

    const json = JSON.stringify(project, null, 2);
    this.downloadFile(json, 'projeto-ritmo.json', 'application/json');
  }

  async loadProject(data: SavedProject): Promise<void> {
    const state = this.stateManager.getState();

    // Carregar padrões
    if (data.patterns.main) {
      state.patterns.main = expandPattern(data.patterns.main);
    }
    if (data.patterns.fill) {
      state.patterns.fill = expandPattern(data.patterns.fill);
    }
    if (data.patterns.end) {
      state.patterns.end = expandPattern(data.patterns.end);
    }
    if (data.patterns.intro) {
      state.patterns.intro = expandPattern(data.patterns.intro);
    }

    // Carregar volumes
    if (data.volumes) {
      if (data.volumes.main) state.volumes.main = expandVolumes(data.volumes.main);
      if (data.volumes.fill) state.volumes.fill = expandVolumes(data.volumes.fill);
      if (data.volumes.end) state.volumes.end = expandVolumes(data.volumes.end);
      if (data.volumes.intro) state.volumes.intro = expandVolumes(data.volumes.intro);
    }

    // Carregar patternSteps
    if (data.patternSteps) {
      state.patternSteps = {
        main: data.patternSteps.main || 16,
        fill: data.patternSteps.fill || 8,
        end: data.patternSteps.end || 4,
        intro: data.patternSteps.intro || 4
      };
    }

    this.stateManager.setTempo(data.tempo || 80);

    // Carregar áudio
    if (data.audioFiles) {
      const patterns: PatternType[] = ['main', 'fill', 'end', 'intro'];

      for (const patternType of patterns) {
        const audioFiles = data.audioFiles[patternType];
        if (audioFiles && audioFiles.length > 0) {
          for (let i = 0; i < audioFiles.length && i < 8; i++) {
            const audioFile = audioFiles[i];

            if (!audioFile.fileName && !audioFile.midiPath && !audioFile.audioData) {
              continue;
            }

            const midiPath = normalizeMidiPath(audioFile.midiPath || '');
            state.channels[patternType][i].midiPath = midiPath;
            state.channels[patternType][i].fileName = audioFile.fileName;

            try {
              if (midiPath) {
                const buffer = await this.audioManager.loadAudioFromPath(midiPath);
                state.channels[patternType][i].buffer = buffer;
              } else if (audioFile.audioData) {
                const buffer = await this.audioManager.loadAudioFromBase64(audioFile.audioData);
                state.channels[patternType][i].buffer = buffer;
              }
            } catch (error) {
              console.error(`Erro ao carregar áudio para ${patternType} canal ${i}:`, error);
            }
          }
        }
      }
    }

    // Salvar padrões em variações
    for (let v = 0; v < 3; v++) {
      state.variations.main[v] = {
        pattern: state.patterns.main.map(row => [...row]),
        volumes: state.volumes.main.map(row => [...row]),
        channels: state.channels.main.map(ch => ({ ...ch })),
        steps: state.patternSteps.main || 16
      };
    }

    for (let v = 0; v < 3; v++) {
      state.variations.fill[v] = {
        pattern: state.patterns.fill.map(row => [...row]),
        volumes: state.volumes.fill.map(row => [...row]),
        channels: state.channels.fill.map(ch => ({ ...ch })),
        steps: state.patternSteps.fill || 16
      };
    }

    state.variations.end[0] = {
      pattern: state.patterns.end.map(row => [...row]),
      volumes: state.volumes.end.map(row => [...row]),
      channels: state.channels.end.map(ch => ({ ...ch })),
      steps: state.patternSteps.end || 8
    };
  }

  async loadProjectFromPath(filePath: string): Promise<void> {
    const response = await fetch(filePath);
    const text = await response.text();
    const data = JSON.parse(text);

    if (data.patterns) {
      await this.loadProject(data);
    } else {
      throw new Error('Formato de arquivo não reconhecido');
    }
  }

  async loadProjectFromFile(file: File): Promise<void> {
    const text = await file.text();
    const data = JSON.parse(text);

    if (data.patterns) {
      await this.loadProject(data);
    } else {
      throw new Error('Formato de arquivo não reconhecido');
    }
  }

  async savePattern(patternType: PatternType): Promise<void> {
    const state = this.stateManager.getState();
    const pattern: SavedPattern = {
      version: '1.3',
      type: patternType,
      tempo: state.tempo,
      pattern: state.patterns[patternType],
      volumes: state.volumes[patternType],
      audioFiles: state.channels[patternType].map(ch => ({
        fileName: ch.fileName,
        audioData: '',
        midiPath: ch.midiPath
      })),
      timestamp: new Date().toISOString()
    };

    const json = JSON.stringify(pattern, null, 2);
    this.downloadFile(json, `pattern-${patternType}.json`, 'application/json');
  }

  async loadPatternFromFile(file: File): Promise<void> {
    const text = await file.text();
    const data = JSON.parse(text) as SavedPattern;

    if (!data.type || !data.pattern) {
      throw new Error('Formato de padrão inválido');
    }

    const state = this.stateManager.getState();
    const patternType = data.type;

    // Carregar padrão
    state.patterns[patternType] = expandPattern(data.pattern);

    // Carregar volumes
    if (data.volumes) {
      state.volumes[patternType] = expandVolumes(data.volumes);
    }

    // Carregar áudio
    if (data.audioFiles && data.audioFiles.length > 0) {
      for (let i = 0; i < data.audioFiles.length && i < 8; i++) {
        const audioFile = data.audioFiles[i];

        if (!audioFile.fileName && !audioFile.midiPath && !audioFile.audioData) {
          continue;
        }

        const midiPath = normalizeMidiPath(audioFile.midiPath || '');
        state.channels[patternType][i].midiPath = midiPath;
        state.channels[patternType][i].fileName = audioFile.fileName;

        try {
          if (midiPath) {
            const buffer = await this.audioManager.loadAudioFromPath(midiPath);
            state.channels[patternType][i].buffer = buffer;
          } else if (audioFile.audioData) {
            const buffer = await this.audioManager.loadAudioFromBase64(audioFile.audioData);
            state.channels[patternType][i].buffer = buffer;
          }
        } catch (error) {
          console.error(`Erro ao carregar áudio para canal ${i}:`, error);
        }
      }
    }

    // Definir como padrão de edição
    this.stateManager.setEditingPattern(patternType);
  }

  private downloadFile(content: string, fileName: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
