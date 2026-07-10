// PaymentService — InfinitePay checkout via API

import { t } from '../i18n';

const SUPABASE_URL = 'https://qsfziivubwdgtmwyztfw.supabase.co';
const INFINITEPAY_HANDLE = 'checkout-gdrums';
// Migrado em 2026-06-02: URL antiga (api.infinitepay.io/invoices/public/
// checkout) foi desativada em 01/06. Payload e webhooks continuam iguais.
const INFINITEPAY_API = 'https://api.checkout.infinitepay.io';

export interface Plan {
  id: string;
  name: string;
  displayName: string;
  priceCents: number;
  priceDisplay: string;
  pricePerMonth: string;
  durationMonths: number;
  /** Duração em DIAS — só pra planos curtos (ex: Modo Show 3 Dias). Quando
   *  presente, manda em durationMonths no cálculo de expiração. */
  durationDays?: number;
  savings?: string;
  popular?: boolean;
  /** Tagline curta exibida no card (posicionamento do plano). */
  tagline?: string;
  /** Esconder do iOS (sem produto IAP correspondente — evita rejeição Apple). */
  hideOnIOS?: boolean;
}

export const PLANS: Plan[] = [
  {
    id: 'passe-3-dias',
    name: t('plans.name.passe3dias'),
    displayName: t('plans.displayName.passe3dias'),
    priceCents: 990,
    priceDisplay: 'R$ 9,90',
    pricePerMonth: '9,90',
    durationMonths: 0,
    durationDays: 3,
    tagline: t('plans.tagline.passe3dias'),
    hideOnIOS: true,
  },
  {
    id: 'mensal',
    name: t('plans.name.mensal'),
    displayName: t('plans.displayName.mensal'),
    priceCents: 2900,
    priceDisplay: 'R$ 29',
    pricePerMonth: '29',
    durationMonths: 1,
  },
  {
    id: 'trimestral',
    name: t('plans.name.trimestral'),
    displayName: t('plans.displayName.trimestral'),
    priceCents: 8100,
    priceDisplay: 'R$ 81',
    pricePerMonth: '27',
    durationMonths: 3,
    savings: t('plans.savings.trimestral'),
  },
  {
    id: 'semestral',
    name: t('plans.name.semestral'),
    displayName: t('plans.displayName.semestral'),
    priceCents: 14400,
    priceDisplay: 'R$ 144',
    pricePerMonth: '24',
    durationMonths: 6,
    savings: t('plans.savings.semestral'),
    popular: true,
  },
  {
    id: 'anual',
    name: t('plans.name.anual'),
    displayName: t('plans.displayName.anual'),
    priceCents: 22800,
    priceDisplay: 'R$ 228',
    pricePerMonth: '19',
    durationMonths: 12,
    savings: t('plans.savings.anual'),
  },
  {
    id: 'rei-dos-palcos',
    name: t('plans.name.reidospalcos'),
    displayName: t('plans.displayName.reidospalcos'),
    priceCents: 52200,
    priceDisplay: 'R$ 522',
    pricePerMonth: '14,50',
    durationMonths: 36,
    savings: t('plans.savings.reidospalcos'),
    hideOnIOS: true,
  },
];

export function getPlan(id: string): Plan | undefined {
  return PLANS.find(p => p.id === id);
}

export function generateOrderNsu(userId: string, planId: string): string {
  return `${userId}_${planId}_${Date.now()}`;
}

export function parseOrderNsu(orderNsu: string): { userId: string; planId: string } | null {
  const parts = orderNsu.split('_');
  if (parts.length < 3) return null;
  const planId = parts[parts.length - 2];
  const userId = parts.slice(0, parts.length - 2).join('_');
  return { userId, planId };
}

// ─── Gerar link de checkout via API ───────────────────────────────────

export interface CheckoutLinkResponse {
  success: boolean;
  url?: string;
  error?: string;
}

export interface CheckoutResult {
  success: boolean;
  url?: string;
  error?: string;
}

export async function createCheckoutLink(
  plan: Plan,
  orderNsu: string,
  redirectUrl: string,
  customer?: { name?: string; email?: string }
): Promise<CheckoutResult> {
  try {
    const ANON_KEY = 'sb_publishable_qjW2fGXMHtQvqVKgyyiiUg_HczRwmXy';

    const response = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ANON_KEY}`,
        'apikey': ANON_KEY,
      },
      body: JSON.stringify({
        items: [{ quantity: 1, price: plan.priceCents, description: plan.name }],
        order_nsu: orderNsu,
        redirect_url: redirectUrl,
        customer,
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.url) {
      return { success: false, error: data.error || t('plans.checkout.createError') };
    }

    return { success: true, url: data.url };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// ─── Verificar pagamento ──────────────────────────────────────────────

export interface PaymentCheckResult {
  success: boolean;
  paid: boolean;
  amount?: number;
  paid_amount?: number;
  capture_method?: string;
}

export async function verifyPayment(
  orderNsu: string,
  transactionNsu: string,
  slug: string
): Promise<PaymentCheckResult> {
  try {
    const response = await fetch(`${INFINITEPAY_API}/payment_check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: INFINITEPAY_HANDLE,
        order_nsu: orderNsu,
        transaction_nsu: transactionNsu,
        slug,
      }),
    });

    if (!response.ok) return { success: false, paid: false };

    const data = await response.json();
    return {
      success: true,
      paid: !!data.paid,
      amount: data.amount,
      paid_amount: data.paid_amount,
      capture_method: data.capture_method,
    };
  } catch {
    return { success: false, paid: false };
  }
}

// ─── Trial ────────────────────────────────────────────────────────────

export const TRIAL_HOURS = 48;

export function calculateTrialExpiry(): string {
  const now = new Date();
  now.setHours(now.getHours() + TRIAL_HOURS);
  return now.toISOString();
}

export function calculatePlanExpiry(durationMonths: number): string {
  const now = new Date();
  now.setMonth(now.getMonth() + durationMonths);
  return now.toISOString();
}

/** Expiração a partir de um Plan, respeitando durationDays (planos curtos)
 *  OU durationMonths. Use este em vez de calcular na mão. */
export function calculateExpiryFromPlan(plan: Plan): string {
  const now = new Date();
  if (plan.durationDays && plan.durationDays > 0) {
    now.setDate(now.getDate() + plan.durationDays);
  } else {
    now.setMonth(now.getMonth() + plan.durationMonths);
  }
  return now.toISOString();
}
