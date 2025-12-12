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
      version: '1.4',
      tempo: state.tempo,
      patternSteps: state.patternSteps,
      variations: {
        main: state.variations.main.map(v => ({
          pattern: v.pattern,
          volumes: v.volumes,
          audioFiles: v.channels.map(ch => ({
            fileName: ch.fileName,
            audioData: '',
            midiPath: ch.midiPath
          })),
          steps: v.steps,
          speed: v.speed
        })),
        fill: state.variations.fill.map(v => ({
          pattern: v.pattern,
          volumes: v.volumes,
          audioFiles: v.channels.map(ch => ({
            fileName: ch.fileName,
            audioData: '',
            midiPath: ch.midiPath
          })),
          steps: v.steps,
          speed: v.speed
        })),
        end: state.variations.end.map(v => ({
          pattern: v.pattern,
          volumes: v.volumes,
          audioFiles: v.channels.map(ch => ({
            fileName: ch.fileName,
            audioData: '',
            midiPath: ch.midiPath
          })),
          steps: v.steps,
          speed: v.speed
        })),
        intro: state.variations.intro.map(v => ({
          pattern: v.pattern,
          volumes: v.volumes,
          audioFiles: v.channels.map(ch => ({
            fileName: ch.fileName,
            audioData: '',
            midiPath: ch.midiPath
          })),
          steps: v.steps,
          speed: v.speed
        }))
      },
      fillStartSound: {
        fileName: state.fillStartSound.fileName,
        midiPath: state.fillStartSound.midiPath
      },
      fillReturnSound: {
        fileName: state.fillReturnSound.fileName,
        midiPath: state.fillReturnSound.midiPath
      },
      timestamp: new Date().toISOString()
    };

    const json = JSON.stringify(project, null, 2);
    this.downloadFile(json, 'projeto-ritmo.json', 'application/json');
  }

  async loadProject(data: SavedProject): Promise<void> {
    const state = this.stateManager.getState();

    this.stateManager.setTempo(data.tempo || 80);

    // Carregar patternSteps
    if (data.patternSteps) {
      state.patternSteps = {
        main: data.patternSteps.main || 16,
        fill: data.patternSteps.fill || 8,
        end: data.patternSteps.end || 4,
        intro: data.patternSteps.intro || 4
      };
    }

    // Novo formato com variações
    if (data.variations) {
      // Carregar variações de main
      for (let v = 0; v < 3; v++) {
        if (data.variations.main && data.variations.main[v]) {
          const variation = data.variations.main[v];
          const targetSteps = variation.steps || state.patternSteps.main;
          state.variations.main[v] = {
            pattern: expandPattern(variation.pattern, targetSteps),
            volumes: expandVolumes(variation.volumes, targetSteps),
            channels: state.channels.main.map(() => ({ buffer: null, fileName: '', midiPath: '' })),
            steps: targetSteps,
            speed: variation.speed || 1
          };

          // Carregar áudios da variação
          for (let i = 0; i < variation.audioFiles.length && i < 8; i++) {
            const audioFile = variation.audioFiles[i];
            if (!audioFile.fileName && !audioFile.midiPath && !audioFile.audioData) {
              continue;
            }

            const midiPath = normalizeMidiPath(audioFile.midiPath || '');
            state.variations.main[v].channels[i].midiPath = midiPath;
            state.variations.main[v].channels[i].fileName = audioFile.fileName;

            try {
              if (midiPath) {
                const buffer = await this.audioManager.loadAudioFromPath(midiPath);
                state.variations.main[v].channels[i].buffer = buffer;
              } else if (audioFile.audioData) {
                const buffer = await this.audioManager.loadAudioFromBase64(audioFile.audioData);
                state.variations.main[v].channels[i].buffer = buffer;
              }
            } catch (error) {
              console.error(`Erro ao carregar áudio para main variação ${v} canal ${i}:`, error);
            }
          }
        }
      }

      // Carregar variações de fill
      for (let v = 0; v < 3; v++) {
        if (data.variations.fill && data.variations.fill[v]) {
          const variation = data.variations.fill[v];
          const targetSteps = variation.steps || state.patternSteps.fill;
          state.variations.fill[v] = {
            pattern: expandPattern(variation.pattern, targetSteps),
            volumes: expandVolumes(variation.volumes, targetSteps),
            channels: state.channels.fill.map(() => ({ buffer: null, fileName: '', midiPath: '' })),
            steps: targetSteps,
            speed: variation.speed || 1
          };

          // Carregar áudios da variação
          for (let i = 0; i < variation.audioFiles.length && i < 8; i++) {
            const audioFile = variation.audioFiles[i];
            if (!audioFile.fileName && !audioFile.midiPath && !audioFile.audioData) {
              continue;
            }

            const midiPath = normalizeMidiPath(audioFile.midiPath || '');
            state.variations.fill[v].channels[i].midiPath = midiPath;
            state.variations.fill[v].channels[i].fileName = audioFile.fileName;

            try {
              if (midiPath) {
                const buffer = await this.audioManager.loadAudioFromPath(midiPath);
                state.variations.fill[v].channels[i].buffer = buffer;
              } else if (audioFile.audioData) {
                const buffer = await this.audioManager.loadAudioFromBase64(audioFile.audioData);
                state.variations.fill[v].channels[i].buffer = buffer;
              }
            } catch (error) {
              console.error(`Erro ao carregar áudio para fill variação ${v} canal ${i}:`, error);
            }
          }
        }
      }

      // Carregar variações de end
      for (let v = 0; v < 3; v++) {
        if (data.variations.end && data.variations.end[v]) {
          const variation = data.variations.end[v];
          const targetSteps = variation.steps || state.patternSteps.end;
          state.variations.end[v] = {
            pattern: expandPattern(variation.pattern, targetSteps),
            volumes: expandVolumes(variation.volumes, targetSteps),
            channels: state.channels.end.map(() => ({ buffer: null, fileName: '', midiPath: '' })),
            steps: targetSteps,
            speed: variation.speed || 1
          };

          // Carregar áudios da variação
          for (let i = 0; i < variation.audioFiles.length && i < 8; i++) {
            const audioFile = variation.audioFiles[i];
            if (!audioFile.fileName && !audioFile.midiPath && !audioFile.audioData) {
              continue;
            }

            const midiPath = normalizeMidiPath(audioFile.midiPath || '');
            state.variations.end[v].channels[i].midiPath = midiPath;
            state.variations.end[v].channels[i].fileName = audioFile.fileName;

            try {
              if (midiPath) {
                const buffer = await this.audioManager.loadAudioFromPath(midiPath);
                state.variations.end[v].channels[i].buffer = buffer;
              } else if (audioFile.audioData) {
                const buffer = await this.audioManager.loadAudioFromBase64(audioFile.audioData);
                state.variations.end[v].channels[i].buffer = buffer;
              }
            } catch (error) {
              console.error(`Erro ao carregar áudio para end variação ${v} canal ${i}:`, error);
            }
          }
        }
      }

      // Carregar variações de intro (apenas uma variação)
      if (data.variations.intro && data.variations.intro.length > 0) {
        console.log('Carregando intro, quantidade de variações:', data.variations.intro.length);
        for (let v = 0; v < Math.min(data.variations.intro.length, 1); v++) {
          const variation = data.variations.intro[v];
          if (!variation) {
            console.log(`Variação intro ${v} não existe`);
            continue;
          }

          console.log(`Carregando intro variação ${v}, steps:`, variation.steps);
          const targetSteps = variation.steps || state.patternSteps.intro;
          state.variations.intro[v] = {
            pattern: expandPattern(variation.pattern, targetSteps),
            volumes: expandVolumes(variation.volumes, targetSteps),
            channels: state.channels.intro.map(() => ({ buffer: null, fileName: '', midiPath: '' })),
            steps: targetSteps,
            speed: variation.speed || 1
          };

          // Carregar áudios da variação
          console.log(`Intro variação ${v} tem ${variation.audioFiles.length} arquivos de áudio`);
          for (let i = 0; i < variation.audioFiles.length && i < 8; i++) {
            const audioFile = variation.audioFiles[i];
            if (!audioFile.fileName && !audioFile.midiPath && !audioFile.audioData) {
              continue;
            }

            console.log(`Carregando áudio intro canal ${i}:`, audioFile.fileName, audioFile.midiPath);
            const midiPath = normalizeMidiPath(audioFile.midiPath || '');
            state.variations.intro[v].channels[i].midiPath = midiPath;
            state.variations.intro[v].channels[i].fileName = audioFile.fileName;

            try {
              if (midiPath) {
                const buffer = await this.audioManager.loadAudioFromPath(midiPath);
                state.variations.intro[v].channels[i].buffer = buffer;
                console.log(`✓ Áudio carregado com sucesso para intro canal ${i}`);
              } else if (audioFile.audioData) {
                const buffer = await this.audioManager.loadAudioFromBase64(audioFile.audioData);
                state.variations.intro[v].channels[i].buffer = buffer;
                console.log(`✓ Áudio carregado com sucesso para intro canal ${i} (base64)`);
              }
            } catch (error) {
              console.error(`Erro ao carregar áudio para intro variação ${v} canal ${i}:`, error);
            }
          }
        }
      } else {
        console.log('Intro não foi carregada - data.variations.intro:', data.variations?.intro);
      }

      // Carregar sons de início e retorno
      if (data.fillStartSound) {
        state.fillStartSound.fileName = data.fillStartSound.fileName;
        state.fillStartSound.midiPath = data.fillStartSound.midiPath;
        if (data.fillStartSound.midiPath) {
          try {
            const buffer = await this.audioManager.loadAudioFromPath(data.fillStartSound.midiPath);
            state.fillStartSound.buffer = buffer;
          } catch (error) {
            console.error('Erro ao carregar som de início:', error);
          }
        }
      }

      if (data.fillReturnSound) {
        state.fillReturnSound.fileName = data.fillReturnSound.fileName;
        state.fillReturnSound.midiPath = data.fillReturnSound.midiPath;
        if (data.fillReturnSound.midiPath) {
          try {
            const buffer = await this.audioManager.loadAudioFromPath(data.fillReturnSound.midiPath);
            state.fillReturnSound.buffer = buffer;
          } catch (error) {
            console.error('Erro ao carregar som de retorno:', error);
          }
        }
      }
    } else {
      // Formato legado - carregar padrões únicos
      if (data.patterns?.main) {
        state.patterns.main = expandPattern(data.patterns.main);
      }
      if (data.patterns?.fill) {
        state.patterns.fill = expandPattern(data.patterns.fill);
      }
      if (data.patterns?.end) {
        state.patterns.end = expandPattern(data.patterns.end);
      }
      if (data.patterns?.intro) {
        state.patterns.intro = expandPattern(data.patterns.intro);
      }

      // Carregar volumes
      if (data.volumes) {
        if (data.volumes.main) state.volumes.main = expandVolumes(data.volumes.main);
        if (data.volumes.fill) state.volumes.fill = expandVolumes(data.volumes.fill);
        if (data.volumes.end) state.volumes.end = expandVolumes(data.volumes.end);
        if (data.volumes.intro) state.volumes.intro = expandVolumes(data.volumes.intro);
      }

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

      // Criar variações a partir dos padrões únicos
      for (let v = 0; v < 3; v++) {
        state.variations.main[v] = {
          pattern: state.patterns.main.map(row => [...row]),
          volumes: state.volumes.main.map(row => [...row]),
          channels: state.channels.main.map(ch => ({ ...ch })),
          steps: state.patternSteps.main || 16,
          speed: 1
        };
      }

      for (let v = 0; v < 3; v++) {
        state.variations.fill[v] = {
          pattern: state.patterns.fill.map(row => [...row]),
          volumes: state.volumes.fill.map(row => [...row]),
          channels: state.channels.fill.map(ch => ({ ...ch })),
          steps: state.patternSteps.fill || 16,
          speed: 1
        };
      }

      for (let v = 0; v < 3; v++) {
        state.variations.end[v] = {
          pattern: state.patterns.end.map(row => [...row]),
          volumes: state.volumes.end.map(row => [...row]),
          channels: state.channels.end.map(ch => ({ ...ch })),
          steps: state.patternSteps.end || 8,
          speed: 1
        };
      }

      state.variations.intro[0] = {
        pattern: state.patterns.intro.map(row => [...row]),
        volumes: state.volumes.intro.map(row => [...row]),
        channels: state.channels.intro.map(ch => ({ ...ch })),
        steps: state.patternSteps.intro || 4,
        speed: 1
      };
    }
  }

  async loadProjectFromPath(filePath: string): Promise<void> {
    const response = await fetch(filePath);
    const text = await response.text();
    const data = JSON.parse(text);

    if (data.patterns || data.variations) {
      await this.loadProject(data);
    } else {
      throw new Error('Formato de arquivo não reconhecido');
    }
  }

  async loadProjectFromFile(file: File): Promise<void> {
    const text = await file.text();
    const data = JSON.parse(text);

    if (data.patterns || data.variations) {
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
