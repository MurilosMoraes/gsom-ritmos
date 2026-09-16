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

function routeFromUrl(url: string): string | null {
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
export function openAppUrl(url: string): boolean {
  const target = routeFromUrl(url);
  if (!target) return false;

  if (target.startsWith('/plans.html') && isNativeApp() && !isIOSNative()) {
    gotoPlans('/plans' + target.slice('/plans.html'.length).replace(/#.*$/, ''));
    return true;
  }

  // Link pra página que já está aberta, mudando só o #hash (ex: recovery com
  // o app parado no login): trocar href NÃO recarrega, e a página nunca
  // processaria o token. Força o reload.
  const samePage = target.replace(/#.*$/, '') === window.location.pathname + window.location.search;
  internalNav(target, { force: true });
  if (samePage) window.location.reload();
  // O que o cliente tocou vence qualquer redirect que o boot desta página
  // ainda dispare (ex: main.ts mandando deslogado pro /login sem destino).
  lockInternalNav();
  return true;
}

let listening = false;

/**
 * Registra o listener de deep link no app Capacitor. Chamar na
 * inicialização de CADA página que o cliente pode estar vendo quando toca
 * num link (main, login, plans): cada .html é um contexto JS separado, e
 * sem listener na página atual o toque não faz nada.
 *
 * No web não faz nada (deep links só rolam no Capacitor).
 */
export function initDeepLinks(): void {
  if (!isNativeApp() || listening) return;
  listening = true;

  CapacitorApp.addListener('appUrlOpen', (event: { url: string }) => {
    if (!openAppUrl(event.url)) {
      console.warn('[DeepLink] URL não roteada:', event.url);
    }
  });
}
