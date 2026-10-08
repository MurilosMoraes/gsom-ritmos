// Gerenciamento de arquivos (salvar/carregar projetos)

import { MAX_CHANNELS, type SavedProject, type SavedVariation, type SavedPattern, type AudioFileData, type AudioChannel, type PatternType } from '../types';
import type { StateManager } from '../core/StateManager';
import type { IAudioEngine } from '../core/audio/IAudioEngine';
import { arrayBufferToBase64, expandPattern, expandVolumes, expandOffsets, normalizeMidiPath } from '../utils/helpers';

export class FileManager {
  private stateManager: StateManager;
  private audioManager: IAudioEngine;

  constructor(stateManager: StateManager, audioManager: IAudioEngine) {
    this.stateManager = stateManager;
    this.audioManager = audioManager;
  }

  // Helper: só inclui offsets se tiver ao menos uma célula != 0
  // (mantém JSONs enxutos e diffs de git limpos nos ritmos oficiais)
  private hasOffsets(grid?: number[][]): boolean {
    if (!grid) return false;
    for (const row of grid) for (const v of row) if (v && Math.abs(v) > 0.001) return true;
    return false;
  }

  // Serialização ÚNICA de uma variação — usada tanto no export pra ARQUIVO
  // (saveProject) quanto no salvar em Meus Ritmos / repertório
  // (exportProjectAsJSON). Antes eram dois mapeamentos duplicados que
  // DIVERGIRAM: o de arquivo incluía `offsets` (o groove/swing por célula,
  // v1.6) e o de Meus Ritmos NÃO — então ritmo salvo ou posto no repertório
  // perdia o swing e tocava reto. Um serializador só garante que ritmo
  // salvo == ritmo normal, pra sempre.
  private serializeVariation(v: any): SavedVariation {
    return {
      pattern: v.pattern,
      volumes: v.volumes,
      ...(this.hasOffsets(v.offsets) ? { offsets: v.offsets } : {}),
      audioFiles: v.channels.map((ch: any) => ({
        fileName: ch.fileName,
        audioData: '',
        midiPath: ch.midiPath
      })),
      steps: v.steps,
      speed: v.speed
    };
  }

  // Snapshot completo do estado no formato v1.6 (com offsets/groove).
  // Fonte única pro download de arquivo E pro salvar em Meus Ritmos.
  private buildProjectSnapshot(): SavedProject {
    const state = this.stateManager.getState();
    return {
      version: '1.6',
      tempo: state.tempo,
      ...(state.rhythmGain && state.rhythmGain !== 1 ? { gain: state.rhythmGain } : {}),
      beatsPerBar: state.beatsPerBar,
      patternSteps: state.patternSteps,
      variations: {
        main: state.variations.main.map(v => this.serializeVariation(v)),
        fill: state.variations.fill.map(v => this.serializeVariation(v)),
        end: state.variations.end.map(v => this.serializeVariation(v)),
        intro: state.variations.intro.map(v => this.serializeVariation(v))
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
  }

  /**
   * Espera o lote de samples, mas COM TETO.
   *
   * O `Promise.all` cru nunca desperta se uma unica tarefa nao resolver, e
   * quem chama (loadRhythm) so esconde a tela de loading no `finally`. Era
   * assim que o cliente ficava preso na tela do ritmo pra sempre, sem nem
   * conseguir trocar de ritmo: o guard `isLoadingRhythm` tambem continuava
   * ligado e recusava qualquer carga nova.
   *
   * Estourado o teto a gente SEGUE (resolve, nao rejeita). As tarefas que
   * faltam continuam vivas e escrevem o buffer no canal quando chegarem,
   * porque mexem no objeto que ja esta no state. O pior caso vira "o ritmo
   * entra e alguns sons aparecem com atraso", nao "o app congelou". E o
   * AudioManager avisa se algum canal chegar a tocar sem buffer.
   */
  private static readonly LIMITE_LOTE_MS = 15000;

  private async esperarLote(tarefas: Promise<void>[]): Promise<void> {
    if (tarefas.length === 0) return;
    let id: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all(tarefas).then(() => undefined),
        new Promise<void>((resolve) => {
          id = setTimeout(() => {
            console.warn(
              `[GDrums] carga de samples passou de ${FileManager.LIMITE_LOTE_MS}ms; ` +
              'seguindo sem esperar o resto'
            );
            resolve();
          }, FileManager.LIMITE_LOTE_MS);
        }),
      ]);
    } finally {
      if (id !== undefined) clearTimeout(id);
    }
  }

  /**
   * Enfileira a carga dos samples de um conjunto de canais, SEM esperar.
   *
   * Antes cada canal era um `await` em serie. Um ritmo tem ate 8 variacoes
   * x 12 canais (medido: 11.964 canais nos 180 ritmos, ~66 por ritmo), e na
   * primeira carga de uma maquina com cache frio isso levava SEGUNDOS.
   * Nesse intervalo o pattern ja estava no state, o hasRhythmLoaded() do
   * main ja dizia "sim", e todo canal ainda sem buffer virava BURACO
   * audivel no lugar do som (relato de 27/09/2026 num MacBook M1: so prato
   * e chimbal soavam, porque sao os dois pre-aquecidos fora daqui).
   *
   * Agora tudo dispara junto e quem chama espera o conjunto. A deduplicacao
   * em voo do AudioManager garante que o mesmo arquivo pedido por varias
   * variacoes seja baixado e decodificado UMA vez.
   *
   * O catch por canal fica: um sample que falha nao pode derrubar o ritmo
   * inteiro. O que mudou e que o AudioManager agora tenta de novo antes de
   * desistir, e avisa se o canal chegar a tocar sem buffer.
   */
  private enfileirarCanais(
    tarefas: Promise<void>[],
    canais: AudioChannel[],
    audioFiles: AudioFileData[] | undefined,
    rotulo: string
  ): void {
    if (!audioFiles) return;
    for (let i = 0; i < audioFiles.length && i < MAX_CHANNELS; i++) {
      const audioFile = audioFiles[i];
      if (!audioFile || !canais[i]) continue;
      if (!audioFile.fileName && !audioFile.midiPath && !audioFile.audioData) continue;

      const midiPath = normalizeMidiPath(audioFile.midiPath || '');
      canais[i].midiPath = midiPath;
      canais[i].fileName = audioFile.fileName;
      if (!midiPath && !audioFile.audioData) continue;

      tarefas.push((async () => {
        try {
          canais[i].buffer = midiPath
            ? await this.audioManager.loadAudioFromPath(midiPath)
            : await this.audioManager.loadAudioFromBase64(audioFile.audioData);
        } catch (error) {
          console.error(
            `[GDrums] sample nao carregou: ${rotulo} canal ${i} ` +
            `(${audioFile.fileName || midiPath})`, error
          );
        }
      })());
    }
  }

  async saveProject(): Promise<void> {
    const project = this.buildProjectSnapshot();
    const json = JSON.stringify(project, null, 2);
    this.downloadFile(json, 'projeto-ritmo.json', 'application/json');
  }

  async loadProject(data: SavedProject): Promise<void> {
    const state = this.stateManager.getState();
    // Fila unica de cargas de sample deste projeto. Tudo dispara junto e a
    // espera acontece de uma vez, no fim (ver enfileirarCanais).
    const tarefas: Promise<void>[] = [];

    this.stateManager.setTempo(data.tempo || 80);
    this.stateManager.setRhythmGain(data.gain ?? 1);

    // Carregar beatsPerBar (compasso)
    state.beatsPerBar = data.beatsPerBar || 4;

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
            offsets: expandOffsets(variation.offsets, targetSteps),
            channels: state.channels.main.map(() => ({ buffer: null, fileName: '', midiPath: '' })),
            steps: targetSteps,
            speed: variation.speed || 1
          };

          this.enfileirarCanais(
            tarefas, state.variations.main[v].channels, variation.audioFiles, `main[${v}]`
          );
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
            offsets: expandOffsets(variation.offsets, targetSteps),
            channels: state.channels.fill.map(() => ({ buffer: null, fileName: '', midiPath: '' })),
            steps: targetSteps,
            speed: variation.speed || 1
          };

          this.enfileirarCanais(
            tarefas, state.variations.fill[v].channels, variation.audioFiles, `fill[${v}]`
          );
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
            offsets: expandOffsets(variation.offsets, targetSteps),
            channels: state.channels.end.map(() => ({ buffer: null, fileName: '', midiPath: '' })),
            steps: targetSteps,
            speed: variation.speed || 1
          };

          this.enfileirarCanais(
            tarefas, state.variations.end[v].channels, variation.audioFiles, `end[${v}]`
          );
        }
      }

      // Carregar variações de intro (apenas uma variação)
      if (data.variations.intro && data.variations.intro.length > 0) {
        for (let v = 0; v < Math.min(data.variations.intro.length, 1); v++) {
          const variation = data.variations.intro[v];
          if (!variation) continue;

          const targetSteps = variation.steps || state.patternSteps.intro;
          state.variations.intro[v] = {
            pattern: expandPattern(variation.pattern, targetSteps),
            volumes: expandVolumes(variation.volumes, targetSteps),
            offsets: expandOffsets(variation.offsets, targetSteps),
            channels: state.channels.intro.map(() => ({ buffer: null, fileName: '', midiPath: '' })),
            steps: targetSteps,
            speed: variation.speed || 1
          };

          this.enfileirarCanais(
            tarefas, state.variations.intro[v].channels, variation.audioFiles, `intro[${v}]`
          );
        }
      }

      // Carregar sons de início e retorno (prato do fill) — junto com o resto
      if (data.fillStartSound) {
        state.fillStartSound.fileName = data.fillStartSound.fileName;
        state.fillStartSound.midiPath = data.fillStartSound.midiPath;
        const caminho = data.fillStartSound.midiPath;
        if (caminho) {
          tarefas.push((async () => {
            try {
              state.fillStartSound.buffer = await this.audioManager.loadAudioFromPath(caminho);
            } catch (error) {
              console.error('[GDrums] sample nao carregou: som de início do fill', error);
            }
          })());
        }
      }

      if (data.fillReturnSound) {
        state.fillReturnSound.fileName = data.fillReturnSound.fileName;
        state.fillReturnSound.midiPath = data.fillReturnSound.midiPath;
        const caminho = data.fillReturnSound.midiPath;
        if (caminho) {
          tarefas.push((async () => {
            try {
              state.fillReturnSound.buffer = await this.audioManager.loadAudioFromPath(caminho);
            } catch (error) {
              console.error('[GDrums] sample nao carregou: som de retorno do fill', error);
            }
          })());
        }
      }

      // ⚠️ A ESPERA MORA AQUI. Quem chama loadProject tem que receber o
      // ritmo PRONTO pra tocar: e nessa garantia que o main.ts se apoia pra
      // nao soltar o play com canal sem buffer.
      await this.esperarLote(tarefas);
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
          this.enfileirarCanais(
            tarefas, state.channels[patternType], data.audioFiles[patternType], patternType
          );
        }
      }

      // ⚠️ ESPERAR AQUI E OBRIGATORIO, nao e so questao de garantia: logo
      // abaixo as variacoes sao montadas COPIANDO o canal por valor
      // (`state.channels.main.map(ch => ({ ...ch }))`). Copiar antes do
      // buffer chegar congelaria buffer null na copia, pra sempre, e o
      // ritmo legado tocaria mudo mesmo depois de tudo carregado.
      //
      // Aqui o teto do esperarLote TEM preco: se estourar, a copia leva
      // buffer null e esses canais ficam mudos ate recarregar o ritmo. E o
      // mal menor, porque a alternativa e o app travar. Formato legado e
      // raro (projeto salvo antigo), entao o estrago fica contido.
      await this.esperarLote(tarefas);

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
    // Teto tambem aqui: este fetch busca o JSON do ritmo e tambem nao tinha
    // limite nenhum. Se ele pendurar, nem o teto do lote de samples salva,
    // porque a carga nem chega la: o cliente fica na tela de loading com a
    // tela de ritmo vazia atras.
    const abortar = typeof AbortController === 'function' ? new AbortController() : null;
    const corta = setTimeout(() => { try { abortar?.abort(); } catch { /* ok */ } }, 12000);
    let response: Response;
    let text: string;
    try {
      response = await fetch(filePath, abortar ? { signal: abortar.signal } : undefined);
      text = await response.text();
    } finally {
      clearTimeout(corta);
    }
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

  // ─── Export/Import como JSON (para ritmos pessoais) ────────────────

  // Snapshot pra Meus Ritmos / repertório. IDÊNTICO ao saveProject (mesmo
  // v1.6 com offsets/groove) — um ritmo salvo tem que ter TUDO que o ritmo
  // normal tem: pattern, volumes, offsets (swing/groove), steps, speed,
  // áudios, sons de virada. Sem paridade, o ritmo tocava diferente do
  // original ao vir do repertório.
  exportProjectAsJSON(): SavedProject {
    return this.buildProjectSnapshot();
  }

  async loadProjectFromData(data: SavedProject): Promise<void> {
    if (data.patterns || data.variations) {
      await this.loadProject(data);
    } else {
      throw new Error('Formato de dados não reconhecido');
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

    // Carregar áudio (em paralelo, igual ao loadProject)
    if (data.audioFiles && data.audioFiles.length > 0) {
      const tarefas: Promise<void>[] = [];
      this.enfileirarCanais(tarefas, state.channels[patternType], data.audioFiles, patternType);
      await this.esperarLote(tarefas);
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
