// Helper de detecção de plataforma + abertura de links externos.
//
// Usado principalmente pra compliance com políticas das lojas:
// - Google Play: produtos digitais devem usar Play Billing. Links pra
//   pagamento externo DEVEM abrir fora do app (browser do sistema),
//   não dentro do WebView.
// - App Store (iOS): Guideline 3.1.1 (mesma ideia).
//
// Ref:
// - https://support.google.com/googleplay/android-developer/answer/10281818
// - https://developer.apple.com/app-store/review/guidelines/#payments

import { Capacitor } from '@capacitor/core';

/** True se rodando dentro do app nativo (iOS/Android via Capacitor). */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Abre uma URL externamente (fora do app).
 * - App nativo: abre no navegador do sistema (Chrome/Safari).
 * - Web: navega na mesma aba (comportamento padrão).
 */
export function openExternal(url: string): void {
  if (isNativeApp()) {
    // _system abre no browser externo (Capacitor encaminha pro OS).
    // _blank também funciona mas às vezes abre in-app.
    window.open(url, '_system');
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/**
 * Navega internamente pra outra página do app (login, plans, register, etc).
 *
 * No web (Vercel) usa URLs limpas via rewrites do vercel.json (`/login` →
 * `/login.html`). No app nativo (Capacitor iOS/Android) NÃO HÁ rewriter —
 * arquivos são servidos do filesystem. Sem `.html`, o navegador volta pra
 * `index.html` e cria LOOP DE REDIRECT (tela "Tudo pronto" piscando).
 *
 * Sempre usa esse helper em vez de `window.location.href = '/login'`.
 *
 * @param path Caminho sem `.html` (ex: '/login', '/plans?renew=true')
 */
export function internalNav(path: string): void {
  if (isNativeApp() && !path.includes('.html')) {
    // Separa querystring/hash pra adicionar .html no lugar certo
    const match = path.match(/^([^?#]*)(.*)$/);
    if (match) {
      const [, base, rest] = match;
      const baseWithHtml = base.endsWith('/') ? base + 'index.html' : base + '.html';
      window.location.href = baseWithHtml + rest;
      return;
    }
  }
  window.location.href = path;
}
