// Plan selection page

import { authService } from './AuthService';
import { supabase } from './supabase';
import { PLANS, generateOrderNsu, createCheckoutLink } from './PaymentService';
import type { Plan } from './PaymentService';

class PlansPage {
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

    // Check if already subscribed
    const { data: profile } = await supabase
      .from('gdrums_profiles')
      .select('subscription_status, subscription_expires_at')
      .eq('id', user.id)
      .single();

    const status = profile?.subscription_status;
    if ((status === 'active' || status === 'trial') && profile?.subscription_expires_at) {
      if (new Date(profile.subscription_expires_at) > new Date()) {
        window.location.href = '/';
        return;
      }
    }

    if (status === 'expired' || (status === 'trial' && profile?.subscription_expires_at && new Date(profile.subscription_expires_at) <= new Date())) {
      this.showAlert('Sua assinatura expirou. Escolha um plano para continuar.');
    }

    // Check for pre-selected plan from URL
    const params = new URLSearchParams(window.location.search);
    this.renderPlans(params.get('plan'));
  }

  private renderPlans(highlight?: string | null): void {
    const grid = document.getElementById('plansGrid');
    if (!grid) return;
    grid.innerHTML = '';

    PLANS.forEach(plan => {
      const isHighlighted = plan.popular || highlight === plan.id;
      const card = document.createElement('div');
      card.className = 'plan-card' + (isHighlighted ? ' popular' : '');

      card.innerHTML = `
        ${isHighlighted ? '<div class="plan-badge">Mais Popular</div>' : ''}
        <span class="plan-name">${plan.displayName}</span>
        <div class="plan-price">
          <span class="plan-currency">R$</span>
          <span class="plan-amount">${plan.pricePerMonth}</span>
          <span class="plan-period">/mês</span>
        </div>
        ${plan.savings ? `<span class="plan-savings">${plan.savings}</span>` : ''}
        ${plan.durationMonths > 1 ? `<span class="plan-total">Total: ${plan.priceDisplay}</span>` : '<span class="plan-total">&nbsp;</span>'}
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

      card.querySelector('.plan-btn')!.addEventListener('click', () => this.selectPlan(plan));
      grid.appendChild(card);
    });
  }

  private async selectPlan(plan: Plan): Promise<void> {
    const loading = document.getElementById('plansLoading');
    if (loading) loading.classList.add('active');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = '/login.html'; return; }

      const orderNsu = generateOrderNsu(user.id, plan.id);
      const redirectUrl = `${window.location.origin}/payment-success.html`;

      // Salvar pedido pendente
      localStorage.setItem('gdrums-pending-order', JSON.stringify({
        orderNsu, planId: plan.id, userId: user.id,
      }));

      // Criar link via Edge Function (sem CORS, com webhook)
      const result = await createCheckoutLink(plan, orderNsu, redirectUrl, {
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
