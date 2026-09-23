// Testes da tela de abertura do iPhone (a que destrava o áudio e o pedal).
//
// Rodar: npx tsx test/abertura-ios-test.ts

import {
  escolherVariante, eOferta, destinoDaVariante, botaoDaVariante, textosDaVariante,
  MAX_OFERTAS_DIA, TRIAL_ALERTA_H, RENOVAR_ALERTA_D,
  type EstadoAbertura,
} from '../src/ui/aberturaIos';

let ok = 0, falhou = 0;
const t = (nome: string, fn: () => void) => {
  try { fn(); ok++; console.log('  ✅', nome); }
  catch (e) { falhou++; console.log('  ❌', nome, '\n     ', (e as Error).message); }
};
const eq = <T>(a: T, b: T, msg = '') => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg}\n      esperado: ${JSON.stringify(b)}\n      recebido: ${JSON.stringify(a)}`);
  }
};

const AGORA = new Date('2026-09-23T12:00:00Z').getTime();
const H = 3600e3, D = 24 * H;
const daqui = (ms: number) => new Date(AGORA + ms).toISOString();

const base = (over: Partial<EstadoAbertura> = {}): EstadoAbertura => ({
  status: 'active', venceEm: daqui(90 * D),
  temPedal: true, temRepertorio: true, temOffline: true,
  pagandoAgora: false, ofertasHoje: 0, agora: AGORA,
  ...over,
});

console.log('\n── Dinheiro primeiro ──');

t('teste acabando em 6h: oferece assinar', () => {
  eq(escolherVariante(base({ status: 'trial', venceEm: daqui(6 * H) })), 'trial-acabando');
});

t('teste com 3 dias ainda: nao enche o saco', () => {
  eq(escolherVariante(base({ status: 'trial', venceEm: daqui(3 * D) })), 'padrao');
});

t('no limite do alerta de teste ainda oferece', () => {
  eq(escolherVariante(base({ status: 'trial', venceEm: daqui(TRIAL_ALERTA_H * H) })), 'trial-acabando');
});

t('plano vencendo em 3 dias: oferece renovar', () => {
  eq(escolherVariante(base({ venceEm: daqui(3 * D) })), 'renovar');
});

t('plano vencendo em 30 dias: nao fala de dinheiro', () => {
  eq(escolherVariante(base({ venceEm: daqui(30 * D) })), 'padrao');
});

t('no limite da renovacao ainda oferece', () => {
  eq(escolherVariante(base({ venceEm: daqui(RENOVAR_ALERTA_D * D) })), 'renovar');
});

console.log('\n── Quem acabou de pagar não leva oferta na cara ──');

t('foi pagar agora: nada de oferta', () => {
  eq(escolherVariante(base({ status: 'trial', venceEm: daqui(2 * H), pagandoAgora: true })), 'padrao');
});

t('foi pagar agora e nao tem pedal: ainda ajuda com o pedal', () => {
  // Ajudar a configurar nao e cobranca, entao pode.
  eq(escolherVariante(base({ pagandoAgora: true, temPedal: false })), 'sem-pedal');
});

console.log('\n── Teto diário de oferta ──');

t('ja ofereceu o maximo hoje: para de oferecer', () => {
  eq(escolherVariante(base({ venceEm: daqui(2 * D), ofertasHoje: MAX_OFERTAS_DIA })), 'padrao');
});

t('abaixo do teto ainda oferece', () => {
  eq(escolherVariante(base({ venceEm: daqui(2 * D), ofertasHoje: MAX_OFERTAS_DIA - 1 })), 'renovar');
});

console.log('\n── Ativação: o que segura o cliente ──');

t('nunca configurou pedal: e o diferencial do produto', () => {
  eq(escolherVariante(base({ temPedal: false })), 'sem-pedal');
});

t('tem pedal mas nunca montou repertorio', () => {
  eq(escolherVariante(base({ temRepertorio: false })), 'sem-repertorio');
});

t('tem tudo menos offline: evita falhar no palco sem sinal', () => {
  eq(escolherVariante(base({ temOffline: false })), 'sem-offline');
});

t('pedal vem antes de repertorio e de offline', () => {
  eq(escolherVariante(base({ temPedal: false, temRepertorio: false, temOffline: false })), 'sem-pedal');
});

t('dinheiro vem antes de ativacao', () => {
  eq(escolherVariante(base({ venceEm: daqui(1 * D), temPedal: false })), 'renovar');
});

console.log('\n── Quem não tem acesso não recebe dica de uso ──');

t('vencido nao leva "configure seu pedal" na cara', () => {
  eq(escolherVariante(base({ status: 'expired', venceEm: daqui(-5 * D), temPedal: false })), 'padrao');
});

t('cancelado idem', () => {
  eq(escolherVariante(base({ status: 'canceled', venceEm: null, temPedal: false })), 'padrao');
});

t('sem cache de perfil nenhum: padrao', () => {
  eq(escolherVariante(base({ status: null, venceEm: null, temPedal: false })), 'padrao');
});

t('data ja passada nao conta como acesso', () => {
  eq(escolherVariante(base({ status: 'active', venceEm: daqui(-1 * H), temPedal: false })), 'padrao');
});

console.log('\n── Destino e textos ──');

t('so as variantes de dinheiro levam pra fora da tela', () => {
  eq(destinoDaVariante('trial-acabando'), '/plans');
  eq(destinoDaVariante('renovar'), '/plans?renew=true');
  eq(destinoDaVariante('sem-pedal'), null);
  eq(destinoDaVariante('sem-repertorio'), null);
  eq(destinoDaVariante('sem-offline'), null);
  eq(destinoDaVariante('padrao'), null);
});

t('so as variantes de dinheiro contam no teto', () => {
  eq(eOferta('trial-acabando'), true);
  eq(eOferta('renovar'), true);
  eq(eOferta('sem-pedal'), false);
  eq(eOferta('padrao'), false);
});

t('as variantes de ativacao levam a um botao de verdade', () => {
  // Sem isto o modal seria conversa fiada: dizer "configure seu pedal" e
  // deixar o cliente procurar no menu.
  eq(botaoDaVariante('sem-pedal'), 'pedalMapBtn');
  eq(botaoDaVariante('sem-repertorio'), 'setlistEditBtn');
  eq(botaoDaVariante('sem-offline'), 'menuOfflineBtn');
  eq(botaoDaVariante('trial-acabando'), null, 'esta navega, nao clica');
  eq(botaoDaVariante('padrao'), null);
});

t('toda variante ou navega ou clica em algo, menos a padrao', () => {
  for (const v of ['trial-acabando', 'renovar', 'sem-pedal', 'sem-repertorio', 'sem-offline'] as const) {
    if (!destinoDaVariante(v) && !botaoDaVariante(v)) throw new Error(`${v} nao faz nada`);
  }
  eq(destinoDaVariante('padrao'), null);
  eq(botaoDaVariante('padrao'), null);
});

t('os botoes existem no index.html', () => {
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const v of ['sem-pedal', 'sem-repertorio', 'sem-offline'] as const) {
    const id = botaoDaVariante(v)!;
    if (!html.includes(`id="${id}"`)) throw new Error(`id ${id} nao existe no index.html`);
  }
});

t('o padrao reaproveita as chaves que ja existiam', () => {
  eq(textosDaVariante('padrao'), {
    titulo: 'main.iosStartup.title', corpo: 'main.iosStartup.body', cta: 'main.iosStartup.cta',
  });
});

t('toda variante tem as 3 chaves', () => {
  for (const v of ['trial-acabando', 'renovar', 'sem-pedal', 'sem-repertorio', 'sem-offline'] as const) {
    const x = textosDaVariante(v);
    if (!x.titulo || !x.corpo || !x.cta) throw new Error('faltou chave em ' + v);
  }
});

console.log('\n── As chaves do aparelho têm que bater com as reais ──');

t('a chave do cache de perfil e a mesma do OfflineCache', () => {
  // Errei isto na primeira versao: usei 'gdrums-offline-cache' e a real e
  // 'gdrums-offline-profile'. O modal caia no padrao PRA SEMPRE, sem erro
  // nenhum, sem log, sem sintoma. So um dia alguem notaria que a oferta
  // nunca aparecia.
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const raiz = path.join(__dirname, '..');
  const real = fs.readFileSync(path.join(raiz, 'src/native/OfflineCache.ts'), 'utf8')
    .match(/const PROFILE_KEY = '([^']+)'/)?.[1];
  const usada = fs.readFileSync(path.join(raiz, 'src/main.ts'), 'utf8')
    .match(/PERFIL_CACHE_KEY = '([^']+)'/)?.[1];
  eq(usada, real, 'a tela de abertura le uma chave que ninguem escreve');
});

t('as outras chaves lidas existem mesmo no codigo', () => {
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const raiz = path.join(__dirname, '..');
  const todo = ['src/main.ts', 'src/core/SetlistManager.ts', 'src/auth/paymentSync.ts']
    .map(f => fs.readFileSync(path.join(raiz, f), 'utf8')).join('\n');
  for (const k of ['gdrums-setlists-v2', 'gdrums-offline-ready', 'gdrums-awaiting-payment', 'gdrums_pedal_keys']) {
    // tem que aparecer ALEM da leitura da tela de abertura
    const vezes = todo.split(k).length - 1;
    if (vezes < 2) throw new Error(`${k} so aparece ${vezes}x: ninguem grava essa chave`);
  }
});

console.log('\n── O PEDAL ACIMA DE TUDO ──');

// Estes três testes existem porque o app tem 10 mil pessoas e o pedal
// Bluetooth no iPhone é o diferencial do produto. O iOS só libera o áudio
// se o unlock acontecer SÍNCRONO dentro do gesto do usuário. Qualquer
// await, setTimeout ou promessa antes dele e o iOS recusa: o app abre
// mudo e o pedal não responde.
//
// Se um destes quebrar, NÃO conserte o teste. Conserte o código.

function fonteDoModal(): string {
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const s = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.ts'), 'utf8');
  const i = s.indexOf('const fecharModal');
  if (i < 0) throw new Error('nao achei o fecharModal do modal de abertura');
  return s.slice(i, i + 1400);
}

t('unlockAudio() e a PRIMEIRA linha do fechar, sem nada antes', () => {
  const src = fonteDoModal();
  const corpo = src.slice(src.indexOf('=> {') + 4, src.indexOf('};'));
  const primeira = corpo.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'))[0];
  eq(primeira, 'unlockAudio();', 'perdeu o contexto do gesto = pedal morto no iPhone');
});

t('nada de await nem async no caminho do gesto', () => {
  const src = fonteDoModal();
  const trecho = src.slice(0, src.indexOf("addEventListener('touchstart'"));
  if (/\bawait\b|\basync\b/.test(trecho)) {
    throw new Error('await/async no caminho do gesto quebra o unlock do iOS');
  }
});

t('a logica nova roda DEPOIS do fechar, e dentro de try/catch', () => {
  const src = fonteDoModal();
  const clique = src.slice(src.indexOf("startBtn.addEventListener('click'"));
  const posFechar = clique.indexOf('fecharModal();');
  const posNova = clique.indexOf('cumprirAberturaIos');
  if (posFechar < 0 || posNova < 0) throw new Error('nao achei as duas chamadas no clique');
  if (posNova < posFechar) throw new Error('a logica nova esta ANTES do destrave');
  const linha = clique.slice(clique.lastIndexOf('\n', posNova) + 1, clique.indexOf('\n', posNova));
  if (!linha.includes('try {')) throw new Error('a logica nova precisa estar em try/catch');
});

console.log(`\n${ok} ok, ${falhou} falharam\n`);
process.exit(falhou ? 1 : 0);
