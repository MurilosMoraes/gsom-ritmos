// Teste das REGRAS DE ROTA DA COMPRA (src/auth/plansRouting.ts).
// "um cara que vai renovar, aparece a tela dos planos e redireciona na HOME"
// Prova que:
//  - assinante pago ativo NUNCA é expulso da tela de planos (renova/upgrade)
//  - o push de renovação (com e sem renew=true, cupom/coupon) abre renovação
//  - o login devolve pra tela de compra (?next=) e barra open redirect
//  - crédito de upgrade e preço final batem com o create-checkout
//
// Roda: npx tsx test/plans-routing-test.ts

import {
  readPlansIntent, resolvePlansMode, isPaidActive, computeUpgradeCredit, computeFinalPrice,
  sanitizeNext, loginPathWithNext, nextForPlatform, hasAppAccess,
  savePendingNext, peekPendingNext, clearPendingNext, canAutoBounce, markAutoBounce,
  PENDING_NEXT_KEY, NEXT_BOUNCE_WINDOW_MS,
  type ProfileLike, type PlanPrice, type KeyValueStore,
} from '../src/auth/plansRouting';

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ FALHOU: ${msg}`); }
}
function eq<T>(got: T, want: T, msg: string): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  assert(ok, ok ? msg : `${msg} (veio ${JSON.stringify(got)}, esperado ${JSON.stringify(want)})`);
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-16T12:00:00Z');
const inDays = (d: number) => new Date(NOW.getTime() + d * DAY).toISOString();

const CATALOG: Record<string, PlanPrice> = {
  'passe-3-dias': { priceCents: 990, durationMonths: 0 },
  mensal: { priceCents: 2900, durationMonths: 1 },
  trimestral: { priceCents: 8100, durationMonths: 3 },
  semestral: { priceCents: 14400, durationMonths: 6 },
  anual: { priceCents: 22800, durationMonths: 12 },
  'rei-dos-palcos': { priceCents: 52200, durationMonths: 36 },
};

const paid = (plan: string, days: number): ProfileLike =>
  ({ subscription_status: 'active', subscription_plan: plan, subscription_expires_at: inDays(days) });

function main(): void {
  console.log('═══ Tela de planos: nunca expulsa quem veio pagar ═══\n');

  const noIntent = readPlansIntent('');
  eq(resolvePlansMode(paid('mensal', 3), noIntent, NOW), 'renew', 'pago ativo SEM flag → renovação (antes: HOME)');
  eq(resolvePlansMode(paid('mensal', 3), readPlansIntent('?renew=true'), NOW), 'renew', 'pago ativo + renew=true → renovação');
  eq(resolvePlansMode(paid('mensal', 20), readPlansIntent('?upgrade=true'), NOW), 'upgrade', 'pago ativo + upgrade=true → upgrade');
  eq(resolvePlansMode(paid('mensal', 20), readPlansIntent('?upgrade=1&renew=1'), NOW), 'upgrade', 'upgrade e renew juntos → upgrade vence');
  eq(resolvePlansMode(paid('passe-3-dias', 1), noIntent, NOW), 'renew', 'Passe 3 Dias ativo → renovação (pode comprar mensal)');
  eq(resolvePlansMode(paid('mensal', -1), readPlansIntent('?renew=true'), NOW), 'subscribe', 'pago VENCIDO (status ainda active) → assinar');
  eq(resolvePlansMode({ subscription_status: 'expired', subscription_plan: 'mensal', subscription_expires_at: inDays(-5) }, noIntent, NOW), 'subscribe', 'expired → assinar');
  eq(resolvePlansMode({ subscription_status: 'trial', subscription_plan: 'trial', subscription_expires_at: inDays(1) }, readPlansIntent('?upgrade=true'), NOW), 'subscribe', 'trial com upgrade=true → assinar');
  eq(resolvePlansMode(null, noIntent, NOW), 'subscribe', 'sem perfil (rede falhou) → assinar, nunca home');
  assert(!isPaidActive({ subscription_status: 'active', subscription_plan: 'free', subscription_expires_at: inDays(30) }, NOW), 'free não é pago');
  assert(!isPaidActive({ subscription_status: 'active', subscription_plan: 'mensal', subscription_expires_at: null }, NOW), 'sem data de validade não é pago ativo');

  console.log('\n═══ Links reais que chegam na tela ═══\n');

  const pushNovo = readPlansIntent(new URL('https://gdrums.com.br/plans?renew=true&coupon=VOLTA50&utm_source=push&utm_campaign=renovacao').search);
  eq([pushNovo.renew, pushNovo.coupon], [true, 'VOLTA50'], 'push de renovação novo: renova + cupom');
  const pushAntigo = readPlansIntent('?cupom=volta50&utm_source=push&utm_campaign=renovacao');
  eq([pushAntigo.renew, pushAntigo.coupon], [true, 'VOLTA50'], 'push de renovação ANTIGO (cupom=, sem renew): renova + cupom');
  eq(readPlansIntent('?coupon=%20trial10%20').coupon, 'TRIAL10', 'cupom com espaço/minúscula normalizado');
  eq(readPlansIntent('?coupon=' + 'X'.repeat(80)).coupon, null, 'cupom absurdo de longo ignorado');
  eq(readPlansIntent('?ref=lucas10').ref, 'lucas10', 'ref de afiliado preservado (RPC normaliza)');
  eq(readPlansIntent('?renew=false').renew, false, 'renew=false não é renovação');
  eq(readPlansIntent('?utm_campaign=fim_de_mes').renew, false, 'outra campanha não vira renovação');

  console.log('\n═══ Login devolve pra compra (?next=) ═══\n');

  eq(sanitizeNext('/plans?renew=true&coupon=X'), '/plans?renew=true&coupon=X', 'next /plans com query');
  eq(sanitizeNext('/plans.html?upgrade=true'), '/plans?upgrade=true', 'next /plans.html (nativo) sem .html');
  eq(sanitizeNext('/assinar?renew=true'), '/assinar?renew=true', 'next /assinar (Chrome do Android)');
  eq(sanitizeNext('/payment-success.html?order_nsu=a_b_1'), '/payment-success?order_nsu=a_b_1', 'next retorno do pagamento');
  eq(sanitizeNext('/plans#x'), '/plans', 'hash descartado');
  for (const bad of ['https://evil.com/plans', '//evil.com/plans', '/\\evil.com', '/admin', '/', 'javascript:alert(1)', '/plans/../admin', '/plansX', '', null]) {
    eq(sanitizeNext(bad as string | null), null, `next bloqueado: ${JSON.stringify(bad)}`);
  }
  eq(loginPathWithNext('/plans.html?renew=true&coupon=VOLTA50'), '/login?next=%2Fplans%3Frenew%3Dtrue%26coupon%3DVOLTA50', 'login leva o destino inteiro');
  eq(loginPathWithNext('/index.html'), '/login', 'página fora da compra → login simples');
  eq(sanitizeNext(new URLSearchParams(loginPathWithNext('/assinar?renew=true').split('?')[1]).get('next')), '/assinar?renew=true', 'ida e volta do next sem perda');
  eq(nextForPlatform('/assinar?renew=true', true), '/plans?renew=true', 'nativo: /assinar vira /plans');
  eq(nextForPlatform('/assinar?renew=true', false), '/assinar?renew=true', 'web: /assinar fica (fora dos App Links)');
  eq(nextForPlatform('/assinarX', true), '/assinarX', 'só troca /assinar exato');

  console.log('\n═══ Crédito de upgrade = create-checkout ═══\n');

  // trimestral com 83 dias restantes: 8100 * 83/90 = 7470
  eq(computeUpgradeCredit(paid('trimestral', 83), 'semestral', CATALOG, NOW), 7470, 'trimestral → semestral, 83 dias: R$ 74,70');
  eq(computeUpgradeCredit(paid('trimestral', 83), 'mensal', CATALOG, NOW), 0, 'downgrade não tem crédito');
  eq(computeUpgradeCredit(paid('trimestral', 83), 'trimestral', CATALOG, NOW), 0, 'mesmo plano (renovação) não tem crédito');
  eq(computeUpgradeCredit(paid('passe-3-dias', 2), 'mensal', CATALOG, NOW), 0, 'Passe 3 Dias não gera crédito (fora da hierarquia)');
  eq(computeUpgradeCredit(paid('mensal', -2), 'anual', CATALOG, NOW), 0, 'plano vencido não gera crédito');
  eq(computeUpgradeCredit({ ...paid('mensal', 10), subscription_status: 'trial' }, 'anual', CATALOG, NOW), 0, 'trial não gera crédito');
  // 0.2 dia restante arredonda pra 1 dia (ceil, igual servidor)
  eq(computeUpgradeCredit(paid('mensal', 0.2), 'anual', CATALOG, NOW), Math.round(2900 / 30), 'fração de dia conta como 1 dia');

  console.log('\n═══ Preço final: crédito ANTES do cupom ═══\n');

  eq(computeFinalPrice(14400, 7470, 50), 3465, 'upgrade + cupom 50%: paga R$ 34,65 (ordem antiga dava R$ 0)');
  eq(computeFinalPrice(2900, 0, 10), 2610, 'mensal com 10%');
  eq(computeFinalPrice(2900, 0, 0), 2900, 'sem nada, preço cheio');
  eq(computeFinalPrice(2900, 99999, 10), 0, 'crédito maior que preço não fica negativo');

  console.log('\n═══ Voltar pro app: só com acesso válido ═══\n');

  assert(hasAppAccess(paid('mensal', 3), NOW), 'pago válido tem acesso (botão aparece)');
  assert(hasAppAccess({ subscription_status: 'trial', subscription_plan: 'trial', subscription_expires_at: inDays(1) }, NOW), 'trial válido tem acesso');
  assert(!hasAppAccess(paid('mensal', -1), NOW), 'vencido sem acesso (botão some, senão loop app ⇄ planos)');
  assert(!hasAppAccess({ subscription_status: 'expired', subscription_plan: 'mensal', subscription_expires_at: inDays(10) }, NOW), 'status expired sem acesso');
  assert(!hasAppAccess(null, NOW), 'sem perfil sem acesso');

  console.log('\n═══ Intenção guardada: jornada do cliente deslogado ═══\n');

  const mem = new Map<string, string>();
  const store: KeyValueStore = {
    getItem: k => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k, v) => { mem.set(k, v); },
    removeItem: k => { mem.delete(k); },
  };
  const T0 = NOW.getTime();
  const MIN = 60 * 1000;

  // 1. Clicou no link deslogado → planos → login?next= (login guarda)
  savePendingNext(store, '/plans?renew=true&coupon=VOLTA50', T0);
  eq(peekPendingNext(store, T0 + MIN), '/plans?renew=true&coupon=VOLTA50', 'login guardou o link clicado');
  // 2. Esqueceu a senha: e-mail abre o login SEM next, 8 min depois
  eq(peekPendingNext(store, T0 + 8 * MIN), '/plans?renew=true&coupon=VOLTA50', 'recovery 8 min depois ainda leva pros planos com cupom');
  // 3. Chegou nos planos logado → consome
  clearPendingNext(store);
  eq(peekPendingNext(store, T0 + 9 * MIN), null, 'depois de chegar nos planos, não sobra nada (uso único)');
  // 4. Próximo login normal → home (nada guardado)
  eq(mem.size, 0, 'storage limpo, sem risco de loop');

  console.log('\n═══ Intenção guardada: limites e adulteração ═══\n');

  savePendingNext(store, '/plans?renew=true', T0);
  eq(peekPendingNext(store, T0 + 16 * MIN), null, 'abandonou e voltou 16 min depois → expirou');
  assert(!mem.has(PENDING_NEXT_KEY), 'expirado é apagado na leitura');

  savePendingNext(store, 'https://evil.com/plans', T0);
  assert(!mem.has(PENDING_NEXT_KEY), 'next externo nem é guardado');

  mem.set(PENDING_NEXT_KEY, JSON.stringify({ next: '//evil.com/plans', savedAt: T0 }));
  eq(peekPendingNext(store, T0), null, 'storage adulterado com open redirect → descartado');
  assert(!mem.has(PENDING_NEXT_KEY), 'adulterado é apagado');

  mem.set(PENDING_NEXT_KEY, JSON.stringify({ next: '/plans', savedAt: T0 + 60 * MIN }));
  eq(peekPendingNext(store, T0), null, 'savedAt no futuro (relógio mexido) → descartado');

  mem.set(PENDING_NEXT_KEY, '{quebrado');
  eq(peekPendingNext(store, T0), null, 'JSON quebrado → descartado sem erro');
  assert(!mem.has(PENDING_NEXT_KEY), 'JSON quebrado é apagado');

  savePendingNext(store, '/plans?renew=true', T0);
  clearPendingNext(store);
  eq(peekPendingNext(store, T0), null, 'Sair / Voltar pro app / logout limpam');

  eq(peekPendingNext(null, T0), null, 'sem storage (modo privado) não quebra');
  savePendingNext(null, '/plans', T0);
  const throwing: KeyValueStore = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
  savePendingNext(throwing, '/plans', T0);
  eq(peekPendingNext(throwing, T0), null, 'storage que explode não derruba a tela');

  console.log('\n═══ Trava anti-loop login ⇄ destino ═══\n');

  const tab = new Map<string, string>();
  const tabKv: KeyValueStore = { getItem: k => tab.get(k) ?? null, setItem: (k, v) => { tab.set(k, v); }, removeItem: k => { tab.delete(k); } };
  assert(canAutoBounce(tabKv, T0), '1º pulo automático pro destino: liberado');
  markAutoBounce(tabKv, T0);
  assert(!canAutoBounce(tabKv, T0 + 5000), 'voltou pro login em 5s: bloqueia (mostra o formulário)');
  assert(canAutoBounce(tabKv, T0 + NEXT_BOUNCE_WINDOW_MS + 1), 'depois de 30s: liberado de novo');
  assert(canAutoBounce(null, T0), 'sem storage: libera (máx. comportamento antigo)');

  console.log(`\n${passed} ok, ${failed} falharam`);
  if (failed > 0) process.exit(1);
}

main();
