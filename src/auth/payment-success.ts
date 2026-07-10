// Payment success page — verifica pagamento e ativa assinatura

import { authService } from './AuthService';
import { supabase } from './supabase';
import { parseOrderNsu, getPlan } from './PaymentService';
import { internalNav } from '../native/Platform';
import { redirectIfRecoveryHash } from './recoveryGuard';
import { trackPurchase } from '../utils/metaTracking';
import { t, hydrate } from '../i18n';

// Hidrata o HTML estático (data-i18n) ANTES de qualquer render dinâmico —
// pra pt-BR é no-op visual (valores byte-idênticos ao HTML).
hydrate();

const SUPABASE_URL = 'https://qsfziivubwdgtmwyztfw.supabase.co';

class PaymentSuccessPage {
  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    if (!(await authService.isAuthenticated())) {
      internalNav('/login');
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { internalNav('/login'); return; }

    // Pegar dados do redirect da InfinitePay
    const params = new URLSearchParams(window.location.search);
    const orderNsu = params.get('order_nsu');
    const transactionNsu = params.get('transaction_nsu');
    const slug = params.get('slug');
    const captureMethod = params.get('capture_method');
    const isIOSIAP = params.get('ios_iap') === '1';
    const isRestore = params.get('restore') === '1';

    // Fluxo Apple IAP: o backend (apple-iap-verify) já atualizou o
    // gdrums_profiles antes de retornar pro cliente. Aqui só confirmamos.
    if (isIOSIAP) {
      const { data: iapProfile } = await supabase
        .from('gdrums_profiles')
        .select('subscription_status, subscription_plan')
        .eq('id', user.id)
        .single();

      if (iapProfile?.subscription_status === 'active' || iapProfile?.subscription_status === 'trial') {
        const planLabel = getPlan(iapProfile.subscription_plan || '')?.displayName || t('plans.success.fallbackProLabel');
        await this.showSuccess(isRestore ? t('plans.success.restoredLabel', { plan: planLabel }) : planLabel);
        return;
      }

      // Se chegou aqui mesmo o webhook tendo retornado success, faz polling curto
      for (let i = 0; i < 3; i++) {
        await new Promise(r => setTimeout(r, 1500));
        const { data: retry } = await supabase
          .from('gdrums_profiles')
          .select('subscription_status, subscription_plan')
          .eq('id', user.id)
          .single();
        if (retry?.subscription_status === 'active' || retry?.subscription_status === 'trial') {
          const planLabel = getPlan(retry.subscription_plan || '')?.displayName || t('plans.success.fallbackProLabel');
          await this.showSuccess(planLabel);
          return;
        }
      }
      this.showPending();
      return;
    }

    const pending = localStorage.getItem('gdrums-pending-order');
    const pendingOrder = pending ? JSON.parse(pending) : null;
    const finalOrderNsu = orderNsu || pendingOrder?.orderNsu;

    // Identificar o plano
    let planName = '';
    if (finalOrderNsu) {
      const orderInfo = parseOrderNsu(finalOrderNsu);
      if (orderInfo) {
        const plan = getPlan(orderInfo.planId);
        planName = plan?.displayName || orderInfo.planId;
      }
    }

    // 1. Primeiro: verificar se já está ativo (webhook pode ter chegado)
    const { data: profile } = await supabase
      .from('gdrums_profiles')
      .select('subscription_status, subscription_plan')
      .eq('id', user.id)
      .single();

    if (profile?.subscription_status === 'active' && profile?.subscription_plan !== 'trial' && profile?.subscription_plan !== 'free') {
      await this.showSuccess(planName || profile.subscription_plan || t('plans.success.fallbackPlanName'));
      localStorage.removeItem('gdrums-pending-order');
      return;
    }

    // 2. Se temos dados do redirect, salvar no banco e chamar o webhook
    if (finalOrderNsu && (transactionNsu || slug)) {
      this.updateProgress(t('plans.success.verifyingPayment'));

      // Salvar transaction_nsu e slug no banco pra recuperação futura
      await supabase.from('gdrums_transactions')
        .update({
          transaction_nsu: transactionNsu || '',
          payment_method: captureMethod || '',
        })
        .eq('order_nsu', finalOrderNsu);

      try {
        const webhookResponse = await fetch(`${SUPABASE_URL}/functions/v1/payment-webhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order_nsu: finalOrderNsu,
            transaction_nsu: transactionNsu || '',
            invoice_slug: slug || '',
            capture_method: captureMethod || '',
          }),
        });

        const result = await webhookResponse.json();

        if (result.success) {
          await this.showSuccess(planName || t('plans.success.fallbackPlanName'));
          localStorage.removeItem('gdrums-pending-order');
          return;
        }
      } catch {
        // Falha na chamada direta — continuar com polling
      }
    }

    // 3. Fallback: polling no banco (caso webhook chegue por conta)
    const maxAttempts = 5;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 2000));
      this.updateProgress(t('plans.success.confirmingProgress', { attempt: i + 1, max: maxAttempts }));

      const { data: updated } = await supabase
        .from('gdrums_profiles')
        .select('subscription_status, subscription_plan')
        .eq('id', user.id)
        .single();

      if (updated?.subscription_status === 'active' && updated?.subscription_plan !== 'trial' && updated?.subscription_plan !== 'free') {
        await this.showSuccess(planName || updated.subscription_plan || t('plans.success.fallbackPlanName'));
        localStorage.removeItem('gdrums-pending-order');
        return;
      }
    }

    // 4. Nada funcionou
    this.showPending();
  }

  private updateProgress(text: string): void {
    const msg = document.getElementById('statusMsg');
    if (msg) msg.textContent = text;
  }

  private async showSuccess(planName: string): Promise<void> {
    const icon = document.getElementById('statusIcon')!;
    const title = document.getElementById('statusTitle')!;
    const msg = document.getElementById('statusMsg')!;
    const btn = document.getElementById('accessBtn')!;

    icon.className = 'success-icon ok';
    icon.innerHTML = '&#10003;';
    title.textContent = t('plans.success.title');
    msg.textContent = t('plans.success.activated', { plan: planName });
    btn.classList.add('visible');

    // Incrementar uso do cupom (se teve)
    await this.incrementCouponUse();

    // Meta Pixel Purchase (browser) — server (payment-webhook ou
    // apple-iap-verify) já disparou CAPI; aqui mandamos o Pixel com o
    // MESMO event_id pra dedup no Meta. Se o event_id não tiver no
    // banco (caso raro), mandamos null e o trackPurchase também
    // dispara CAPI como fallback (Meta deduplica em 7 dias).
    await this.firePixelPurchase();
  }

  /**
   * Lê event_id + amount + plan + user info do banco e dispara o
   * Pixel browser. Best-effort: qualquer falha aqui não afeta o UX
   * de sucesso (já mostramos a tela ativada).
   */
  private async firePixelPurchase(): Promise<void> {
    try {
      const params = new URLSearchParams(window.location.search);
      const orderNsu = params.get('order_nsu');
      const pending = localStorage.getItem('gdrums-pending-order');
      const pendingOrder = pending ? JSON.parse(pending) : null;
      const finalOrderNsu = orderNsu || pendingOrder?.orderNsu;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let eventId: string | null = null;
      let amountCents = 0;
      let planId = '';

      // Fluxo Web (InfinitePay): event_id veio do payment-webhook ao
      // claimar a transação. Pega do banco.
      if (finalOrderNsu) {
        const { data: tx } = await supabase
          .from('gdrums_transactions')
          .select('event_id, amount_cents, plan')
          .eq('order_nsu', finalOrderNsu)
          .eq('status', 'confirmed')
          .maybeSingle();
        if (tx) {
          eventId = tx.event_id || null;
          amountCents = tx.amount_cents || 0;
          planId = tx.plan || '';
        }
      }

      // Fluxo iOS IAP: order_nsu é apple_iap_<userId>_<plan>_<txid>.
      // Já passou pelo apple-iap-verify (server dispara CAPI). Aqui
      // ainda assim queremos disparar Pixel browser caso o user esteja
      // numa WebView que renderiza essa página (raro). Tentamos pegar
      // a última tx confirmada do user.
      if (!planId) {
        const { data: lastTx } = await supabase
          .from('gdrums_transactions')
          .select('event_id, amount_cents, plan')
          .eq('user_id', user.id)
          .eq('status', 'confirmed')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastTx) {
          eventId = lastTx.event_id || null;
          amountCents = lastTx.amount_cents || 0;
          planId = lastTx.plan || '';
        }
      }

      if (!planId || !amountCents) return;

      // Profile pra pegar phone (email vem do auth.users)
      let phone = '';
      try {
        const { data: profile } = await supabase
          .from('gdrums_profiles')
          .select('phone')
          .eq('id', user.id)
          .maybeSingle();
        phone = profile?.phone || '';
      } catch { /* ok */ }

      const plan = getPlan(planId);
      trackPurchase({
        eventId,
        value: amountCents / 100,
        currency: 'BRL',
        contentIds: [planId],
        contentName: plan?.displayName || planId,
        email: user.email || '',
        phone,
      });
    } catch { /* tracking nunca quebra a UI */ }
  }

  private async incrementCouponUse(): Promise<void> {
    try {
      const pending = localStorage.getItem('gdrums-pending-order');
      if (!pending) return;
      const order = JSON.parse(pending);
      const couponCode = order.coupon?.code;
      if (!couponCode) return;

      // Incremento atômico no banco — evita race condition com pagamentos simultâneos
      await supabase.rpc('increment_coupon_uses', { coupon_code: couponCode });
    } catch {
      // Não bloquear o fluxo de sucesso se falhar
    }
  }

  private showPending(): void {
    const icon = document.getElementById('statusIcon')!;
    const title = document.getElementById('statusTitle')!;
    const msg = document.getElementById('statusMsg')!;
    const btn = document.getElementById('accessBtn')!;
    const retry = document.getElementById('retryBtn')!;

    icon.className = 'success-icon ok';
    icon.innerHTML = '&#8987;';
    title.textContent = t('plans.pending.title');
    msg.textContent = t('plans.pending.message');
    btn.classList.add('visible');
    retry.classList.add('visible');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  if (redirectIfRecoveryHash()) return;
  new PaymentSuccessPage();
});
