// Payment success page — verifica pagamento e ativa assinatura

import { authService } from './AuthService';
import { supabase } from './supabase';
import { parseOrderNsu, getPlan } from './PaymentService';

const SUPABASE_URL = 'https://qsfziivubwdgtmwyztfw.supabase.co';

class PaymentSuccessPage {
  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    if (!(await authService.isAuthenticated())) {
      window.location.href = '/login.html';
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.location.href = '/login.html'; return; }

    // Pegar dados do redirect da InfinitePay
    const params = new URLSearchParams(window.location.search);
    const orderNsu = params.get('order_nsu');
    const transactionNsu = params.get('transaction_nsu');
    const slug = params.get('slug');
    const captureMethod = params.get('capture_method');

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
      await this.showSuccess(planName || profile.subscription_plan || 'seu plano');
      localStorage.removeItem('gdrums-pending-order');
      return;
    }

    // 2. Se temos dados do redirect, salvar no banco e chamar o webhook
    if (finalOrderNsu && (transactionNsu || slug)) {
      this.updateProgress('Verificando pagamento...');

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
          await this.showSuccess(planName || 'seu plano');
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
      this.updateProgress(`Confirmando pagamento... (${i + 1}/${maxAttempts})`);

      const { data: updated } = await supabase
        .from('gdrums_profiles')
        .select('subscription_status, subscription_plan')
        .eq('id', user.id)
        .single();

      if (updated?.subscription_status === 'active' && updated?.subscription_plan !== 'trial' && updated?.subscription_plan !== 'free') {
        await this.showSuccess(planName || updated.subscription_plan || 'seu plano');
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
    title.textContent = 'Pagamento confirmado!';
    msg.textContent = `Plano ${planName} ativado. Bora fazer música!`;
    btn.classList.add('visible');

    // Incrementar uso do cupom (se teve)
    await this.incrementCouponUse();
  }

  private async incrementCouponUse(): Promise<void> {
    try {
      const pending = localStorage.getItem('gdrums-pending-order');
      if (!pending) return;
      const order = JSON.parse(pending);
      const couponCode = order.coupon?.code;
      if (!couponCode) return;

      // Buscar cupom atual
      const { data: coupon } = await supabase
        .from('gdrums_coupons')
        .select('id, current_uses')
        .eq('code', couponCode)
        .single();

      if (!coupon) return;

      // Incrementar current_uses
      await supabase
        .from('gdrums_coupons')
        .update({ current_uses: (coupon.current_uses || 0) + 1 })
        .eq('id', coupon.id);
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
    title.textContent = 'Pagamento em processamento';
    msg.textContent = 'Seu pagamento foi recebido e está sendo processado. Pode levar alguns minutos. Tente acessar o app.';
    btn.classList.add('visible');
    retry.classList.add('visible');
  }
}

window.addEventListener('DOMContentLoaded', () => { new PaymentSuccessPage(); });
