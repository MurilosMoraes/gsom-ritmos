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
      this.showSuccess(planName || profile.subscription_plan || 'seu plano');
      localStorage.removeItem('gdrums-pending-order');
      return;
    }

    // 2. Se temos dados do redirect, chamar o webhook diretamente
    if (finalOrderNsu && (transactionNsu || slug)) {
      this.updateProgress('Verificando pagamento...');

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
          this.showSuccess(planName || 'seu plano');
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
        this.showSuccess(planName || updated.subscription_plan || 'seu plano');
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

  private showSuccess(planName: string): void {
    const icon = document.getElementById('statusIcon')!;
    const title = document.getElementById('statusTitle')!;
    const msg = document.getElementById('statusMsg')!;
    const btn = document.getElementById('accessBtn')!;

    icon.className = 'success-icon ok';
    icon.innerHTML = '&#10003;';
    title.textContent = 'Pagamento confirmado!';
    msg.textContent = `Plano ${planName} ativado. Bora fazer música!`;
    btn.classList.add('visible');
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
