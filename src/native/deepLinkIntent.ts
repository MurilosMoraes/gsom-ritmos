// A INTENÇÃO DE ABERTURA DO APP (deep link, push, link de campanha).
//
// ═══════════════════════════════════════════════════════════════════════
// O PROBLEMA QUE ISTO RESOLVE
// ═══════════════════════════════════════════════════════════════════════
// Cliente clica num link de recuperar senha, de renovação, de afiliado, ou
// num push. O app abre e cai na home, como se ninguém tivesse clicado em
// nada. Às vezes funciona, às vezes não, e a diferença é invisível pra ele.
//
// Não era instabilidade. Eram buracos:
//
// 1. ABERTURA FRIA NUNCA FUNCIONOU. O `appUrlOpen` do @capacitor/app só é
//    disparado de `handleOnNewIntent`, e `onNewIntent` NÃO roda quando o
//    app estava fechado. Com o app fechado a URL existe só em
//    `bridge.getIntentUri()`, que se lê com `getLaunchUrl()`. O código
//    nunca chamava. Não é corrida: é ausência.
//
// 2. PÁGINA SURDA. Cada .html é um contexto JS separado, e o listener era
//    registrado só em index, login e plans. Quem estava em register,
//    payment-success, completar-cadastro ou demo não recebia nada.
//
// 3. A INTENÇÃO NÃO SOBREVIVIA. O destino é outra página, ou seja, um
//    contexto novo. Se o boot dele decidisse redirecionar (deslogado indo
//    pro login, por exemplo), o motivo da abertura era perdido no caminho.
//
// ═══════════════════════════════════════════════════════════════════════
// COMO FUNCIONA AGORA
// ═══════════════════════════════════════════════════════════════════════
// A intenção é GRAVADA antes de qualquer navegação e só é apagada quando
// a página de destino realmente a atende. Assim ela atravessa recarga,
// troca de página e redirect de boot.
//
// Regras:
//  - vale por 2 minutos (`TTL_MS`). Link velho não sequestra o app.
//  - uso único: quem atende, apaga.
//  - a URL de lançamento é marcada como consumida por sessão de app
//    (sessionStorage), senão `getLaunchUrl()` devolveria a mesma URL a
//    cada página e o app entraria em loop.
//
// As funções aqui são puras de propósito (recebem o armazenamento),
// pra poderem ser testadas sem navegador. Ver test/deep-link-test.ts.

export interface KeyValueStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const CHAVE_INTENCAO = 'gdrums-deeplink-intent';
const CHAVE_LANCAMENTO = 'gdrums-launch-consumida';

/** Link parado há mais de isso não abre nada: o cliente já está em outra. */
export const TTL_MS = 2 * 60 * 1000;

export interface Intencao {
  /** Caminho interno já resolvido, ex: '/login.html?token_hash=..'. */
  destino: string;
  /** Quando foi capturada (epoch ms). */
  em: number;
  /** De onde veio, só pra log e diagnóstico. */
  origem: 'link' | 'push' | 'lancamento';
  /** Quantas vezes já tentamos chegar lá. Ver MAX_TENTATIVAS. */
  tentativas?: number;
}

/**
 * Quantas navegações a intenção pode causar antes de desistir.
 *
 * Sem isto dá pingue-pongue: o push manda pro /plans, o boot do /plans vê
 * que não tem sessão e manda pro /login, o /login lê a intenção e manda de
 * volta pro /plans, pra sempre. Com o app travado piscando entre as duas
 * telas, que é pior que não redirecionar.
 *
 * 2 é o suficiente pro caminho legítimo mais longo que existe hoje:
 * home → destino, ou login → destino depois de autenticar.
 */
export const MAX_TENTATIVAS = 2;

// ─── Guardar / ler / consumir ──────────────────────────────────────────

export function guardarIntencao(
  store: KeyValueStore | null,
  destino: string,
  origem: Intencao['origem'],
  agora: number = Date.now(),
): void {
  if (!store || !destino) return;
  try {
    store.setItem(CHAVE_INTENCAO, JSON.stringify({ destino, em: agora, origem }));
  } catch { /* storage cheio ou bloqueado: segue sem persistir */ }
}

/** Lê sem apagar. Devolve null se não existe, está podre ou venceu. */
export function lerIntencao(
  store: KeyValueStore | null,
  agora: number = Date.now(),
): Intencao | null {
  if (!store) return null;
  try {
    const cru = store.getItem(CHAVE_INTENCAO);
    if (!cru) return null;
    const i = JSON.parse(cru) as Intencao;
    if (!i || typeof i.destino !== 'string' || typeof i.em !== 'number') return null;
    if (agora - i.em > TTL_MS) { store.removeItem(CHAVE_INTENCAO); return null; }
    if ((i.tentativas ?? 0) >= MAX_TENTATIVAS) { store.removeItem(CHAVE_INTENCAO); return null; }
    return i;
  } catch {
    try { store.removeItem(CHAVE_INTENCAO); } catch { /* ignora */ }
    return null;
  }
}

export function limparIntencao(store: KeyValueStore | null): void {
  if (!store) return;
  try { store.removeItem(CHAVE_INTENCAO); } catch { /* ignora */ }
}

/**
 * Marca mais uma tentativa de chegar no destino. Chamar SEMPRE antes de
 * navegar por causa de uma intenção, senão a trava anti-pingue-pongue não
 * conta nada e não serve pra nada.
 */
export function contarTentativa(store: KeyValueStore | null, agora: number = Date.now()): void {
  const i = lerIntencao(store, agora);
  if (!i || !store) return;
  try {
    store.setItem(CHAVE_INTENCAO, JSON.stringify({ ...i, tentativas: (i.tentativas ?? 0) + 1 }));
  } catch { /* ignora */ }
}

// ─── Decisão: esta página atende a intenção, ou tem que navegar? ───────

export type Decisao =
  | { acao: 'nada' }
  | { acao: 'atender'; destino: string }
  | { acao: 'navegar'; destino: string };

/**
 * O coração da coisa. Dado onde o app está agora e qual intenção está
 * guardada, decide o que fazer.
 *
 * 'atender'  → já estamos na página certa; quem chamou processa e limpa.
 * 'navegar'  → é outra página; vai pra lá, mantendo a intenção guardada
 *              pra ela ser atendida quando chegar.
 *
 * Comparação por caminho + query, ignorando o hash: o Supabase reescreve
 * o hash do link de recuperação com replaceState assim que processa, e
 * sem ignorar isso a página acharia que nunca chegou e ficaria navegando
 * em círculo.
 */
export function decidir(
  atualHref: string,
  intencao: Intencao | null,
): Decisao {
  if (!intencao) return { acao: 'nada' };
  const chave = (s: string) => {
    const semHash = s.replace(/#.*$/, '');
    // /login e /login.html sao a mesma pagina
    return semHash.replace(/\.html(?=$|\?)/i, '');
  };
  return chave(atualHref) === chave(intencao.destino)
    ? { acao: 'atender', destino: intencao.destino }
    : { acao: 'navegar', destino: intencao.destino };
}

// ─── URL de lançamento: só pode ser usada uma vez por sessão de app ────

/**
 * `getLaunchUrl()` devolve a MESMA URL enquanto a Activity viver, inclusive
 * depois de trocar de página. Sem esta trava, index manda pro login, login
 * lê a mesma URL de novo e o app fica preso num ciclo.
 */
export function lancamentoJaUsado(store: KeyValueStore | null, url: string): boolean {
  if (!store) return false;
  try { return store.getItem(CHAVE_LANCAMENTO) === url; } catch { return false; }
}

export function marcarLancamentoUsado(store: KeyValueStore | null, url: string): void {
  if (!store) return;
  try { store.setItem(CHAVE_LANCAMENTO, url); } catch { /* ignora */ }
}
