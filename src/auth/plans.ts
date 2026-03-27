// Plan selection page with coupon support

import { authService } from './AuthService';
import { supabase } from './supabase';
import { PLANS, generateOrderNsu, createCheckoutLink } from './PaymentService';
import type { Plan } from './PaymentService';

interface AppliedCoupon {
  code: string;
  discount_percent: number;
}

class PlansPage {
  private appliedCoupon: AppliedCoupon | null = null;
  private upgradeCredit = 0; // Crédito em centavos do plano atual (upgrade proporcional)

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    // Limpar loading se voltou do checkout (bfcache)
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) {
        const loading = document.getElementById('plansLoading');
        if (loading) loading.classList.remove('active');
      }
    });
    // Também limpar ao ganhar foco (fallback)
    window.addEventListener('focus', () => {
      const loading = document.getElementById('plansLoading');
      if (loading) loading.classList.remove('active');
    });

    if (!(await authService.isAuthenticated())) {
      window.location.href = '/login.html';
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.location.href = '/login.html'; return; }

    const { data: profile } = await supabase
      .from('gdrums_profiles')
      .select('subscription_status, subscription_expires_at, subscription_plan')
      .eq('id', user.id)
      .single();

    const status = profile?.subscription_status;
    const plan = profile?.subscription_plan;

    // Verificar pedido pendente no banco (pagou mas fechou a página do checkout)
    if (status !== 'active') {
      const { data: pendingTx } = await supabase
        .from('gdrums_transactions')
        .select('order_nsu, transaction_nsu')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (pendingTx?.order_nsu) {
        try {
          const webhookBody: Record<string, string> = { order_nsu: pendingTx.order_nsu };
          if (pendingTx.transaction_nsu) webhookBody.transaction_nsu = pendingTx.transaction_nsu;

          const res = await fetch(
            'https://qsfziivubwdgtmwyztfw.supabase.co/functions/v1/payment-webhook',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(webhookBody),
            }
          );
          const result = await res.json();
          if (result.success) {
            localStorage.removeItem('gdrums-pending-order');
            window.location.href = '/';
            return;
          }
        } catch { /* continuar normalmente */ }
      }
    }

    // Só redirecionar se tem plano PAGO ativo e NÃO veio fazer upgrade
    const params = new URLSearchParams(window.location.search);
    const isUpgrade = params.get('upgrade') === 'true';

    if (!isUpgrade && status === 'active' && plan && plan !== 'trial' && profile?.subscription_expires_at) {
      if (new Date(profile.subscription_expires_at) > new Date()) {
        window.location.href = '/';
        return;
      }
    }

    if (isUpgrade) {
      this.showAlert('Escolha um plano superior para fazer o upgrade da sua assinatura.');
    } else if (status === 'expired' || (status === 'trial' && profile?.subscription_expires_at && new Date(profile.subscription_expires_at) <= new Date())) {
      this.showAlert('Sua assinatura expirou. Escolha um plano para continuar.');
    }

    // Crédito de upgrade (proporcional ao tempo não usado do plano atual)
    const creditParam = parseInt(params.get('credit') || '0');
    if (isUpgrade && creditParam > 0) {
      this.upgradeCredit = creditParam;
    }

    this.setupCoupon();
    this.renderPlans(params.get('plan'));
  }

  // ─── Cupom ──────────────────────────────────────────────────────────

  private setupCoupon(): void {
    const input = document.getElementById('couponInput') as HTMLInputElement;
    const btn = document.getElementById('couponBtn') as HTMLButtonElement;

    if (!input || !btn) return;

    // Enter aplica
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.applyCoupon();
    });

    btn.addEventListener('click', () => this.applyCoupon());
  }

  private async applyCoupon(): Promise<void> {
    const input = document.getElementById('couponInput') as HTMLInputElement;
    const status = document.getElementById('couponStatus') as HTMLElement;
    const btn = document.getElementById('couponBtn') as HTMLButtonElement;

    if (!input || !status) return;

    const code = input.value.trim().toUpperCase();
    if (!code) {
      status.textContent = 'Digite um código de cupom';
      status.className = 'coupon-status error';
      return;
    }

    btn.disabled = true;
    status.textContent = 'Verificando...';
    status.className = 'coupon-status';

    // Buscar cupom no banco
    const { data: coupon, error } = await supabase
      .from('gdrums_coupons')
      .select('*')
      .eq('code', code)
      .eq('active', true)
      .single();

    btn.disabled = false;

    if (error || !coupon) {
      status.textContent = 'Cupom inválido';
      status.className = 'coupon-status error';
      this.appliedCoupon = null;
      this.renderPlans(null);
      return;
    }

    // Verificar validade
    const now = new Date();
    if (new Date(coupon.valid_from) > now) {
      status.textContent = 'Cupom ainda não está ativo';
      status.className = 'coupon-status error';
      return;
    }
    if (new Date(coupon.valid_until) < now) {
      status.textContent = 'Cupom expirado';
      status.className = 'coupon-status error';
      return;
    }

    // Verificar usos
    if (coupon.current_uses >= coupon.max_uses) {
      status.textContent = 'Cupom esgotado';
      status.className = 'coupon-status error';
      return;
    }

    // Cupom válido!
    this.appliedCoupon = {
      code: coupon.code,
      discount_percent: coupon.discount_percent,
    };

    status.innerHTML = '';
    const badge = document.createElement('span');
    badge.className = 'coupon-badge';
    badge.innerHTML = `${coupon.code} — ${coupon.discount_percent}% OFF <button id="removeCoupon">&times;</button>`;
    status.appendChild(badge);
    status.className = 'coupon-status success';

    badge.querySelector('#removeCoupon')!.addEventListener('click', () => {
      this.appliedCoupon = null;
      status.textContent = '';
      status.className = 'coupon-status';
      input.value = '';
      this.renderPlans(null);
    });

    input.value = '';
    this.renderPlans(null);
  }

  // ─── Renderizar planos ──────────────────────────────────────────────

  private renderPlans(highlight?: string | null): void {
    const grid = document.getElementById('plansGrid');
    if (!grid) return;
    grid.innerHTML = '';

    PLANS.forEach(plan => {
      const isHighlighted = plan.popular || highlight === plan.id;
      const card = document.createElement('div');
      card.className = 'plan-card' + (isHighlighted ? ' popular' : '');

      // Aplicar desconto do cupom
      const discount = this.appliedCoupon?.discount_percent || 0;
      const originalPrice = plan.priceCents;
      let finalPrice = Math.round(originalPrice * (1 - discount / 100));
      const hasDiscount = discount > 0;

      // Aplicar crédito de upgrade (após cupom)
      const hasCredit = this.upgradeCredit > 0;
      const creditApplied = hasCredit ? Math.min(this.upgradeCredit, finalPrice) : 0;
      finalPrice = Math.max(0, finalPrice - creditApplied);

      const finalPerMonth = plan.durationMonths > 0
        ? Math.round(finalPrice / plan.durationMonths / 100)
        : Math.round(finalPrice / 100);

      // Texto de economia
      let savingsText = '';
      if (hasCredit && creditApplied > 0) {
        const creditDisplay = (creditApplied / 100).toFixed(0);
        savingsText = `Crédito de R$ ${creditDisplay} aplicado!`;
      } else if (hasDiscount) {
        savingsText = `${discount}% OFF com cupom!`;
      } else if (plan.savings) {
        savingsText = plan.savings;
      }

      card.innerHTML = `
        ${isHighlighted ? '<div class="plan-badge">' + (hasCredit ? 'Upgrade' : 'Mais Popular') + '</div>' : ''}
        <span class="plan-name">${plan.displayName}</span>
        ${(hasDiscount || hasCredit) ? `<div class="plan-original-price">R$ ${plan.pricePerMonth}/mês</div>` : ''}
        <div class="plan-price">
          <span class="plan-currency">R$</span>
          <span class="plan-amount">${(hasDiscount || hasCredit) ? finalPerMonth : plan.pricePerMonth}</span>
          <span class="plan-period">/mês</span>
        </div>
        ${savingsText ? `<span class="plan-savings">${savingsText}</span>` : ''}
        ${plan.durationMonths > 1 ? `<span class="plan-total">Total: R$ ${(finalPrice / 100).toFixed(0)}</span>` : '<span class="plan-total">&nbsp;</span>'}
        <ul class="plan-features">
          <li>Todos os ritmos da biblioteca</li>
          <li>Performance ao vivo (viradas, intro, final)</li>
          <li>Pedal Bluetooth personalizável</li>
          <li>Favoritos e setlist</li>
          <li>Modo offline</li>
          <li>Ritmos novos toda semana</li>
          ${plan.durationMonths >= 6 ? '<li>Suporte prioritário</li>' : ''}
          ${plan.durationMonths >= 36 ? '<li>3 anos garantidos — metade do mensal</li>' : ''}
        </ul>
        <button class="plan-btn" data-plan="${plan.id}">${hasCredit ? 'Upgrade para' : 'Assinar'} ${plan.displayName}</button>
      `;

      card.querySelector('.plan-btn')!.addEventListener('click', () => this.selectPlan(plan, finalPrice));
      grid.appendChild(card);
    });
  }

  // ─── Selecionar plano ───────────────────────────────────────────────

  private async selectPlan(plan: Plan, finalPriceCents: number): Promise<void> {
    const loading = document.getElementById('plansLoading');
    if (loading) loading.classList.add('active');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = '/login.html'; return; }

      // Verificar se já tem pending pro mesmo plano (evitar duplicatas)
      const { data: existingPending } = await supabase
        .from('gdrums_transactions')
        .select('order_nsu')
        .eq('user_id', user.id)
        .eq('plan', plan.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // Gerar order_nsu com info do cupom
      const couponSuffix = this.appliedCoupon ? `_${this.appliedCoupon.code}` : '';
      const orderNsu = existingPending?.order_nsu || (generateOrderNsu(user.id, plan.id) + couponSuffix);
      const redirectUrl = `${window.location.origin}/payment-success.html`;

      // Salvar pedido pendente no banco (só se não existe)
      if (!existingPending) {
        await supabase.from('gdrums_transactions').insert({
          user_id: user.id,
          order_nsu: orderNsu,
          plan: plan.id,
          amount_cents: finalPriceCents,
          original_amount_cents: plan.priceCents,
          status: 'pending',
          coupon_code: this.appliedCoupon?.code || null,
          discount_percent: this.appliedCoupon?.discount_percent || null,
        });
      }

      // Backup local (fallback)
      localStorage.setItem('gdrums-pending-order', JSON.stringify({
        orderNsu,
        planId: plan.id,
        userId: user.id,
        coupon: this.appliedCoupon,
        originalPriceCents: plan.priceCents,
        finalPriceCents,
        upgradeCredit: this.upgradeCredit || 0,
      }));

      // Criar checkout com preço final (já com desconto)
      const checkoutPlan = { ...plan, priceCents: finalPriceCents, name: plan.name + (this.appliedCoupon ? ` (${this.appliedCoupon.code})` : '') };
      const result = await createCheckoutLink(checkoutPlan, orderNsu, redirectUrl, {
        name: user.user_metadata?.name || '',
        email: user.email || '',
      });

      if (result.success && result.url) {
        window.location.href = result.url;
      } else {
        if (loading) loading.classList.remove('active');
        this.showAlert(result.error || 'Erro ao gerar pagamento. Tente novamente.');
      }
    } catch {
      if (loading) loading.classList.remove('active');
      this.showAlert('Erro ao processar. Tente novamente.');
    }
  }

  private showAlert(message: string): void {
    const alert = document.getElementById('alertBar');
    if (alert) { alert.textContent = message; alert.style.display = 'block'; }
  }
}

window.addEventListener('DOMContentLoaded', () => { new PlansPage(); });
