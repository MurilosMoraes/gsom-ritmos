// O que a tela de planos OFERECE, de acordo com a situação do cliente.
//
// Regras amarradas no que o payment-webhook faz com a validade:
//  - mesmo plano, ainda ativo → soma a partir do vencimento atual
//    (renovar cedo é seguro, nenhum dia se perde);
//  - plano acima, ainda ativo → começa hoje, com crédito dos dias restantes;
//  - plano abaixo ou Passe 3 Dias, ainda ativo → começa hoje e SEM crédito:
//    o cliente perderia os dias que tem. Por isso nunca é oferecido.
//
// Quem é o quê:
//  - sem assinatura paga válida → todos os planos (vencido: o último em destaque)
//  - pago ativo → renovar o próprio plano + upgrades; o que vem primeiro
//    depende de quanto falta pra vencer e do que o cliente veio fazer
//  - Passe 3 Dias ativo → planos mensais em diante
//  - iOS com assinatura da Apple → sem "renovar" (a App Store renova sozinha)
//
// Função pura, coberta por test/plan-offer-test.ts.

import { computeUpgradeCredit, isPaidActive, UPGRADE_ORDER, type PlanPrice, type PlansIntent, type ProfileLike } from './plansRouting';

export interface OfferCatalogPlan extends PlanPrice {
  id: string;
  durationDays?: number;
  popular?: boolean;
  hideOnIOS?: boolean;
}

export type OfferItemKind = 'renew' | 'upgrade' | 'new';
export type OfferSectionKey = 'renew' | 'upgrade' | 'choose';
export type OfferState = 'subscribe' | 'expired' | 'active' | 'active-pass' | 'lifetime';

export interface OfferItem {
  planId: string;
  kind: OfferItemKind;
  /** Crédito de upgrade em centavos (0 fora de upgrade ou no iOS). */
  creditCents: number;
  /** Validade que o servidor vai gravar se pagar este (null quando não dá pra prever). */
  newExpiresAt: string | null;
  recommended: boolean;
}

export interface OfferSection {
  key: OfferSectionKey;
  items: OfferItem[];
}

export interface PlanOffer {
  state: OfferState;
  currentPlanId: string | null;
  expiresAt: string | null;
  /** Dias até vencer (arredondado pra cima); negativo = já venceu. */
  daysLeft: number | null;
  /** Primeira seção = a principal. */
  sections: OfferSection[];
  /** Assinatura da App Store: renova sozinha, a tela não oferece renovar. */
  appleManaged: boolean;
}

export interface OfferInput {
  profile: ProfileLike | null;
  intent: PlansIntent;
  /** Catálogo na ordem de exibição (PLANS). */
  catalog: OfferCatalogPlan[];
  ios: boolean;
  /** Já comprou o Passe 3 Dias (compra única por pessoa). */
  passUsed: boolean;
  /** Última compra confirmada foi pela App Store. */
  appleManaged: boolean;
  now: Date;
}

/** Até quantos dias antes do vencimento "renovar" vira a ação principal. */
export const RENEW_WINDOW_DAYS = 15;

/** Planos de cortesia que não vencem, pela convenção do banco: 'vitalicio'
 *  (cliente com acesso pra sempre) e 'admin' (equipe). Não estão no
 *  catálogo, então caíam no caminho do Passe e a tela oferecia TUDO pra
 *  quem já tem tudo. */
export const LIFETIME_PLANS = ['vitalicio', 'admin'];

/** Acesso pago que vai tão longe que é vitalício na prática (as cortesias
 *  ficam com 2099). Cobre também quem foi marcado com um plano do catálogo
 *  e data lá na frente. */
const LIFETIME_YEARS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Mesmo cálculo do payment-webhook (setMonth rodando em UTC). */
export function addPlanDuration(base: Date, plan: Pick<OfferCatalogPlan, 'durationMonths' | 'durationDays'>): Date {
  const d = new Date(base.getTime());
  if (plan.durationDays && plan.durationDays > 0) {
    d.setUTCDate(d.getUTCDate() + plan.durationDays);
  } else {
    d.setUTCMonth(d.getUTCMonth() + (plan.durationMonths || 1));
  }
  return d;
}

/** Tem acesso que não vence: nada a vender pra essa pessoa. */
export function isLifetime(profile: ProfileLike | null, now: Date): boolean {
  if (!isPaidActive(profile, now)) return false;
  if (LIFETIME_PLANS.includes(profile?.subscription_plan || '')) return true;
  const expira = profile?.subscription_expires_at;
  if (!expira) return false;
  return new Date(expira).getTime() > now.getTime() + LIFETIME_YEARS * 365 * DAY_MS;
}

export function buildPlanOffer(input: OfferInput): PlanOffer {
  const { profile, intent, catalog, ios, passUsed, now } = input;
  const byId = new Map(catalog.map(p => [p.id, p]));
  const priceTable: Record<string, PlanPrice> = Object.fromEntries(catalog.map(p => [p.id, p]));

  const visible = catalog.filter(p => !(ios && p.hideOnIOS) && !(p.id === 'passe-3-dias' && passUsed));
  const currentPlanId = profile?.subscription_plan || null;
  const expiresAt = profile?.subscription_expires_at || null;
  const daysLeft = expiresAt ? Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / DAY_MS) : null;
  const base = { currentPlanId, expiresAt, daysLeft, appleManaged: input.appleManaged };

  const newItem = (p: OfferCatalogPlan, recommended: boolean): OfferItem => ({
    planId: p.id, kind: 'new', creditCents: 0,
    newExpiresAt: addPlanDuration(now, p).toISOString(), recommended,
  });
  const pickRecommended = (list: OfferCatalogPlan[], preferred: string | null): string | null => {
    if (preferred && list.some(p => p.id === preferred)) return preferred;
    return list.find(p => p.popular)?.id || list[0]?.id || null;
  };

  // ─── Vitalício: não existe o que vender ──────────────────────────
  if (isLifetime(profile, now)) {
    return { ...base, state: 'lifetime', sections: [] };
  }

  // ─── Sem assinatura paga válida ──────────────────────────────────
  if (!isPaidActive(profile, now)) {
    const lastPaid = currentPlanId && UPGRADE_ORDER.includes(currentPlanId) ? currentPlanId : null;
    const expired = !!lastPaid && profile?.subscription_status !== 'trial';
    const rec = pickRecommended(visible, expired ? lastPaid : intent.plan);
    return {
      ...base,
      state: expired ? 'expired' : 'subscribe',
      sections: [{ key: 'choose', items: visible.map(p => newItem(p, p.id === rec)) }],
    };
  }

  // ─── Pago ativo, mas fora da hierarquia (Passe 3 Dias) ───────────
  const currentIdx = UPGRADE_ORDER.indexOf(currentPlanId!);
  if (currentIdx === -1) {
    const regular = visible.filter(p => UPGRADE_ORDER.includes(p.id));
    const rec = pickRecommended(regular, intent.plan);
    return {
      ...base,
      state: 'active-pass',
      sections: [{ key: 'choose', items: regular.map(p => newItem(p, p.id === rec)) }],
    };
  }

  // ─── Pago ativo na hierarquia: renovar + upgrades ────────────────
  const current = byId.get(currentPlanId!);
  const canRenew = !!current && visible.some(p => p.id === current.id) && !input.appleManaged;
  const renewItems: OfferItem[] = canRenew ? [{
    planId: current!.id, kind: 'renew', creditCents: 0,
    newExpiresAt: addPlanDuration(new Date(expiresAt!), current!).toISOString(),
    recommended: false,
  }] : [];

  const upgradePlans = visible.filter(p => UPGRADE_ORDER.indexOf(p.id) > currentIdx);
  const upgradeItems: OfferItem[] = upgradePlans.map(p => ({
    planId: p.id, kind: 'upgrade',
    // iOS: a Apple cobra o preço da loja, sem crédito nosso.
    creditCents: ios ? 0 : computeUpgradeCredit(profile, p.id, priceTable, now),
    newExpiresAt: addPlanDuration(now, p).toISOString(),
    recommended: false,
  }));

  const renewFirst = renewItems.length > 0 && (
    upgradeItems.length === 0 ||
    (!intent.upgrade && (intent.renew || (daysLeft !== null && daysLeft <= RENEW_WINDOW_DAYS)))
  );

  // Destaque só na seção principal. Upgrade: o próximo degrau (menor salto
  // de preço, maior chance de conversão), ou o ?plan= pedido.
  if (renewFirst) {
    renewItems[0].recommended = true;
  } else if (upgradeItems.length > 0) {
    const rec = intent.plan && upgradePlans.some(p => p.id === intent.plan)
      ? intent.plan
      : upgradePlans[0].id;
    upgradeItems.forEach(i => { i.recommended = i.planId === rec; });
  }

  const renewSection: OfferSection = { key: 'renew', items: renewItems };
  const upgradeSection: OfferSection = { key: 'upgrade', items: upgradeItems };
  const sections = (renewFirst ? [renewSection, upgradeSection] : [upgradeSection, renewSection])
    .filter(s => s.items.length > 0);

  return { ...base, state: 'active', sections };
}
