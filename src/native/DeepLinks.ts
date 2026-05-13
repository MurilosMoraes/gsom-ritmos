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
//     → roteia pra /plans.html preservando query

import { App as CapacitorApp } from '@capacitor/app';
import { isNativeApp, internalNav } from './Platform';

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
    const mapped = PATH_MAP[path];
    if (!mapped) return null;

    // Preserva query + hash (recovery hash, coupon, order_nsu, etc.)
    return mapped + u.search + u.hash;
  } catch {
    return null;
  }
}

/**
 * Registra o listener de deep link no app Capacitor. Chamar 1x na
 * inicialização (main.ts) ANTES da rota atual ser decidida.
 *
 * No web não faz nada (deep links só rolam no Capacitor).
 */
export function initDeepLinks(): void {
  if (!isNativeApp()) return;

  CapacitorApp.addListener('appUrlOpen', (event: { url: string }) => {
    const target = routeFromUrl(event.url);
    if (!target) {
      console.warn('[DeepLink] URL não roteada:', event.url);
      return;
    }

    // Se o user clicou no link enquanto o app estava aberto na mesma rota,
    // ainda assim navega pra refrescar o estado (ex: hash de recovery).
    // internalNav já faz window.location.href, que dispara recarregamento.
    internalNav(target);
  });
}
