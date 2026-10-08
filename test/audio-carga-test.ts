// CARGA DE SAMPLE E A CORRIDA CARREGAR x TOCAR
//
// Rodar: npx tsx test/audio-carga-test.ts
//
// O QUE ACONTECIA (relato de 27/09/2026, MacBook M1):
//   "parece não estar tocando todas as wav, entre chimbal e prato parecia
//    que tava dando certo, mas o restante não tocava, ficava uns espaços
//    vazios"
//
// A cadeia do defeito:
//   1. o FileManager punha o PATTERN no state e criava os canais com
//      buffer null, e só DEPOIS carregava os samples, um a um, em série
//      (até 8 variações x 12 canais: medi 11.964 canais nos 180 ritmos);
//   2. hasRhythmLoaded() olha só o pattern, então já dizia "sim" nessa
//      janela, e o play era liberado;
//   3. o AudioManager pulava EM SILÊNCIO todo canal sem buffer.
//   Resultado: buraco no lugar do som. Só soavam prato e chimbal, que são
//   os dois únicos samples pré-aquecidos FORA da carga do ritmo.
//
// Aparecia em máquina nova porque com cache frio a janela vira segundos.
//
// Este arquivo trava as quatro correções. Roda o FileManager e o
// AudioManager DE VERDADE; onde não dá (main.ts depende de DOM), usa
// guarda de fonte.

import './_browser-polyfill';
import { readFileSync } from 'node:fs';

// UA de Mac desktop: fixa o caminho de timing "desktop" do AudioManager.
(globalThis as any).navigator.userAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';
(globalThis as any).navigator.maxTouchPoints = 0;

import { AudioManager } from '../src/core/AudioManager';
import { FileManager } from '../src/io/FileManager';
import { StateManager } from '../src/core/StateManager';
import { MAX_CHANNELS, type AudioChannel, type SavedProject } from '../src/types';
import type { IAudioEngine } from '../src/core/audio/IAudioEngine';

let ok = 0, falhou = 0;
const t = (nome: string, fn: () => void | Promise<void>) => {
  const r = (() => { try { return fn(); } catch (e) { falhou++; console.log('  ❌', nome, '\n     ', (e as Error).message); return null; } })();
  if (r instanceof Promise) {
    return r.then(() => { ok++; console.log('  ✅', nome); })
            .catch((e) => { falhou++; console.log('  ❌', nome, '\n     ', (e as Error).message); });
  }
  if (r === null) return Promise.resolve();
  ok++; console.log('  ✅', nome);
  return Promise.resolve();
};
const eq = <T>(a: T, b: T, msg = '') => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg}\n      esperado: ${JSON.stringify(b)}\n      recebido: ${JSON.stringify(a)}`);
  }
};
const verdade = (v: unknown, msg: string) => { if (!v) throw new Error(msg); };

// ─── AudioContext falso: o suficiente pro AudioManager real subir ──────
const paramFalso = () => ({
  value: 0,
  setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {},
  cancelScheduledValues() {}, cancelAndHoldAtTime() {},
});
const bufferFalso = (dur = 0.5) => ({
  duration: dur, numberOfChannels: 2, sampleRate: 48000, length: Math.round(dur * 48000),
  getChannelData: () => new Float32Array(8),
}) as unknown as AudioBuffer;

function ctxFalso() {
  const no = () => ({ connect() {}, disconnect() {}, start() {}, stop() {} });
  return {
    currentTime: 0, sampleRate: 48000, state: 'running', destination: no(),
    createGain: () => ({ ...no(), gain: paramFalso(), channelCount: 2, channelCountMode: '', channelInterpretation: '' }),
    createDynamicsCompressor: () => ({ ...no(), threshold: paramFalso(), knee: paramFalso(), ratio: paramFalso(), attack: paramFalso(), release: paramFalso(), reduction: 0 }),
    createBiquadFilter: () => ({ ...no(), type: '', frequency: paramFalso(), Q: paramFalso(), gain: paramFalso() }),
    createConvolver: () => ({ ...no(), buffer: null }),
    createBufferSource: () => ({ ...no(), buffer: null, onended: null }),
    createBuffer: (ch: number, len: number, rate: number) => ({
      numberOfChannels: ch, length: len, sampleRate: rate, duration: len / rate,
      getChannelData: () => new Float32Array(len),
    }),
    // Realista: HTML de pagina de erro NAO decodifica como audio. O fetch
    // falso devolve 8 bytes pra erro e 64 pra arquivo bom.
    decodeAudioData: async (ab: ArrayBuffer) => {
      if (ab.byteLength <= 8) throw new Error('Unable to decode audio data');
      return bufferFalso();
    },
    resume() {}, suspend() {},
  } as unknown as AudioContext;
}

// ─── fetch falso controlável ───────────────────────────────────────────
interface Plano { ok?: boolean; status?: number; explode?: number; corpoBom?: boolean; }
let pedidos: string[] = [];
let planos: Record<string, Plano> = {};
const instalarFetch = () => {
  pedidos = [];
  (globalThis as any).fetch = async (url: string) => {
    pedidos.push(url);
    const plano = planos[url] || {};
    if (plano.explode && plano.explode > 0) {
      plano.explode--;
      throw new Error('rede caiu');
    }
    if (plano.ok === false) {
      // corpoBom = status esquisito mas ARQUIVO INTEIRO no corpo (caso Capacitor)
      const bytes = plano.corpoBom ? 64 : 8;
      return { ok: false, status: plano.status ?? 404, arrayBuffer: async () => new ArrayBuffer(bytes) };
    }
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(64) };
  };
};

(async () => {

console.log('\n── AudioManager: carregar sample sem falhar calado ──');
{
  planos = {}; instalarFetch();
  const am = new AudioManager(ctxFalso());

  await t('carrega e guarda no cache (2º pedido não vai na rede)', async () => {
    await am.loadAudioFromPath('/midi/bumbo.wav');
    await am.loadAudioFromPath('/midi/bumbo.wav');
    eq(pedidos.filter(u => u === '/midi/bumbo.wav').length, 1);
    verdade(am.temNoCache('/midi/bumbo.wav'), 'deveria estar no cache');
  });

  await t('query string não cria entrada duplicada no cache', async () => {
    verdade(am.temNoCache('/midi/bumbo.wav?v=9'), 'cache é por path sem query');
  });
}
{
  planos = {}; instalarFetch();
  const am = new AudioManager(ctxFalso());
  await t('CORRIDA: 6 pedidos simultâneos do mesmo sample = 1 download', async () => {
    // Sem isto, paralelizar a carga do ritmo baixaria e decodificaria o
    // MESMO arquivo várias vezes (um ritmo pede o mesmo sample em várias
    // variações: ~66 canais para ~12 arquivos distintos).
    const todos = await Promise.all(Array.from({ length: 6 }, () => am.loadAudioFromPath('/midi/caixa.wav')));
    eq(pedidos.length, 1, 'deveria ter ido na rede uma única vez');
    verdade(todos.every(b => b === todos[0]), 'todos devem receber o MESMO buffer');
  });
}
{
  planos = { '/midi/fantasma.wav': { ok: false, status: 404 } }; instalarFetch();
  const am = new AudioManager(ctxFalso());
  await t('404 REJEITA em vez de entregar HTML pro decodificador', async () => {
    // Antes não havia checagem de response.ok: o HTML da página de erro ia
    // pro decodeAudioData, que rejeitava. 404 e arquivo corrompido davam o
    // mesmo silêncio, impossível de separar em campo.
    let mensagem = '';
    try { await am.loadAudioFromPath('/midi/fantasma.wav'); }
    catch (e) { mensagem = (e as Error).message; }
    verdade(/404/.test(mensagem), `erro deveria citar o status HTTP, veio: ${mensagem}`);
    verdade(!am.temNoCache('/midi/fantasma.wav'), '404 não pode virar cache');
  });
  await t('404 tenta 2 vezes antes de desistir', () => {
    eq(pedidos.filter(u => u === '/midi/fantasma.wav').length, 2);
  });
}
{
  // ⚠️ A REGRESSAO QUE DEIXOU O IPHONE MUDO (28/09/2026).
  // A 1a versao desta correcao fazia `if (!response.ok) throw`. No WebView do
  // Capacitor o sample vem do bundle por um scheme proprio e o status NAO e um
  // 200 confiavel, mesmo com o arquivo inteiro no corpo. Resultado: todos os
  // samples eram rejeitados de uma vez e o app ficava sem som nenhum.
  planos = { '/midi/bundle.wav': { ok: false, status: 0, corpoBom: true } }; instalarFetch();
  const am = new AudioManager(ctxFalso());
  await t('status esquisito mas arquivo inteiro no corpo: TEM que tocar', () => {
    return am.loadAudioFromPath('/midi/bundle.wav').then((b) => {
      verdade(!!b, 'o sample do bundle tem que carregar');
      verdade(am.temNoCache('/midi/bundle.wav'), 'e tem que ficar em cache');
    });
  });
  await t('nao gasta retry a toa quando o arquivo veio certo', () => {
    eq(pedidos.length, 1);
  });
}
{
  planos = { '/midi/instavel.wav': { explode: 1 } }; instalarFetch();
  const am = new AudioManager(ctxFalso());
  await t('soluço de rede não deixa o canal mudo pro resto da sessão', async () => {
    const b = await am.loadAudioFromPath('/midi/instavel.wav');
    verdade(!!b, 'deveria ter carregado na 2ª tentativa');
    eq(pedidos.length, 2);
  });
}
{
  planos = { '/midi/morto.wav': { explode: 99 } }; instalarFetch();
  const am = new AudioManager(ctxFalso());
  await t('falha total não prende o path: pedido posterior tenta de novo', async () => {
    try { await am.loadAudioFromPath('/midi/morto.wav'); } catch {}
    eq(pedidos.length, 2);
    try { await am.loadAudioFromPath('/midi/morto.wav'); } catch {}
    eq(pedidos.length, 4, 'a fila em voo tem que ser limpa no erro');
  });
}

console.log('\n── NADA pode pendurar a carga (cliente preso no loading) ──');
{
  // Relato de 08/10/2026. Nem fetch nem decodeAudioData tem limite proprio:
  // se um deles nunca responde, o Promise.all nunca desperta, o `finally` do
  // loadRhythm nunca roda, a tela de loading nunca some E o isLoadingRhythm
  // fica ligado, recusando ate a troca de ritmo. Trava total.
  planos = {}; instalarFetch();
  const pendurado = new Promise<never>(() => { /* nunca resolve, de proposito */ });
  (globalThis as any).fetch = async () => pendurado;
  const am = new AudioManager(ctxFalso());
  (am as any).LIMITE_SAMPLE_MS = 60;   // o teste nao vai esperar 12s

  await t('fetch que nunca responde REJEITA por tempo, nao pendura', async () => {
    const inicio = Date.now();
    let erro = '';
    try { await am.loadAudioFromPath('/midi/buraco.wav'); }
    catch (e) { erro = (e as Error).message; }
    const gasto = Date.now() - inicio;
    verdade(/tempo esgotado/.test(erro), `devia estourar por tempo, veio: ${erro}`);
    verdade(gasto < 2000, `demorou ${gasto}ms: nao desistiu`);
  });
}
{
  planos = {}; instalarFetch();
  const am = new AudioManager(ctxFalso());
  (am as any).LIMITE_SAMPLE_MS = 60;
  // decode que nunca responde (WebKit engasgado com decode concorrente)
  (am as any).audioContext.decodeAudioData = () => new Promise(() => {});
  await t('decodeAudioData que nunca responde tambem desiste', async () => {
    let erro = '';
    try { await am.loadAudioFromPath('/midi/trava.wav'); }
    catch (e) { erro = (e as Error).message; }
    verdade(/tempo esgotado/.test(erro), `devia estourar por tempo, veio: ${erro}`);
  });
}
{
  // Vagas limitadas: um ritmo pede dezenas de amostras de uma vez e o pool
  // de conexoes do navegador e pequeno.
  let emVoo = 0, pico = 0;
  (globalThis as any).fetch = async () => {
    emVoo++; pico = Math.max(pico, emVoo);
    await new Promise((r) => setTimeout(r, 15));
    emVoo--;
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(64) };
  };
  const am = new AudioManager(ctxFalso());
  await t('nunca passa de 6 cargas simultaneas', async () => {
    await Promise.all(Array.from({ length: 30 }, (_, i) => am.loadAudioFromPath(`/midi/s${i}.wav`)));
    eq(pico <= 6, true, `pico de ${pico} cargas ao mesmo tempo`);
    verdade(pico > 1, 'mas tem que ser paralelo de verdade');
  });
}

console.log('\n── AudioManager: canal sem buffer para de sumir calado ──');
{
  planos = {}; instalarFetch();
  const am = new AudioManager(ctxFalso());
  const canais: AudioChannel[] = Array.from({ length: MAX_CHANNELS },
    () => ({ buffer: null, fileName: '', midiPath: '' }));
  canais[0] = { buffer: null, fileName: 'bumbo.wav', midiPath: '/midi/bumbo.wav' };
  canais[1] = { buffer: null, fileName: 'caixa.wav', midiPath: '/midi/caixa.wav' };
  const pattern = Array.from({ length: MAX_CHANNELS }, () => Array(16).fill(false) as boolean[]);
  pattern[0][0] = true;   // canal 0 TEM nota no step 0 e não tem buffer → buraco
  // canal 1 não tem nota: não é buraco, não deve ser acusado
  const volumes = Array.from({ length: MAX_CHANNELS }, () => Array(16).fill(1) as number[]);

  await t('acusa o canal que tocou sem buffer', () => {
    am.scheduleStepFromSnapshot({
      step: 0, pattern, channels: canais, volumes, masterVolume: 1,
      shouldPlayStartSound: false, shouldPlayReturnSound: false,
      fillStartBuffer: null, fillReturnBuffer: null,
    }, 1.0);
    eq(am.canaisSemBuffer(), ['0:/midi/bumbo.wav']);
  });

  await t('não acusa canal sem nota no step (não houve buraco)', () => {
    verdade(!am.canaisSemBuffer().some(c => c.includes('caixa')), 'caixa não tinha nota');
  });

  await t('não repete o aviso (não inunda o console)', () => {
    for (let i = 0; i < 50; i++) {
      am.scheduleStepFromSnapshot({
        step: 0, pattern, channels: canais, volumes, masterVolume: 1,
        shouldPlayStartSound: false, shouldPlayReturnSound: false,
        fillStartBuffer: null, fillReturnBuffer: null,
      }, 1.0);
    }
    eq(am.canaisSemBuffer().length, 1);
  });
}

console.log('\n── FileManager: carga em paralelo e ritmo PRONTO ao terminar ──');

// Motor falso: conta chamadas e atrasa cada carga, pra medir serial x paralelo
function motorFalso(atrasoMs: number, quebrados: string[] = []) {
  const chamadas: string[] = [];
  const engine = {
    kind: 'web' as const,
    async loadAudioFromPath(path: string) {
      chamadas.push(path);
      await new Promise((r) => setTimeout(r, atrasoMs));
      if (quebrados.includes(path)) throw new Error('sample quebrado');
      return bufferFalso();
    },
    async loadAudioFromFile() { return bufferFalso(); },
    async loadAudioFromBase64() { await new Promise((r) => setTimeout(r, atrasoMs)); return bufferFalso(); },
    temNoCache: () => false,
    playSound() {}, scheduleStepFromSnapshot() {}, resume() {},
    getCurrentTime: () => 0, getState: () => 'running',
    fadeOutAllActive() {}, cancelAllScheduled() {},
    setEqGain() {}, setMonoOutput() {}, setReverbAmount() {}, setReverbFrequency() {},
  } satisfies IAudioEngine;
  return { engine, chamadas };
}

const SAMPLES = ['/midi/bumbo.wav', '/midi/caixa.wav', '/midi/chimbal_fechado.wav',
                 '/midi/prato.mp3', '/midi/ride.wav', '/midi/surdo.wav'];
function variacao(steps = 16, quantos = SAMPLES.length) {
  return {
    pattern: Array.from({ length: MAX_CHANNELS }, () => Array(steps).fill(false) as boolean[]),
    volumes: Array.from({ length: MAX_CHANNELS }, () => Array(steps).fill(1) as number[]),
    audioFiles: SAMPLES.slice(0, quantos).map((p) => ({
      fileName: p.split('/').pop() as string, audioData: '', midiPath: p,
    })),
    steps, speed: 1,
  };
}
function projetoCompleto(): SavedProject {
  return {
    version: '1.6', tempo: 120, beatsPerBar: 4,
    patternSteps: { main: 16, fill: 16, end: 8, intro: 8 },
    variations: {
      main: [variacao(), variacao(), variacao()],
      fill: [variacao(), variacao(), variacao()],
      end: [variacao(8), variacao(8), variacao(8)],
      intro: [variacao(8)],
    },
    fillStartSound: { fileName: 'prato.mp3', midiPath: '/midi/prato.mp3' },
    fillReturnSound: { fileName: 'prato.mp3', midiPath: '/midi/prato.mp3' },
    timestamp: new Date().toISOString(),
  } as unknown as SavedProject;
}

function canaisSemBufferDoState(sm: StateManager): string[] {
  const st = sm.getState();
  const fora: string[] = [];
  (['main', 'fill', 'end', 'intro'] as const).forEach((tipo) => {
    st.variations[tipo].forEach((v: any, vi: number) => {
      v?.channels?.forEach((c: AudioChannel, ci: number) => {
        if (c.midiPath && !c.buffer) fora.push(`${tipo}[${vi}] canal ${ci} → ${c.midiPath}`);
      });
    });
  });
  return fora;
}

{
  const sm = new StateManager();
  const { engine, chamadas } = motorFalso(20);
  const fm = new FileManager(sm, engine);
  const inicio = Date.now();
  await fm.loadProject(projetoCompleto());
  const gasto = Date.now() - inicio;

  await t('ao terminar loadProject NENHUM canal está sem buffer', () => {
    eq(canaisSemBufferDoState(sm), []);
  });

  await t(`carga é PARALELA (${chamadas.length} samples, ${gasto}ms; em série passaria de ${chamadas.length * 20}ms)`, () => {
    // É esta garantia que encurta a janela em que dava buraco.
    verdade(gasto < 400, `demorou ${gasto}ms: parece que voltou a ser em série`);
    verdade(chamadas.length >= 60, `esperava muitos canais, veio ${chamadas.length}`);
  });

  await t('sons de início e retorno do fill também chegam carregados', () => {
    const st = sm.getState();
    verdade(!!st.fillStartSound.buffer, 'fillStartSound sem buffer');
    verdade(!!st.fillReturnSound.buffer, 'fillReturnSound sem buffer');
  });
}
{
  const sm = new StateManager();
  const { engine } = motorFalso(5, ['/midi/ride.wav']);
  const fm = new FileManager(sm, engine);
  await fm.loadProject(projetoCompleto());
  await t('um sample quebrado não derruba os outros canais', () => {
    const fora = canaisSemBufferDoState(sm);
    verdade(fora.length > 0, 'o ride deveria constar como sem buffer');
    verdade(fora.every(l => l.includes('ride.wav')), `só o ride deveria falhar: ${JSON.stringify(fora)}`);
  });
}
{
  // Formato LEGADO: aqui as variações são montadas COPIANDO o canal por
  // valor. Se a espera não acontecer antes dessa cópia, o buffer null fica
  // congelado na cópia pra sempre e o ritmo toca mudo mesmo depois de
  // tudo carregado.
  const sm = new StateManager();
  const { engine } = motorFalso(10);
  const fm = new FileManager(sm, engine);
  const legado = {
    version: '1.3', tempo: 100, beatsPerBar: 4,
    patternSteps: { main: 16, fill: 16, end: 8, intro: 8 },
    patterns: {
      main: Array.from({ length: MAX_CHANNELS }, () => Array(16).fill(false)),
      fill: Array.from({ length: MAX_CHANNELS }, () => Array(16).fill(false)),
    },
    audioFiles: {
      main: SAMPLES.slice(0, 4).map(p => ({ fileName: p.split('/').pop(), audioData: '', midiPath: p })),
      fill: SAMPLES.slice(0, 3).map(p => ({ fileName: p.split('/').pop(), audioData: '', midiPath: p })),
    },
    timestamp: new Date().toISOString(),
  } as unknown as SavedProject;
  await fm.loadProject(legado);

  await t('LEGADO: a variação copiada leva o buffer, não um null congelado', () => {
    const st = sm.getState();
    for (let v = 0; v < 3; v++) {
      for (let i = 0; i < 4; i++) {
        verdade(!!st.variations.main[v].channels[i].buffer,
          `main[${v}] canal ${i} copiou buffer null (espera aconteceu depois da cópia)`);
      }
    }
  });
}

{
  // O teto do lote: uma amostra pendurada nao pode segurar o ritmo inteiro.
  (FileManager as any).LIMITE_LOTE_MS = 120;
  const sm = new StateManager();
  const engine = {
    ...motorFalso(5).engine,
    async loadAudioFromPath(path: string) {
      if (path === '/midi/ride.wav') return new Promise<AudioBuffer>(() => {});  // pendura
      await new Promise((r) => setTimeout(r, 5));
      return bufferFalso();
    },
  } as unknown as IAudioEngine;
  const fm = new FileManager(sm, engine);

  await t('amostra pendurada NAO prende o loadProject (tela nao trava)', async () => {
    const inicio = Date.now();
    await fm.loadProject(projetoCompleto());
    const gasto = Date.now() - inicio;
    verdade(gasto < 3000, `loadProject demorou ${gasto}ms: voltou a pendurar`);
  });

  await t('e o que carregou continua valendo (so o pendurado falta)', () => {
    const fora = canaisSemBufferDoState(sm);
    verdade(fora.length > 0, 'o ride deveria constar como sem buffer');
    verdade(fora.every((l) => l.includes('ride.wav')), `so o ride devia faltar: ${JSON.stringify(fora)}`);
  });
}

console.log('\n── main.ts: a trava do play (guardas de fonte) ──');

const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf-8');
const corpoPlay = (() => {
  const i = mainSrc.indexOf('private play(latencyCompensation');
  const j = mainSrc.indexOf('\n  private ', i + 10);
  if (i < 0 || j < 0) throw new Error('não achei o play() no main.ts');
  return mainSrc.slice(i, j);
})();

await t('play() espera a carga antes de soltar o scheduler', () => {
  verdade(corpoPlay.includes('this.cargaDeRitmo'), 'play() não consulta a carga em andamento');
  verdade(corpoPlay.includes('Promise.race'), 'play() não tem o teto de espera');
  verdade(corpoPlay.includes('if (this.stateManager.isPlaying()) this.scheduler.start(latencyCompensation);'),
    'o start adiado precisa checar isPlaying: pode ter parado na espera');
});

await t('⚠️ REGRA DO iOS: resume() é SÍNCRONO e vem ANTES da espera', () => {
  // Se o resume() cair dentro do then, o áudio do iOS morre e o pedal
  // morre com ele. Está em CLAUDE.md como regra inquebrável.
  const iResume = corpoPlay.indexOf('this.audioManager.resume();');
  const iEspera = corpoPlay.indexOf('Promise.race');
  verdade(iResume >= 0, 'play() perdeu o resume()');
  verdade(iResume < iEspera, 'resume() tem que vir ANTES da espera pela carga');
  const depois = corpoPlay.slice(iEspera);
  verdade(!depois.includes('resume()'), 'resume() NÃO pode estar dentro da espera');
});

await t('entrar cravado no downbeat NÃO é adiado (compensação de latência)', () => {
  // scheduleRhythmEntryAt chama play(comp) pra entrar exato no tempo da
  // voz. Atrasar esse start desalinha o ritmo no palco, pior que o buraco.
  verdade(corpoPlay.includes('latencyCompensation > 0 || !audioPronto'),
    'o caminho de compensação precisa seguir sem espera');
});

await t('⚠️ audio ainda TRAVADO: nao adia, sai dentro do gesto (iPhone mudo)', () => {
  // O primeiro play do iOS e o caminho do destrave. Adiar o scheduler ali
  // tira o start do buffer de dentro do gesto. Enquanto o contexto nao
  // estiver 'running', o play tem que seguir igual ao de sempre.
  verdade(corpoPlay.includes("this.audioManager.getState() === 'running'"),
    'play() precisa checar se o audio ja destravou antes de adiar');
  const iEstado = corpoPlay.indexOf("getState() === 'running'");
  const iEspera = corpoPlay.indexOf('Promise.race');
  verdade(iEstado >= 0 && iEstado < iEspera, 'a checagem tem que vir ANTES da espera');
});

await t('⚠️ a tela de loading tem cinto de seguranca (preso no ritmo)', () => {
  const i = mainSrc.indexOf('private async loadRhythm(');
  const corpo = mainSrc.slice(i, mainSrc.indexOf('\n  // ─── Duplicate from Rhythm', i));
  verdade(corpo.includes('LIMITE_CARGA_RITMO_MS'), 'loadRhythm perdeu o teto da tela');
  verdade(corpo.includes('this.isLoadingRhythm = false;\n      this.cargaDeRitmo = null;'),
    'o cinto tem que soltar o guard, senao nao da nem pra trocar de ritmo');
  verdade(corpo.includes('window.clearTimeout(liberarTela)'), 'o finally tem que cancelar o cinto');
});

await t('pre-aquecimento cede a vez pra carga do ritmo', () => {
  const i = mainSrc.indexOf('private async preAquecerSamples(');
  const corpo = mainSrc.slice(i, mainSrc.indexOf('\n  private ', i + 10));
  verdade(corpo.includes('while (this.isLoadingRhythm)'),
    'o adiantamento nao pode competir por conexao com o ritmo pedido');
});

await t('loadRhythm libera a espera SEMPRE, inclusive quando falha', () => {
  const i = mainSrc.indexOf('private async loadRhythm(');
  const corpo = mainSrc.slice(i, mainSrc.indexOf('\n  // ─── Duplicate from Rhythm', i));
  const fim = corpo.slice(corpo.lastIndexOf('} finally {'));
  verdade(fim.includes('concluirCarga();'), 'finally tem que resolver a espera (senão play trava)');
  verdade(fim.includes('this.cargaDeRitmo = null;'), 'finally tem que limpar a carga');
  verdade(fim.includes('this.isLoadingRhythm = false;'), 'finally perdeu a limpeza da flag');
});

await t('o pré-aquecimento existe e não pode derrubar nada', () => {
  verdade(mainSrc.includes('void this.preAquecerSamples();'), 'pré-aquecimento não é chamado no boot');
  const i = mainSrc.indexOf('private async preAquecerSamples(');
  const corpo = mainSrc.slice(i, mainSrc.indexOf('\n  private ', i + 10));
  verdade(/\}\s*catch\s*\{/.test(corpo), 'pré-aquecimento tem que engolir qualquer erro');
  verdade(corpo.includes('navigator.onLine === false'), 'não deve tentar offline');
});

console.log('\n── o hack do pedal iOS segue intacto ──');

await t('bloco do pedal e suas regras inquebráveis continuam lá', () => {
  verdade(mainSrc.includes('PEDAL BLUETOOTH NO iOS'), 'marcador do bloco do pedal desapareceu');
  verdade(mainSrc.includes('focusPedalInput'), 'focusPedalInput desapareceu');
  verdade(mainSrc.includes('hasModalOpen'), 'guarda de modal do pedal desapareceu');
});

console.log(`\n${ok} ok, ${falhou} falharam\n`);
process.exit(falhou ? 1 : 0);
})();
