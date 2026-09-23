// Deep Links — Universal Links (iOS) / App Links (Android)
//
// Quando o user clica num link `https://gdrums.com.br/...` (ex: link de
// recovery de senha no email), o OS valida o domínio contra:
//   iOS:     /.well-known/apple-app-site-association
//   Android: /.well-known/assetlinks.json
//
// Se válido + path bate com intent-filter / AASA → abre o app direto na
// rota correspondente, em vez de cair no navegador.
//
// O Capacitor entrega a URL via `App.addListener('appUrlOpen', ...)`.
// Aqui interpretamos o pathname/hash e navegamos internamente, porque
// o app já abriu na rota inicial (index.html geralmente).
//
// Casos suportados hoje:
// - https://gdrums.com.br/login#access_token=...&type=recovery
//     → roteia pra /login.html preservando o hash (login.ts processa)
// - https://gdrums.com.br/payment-success?order_nsu=...
//     → roteia pra /payment-success.html preservando query
// - https://gdrums.com.br/plans?coupon=X
//     → iOS: /plans.html preservando query (StoreKit)
//     → Android: gotoPlans() → Chrome em /assinar com a mesma query
//
// Push com URL (NativePushService) passa pela MESMA regra: openAppUrl().

import { App as CapacitorApp } from '@capacitor/app';
import { isNativeApp, isIOSNative, internalNav, gotoPlans, lockInternalNav } from './Platform';
import {
  guardarIntencao, lerIntencao, limparIntencao, contarTentativa, decidir,
  lancamentoJaUsado, marcarLancamentoUsado,
  type Intencao, type KeyValueStore,
} from './deepLinkIntent';

/**
 * Mapeia o pathname externo (que veio no link) pro arquivo .html do
 * Capacitor (que serve arquivos do filesystem, sem rewrites do Vercel).
 *
 * Importante: no Capacitor o webView serve `/index.html`, `/login.html`,
 * etc. direto — não tem o rewriter do vercel.json que aceita `/login`.
 * Por isso o internalNav() (em Platform.ts) já adiciona `.html` no
 * native, mas só pra paths SEM extensão.
 */
const PATH_MAP: Record<string, string> = {
  '/login': '/login.html',
  '/plans': '/plans.html',
  '/payment-success': '/payment-success.html',
  '/admin': '/admin.html',
  '/register': '/register.html',
};

export function routeFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    // Só processa nosso próprio domínio (defesa contra abuso).
    if (u.hostname !== 'gdrums.com.br') return null;

    // Normaliza: tira .html do path se vier
    const path = u.pathname.replace(/\.html$/i, '');

    // /app com código: ?c=CODIGO (baixar da comunidade) ou ?s=CODIGO
    // (link de compartilhar). Vai pro app principal, que lê a query e
    // mostra o preview de importar — ver handleShareImport() no main.ts.
    // A raiz tambem e aceita: links antigos (/?c=) continuam funcionando.
    if (path === '/app' || path === '' || path === '/' || path === '/index') {
      const code = u.searchParams.get('c') || u.searchParams.get('s');
      return code ? '/index.html' + u.search : null;
    }

    const mapped = PATH_MAP[path];
    if (!mapped) return null;

    // Preserva query + hash (recovery hash, coupon, order_nsu, etc.)
    return mapped + u.search + u.hash;
  } catch {
    return null;
  }
}

/**
 * Abre dentro do app uma URL nossa (link universal ou push). Retorna false
 * se a URL não é roteável — o chamador decide o que fazer.
 *
 * Planos no Android NÃO abrem dentro do app: o pagamento de lá é no Chrome
 * (InfinitePay), então vai pelo gotoPlans(), levando a query junto. Sem
 * isso, o link de renovação abria a tela de planos DENTRO do WebView.
 */
const local = (): KeyValueStore | null => {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
};
const sessao = (): KeyValueStore | null => {
  try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch { return null; }
};

/**
 * Chegou uma URL nossa (link universal ou push). Guarda a intenção ANTES de
 * qualquer navegação e tenta atender.
 *
 * Guardar antes é o ponto todo: o destino é outra página, ou seja, outro
 * contexto JS. Se o boot dele redirecionar (deslogado indo pro login), a
 * intenção continua de pé e é atendida quando o caminho liberar.
 */
export function openAppUrl(url: string, origem: Intencao['origem'] = 'link'): boolean {
  const target = routeFromUrl(url);
  if (!target) return false;
  guardarIntencao(local(), target, origem);
  aplicarIntencaoPendente();
  return true;
}

/**
 * Olha a intenção guardada e decide o que fazer nesta página. Chamar no
 * boot de TODA página do app.
 *
 * Devolve true se agiu (navegou ou atendeu).
 */
export function aplicarIntencaoPendente(): boolean {
  const store = local();
  const intencao = lerIntencao(store);
  const aqui = window.location.pathname + window.location.search + window.location.hash;
  const d = decidir(aqui, intencao);

  if (d.acao === 'nada') return false;

  if (d.acao === 'atender') {
    // Já estamos na página certa, com a query certa. O código da própria
    // página lê a URL e faz o resto. Só tiramos a intenção do caminho pra
    // ela não reabrir nada depois.
    limparIntencao(store);
    return true;
  }

  // Vai ter que navegar. Conta a tentativa ANTES, senão a trava
  // anti-pingue-pongue não conta nada.
  contarTentativa(store);

  // Planos no Android saem do app: o pagamento é no Chrome (InfinitePay).
  // Como não voltamos pra cá, a intenção se encerra aqui.
  if (d.destino.startsWith('/plans.html') && isNativeApp() && !isIOSNative()) {
    limparIntencao(store);
    gotoPlans('/plans' + d.destino.slice('/plans.html'.length).replace(/#.*$/, ''));
    return true;
  }

  // Mesma página mudando só o #hash: trocar o href NÃO recarrega, e a
  // página nunca processaria o token. Aí só o reload resolve, e ele
  // sozinho, sem o internalNav junto (os dois brigavam entre si).
  const semHash = (s: string) => s.replace(/#.*$/, '');
  if (semHash(d.destino) === semHash(aqui) && d.destino !== aqui) {
    window.location.hash = d.destino.slice(d.destino.indexOf('#') + 1);
    window.location.reload();
    return true;
  }

  // O que o cliente tocou vence qualquer redirect que o boot desta página
  // ainda dispare (ex: main.ts mandando deslogado pro /login sem destino).
  lockInternalNav();
  internalNav(d.destino, { force: true });
  return true;
}

let listening = false;

/**
 * Liga o roteamento por link nesta página. Chamar no boot de TODA página
 * do app: cada .html é um contexto JS separado, e sem isto o toque do
 * cliente não faz nada.
 *
 * Trata as TRÊS formas de o app receber uma intenção:
 *
 *  1. APP ABERTO (`appUrlOpen`). O plugin dispara de `handleOnNewIntent` e
 *     retém o evento até alguém escutar, então basta registrar.
 *
 *  2. APP FECHADO (`getLaunchUrl`). ⚠️ `onNewIntent` NÃO roda em abertura
 *     fria, então `appUrlOpen` NUNCA dispara nesse caso. A URL existe só
 *     em `bridge.getIntentUri()`. Isto aqui não é otimização: sem esta
 *     chamada, deep link com o app fechado simplesmente não funciona, que
 *     era o estado do app até agora.
 *
 *  3. INTENÇÃO GUARDADA de uma navegação anterior, que é o que faz o
 *     destino ser alcançado mesmo passando por redirect no meio.
 *
 * No web não faz nada (deep link só existe no Capacitor).
 */
export async function initDeepLinks(): Promise<void> {
  if (!isNativeApp()) return;

  if (!listening) {
    listening = true;
    CapacitorApp.addListener('appUrlOpen', (event: { url: string }) => {
      if (!openAppUrl(event.url, 'link')) {
        console.warn('[DeepLink] URL não roteada:', event.url);
      }
    });
  }

  // Abertura fria. A trava por sessão é obrigatória: getLaunchUrl devolve
  // a MESMA URL enquanto a Activity viver, então sem ela o index manda pro
  // login, o login lê de novo, e o app fica preso indo e voltando.
  try {
    const r = await CapacitorApp.getLaunchUrl();
    const url = r?.url;
    if (url && !lancamentoJaUsado(sessao(), url)) {
      marcarLancamentoUsado(sessao(), url);
      if (openAppUrl(url, 'lancamento')) return;
    }
  } catch { /* plugin indisponível: segue pro passo 3 */ }

  aplicarIntencaoPendente();
}
