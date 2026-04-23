// Preview de ritmo isolado — toca 2 compassos em gain dedicado (-9dB)
// sem interferir no scheduler principal. Segue o padrão Splice/Loopcloud/NI.
//
// Regras:
// - Usa o MESMO AudioContext do AudioManager (iOS limita a 1 por página)
// - GainNode separado routing paralelo (não passa pelo master)
// - Auto-stop após 2 compassos (o tempo do ritmo em BPM decide)
// - Crossfade de 50ms entre previews quando user aperta outro
// - Reaproveita cache de buffers do AudioManager (não re-decodifica)
// - Só toca main variation 0 + canais ativos no step 0..N

import type { AudioManager } from './AudioManager';
import { expandPattern, expandVolumes, normalizeMidiPath } from '../utils/helpers';

interface RhythmData {
  tempo: number;
  beatsPerBar?: number;
  patternSteps?: { main: number };
  variations: {
    main: Array<{
      pattern: boolean[][];
      volumes?: number[][];
      audioFiles: Array<{ midiPath?: string; audioData?: string; fileName?: string }>;
      steps?: number;
      speed?: number;
    }>;
  };
}

interface ActivePreview {
  id: string;
  gainNode: GainNode;
  sources: AudioBufferSourceNode[];
  stopTimer: number;
  onStop?: () => void;
}

const PREVIEW_GAIN = 0.35; // ≈ -9dB
const CROSSFADE_MS = 50;
// Duração MÍNIMA do preview em segundos. Repetimos o ciclo completo da
// variação até atingir pelo menos isso. Se o ciclo for longo (ex: 32 steps
// a speed=2), já passa esse mínimo no 1º ciclo e preview para ao fim dele.
// Se curto (ex: 8 steps a speed=1, ritmo rápido), repete pra dar contexto.
// ≈ 6s é tempo suficiente pra "sentir" o ritmo sem virar loop infinito.
const PREVIEW_MIN_DURATION_S = 6;
// Teto de segurança pra não tocar eternamente se o ciclo por algum motivo
// medir 0s (evita loop travado).
const PREVIEW_MAX_DURATION_S = 14;

export class PreviewPlayer {
  private audioContext: AudioContext;
  private audioManager: AudioManager;
  private active: ActivePreview | null = null;
  // Subscribers pra UI saber quando preview terminou (botão para pulsar)
  private listeners = new Set<(activeId: string | null) => void>();

  constructor(audioContext: AudioContext, audioManager: AudioManager) {
    this.audioContext = audioContext;
    this.audioManager = audioManager;
  }

  onChange(cb: (activeId: string | null) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    const id = this.active?.id || null;
    this.listeners.forEach(cb => {
      try { cb(id); } catch { /* noop */ }
    });
  }

  isActive(id: string): boolean {
    return this.active?.id === id;
  }

  /**
   * Carrega e toca N compassos (BARS_TO_PREVIEW) do main variation 0 de um ritmo.
   *
   * @param id - identificador único (path do ritmo ou id de userRhythm)
   * @param rhythmData - JSON do ritmo (SavedProject format)
   * @param opts.bpmOverride - força um BPM diferente do que vem no rhythmData.
   *   Crítico pra ritmos pessoais, onde `user.bpm` é o customizado mas
   *   `rhythm_data.tempo` ainda tem o tempo do momento do export.
   * @returns Promise que resolve quando tocar ou rejeita em erro
   */
  async play(id: string, rhythmData: RhythmData, opts?: { bpmOverride?: number }): Promise<void> {
    // iOS: resume do AudioContext tem que ser síncrono dentro do gesto do user.
    // Chamador é responsável por isso — mas se está suspended, tenta resume.
    if (this.audioContext.state === 'suspended') {
      try { await this.audioContext.resume(); } catch { /* ok */ }
    }

    // Para preview anterior com crossfade
    if (this.active) {
      this.stopActive(true);
    }

    // Extrai variação main 0
    const variation = rhythmData.variations?.main?.[0];
    if (!variation) throw new Error('Ritmo sem variação main');

    const steps = variation.steps || 16;
    const speed = variation.speed || 1;
    // bpmOverride tem prioridade — user pode ter salvado ritmo com BPM custom
    // e rhythm_data.tempo ficou com valor do export, não do save.
    const tempo = opts?.bpmOverride && opts.bpmOverride > 0
      ? opts.bpmOverride
      : (rhythmData.tempo || 80);

    const pattern = expandPattern(variation.pattern || []);
    const volumes = expandVolumes(variation.volumes || []);
    const audioFiles = variation.audioFiles || [];

    // Duração do step em segundos — mesma fórmula do Scheduler.
    // (secondsPerBeat/2)/speed → step é sempre "semicolcheia" do beat,
    // ajustado pela velocidade da variação.
    const secondsPerBeat = 60 / tempo;
    const stepDuration = (secondsPerBeat / 2) / (speed || 1);
    const cycleDuration = steps * stepDuration;

    // Safety: se ciclo for degenerado, não toca (evita loop travado ou
    // agendamento instantâneo). 50ms é o mínimo razoável pra um ciclo.
    if (!(cycleDuration > 0.05)) {
      throw new Error(`PreviewPlayer: ciclo degenerado (${cycleDuration}s)`);
    }

    // Quantos ciclos tocar — garante duração mínima sem virar loop eterno.
    // Sempre pelo menos 1 ciclo, mesmo que passe do máximo (pra não cortar
    // ritmo no meio e soar estranho).
    let cyclesToPlay = Math.max(1, Math.ceil(PREVIEW_MIN_DURATION_S / cycleDuration));
    if (cyclesToPlay * cycleDuration > PREVIEW_MAX_DURATION_S) {
      // Se mesmo 1 ciclo passa do máximo, deixa tocar (ritmo muito lento).
      // Senão, reduz pra caber no teto.
      if (cycleDuration <= PREVIEW_MAX_DURATION_S) {
        cyclesToPlay = Math.max(1, Math.floor(PREVIEW_MAX_DURATION_S / cycleDuration));
      }
    }
    const totalDuration = cyclesToPlay * cycleDuration;

    // Carrega samples dos canais ativos (os que têm pelo menos 1 step true)
    const activeChannels: Array<{ ch: number; buffer: AudioBuffer | null }> = [];
    for (let ch = 0; ch < pattern.length; ch++) {
      const hasHit = pattern[ch].some(s => s);
      if (!hasHit) continue;
      const audioFile = audioFiles[ch];
      if (!audioFile?.midiPath) { activeChannels.push({ ch, buffer: null }); continue; }
      try {
        const path = normalizeMidiPath(audioFile.midiPath);
        const buffer = await this.audioManager.loadAudioFromPath(path);
        activeChannels.push({ ch, buffer });
      } catch {
        activeChannels.push({ ch, buffer: null });
      }
    }

    // Durante o await acima outro play() pode ter iniciado. Se o estado
    // ativo não for mais este, aborta silenciosamente.
    // (Sem cancellation token aqui — check simples baseado em tempo.)
    // Também protege iOS onde Web Audio pode ter sido suspenso de novo.
    if (this.audioContext.state === 'suspended') {
      try { await this.audioContext.resume(); } catch { /* ok */ }
    }

    // Cria gain bus dedicado
    const gainNode = this.audioContext.createGain();
    // Começa silencioso e sobe em fade-in
    gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
    gainNode.connect(this.audioContext.destination);

    const startTime = this.audioContext.currentTime + 0.04;
    const fadeInEnd = startTime + CROSSFADE_MS / 1000;
    const fadeOutStart = startTime + totalDuration;
    const endTime = fadeOutStart + CROSSFADE_MS / 1000;

    // Envelope do gain bus: 0 → PREVIEW_GAIN → 0. As rampas precisam dos
    // setValueAtTime de ANCORAGEM antes, senão linearRampToValueAtTime
    // interpola desde o último valor conhecido e pode começar em zero
    // demorando até fadeOutStart pra atingir PREVIEW_GAIN — causando o
    // "mudo" intermitente que o user reportou.
    gainNode.gain.linearRampToValueAtTime(PREVIEW_GAIN, fadeInEnd);
    gainNode.gain.setValueAtTime(PREVIEW_GAIN, fadeOutStart);
    gainNode.gain.linearRampToValueAtTime(0, endTime);

    const sources: AudioBufferSourceNode[] = [];

    // Agenda TODOS os ciclos. Cada hit é um BufferSourceNode próprio
    // (Web Audio: source só pode start() uma vez).
    for (let cycle = 0; cycle < cyclesToPlay; cycle++) {
      const cycleStart = startTime + cycle * cycleDuration;
      for (let step = 0; step < steps; step++) {
        const stepTime = cycleStart + step * stepDuration;
        for (const { ch, buffer } of activeChannels) {
          if (!buffer) continue;
          if (!pattern[ch][step]) continue;
          const vol = volumes[ch]?.[step] ?? 1;
          if (vol <= 0) continue;

          const src = this.audioContext.createBufferSource();
          src.buffer = buffer;
          const stepGain = this.audioContext.createGain();
          stepGain.gain.value = Math.min(vol, 1.5);
          src.connect(stepGain).connect(gainNode);
          try { src.start(stepTime); } catch { /* tempo no passado, ignora */ }
          sources.push(src);
        }
      }
    }

    // Auto-stop após endTime (fadeOut + folga)
    const stopTimer = window.setTimeout(() => {
      if (this.active?.id === id) {
        this.stopActive(false);
      }
    }, (endTime - this.audioContext.currentTime) * 1000 + 100);

    this.active = { id, gainNode, sources, stopTimer };
    this.notify();
  }

  /**
   * Para o preview ativo. Se immediate=true, faz crossfade rápido;
   * senão, usa o fade natural do agendamento.
   */
  stop(): void {
    if (this.active) this.stopActive(true);
  }

  private stopActive(immediate: boolean): void {
    if (!this.active) return;
    const { gainNode, sources, stopTimer, onStop } = this.active;
    clearTimeout(stopTimer);

    const now = this.audioContext.currentTime;
    if (immediate) {
      try {
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(0, now + CROSSFADE_MS / 1000);
      } catch { /* ok */ }
    }

    const killAt = now + CROSSFADE_MS / 1000 + 0.02;
    sources.forEach(s => {
      try { s.stop(killAt); } catch { /* já stopped */ }
    });
    setTimeout(() => {
      try { gainNode.disconnect(); } catch { /* ok */ }
    }, (CROSSFADE_MS + 50));

    this.active = null;
    onStop?.();
    this.notify();
  }
}
