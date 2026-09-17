// Preço da App Store na tela de planos (iOS).
//
// No iOS quem cobra é a Apple, com preço e moeda do país da conta. A tela
// não pode mostrar o R$ do site nem a economia calculada em cima dele.

/**
 * Economia (%) de um plano de `months` meses frente a pagar o mensal pelo
 * mesmo tempo, com os preços da loja. 0 quando não dá pra calcular ou
 * quando não há economia de verdade.
 */
export function storeSavingsPercent(price: number | undefined, months: number, monthlyPrice: number | undefined): number {
  if (!price || !monthlyPrice || months < 2 || price <= 0 || monthlyPrice <= 0) return 0;
  const pct = Math.floor((1 - price / (monthlyPrice * months)) * 100);
  return pct >= 1 && pct < 100 ? pct : 0;
}
