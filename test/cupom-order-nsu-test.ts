// "INVALID PRICE" AO TROCAR DE CUPOM — cliente sem conseguir pagar.
//
// Rodar: npx tsx test/cupom-order-nsu-test.ts
//
// O QUE ACONTECIA (caso real, 24/09/2026):
//   1. cliente aplica AMANHECE (10%) → order_nsu ..._mensal_<ts>_AMANHECE
//   2. troca pra 30ESPECIAL (30%) → a TRANSAÇÃO é atualizada, mas o front
//      reaproveitava o order_nsu antigo, que carrega o cupom no sufixo
//   3. o create-checkout lia AMANHECE do sufixo: 2900 × 0,9 = 2610
//   4. o front mandava 2030 (30%)
//   5. a validação `requestedPrice < finalPrice - 100` recusava
//      → "Invalid price", e o cliente não tinha como pagar
//
// O perverso: quem trocava pra um cupom MELHOR era quem ficava travado.
//
// A leitura do cupom aqui TEM que concordar com a do create-checkout. Se
// uma mudar sem a outra, o bug volta.

import { readFileSync } from 'node:fs';
import { cupomDoOrderNsu, generateOrderNsu } from '../src/auth/PaymentService';

let ok = 0, falhou = 0;
const t = (nome: string, fn: () => void) => {
  try { fn(); ok++; console.log('  ✅', nome); }
  catch (e) { falhou++; console.log('  ❌', nome, '\n     ', (e as Error).message); }
};
const eq = <T>(a: T, b: T, msg = '') => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg}\n      esperado: ${JSON.stringify(b)}\n      recebido: ${JSON.stringify(a)}`);
  }
};

const UID = '6349e8b3-e113-4e58-a6c7-48225ebe5f6f';

console.log('\n── Ler o cupom do order_nsu (igual ao create-checkout) ──');

t('com cupom no fim', () => {
  eq(cupomDoOrderNsu(`${UID}_mensal_1790271273612_AMANHECE`), 'AMANHECE');
});

t('sem cupom', () => {
  eq(cupomDoOrderNsu(`${UID}_mensal_1790271273612`), '');
});

t('cupom que começa com numero (30ESPECIAL) nao e confundido com timestamp', () => {
  eq(cupomDoOrderNsu(`${UID}_mensal_1790271273612_30ESPECIAL`), '30ESPECIAL');
});

t('plano com hifen nao atrapalha', () => {
  eq(cupomDoOrderNsu(`${UID}_passe-3-dias_1790292171367_30ESPECIAL`), '30ESPECIAL');
  eq(cupomDoOrderNsu(`${UID}_rei-dos-palcos_1790292171367`), '');
});

t('lixo nao explode', () => {
  eq(cupomDoOrderNsu(''), '');
  eq(cupomDoOrderNsu('abc'), '');
  eq(cupomDoOrderNsu(undefined as any), '');
});

console.log('\n── A decisão: o pedido pendente ainda serve? ──');

// Mesma regra do plans.ts.
const pendenteServe = (nsuPendente: string | null, cupomAplicado: string | null): boolean =>
  !!nsuPendente && cupomDoOrderNsu(nsuPendente) === (cupomAplicado || '');

t('O CASO REAL: tinha AMANHECE, aplicou 30ESPECIAL -> pedido NOVO', () => {
  eq(pendenteServe(`${UID}_mensal_1790271273612_AMANHECE`, '30ESPECIAL'), false,
     'reaproveitar aqui e o que gerava Invalid price');
});

t('mesmo cupom de antes: reaproveita (nao cria pedido duplicado a toa)', () => {
  eq(pendenteServe(`${UID}_mensal_1790271273612_30ESPECIAL`, '30ESPECIAL'), true);
});

t('sem cupom antes e sem cupom agora: reaproveita', () => {
  eq(pendenteServe(`${UID}_mensal_1790271273612`, null), true);
});

t('nao tinha cupom e agora aplicou: pedido NOVO', () => {
  eq(pendenteServe(`${UID}_mensal_1790271273612`, '30ESPECIAL'), false);
});

t('tinha cupom e REMOVEU: pedido NOVO', () => {
  // Senao o backend continuaria dando desconto que o cliente tirou.
  eq(pendenteServe(`${UID}_mensal_1790271273612_30ESPECIAL`, null), false);
});

t('sem pedido pendente: cria', () => {
  eq(pendenteServe(null, '30ESPECIAL'), false);
});

console.log('\n── O preço bate dos dois lados ──');

// Espelha o create-checkout: crédito primeiro, cupom sobre o que sobrou.
const precoBackend = (base: number, credito: number, pct: number): number => {
  const apos = Math.max(0, base - credito);
  return pct > 0 ? Math.round(apos * (1 - pct / 100)) : apos;
};
const recusa = (mandado: number, calculado: number): boolean => mandado < calculado - 100;

t('mensal com 30ESPECIAL: 2900 -> 2030, aceito', () => {
  eq(precoBackend(2900, 0, 30), 2030);
  eq(recusa(2030, 2030), false);
});

t('o bug: front manda 30% e backend calcula 10% -> RECUSA', () => {
  const backend = precoBackend(2900, 0, 10);   // cupom velho do order_nsu
  eq(backend, 2610);
  eq(recusa(2030, backend), true, 'era exatamente isto que o cliente via');
});

t('com a correcao os dois usam 30% e passa', () => {
  const backend = precoBackend(2900, 0, 30);
  eq(recusa(2030, backend), false);
});

t('cupom pra MENOS nao trava (cliente paga o que o backend calculou)', () => {
  // Trocar 30% por 10%: o front manda 2610, o backend calcula 2610.
  eq(recusa(2610, precoBackend(2900, 0, 30)), false);
});

console.log('\n── O pedido e gravado pelo order_nsu que vai pro checkout ──');

// Guarda de FONTE. A decisao de gravar mora dentro de um metodo da
// PlansPage, que depende de DOM e Supabase, e nao da pra chamar aqui. Mas
// o erro que importa e visivel no codigo: gravar em um order_nsu e mandar
// outro pro checkout. Foi o que aconteceu na primeira versao desta
// correcao — o update caia no pedido velho e o novo ia pro checkout sem
// linha no banco.
const plansSrc = readFileSync(new URL('../src/auth/plans.ts', import.meta.url), 'utf-8');

t('nao grava no order_nsu do pendente velho', () => {
  // So o padrao de ESCRITA e proibido. Ler o cupom do pendente
  // (cupomDoOrderNsu(existingPending.order_nsu)) e exatamente o certo.
  eq(plansSrc.includes(".eq('order_nsu', existingPending.order_nsu)"), false,
     'update tem que cair no orderNsu que vai pro checkout');
});

t('o update usa o orderNsu do checkout', () => {
  eq(plansSrc.includes(".eq('order_nsu', orderNsu)"), true);
});

t('o insert usa o orderNsu do checkout', () => {
  eq(plansSrc.includes('order_nsu: orderNsu,'), true);
});

t('remover o cupom LIMPA o cupom no banco (nao fica desconto fantasma)', () => {
  eq(plansSrc.includes("coupon_code: this.appliedCoupon?.code || null,"), true);
  // O ramo antigo gravava cupom SO quando tinha cupom aplicado.
  eq(plansSrc.includes('} else if (this.appliedCoupon) {'), false);
});

t('o insert mantem original_amount_cents (faturamento e desconto real)', () => {
  eq(plansSrc.includes('original_amount_cents: plan.priceCents,'), true);
});

console.log(`\n${ok} ok, ${falhou} falharam\n`);
process.exit(falhou ? 1 : 0);
