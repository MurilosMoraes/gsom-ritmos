// Payment success page — verifica se webhook já ativou a subscription

import { authService } from './AuthService';
import { supabase } from './supabase';
import { parseOrderNsu, getPlan } from './PaymentService';

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

    // Pegar order info do redirect ou do localStorage
    const params = new URLSearchParams(window.location.search);
    const orderNsu = params.get('order_nsu');
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

    // Aguardar o webhook processar (poll o banco)
    const maxAttempts = 10;
    for (let i = 0; i < maxAttempts; i++) {
      const { data: profile } = await supabase
        .from('gdrums_profiles')
        .select('subscription_status, subscription_plan')
        .eq('id', user.id)
        .single();

      if (profile?.subscription_status === 'active') {
        this.showSuccess(planName || profile.subscription_plan || 'seu plano');
        localStorage.removeItem('gdrums-pending-order');
        return;
      }

      // Esperar 2 segundos e tentar de novo
      await new Promise(r => setTimeout(r, 2000));
      this.updateProgress(i + 1, maxAttempts);
    }

    // Webhook não processou a tempo — mostrar mensagem
    this.showPending();
  }

  private updateProgress(attempt: number, max: number): void {
    const msg = document.getElementById('statusMsg');
    if (msg) {
      msg.textContent = `Confirmando pagamento... (${attempt}/${max})`;
    }
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
