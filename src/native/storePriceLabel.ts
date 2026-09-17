// iOS: textos de preço fora da tela de planos (aviso de assinatura, demo).
// O valor fixo em R$ só vale pro site; no iOS quem cobra é a Apple, com a
// moeda do país da conta. O IAPService é importado sob demanda pra não
// pesar no carregamento da demo e do app.

import { isIOSNative } from './Platform';

/**
 * No iOS, esconde `box` e só mostra de novo com o preço do plano mensal da
 * App Store escrito em `target`. Se a Apple não responder, fica escondido.
 * Fora do iOS não faz nada (o texto em R$ continua).
 */
export function applyMonthlyStorePrice(
  box: HTMLElement | null,
  target: HTMLElement | null,
  render: (price: string) => string,
): void {
  if (!box || !target || !isIOSNative()) return;
  box.style.display = 'none';
  import('./IAPService')
    .then(m => m.getStorePrices())
    .then(byPlan => {
      const price = byPlan['mensal']?.priceString;
      if (!price) return;
      target.textContent = render(price);
      box.style.display = '';
    })
    .catch(() => {});
}
