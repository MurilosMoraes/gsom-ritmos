// Teste da TELA DE PLANOS INTELIGENTE (src/auth/planOffer.ts).
// "entrou com mensal ativo que vence em breve → renovar no mensal;
//  entrou com semestral → opções de upgrade"
//
// Roda: npx tsx test/plan-offer-test.ts

import { buildPlanOffer, addPlanDuration, RENEW_WINDOW_DAYS, type OfferCatalogPlan, type PlanOffer } from '../src/auth/planOffer';
import { readPlansIntent, type ProfileLike } from '../src/auth/plansRouting';

let passed = 0, failed = 0;
function eq<T>(got: T, want: T, msg: string): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ FALHOU: ${msg} (veio ${JSON.stringify(got)}, esperado ${JSON.stringify(want)})`); }
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-16T12:00:00Z');
const inDays = (d: number) => new Date(NOW.getTime() + d * DAY).toISOString();

const CATALOG: OfferCatalogPlan[] = [
  { id: 'passe-3-dias', priceCents: 990, durationMonths: 0, durationDays: 3, hideOnIOS: true },
  { id: 'mensal', priceCents: 2900, durationMonths: 1 },
  { id: 'trimestral', priceCents: 8100, durationMonths: 3 },
  { id: 'semestral', priceCents: 14400, durationMonths: 6, popular: true },
  { id: 'anual', priceCents: 22800, durationMonths: 12 },
  { id: 'rei-dos-palcos', priceCents: 52200, durationMonths: 36, hideOnIOS: true },
];

const prof = (status: string, plan: string, days: number): ProfileLike =>
  ({ subscription_status: status, subscription_plan: plan, subscription_expires_at: inDays(days) });

function offer(profile: ProfileLike | null, opts: { search?: string; ios?: boolean; passUsed?: boolean; apple?: boolean } = {}): PlanOffer {
  return buildPlanOffer({
    profile, intent: readPlansIntent(opts.search || ''), catalog: CATALOG,
    ios: !!opts.ios, passUsed: !!opts.passUsed, appleManaged: !!opts.apple, now: NOW,
  });
}
const shape = (o: PlanOffer) => o.sections.map(s => `${s.key}:${s.items.map(i => i.planId + (i.recommended ? '*' : '')).join(',')}`);
const allIds = (o: PlanOffer) => o.sections.flatMap(s => s.items.map(i => i.planId));

function main(): void {
  console.log('═══ Mensal ativo ═══\n');

  const mensal5 = offer(prof('active', 'mensal', 5));
  eq(mensal5.state, 'active', 'estado ativo');
  eq(shape(mensal5), ['renew:mensal*', 'upgrade:trimestral,semestral,anual,rei-dos-palcos'], 'vence em 5 dias → RENOVAR MENSAL primeiro, upgrades embaixo');
  eq(mensal5.sections[0].items[0].newExpiresAt, new Date(addPlanDuration(new Date(inDays(5)), { durationMonths: 1 })).toISOString(), 'renovação soma 1 mês ao vencimento atual');
  eq(allIds(mensal5).includes('passe-3-dias'), false, 'Passe 3 Dias escondido (faria perder os dias)');

  const mensal25 = offer(prof('active', 'mensal', 25));
  eq(shape(mensal25), ['upgrade:trimestral*,semestral,anual,rei-dos-palcos', 'renew:mensal'], 'vence em 25 dias → UPGRADE primeiro (próximo degrau em destaque)');
  eq(shape(offer(prof('active', 'mensal', 25), { search: '?renew=true' })), ['renew:mensal*', 'upgrade:trimestral,semestral,anual,rei-dos-palcos'], 'link de renovação → renovar primeiro mesmo longe do vencimento');
  eq(shape(offer(prof('active', 'mensal', 3), { search: '?upgrade=true' }))[0], 'upgrade:trimestral*,semestral,anual,rei-dos-palcos', 'botão de upgrade → upgrade primeiro mesmo perto de vencer');
  eq(shape(offer(prof('active', 'mensal', 25), { search: '?upgrade=true&plan=anual' }))[0], 'upgrade:trimestral,semestral,anual*,rei-dos-palcos', '?plan=anual destaca o anual');
  eq(offer(prof('active', 'mensal', RENEW_WINDOW_DAYS)).sections[0].key, 'renew', `exatamente ${RENEW_WINDOW_DAYS} dias → renovar primeiro`);
  eq(offer(prof('active', 'mensal', RENEW_WINDOW_DAYS + 1)).sections[0].key, 'upgrade', `${RENEW_WINDOW_DAYS + 1} dias → upgrade primeiro`);

  console.log('\n═══ Semestral / topo / downgrade ═══\n');

  const semestral = offer(prof('active', 'semestral', 120));
  eq(shape(semestral), ['upgrade:anual*,rei-dos-palcos', 'renew:semestral'], 'semestral → opções de UPGRADE (anual, rei), sem planos menores');
  eq(allIds(semestral).some(id => ['mensal', 'trimestral', 'passe-3-dias'].includes(id)), false, 'mensal/trimestral/passe nunca aparecem pra semestral ativo');
  const credit = semestral.sections[0].items[0].creditCents;
  eq(credit, Math.round(14400 * (120 / 180)), 'crédito do anual = R$ 144 × 120/180 dias');

  eq(shape(offer(prof('active', 'rei-dos-palcos', 400))), ['renew:rei-dos-palcos*'], 'Rei dos Palcos (topo) → só renovar');
  eq(shape(offer(prof('active', 'anual', 200), { ios: true })), ['renew:anual*'], 'iOS: anual é o topo → só renovar');

  console.log('\n═══ iOS ═══\n');

  const iosMensal = offer(prof('active', 'mensal', 25), { ios: true });
  eq(shape(iosMensal), ['upgrade:trimestral*,semestral,anual', 'renew:mensal'], 'iOS: sem Rei dos Palcos');
  eq(iosMensal.sections[0].items.every(i => i.creditCents === 0), true, 'iOS: nenhum crédito exibido (Apple cobra preço da loja)');
  const apple = offer(prof('active', 'mensal', 5), { ios: true, apple: true });
  eq(shape(apple), ['upgrade:trimestral*,semestral,anual'], 'assinatura da Apple: sem renovar (App Store renova sozinha)');
  eq(apple.appleManaged, true, 'flag appleManaged pra tela explicar');
  eq(offer(prof('active', 'anual', 5), { ios: true, apple: true }).sections, [], 'Apple no topo: nada a oferecer (tela mostra aviso)');
  eq(shape(offer(prof('active', 'rei-dos-palcos', 400), { ios: true })), [], 'Rei dos Palcos no iOS: sem produto → nada a vender');

  console.log('\n═══ Sem assinatura / vencido / passe ═══\n');

  eq(shape(offer(prof('trial', 'trial', 1))), ['choose:passe-3-dias,mensal,trimestral,semestral*,anual,rei-dos-palcos'], 'trial → todos, Semestral (popular) em destaque');
  eq(offer(prof('trial', 'trial', 1)).state, 'subscribe', 'trial = assinar');
  eq(shape(offer(prof('trial', 'trial', 1), { passUsed: true })), ['choose:mensal,trimestral,semestral*,anual,rei-dos-palcos'], 'passe já usado some');
  const expired = offer(prof('expired', 'mensal', -3));
  eq([expired.state, shape(expired)], ['expired', ['choose:passe-3-dias,mensal*,trimestral,semestral,anual,rei-dos-palcos']], 'mensal vencido → todos, com o MENSAL em destaque (voltar)');
  eq(offer(prof('active', 'anual', -1)).state, 'expired', 'status active mas data passada = vencido');
  eq(shape(offer(prof('expired', 'rei-dos-palcos', -3), { ios: true }))[0], 'choose:mensal,trimestral,semestral*,anual', 'iOS vencido do Rei: sem o Rei, volta pro popular');
  eq(shape(offer(null)), ['choose:passe-3-dias,mensal,trimestral,semestral*,anual,rei-dos-palcos'], 'sem perfil → todos');
  eq(shape(offer(null, { search: '?plan=anual' }))[0], 'choose:passe-3-dias,mensal,trimestral,semestral,anual*,rei-dos-palcos', '?plan=anual destaca pra quem vai assinar');

  const pass = offer(prof('active', 'passe-3-dias', 2));
  eq([pass.state, shape(pass)], ['active-pass', ['choose:mensal,trimestral,semestral*,anual,rei-dos-palcos']], 'Passe ativo → planos mensais em diante, sem o passe');

  console.log('\n═══ Datas ═══\n');

  eq(addPlanDuration(new Date('2026-01-31T12:00:00Z'), { durationMonths: 1 }).toISOString(), '2026-03-03T12:00:00.000Z', '31/jan + 1 mês = igual ao servidor (setMonth)');
  eq(addPlanDuration(new Date('2026-09-16T12:00:00Z'), { durationMonths: 0, durationDays: 3 }).toISOString(), '2026-09-19T12:00:00.000Z', 'passe: +3 dias');
  eq(mensal5.daysLeft, 5, 'dias restantes');

  console.log(`\n${passed} ok, ${failed} falharam`);
  if (failed > 0) process.exit(1);
}

main();
