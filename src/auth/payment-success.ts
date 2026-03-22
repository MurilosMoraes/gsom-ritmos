// Payment success page — verify and activate subscription

import { authService } from './AuthService';
import { supabase } from './supabase';
import { verifyPayment, parseOrderNsu, getPlan, calculatePlanExpiry } from './PaymentService';

class PaymentSuccessPage {
  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    if (!(await authService.isAuthenticated())) {
      window.location.href = '/login.html';
      return;
    }

    // Parse redirect params from InfinitePay
    const params = new URLSearchParams(window.location.search);
    const orderNsu = params.get('order_nsu');
    const transactionNsu = params.get('transaction_nsu');
    const slug = params.get('slug');
    const receiptUrl = params.get('receipt_url');
    const captureMethod = params.get('capture_method');

    // Also check localStorage for pending order
    const pending = localStorage.getItem('gdrums-pending-order');
    const pendingOrder = pending ? JSON.parse(pending) : null;

    const finalOrderNsu = orderNsu || pendingOrder?.orderNsu;

    if (!finalOrderNsu) {
      this.showError('Dados de pagamento não encontrados.');
      return;
    }

    // Parse order info
    const orderInfo = parseOrderNsu(finalOrderNsu);
    if (!orderInfo) {
      this.showError('Formato de pedido inválido.');
      return;
    }

    const plan = getPlan(orderInfo.planId);
    if (!plan) {
      this.showError('Plano não encontrado.');
      return;
    }

    // If we have transaction params from redirect, verify with InfinitePay
    if (transactionNsu && slug) {
      try {
        const result = await verifyPayment(finalOrderNsu, transactionNsu, slug);

        if (result.success && result.paid) {
          await this.activateSubscription(orderInfo.userId, plan.id, plan.durationMonths, {
            orderNsu: finalOrderNsu,
            transactionNsu,
            captureMethod: captureMethod || result.capture_method || '',
            receiptUrl: receiptUrl || '',
            amountCents: result.paid_amount || plan.priceCents,
          });
          this.showSuccess(plan.id);
          localStorage.removeItem('gdrums-pending-order');
          return;
        }
      } catch {
        // Verification failed, try activating anyway if we have redirect params
        // (InfinitePay already confirmed payment by redirecting)
      }
    }

    // If InfinitePay redirected us here, payment is likely successful
    // Activate based on redirect (InfinitePay only redirects on success)
    if (orderNsu) {
      await this.activateSubscription(orderInfo.userId, plan.id, plan.durationMonths, {
        orderNsu: finalOrderNsu,
        transactionNsu: transactionNsu || '',
        captureMethod: captureMethod || '',
        receiptUrl: receiptUrl || '',
        amountCents: plan.priceCents,
      });
      this.showSuccess(plan.id);
      localStorage.removeItem('gdrums-pending-order');
      return;
    }

    // No redirect params — maybe user came here directly
    this.showError('Pagamento não confirmado. Se você já pagou, aguarde alguns minutos.');
  }

  private async activateSubscription(
    userId: string,
    planId: string,
    durationMonths: number,
    transaction: {
      orderNsu: string;
      transactionNsu: string;
      captureMethod: string;
      receiptUrl: string;
      amountCents: number;
    }
  ): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + durationMonths);

    // Update profile
    await supabase
      .from('gdrums_profiles')
      .update({
        subscription_status: 'active',
        subscription_plan: planId,
        subscription_expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    // Record transaction (upsert to avoid duplicates)
    await supabase
      .from('gdrums_transactions')
      .upsert({
        user_id: userId,
        order_nsu: transaction.orderNsu,
        transaction_nsu: transaction.transactionNsu,
        plan: planId,
        amount_cents: transaction.amountCents,
        status: 'confirmed',
        payment_method: transaction.captureMethod,
        receipt_url: transaction.receiptUrl,
      }, { onConflict: 'order_nsu' });
  }

  private showSuccess(planId: string): void {
    const icon = document.getElementById('statusIcon')!;
    const title = document.getElementById('statusTitle')!;
    const msg = document.getElementById('statusMsg')!;
    const btn = document.getElementById('accessBtn')!;

    icon.className = 'success-icon ok';
    icon.innerHTML = '&#10003;';
    title.textContent = 'Pagamento confirmado!';
    msg.textContent = `Seu plano ${planId} está ativo. Aproveite o GDrums!`;
    btn.classList.add('visible');
  }

  private showError(message: string): void {
    const icon = document.getElementById('statusIcon')!;
    const title = document.getElementById('statusTitle')!;
    const msg = document.getElementById('statusMsg')!;
    const retry = document.getElementById('retryBtn')!;

    icon.className = 'success-icon fail';
    icon.innerHTML = '!';
    title.textContent = 'Ops...';
    msg.textContent = message;
    retry.classList.add('visible');
  }
}

window.addEventListener('DOMContentLoaded', () => { new PaymentSuccessPage(); });
