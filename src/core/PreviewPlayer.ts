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
// 4 compassos = tempo suficiente pro user "sentir" o ritmo antes de decidir.
// A 120 BPM ≈ 8s. A 80 BPM ≈ 12s. User pode parar a qualquer momento.
const BARS_TO_PREVIEW = 4;

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

    // Duração do step em segundos. Scheduler usa (secondsPerBeat/2)/speed
    // → cada step é sempre metade de um beat (semicolcheia), independente
    // do número de steps da variação. Não dividir por steps/beatsPerBar
    // aqui senão o preview toca 2x mais rápido.
    const secondsPerBeat = 60 / tempo;
    const stepDuration = (secondsPerBeat / 2) / (speed || 1);
    const totalDuration = steps * BARS_TO_PREVIEW * stepDuration;

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

    // Cria gain bus dedicado
    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(this.audioContext.destination);

    const startTime = this.audioContext.currentTime + 0.02;
    gainNode.gain.linearRampToValueAtTime(PREVIEW_GAIN, startTime + CROSSFADE_MS / 1000);

    const sources: AudioBufferSourceNode[] = [];

    // Agenda 2 compassos do pattern
    for (let bar = 0; bar < BARS_TO_PREVIEW; bar++) {
      for (let step = 0; step < steps; step++) {
        for (const { ch, buffer } of activeChannels) {
          if (!buffer) continue;
          if (!pattern[ch][step]) continue;
          const vol = volumes[ch]?.[step] ?? 1;
          if (vol <= 0) continue;

          const time = startTime + (bar * steps + step) * stepDuration;
          const src = this.audioContext.createBufferSource();
          src.buffer = buffer;

          const stepGain = this.audioContext.createGain();
          stepGain.gain.value = Math.min(vol, 1.5);
          src.connect(stepGain).connect(gainNode);
          src.start(time);
          sources.push(src);
        }
      }
    }

    // Auto-stop com fade
    const endTime = startTime + totalDuration;
    const fadeStart = endTime - CROSSFADE_MS / 1000;
    gainNode.gain.setValueAtTime(PREVIEW_GAIN, fadeStart);
    gainNode.gain.linearRampToValueAtTime(0, endTime);

    const stopTimer = window.setTimeout(() => {
      if (this.active?.id === id) {
        this.stopActive(false);
      }
    }, totalDuration * 1000 + 100);

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
