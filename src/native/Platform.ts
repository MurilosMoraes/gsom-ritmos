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
