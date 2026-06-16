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

/** True se rodando no app nativo iOS (Capacitor). Usado pra IAP da Apple. */
export function isIOSNative(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
  } catch {
    return false;
  }
}

/** True se rodando no app nativo Android (Capacitor). */
export function isAndroidNative(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

/**
 * True se o user está num browser Android (NÃO no app Capacitor).
 *
 * Usado pra desviar o fluxo de "Instalar app" do PWA pra Play Store —
 * com app publicado, oferecer PWA fragmenta usuários e os notification
 * channels divergem do app nativo. Play Store > PWA quando ambos existem.
 */
export function isAndroidWeb(): boolean {
  if (isNativeApp()) return false;
  try {
    return /Android/i.test(navigator.userAgent);
  } catch {
    return false;
  }
}

/** URL HTTPS da Play Store (fallback pra desktop e quando market:// falha). */
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.gdrums.app&hl=pt';

/** URL da App Store (iOS). */
export const APP_STORE_URL = 'https://apps.apple.com/br/app/gdrums/id6766099516';

/**
 * Esquema `market://` abre direto o app Play Store nativo no Android,
 * pulando a página web intermediária do Chrome ("Abrir no Play Store?").
 * Em desktop / outras plataformas o esquema falha silencioso, então
 * caímos no URL HTTPS.
 */
const PLAY_STORE_MARKET_URL = 'market://details?id=com.gdrums.app';

/**
 * Abre a Play Store do GDrums.
 *
 * Estratégia:
 * - Android web: tenta `market://` (abre app nativo da Play Store direto).
 *   Se não tiver Play Store instalada (raro), o navegador cai no HTTPS
 *   automaticamente porque setamos location pro market e ele falha
 *   silencioso → setTimeout fallback pro https.
 * - Desktop / outros: HTTPS em nova aba.
 */
export function openPlayStore(): void {
  if (isAndroidWeb()) {
    // location.href com market:// abre o app Play Store sem prompt do Chrome
    window.location.href = PLAY_STORE_MARKET_URL;
    // Fallback: se em 800ms a página ainda estiver visível (= market:// falhou
    // porque user não tem Play Store), abre HTTPS em nova aba.
    setTimeout(() => {
      if (!document.hidden) {
        window.open(PLAY_STORE_URL, '_blank', 'noopener,noreferrer');
      }
    }, 800);
    return;
  }
  openExternal(PLAY_STORE_URL);
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
