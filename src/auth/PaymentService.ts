// PaymentService — InfinitePay checkout integration

const INFINITEPAY_HANDLE = 'g-drums';
const INFINITEPAY_CHECKOUT = 'https://checkout.infinitepay.com.br';

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
    name: 'Plano Mensal',
    displayName: 'Mensal',
    priceCents: 2900,
    priceDisplay: 'R$ 29',
    pricePerMonth: '29',
    durationMonths: 1,
  },
  {
    id: 'semestral',
    name: 'Plano Semestral',
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
    name: 'Plano Anual',
    displayName: 'Anual',
    priceCents: 22800,
    priceDisplay: 'R$ 228',
    pricePerMonth: '19',
    durationMonths: 12,
    savings: 'Economize 34%',
  },
];

export function getPlan(id: string): Plan | undefined {
  return PLANS.find(p => p.id === id);
}

export function generateOrderNsu(userId: string, planId: string): string {
  return `${userId}_${planId}_${Date.now()}`;
}

export function parseOrderNsu(orderNsu: string): { userId: string; planId: string; timestamp: string } | null {
  const parts = orderNsu.split('_');
  if (parts.length < 3) return null;
  // userId is UUID (has dashes), so rejoin all but last 2 parts
  const planId = parts[parts.length - 2];
  const timestamp = parts[parts.length - 1];
  const userId = parts.slice(0, parts.length - 2).join('_');
  return { userId, planId, timestamp };
}

export function buildCheckoutUrl(plan: Plan, orderNsu: string, redirectUrl: string, webhookUrl?: string): string {
  const items = JSON.stringify([{
    name: plan.name,
    price: plan.priceCents,
    quantity: 1
  }]);

  const params = new URLSearchParams({
    items,
    order_nsu: orderNsu,
    redirect_url: redirectUrl,
  });

  if (webhookUrl) {
    params.set('webhook_url', webhookUrl);
  }

  return `${INFINITEPAY_CHECKOUT}/${INFINITEPAY_HANDLE}?${params.toString()}`;
}

export interface PaymentCheckResult {
  success: boolean;
  paid: boolean;
  amount?: number;
  paid_amount?: number;
  capture_method?: string;
}

export async function verifyPayment(orderNsu: string, transactionNsu: string, slug: string): Promise<PaymentCheckResult> {
  try {
    const response = await fetch('https://api.infinitepay.io/invoices/public/checkout/payment_check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: INFINITEPAY_HANDLE,
        order_nsu: orderNsu,
        transaction_nsu: transactionNsu,
        slug,
      }),
    });

    if (!response.ok) {
      return { success: false, paid: false };
    }

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

export function calculateExpiryDate(plan: Plan): string {
  const now = new Date();
  now.setMonth(now.getMonth() + plan.durationMonths);
  return now.toISOString();
}
