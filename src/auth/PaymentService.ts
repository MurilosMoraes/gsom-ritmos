// PaymentService — InfinitePay checkout via API

const SUPABASE_URL = 'https://qsfziivubwdgtmwyztfw.supabase.co';
const INFINITEPAY_HANDLE = 'g-drums';
const INFINITEPAY_API = 'https://api.infinitepay.io/invoices/public/checkout';

export interface Plan {
  id: string;
  name: string;
  displayName: string;
  priceCents: number;
  priceDisplay: string;
  pricePerMonth: string;
  durationMonths: number;
  savings?: string;
  popular?: boolean;
}

export const PLANS: Plan[] = [
  {
    id: 'mensal',
    name: 'Plano Mensal GDrums',
    displayName: 'Mensal',
    priceCents: 10,
    priceDisplay: 'R$ 0,10',
    pricePerMonth: '0,10',
    durationMonths: 1,
  },
  {
    id: 'trimestral',
    name: 'Plano Trimestral GDrums',
    displayName: 'Trimestral',
    priceCents: 8100,
    priceDisplay: 'R$ 81',
    pricePerMonth: '27',
    durationMonths: 3,
    savings: 'Economize 7%',
  },
  {
    id: 'semestral',
    name: 'Plano Semestral GDrums',
    displayName: 'Semestral',
    priceCents: 14400,
    priceDisplay: 'R$ 144',
    pricePerMonth: '24',
    durationMonths: 6,
    savings: 'Economize 17%',
    popular: true,
  },
  {
    id: 'anual',
    name: 'Plano Anual GDrums',
    displayName: 'Anual',
    priceCents: 22800,
    priceDisplay: 'R$ 228',
    pricePerMonth: '19',
    durationMonths: 12,
    savings: 'Economize 34%',
  },
  {
    id: 'rei-dos-palcos',
    name: 'Rei dos Palcos — 3 Anos GDrums',
    displayName: 'Rei dos Palcos',
    priceCents: 52200,
    priceDisplay: 'R$ 522',
    pricePerMonth: '14,50',
    durationMonths: 36,
    savings: 'Metade do mensal!',
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
    const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFzZnppaXZ1YndkZ3Rtd3l6dGZ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MDY5NzYsImV4cCI6MjA4ODA4Mjk3Nn0.-yTPPDrZHE26FtmHVzsuR4qSMNJdQtmx8mYA_bkQ6ZE';

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
      return { success: false, error: data.error || 'Erro ao criar checkout' };
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
