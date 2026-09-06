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

import type { IAudioEngine } from './audio/IAudioEngine';
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
  /** Estado do loop: as camadas do main, e a partir de quando repor. */
  loop?: {
    timer: number;
    proximoCiclo: number;
    indice: number;              // camada da vez
    camadas: Array<{
      duracaoCiclo: number;
      passos: number;
      duracaoPasso: number;
      pattern: boolean[][];
      volumes: number[][];
      canais: Array<{ ch: number; buffer: AudioBuffer | null }>;
    }>;
  };
}

const PREVIEW_GAIN = 0.35; // ≈ -9dB
const CROSSFADE_MS = 50;
// A prévia toca o ciclo COMPLETO da variação main 1, em loop, até a pessoa
// parar ou sair. Antes ela se auto-parava depois de ~6s: quem estava
// escolhendo ritmo tinha que ficar reapertando pra continuar ouvindo.
//
// Como cada batida é um BufferSource (que só toca uma vez), loop infinito
// não dá pra agendar de uma vez. Então agendamos uma JANELA à frente e um
// temporizador reabastece antes de ela acabar.
const AGENDA_JANELA_S = 2.5;   // quanto de áudio fica agendado à frente
const AGENDA_TICK_MS = 700;    // de quanto em quanto tempo reabastece

export class PreviewPlayer {
  private audioContext: AudioContext;
  private audioManager: IAudioEngine;
  private active: ActivePreview | null = null;
  // Subscribers pra UI saber quando preview terminou (botão para pulsar)
  private listeners = new Set<(activeId: string | null) => void>();

  /** Lê o volume geral (masterVolume, 0-2) no momento do preview. A prévia
   *  toca 20% ABAIXO desse volume (× 0.8), pra acompanhar o principal em vez
   *  de um gain fixo baixo. Opcional: sem ele, cai no fallback fixo. */
  private getMasterVolume?: () => number;

  constructor(audioContext: AudioContext, audioManager: IAudioEngine, getMasterVolume?: () => number) {
    this.audioContext = audioContext;
    this.audioManager = audioManager;
    this.getMasterVolume = getMasterVolume;
  }

  /** Gain do bus da prévia: 20% abaixo do volume geral. Clamp em [0, 1.6]
   *  (masterVolume vai de 0 a 2, então 2×0.8 = 1.6 é o teto). */
  private previewGain(): number {
    const mv = this.getMasterVolume ? this.getMasterVolume() : PREVIEW_GAIN / 0.8;
    return Math.max(0, Math.min(1.6, mv * 0.8));
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

    // So a VARIACAO 1 do main, em loop. Cheguei a fazer a previa revezar as
    // tres camadas achando que o Frevo soava picotado por causa disso — mas
    // a previa e pra dar uma amostra do ritmo, nao tocar o arranjo inteiro.
    const variacoes = (rhythmData.variations?.main || []).slice(0, 1);
    if (!variacoes.length) throw new Error('Ritmo sem variação main');

    // bpmOverride tem prioridade — user pode ter salvado ritmo com BPM custom
    // e rhythm_data.tempo ficou com valor do export, não do save.
    const tempo = opts?.bpmOverride && opts.bpmOverride > 0
      ? opts.bpmOverride
      : (rhythmData.tempo || 80);
    const secondsPerBeat = 60 / tempo;

    const camadas: Array<{
      duracaoCiclo: number; passos: number; duracaoPasso: number;
      pattern: boolean[][]; volumes: number[][];
      canais: Array<{ ch: number; buffer: AudioBuffer | null }>;
    }> = [];

    for (const variation of variacoes) {
      const steps = variation.steps || 16;
      const speed = variation.speed || 1;
      // (secondsPerBeat/2)/speed → step é sempre "semicolcheia" do beat,
      // ajustado pela velocidade da variação. Mesma fórmula do Scheduler.
      const stepDuration = (secondsPerBeat / 2) / (speed || 1);
      const cycleDuration = steps * stepDuration;
      // Ciclo degenerado: pula essa camada em vez de derrubar a previa toda.
      if (!(cycleDuration > 0.05)) continue;

      // Passar `steps` aqui NAO e opcional: o padrao dessas funcoes e 16, e
      // sem o argumento elas CORTAM a linha nesse tamanho. Ritmo de 32 passos
      // (Frevo e mais 23) perdia a segunda metade do compasso e a previa
      // tocava meio compasso e ficava 16 passos em silencio — o "toca e para"
      // que o Staner ouviu. Pega 47 dos 180 ritmos: os de 8, 12, 24 e 32.
      const pattern = expandPattern(variation.pattern || [], steps);
      const volumes = expandVolumes(variation.volumes || [], steps);
      const audioFiles = variation.audioFiles || [];

      const canais: Array<{ ch: number; buffer: AudioBuffer | null }> = [];
      for (let ch = 0; ch < pattern.length; ch++) {
        if (!pattern[ch].some(x => x)) continue;
        const audioFile = audioFiles[ch];
        if (!audioFile?.midiPath) { canais.push({ ch, buffer: null }); continue; }
        try {
          const buffer = await this.audioManager.loadAudioFromPath(normalizeMidiPath(audioFile.midiPath));
          canais.push({ ch, buffer });
        } catch {
          canais.push({ ch, buffer: null });
        }
      }
      camadas.push({ duracaoCiclo: cycleDuration, passos: steps, duracaoPasso: stepDuration, pattern, volumes, canais });
    }

    if (!camadas.length) throw new Error('PreviewPlayer: nenhuma camada tocavel');

    // Durante os await acima o AudioContext pode ter sido suspenso de novo
    // (iOS faz isso ao sair e voltar).
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

    // Envelope do gain bus: 0 → PREVIEW_GAIN → 0. As rampas precisam dos
    // setValueAtTime de ANCORAGEM antes, senão linearRampToValueAtTime
    // interpola desde o último valor conhecido e pode começar em zero
    // demorando até fadeOutStart pra atingir PREVIEW_GAIN — causando o
    // "mudo" intermitente que o user reportou.
    // Sobe e FICA. O fade de saida e agendado no stop, nao aqui — o loop
    // nao tem fim previsto.
    const busGain = this.previewGain(); // 20% abaixo do volume geral
    gainNode.gain.linearRampToValueAtTime(busGain, fadeInEnd);

    const sources: AudioBufferSourceNode[] = [];

    this.active = {
      id, gainNode, sources, stopTimer: 0,
      loop: { timer: 0, proximoCiclo: startTime, indice: 0, camadas },
    };

    // Primeira leva agendada na hora; o resto vem do temporizador.
    this.abastecerLoop();
    this.active.loop!.timer = window.setInterval(() => this.abastecerLoop(), AGENDA_TICK_MS);

    this.notify();
  }

  /**
   * Mantem a fila de audio cheia enquanto a previa estiver tocando.
   *
   * Cada batida e um BufferSource, que so pode tocar UMA vez — entao loop
   * infinito nao da pra agendar de uma so vez. Agenda-se uma janela a
   * frente e este metodo repoe antes de ela secar.
   */
  private abastecerLoop(): void {
    const a = this.active;
    if (!a?.loop) return;
    const L = a.loop;
    const limite = this.audioContext.currentTime + AGENDA_JANELA_S;

    while (L.proximoCiclo < limite) {
      const C = L.camadas[L.indice % L.camadas.length];
      const inicio = L.proximoCiclo;
      for (let step = 0; step < C.passos; step++) {
        const quando = inicio + step * C.duracaoPasso;
        for (const { ch, buffer } of C.canais) {
          if (!buffer) continue;
          if (!C.pattern[ch][step]) continue;
          const vol = C.volumes[ch]?.[step] ?? 1;
          if (vol <= 0) continue;

          const src = this.audioContext.createBufferSource();
          src.buffer = buffer;
          const stepGain = this.audioContext.createGain();
          stepGain.gain.value = Math.min(vol, 1.5);
          src.connect(stepGain).connect(a.gainNode);
          try { src.start(quando); } catch { /* tempo no passado, ignora */ }
          a.sources.push(src);
        }
      }
      L.proximoCiclo += C.duracaoCiclo;
      L.indice++;
    }

    // A lista de sources so cresce; solta as que ja tocaram, senao um preview
    // deixado tocando por minutos vira vazamento de memoria.
    if (a.sources.length > 400) {
      const agora = this.audioContext.currentTime;
      a.sources = a.sources.filter(src => {
        const fim = (src as any).__fimEm as number | undefined;
        return fim === undefined || fim > agora;
      }).slice(-400);
    }
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
    const { gainNode, sources, stopTimer, onStop, loop } = this.active;
    clearTimeout(stopTimer);
    // Desliga o reabastecimento ANTES de tudo: sem isto o temporizador
    // continua agendando batidas de um preview que ja parou.
    if (loop?.timer) clearInterval(loop.timer);

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
