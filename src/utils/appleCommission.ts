// Comissão da App Store (Apple IAP).
//
// Fomos APROVADOS no Small Business Program da Apple em 10/07/2026, e a
// comissão cai de 30% pra 15%. O corte usado aqui é a data da aprovação:
// vendas a partir de 10/07/2026 contam 15%.
//
// A taxa é POR TRANSAÇÃO, decidida pela data dela, e não uma constante
// global: as vendas ANTERIORES à aprovação a Apple cobrou 30% de verdade, e
// recalculá-las a 15% faria o histórico de faturamento MENTIR (mostraria
// dinheiro que nunca entrou na conta).
//
// Se a data de início mudar, muda só APPLE_SMALL_BUSINESS_INICIO abaixo.

/** Venda da Apple (só o que a regra de comissão precisa saber). */
export interface AppleSaleLike {
  created_at: string;
  amount_cents?: number | null;
}

export const APPLE_CUT_PADRAO = 0.30;         // antes de 10/07/2026
export const APPLE_CUT_SMALL_BUSINESS = 0.15; // a partir de 10/07/2026

/** 10/07/2026 00:00 UTC — data da aprovação no Small Business Program.
 *  Date.UTC é 0-based no mês, então 6 = julho. */
export const APPLE_SMALL_BUSINESS_INICIO = Date.UTC(2026, 6, 10);

/** Comissão que a Apple cobrou NESTA venda, decidida pela data dela. */
export function appleCutFor(t: AppleSaleLike): number {
  const quando = new Date(t.created_at).getTime();
  // Data inválida/ausente: assume a taxa antiga (conservador — nunca
  // superestima o que entrou no caixa).
  if (!Number.isFinite(quando)) return APPLE_CUT_PADRAO;
  return quando >= APPLE_SMALL_BUSINESS_INICIO
    ? APPLE_CUT_SMALL_BUSINESS
    : APPLE_CUT_PADRAO;
}

/** Líquido em CENTAVOS desta venda: o que sobra depois da Apple.
 *
 *  Math.round é OBRIGATÓRIO: 2900 * (1 - 0.30) dá 2029.9999999999998 em
 *  ponto flutuante, não 2030. Na tela o toFixed(2) mascara, mas somando
 *  centenas de vendas o erro acumula e o total fica errado. Centavo é
 *  inteiro (mesma convenção do resto do projeto). */
export function liqTx(t: AppleSaleLike): number {
  return Math.round((t.amount_cents || 0) * (1 - appleCutFor(t)));
}
