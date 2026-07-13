// Teste da COMISSÃO DA APPLE (Small Business Program).
//
// Aprovados em 10/07/2026 → a comissão cai de 30% pra 15% a partir dessa data.
//
// Prova que:
//  - venda ANTES de 10/07 usa 30% (a Apple cobrou 30% de verdade)
//  - venda A PARTIR de 10/07 usa 15%
//  - a virada acontece exatamente na fronteira (09/07 23:59 vs 10/07 00:00)
//  - somatório misto (vendas velhas + novas) fecha certo, sem recalcular
//    retroativamente o histórico
//
// Roda: npx tsx test/apple-commission-test.ts

import {
  appleCutFor, liqTx,
  APPLE_CUT_PADRAO, APPLE_CUT_SMALL_BUSINESS, APPLE_SMALL_BUSINESS_INICIO,
  type AppleSaleLike,
} from '../src/utils/appleCommission';

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ FALHOU: ${msg}`); }
}
const brl = (c: number) => `R$ ${(c / 100).toFixed(2)}`;
const venda = (iso: string, cents: number): AppleSaleLike => ({ created_at: iso, amount_cents: cents });

console.log('═══ Comissão da Apple: 30% antes de 10/07/2026, 15% a partir dela ═══\n');

// ── 1. Vendas ANTES da aprovação: 30% (histórico não pode mentir) ──────
console.log('1. Vendas ANTES da aprovação (Apple cobrou 30% de verdade)');
{
  const v = venda('2026-06-15T12:00:00Z', 2900);
  assert(appleCutFor(v) === APPLE_CUT_PADRAO, 'venda de 15/06 → taxa 30%');
  assert(liqTx(v) === 2030, `líquido de R$29,00 a 30% = ${brl(liqTx(v))} (esperado R$20,30)`);

  const v2 = venda('2026-07-09T12:00:00Z', 2900);
  assert(appleCutFor(v2) === APPLE_CUT_PADRAO, 'venda de 09/07 (véspera) → ainda 30%');
}

// ── 2. A fronteira exata ──────────────────────────────────────────────
console.log('\n2. A virada exata (09/07 23:59:59 vs 10/07 00:00:00)');
{
  const ultimaVelha = venda('2026-07-09T23:59:59Z', 2900);
  const primeiraNova = venda('2026-07-10T00:00:00Z', 2900);
  assert(appleCutFor(ultimaVelha) === APPLE_CUT_PADRAO, '09/07 23:59:59 → 30% (último instante da taxa velha)');
  assert(appleCutFor(primeiraNova) === APPLE_CUT_SMALL_BUSINESS, '10/07 00:00:00 → 15% (primeiro instante da nova)');
  assert(new Date('2026-07-10T00:00:00Z').getTime() === APPLE_SMALL_BUSINESS_INICIO, 'a constante de corte é mesmo 10/07/2026 UTC');
}

// ── 3. Vendas A PARTIR da aprovação: 15% ──────────────────────────────
console.log('\n3. Vendas A PARTIR de 10/07 (Small Business = 15%)');
{
  const v = venda('2026-07-10T12:00:00Z', 2900);
  assert(appleCutFor(v) === APPLE_CUT_SMALL_BUSINESS, 'venda no DIA da aprovação (10/07) → 15%');
  assert(liqTx(v) === 2465, `líquido de R$29,00 a 15% = ${brl(liqTx(v))} (esperado R$24,65)`);

  const v2 = venda('2026-07-25T12:00:00Z', 2900);
  assert(appleCutFor(v2) === APPLE_CUT_SMALL_BUSINESS, 'venda de 25/07 → 15%');

  const anual = venda('2026-08-01T12:00:00Z', 22800); // plano anual R$228
  assert(liqTx(anual) === 19380, `anual R$228,00 a 15% = ${brl(liqTx(anual))} (esperado R$193,80)`);

  // Ganho real da mudança: mesma venda rende mais
  const antes = liqTx(venda('2026-07-05T12:00:00Z', 2900));
  const depois = liqTx(venda('2026-07-15T12:00:00Z', 2900));
  assert(depois > antes, `mesma venda rende mais depois: ${brl(antes)} → ${brl(depois)}`);
  assert(depois - antes === 435, 'ganho de R$4,35 por venda de R$29 (15% do bruto)');
}

// ── 4. Somatório MISTO (o cenário real do painel) ─────────────────────
console.log('\n4. Total misto: histórico antigo (30%) + vendas novas (15%)');
{
  const vendas: AppleSaleLike[] = [
    venda('2026-06-20T10:00:00Z', 2900),  // 30% → 2030
    venda('2026-07-08T10:00:00Z', 8100),  // 30% → 5670
    venda('2026-07-12T10:00:00Z', 2900),  // 15% → 2465
    venda('2026-07-20T10:00:00Z', 22800), // 15% → 19380
  ];
  const bruto = vendas.reduce((s, v) => s + (v.amount_cents || 0), 0);
  const liquido = vendas.reduce((s, v) => s + liqTx(v), 0);

  assert(bruto === 36700, `bruto total = ${brl(bruto)} (esperado R$367,00)`);
  assert(liquido === 2030 + 5670 + 2465 + 19380, `líquido misto = ${brl(liquido)} (esperado R$295,45)`);

  // O erro que este fix evita: aplicar 15% em TUDO inflaria o histórico
  const seFosse15EmTudo = bruto * 0.85;
  assert(liquido < seFosse15EmTudo, `não infla o histórico: ${brl(liquido)} < ${brl(seFosse15EmTudo)} (que seria 15% em tudo)`);

  // E o erro inverso: manter 30% em tudo subestimaria as vendas novas
  const seFosse30EmTudo = bruto * 0.70;
  assert(liquido > seFosse30EmTudo, `não subestima as novas: ${brl(liquido)} > ${brl(seFosse30EmTudo)} (que seria 30% em tudo)`);
}

// ── 5. Robustez ───────────────────────────────────────────────────────
console.log('\n5. Robustez');
{
  assert(liqTx({ created_at: '2026-07-20T00:00:00Z' }) === 0, 'venda sem amount_cents → líquido 0 (não quebra)');
  assert(appleCutFor({ created_at: 'lixo', amount_cents: 100 }) === APPLE_CUT_PADRAO, 'data inválida → taxa conservadora 30% (nunca superestima o caixa)');
}

console.log('\n══════════════════════════════════════════════════');
console.log(`RESULTADO: ${passed} passou, ${failed} falhou, ${passed + failed} total`);
console.log('══════════════════════════════════════════════════');
if (failed > 0) { console.log('\n❌ Cálculo de comissão da Apple ERRADO.'); process.exit(1); }
console.log('\n🎯 Vendas a partir de 10/07 a 15%, histórico anterior intacto a 30%.');
process.exit(0);
