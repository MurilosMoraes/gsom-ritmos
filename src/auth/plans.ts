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

    const { data: profile } = await supabase
      .from('gdrums_profiles')
      .select('subscription_status, subscription_expires_at, subscription_plan')
      .eq('id', user.id)
      .single();

    const status = profile?.subscription_status;
    const plan = profile?.subscription_plan;

    // Só redirecionar se tem plano PAGO ativo
    if (status === 'active' && plan && plan !== 'trial' && profile?.subscription_expires_at) {
      if (new Date(profile.subscription_expires_at) > new Date()) {
        window.location.href = '/';
        return;
      }
    }

    if (status === 'expired' || (status === 'trial' && profile?.subscription_expires_at && new Date(profile.subscription_expires_at) <= new Date())) {
      this.showAlert('Sua assinatura expirou. Escolha um plano para continuar.');
    }

    const params = new URLSearchParams(window.location.search);
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

      const discount = this.appliedCoupon?.discount_percent || 0;
      const originalPrice = plan.priceCents;
      const discountedPrice = Math.round(originalPrice * (1 - discount / 100));
      const discountedPerMonth = plan.durationMonths > 0
        ? Math.round(discountedPrice / plan.durationMonths / 100)
        : Math.round(discountedPrice / 100);
      const hasDiscount = discount > 0;

      card.innerHTML = `
        ${isHighlighted ? '<div class="plan-badge">Mais Popular</div>' : ''}
        <span class="plan-name">${plan.displayName}</span>
        ${hasDiscount ? `<div class="plan-original-price">R$ ${plan.pricePerMonth}/mês</div>` : ''}
        <div class="plan-price">
          <span class="plan-currency">R$</span>
          <span class="plan-amount">${hasDiscount ? discountedPerMonth : plan.pricePerMonth}</span>
          <span class="plan-period">/mês</span>
        </div>
        ${hasDiscount ? `<span class="plan-savings">${discount}% OFF com cupom!</span>` : (plan.savings ? `<span class="plan-savings">${plan.savings}</span>` : '')}
        ${plan.durationMonths > 1 ? `<span class="plan-total">Total: R$ ${(discountedPrice / 100).toFixed(0)}</span>` : '<span class="plan-total">&nbsp;</span>'}
        <ul class="plan-features">
          <li>Acesso total ao sequenciador</li>
          <li>Biblioteca completa de ritmos</li>
          <li>Salvar projetos ilimitados</li>
          <li>Favoritos e setlists</li>
          ${plan.durationMonths >= 6 ? '<li>Suporte prioritário</li>' : '<li>Suporte por email</li>'}
          ${plan.durationMonths >= 12 ? '<li>Acesso antecipado a novidades</li>' : ''}
        </ul>
        <button class="plan-btn" data-plan="${plan.id}">Assinar ${plan.displayName}</button>
      `;

      card.querySelector('.plan-btn')!.addEventListener('click', () => this.selectPlan(plan, discountedPrice));
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

      // Gerar order_nsu com info do cupom
      const couponSuffix = this.appliedCoupon ? `_${this.appliedCoupon.code}` : '';
      const orderNsu = generateOrderNsu(user.id, plan.id) + couponSuffix;
      const redirectUrl = `${window.location.origin}/payment-success.html`;

      // Salvar pedido pendente com info de cupom
      localStorage.setItem('gdrums-pending-order', JSON.stringify({
        orderNsu,
        planId: plan.id,
        userId: user.id,
        coupon: this.appliedCoupon,
        originalPriceCents: plan.priceCents,
        finalPriceCents,
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
