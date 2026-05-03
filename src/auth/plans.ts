// Plan selection page with coupon support

import { authService } from './AuthService';
import { supabase } from './supabase';
import { PLANS, generateOrderNsu, createCheckoutLink } from './PaymentService';
import type { Plan } from './PaymentService';
import { internalNav } from '../native/Platform';

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
    // Logout
    document.getElementById('plansLogoutBtn')?.addEventListener('click', async () => {
      await supabase.auth.signOut();
      internalNav('/login');
    });

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
      // Tentar refresh antes de desistir
      try {
        const { error } = await supabase.auth.refreshSession();
        if (error) {
          internalNav('/login');
          return;
        }
      } catch {
        internalNav('/login');
        return;
      }
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { internalNav('/login'); return; }

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

    // Só redirecionar se tem plano PAGO ativo e NÃO veio fazer upgrade/renovação
    const params = new URLSearchParams(window.location.search);
    const isUpgrade = params.get('upgrade') === 'true';
    const isRenew = params.get('renew') === 'true';

    if (!isUpgrade && !isRenew && status === 'active' && plan && plan !== 'trial' && profile?.subscription_expires_at) {
      if (new Date(profile.subscription_expires_at) > new Date()) {
        window.location.href = '/';
        return;
      }
    }

    if (isUpgrade) {
      this.showAlert('Escolha um plano superior para fazer o upgrade da sua assinatura.');
    } else if (isRenew && plan && plan !== 'trial') {
      // Renovação proativa (assinante pago veio antes de vencer)
      const planLabel = (PLANS.find(p => p.id === plan)?.name) || plan;
      const daysToExp = profile?.subscription_expires_at
        ? Math.ceil((new Date(profile.subscription_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : 0;
      const venceMsg = daysToExp <= 0
        ? 'sua assinatura vence hoje'
        : daysToExp === 1
          ? 'sua assinatura vence amanhã'
          : `sua assinatura vence em ${daysToExp} dias`;
      this.showAlert(`Renove seu plano ${planLabel} — ${venceMsg}.`);
    } else if (status === 'expired' || (status === 'trial' && profile?.subscription_expires_at && new Date(profile.subscription_expires_at) <= new Date())) {
      this.showAlert('Sua assinatura expirou. Escolha um plano para continuar.');
    }

    // Crédito de upgrade (proporcional ao tempo não usado do plano atual)
    const creditParam = parseInt(params.get('credit') || '0');
    if (isUpgrade && creditParam > 0) {
      this.upgradeCredit = creditParam;
    }

    this.setupCoupon();
    // Renovação destaca o plano atual; upgrade respeita ?plan=X; default usa o "popular"
    const highlightPlan = isRenew && plan && plan !== 'trial'
      ? plan
      : params.get('plan');
    this.renderPlans(highlightPlan);
  }

  // ─── Cupom ──────────────────────────────────────────────────────────

  private setupCoupon(): void {
    const input = document.getElementById('couponInput') as HTMLInputElement;
    const btn = document.getElementById('couponBtn') as HTMLButtonElement;

    if (!input || !btn) return;

    // Normaliza pra uppercase enquanto digita (mantém cursor position)
    input.addEventListener('input', () => {
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const upper = input.value.toUpperCase();
      if (input.value !== upper) {
        input.value = upper;
        if (start !== null && end !== null) input.setSelectionRange(start, end);
      }
    });

    // Enter aplica
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.applyCoupon();
    });

    btn.addEventListener('click', () => this.applyCoupon());

    // Pré-aplicar cupom automaticamente — ordem de prioridade:
    // 1. ?coupon=X  (vem do ConversionManager — modal trialEndingSoon)
    // 2. ?ref=X     (link de afiliado direto — gdrums.com.br/plans?ref=LUCAS10)
    // 3. localStorage 'gdrums-attr-v1' — se user veio de afiliado há N dias,
    //    o cupom do afiliado é aplicado no checkout AUTOMATICAMENTE.
    //    Double-sided discount: user ganha desconto, afiliado ganha comissão.
    //    Padrão da indústria (UpPromote, Thinkific, Partnero, Rewardful).
    (async () => {
      const qs = new URLSearchParams(window.location.search);
      const fromCouponParam = qs.get('coupon');
      const fromRefParam = qs.get('ref');

      // 1. Cupom explícito na URL
      if (fromCouponParam) {
        input.value = fromCouponParam.toUpperCase();
        setTimeout(() => this.applyCoupon(), 200);
        return;
      }

      // 2. ?ref=X → converter pro coupon_code do afiliado via RPC
      if (fromRefParam) {
        const couponCode = await this.resolveAffiliateCoupon(fromRefParam);
        if (couponCode) {
          input.value = couponCode;
          setTimeout(() => this.applyCoupon(), 200);
          return;
        }
      }

      // 3. Atribuição salva em localStorage (cookie window de 90 dias)
      const campaign = this.getAffiliateCampaignFromStorage();
      if (campaign) {
        const couponCode = await this.resolveAffiliateCoupon(campaign);
        if (couponCode) {
          input.value = couponCode;
          setTimeout(() => this.applyCoupon(), 200);
        }
      }
    })();
  }

  /**
   * Retorna o coupon_code do afiliado cujo ref bate com o passado,
   * ou null se não existe ou não tá ativo.
   */
  private async resolveAffiliateCoupon(refCode: string): Promise<string | null> {
    try {
      const { data, error } = await supabase.rpc('get_affiliate_coupon', {
        ref_code: refCode,
      });
      if (error || !data) return null;
      const row = Array.isArray(data) ? data[0] : data;
      return row?.coupon_code || null;
    } catch {
      return null;
    }
  }

  /**
   * Lê atribuição salva no localStorage e retorna o campaign (cupom/ref)
   * se o user veio por afiliado. Null em qualquer outro caso.
   */
  private getAffiliateCampaignFromStorage(): string | null {
    try {
      const raw = localStorage.getItem('gdrums-attr-v1');
      if (!raw) return null;
      const attr = JSON.parse(raw);
      if (attr.source !== 'register_referral' && attr.medium !== 'affiliate') return null;
      return attr.campaign || null;
    } catch {
      return null;
    }
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

    // Validar via RPC — retorna só campos mínimos se o cupom for válido
    // (ativo, na janela, com usos disponíveis). Evita expor tabela inteira pro anon.
    const { data: rpcRows, error: rpcErr } = await supabase
      .rpc('validate_coupon', { coupon_code: code });

    btn.disabled = false;

    const coupon = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;

    if (rpcErr || !coupon) {
      status.textContent = 'Cupom inválido';
      status.className = 'coupon-status error';
      this.appliedCoupon = null;
      this.renderPlans(null);
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

      // Mostrar valor total em destaque pra planos > 1 mes
      const isMultiMonth = plan.durationMonths > 1;
      const totalDisplay = (finalPrice / 100).toFixed(0);
      const perMonthDisplay = (hasDiscount || hasCredit) ? finalPerMonth : plan.pricePerMonth;
      const periodLabel = isMultiMonth
        ? (plan.durationMonths >= 36 ? 'total' : `/ ${plan.durationMonths} meses`)
        : '/mes';
      const amountDisplay = isMultiMonth ? totalDisplay : perMonthDisplay;
      const perMonthRef = isMultiMonth
        ? `R$ ${perMonthDisplay}/mes${plan.savings && !hasDiscount && !hasCredit ? ' — ' + plan.savings : ''}`
        : '';

      card.innerHTML = `
        ${isHighlighted ? '<div class="plan-badge">' + (hasCredit ? 'Upgrade' : 'Mais Popular') + '</div>' : ''}
        <span class="plan-name">${plan.durationMonths >= 36 ? plan.displayName + ' — 3 Anos' : plan.displayName}</span>
        ${(hasDiscount || hasCredit) && isMultiMonth ? `<div class="plan-original-price">R$ ${(originalPrice / 100).toFixed(0)}</div>` : ''}
        ${(hasDiscount || hasCredit) && !isMultiMonth ? `<div class="plan-original-price">R$ ${plan.pricePerMonth}/mes</div>` : ''}
        <div class="plan-price">
          <span class="plan-currency">R$</span>
          <span class="plan-amount">${amountDisplay}</span>
          <span class="plan-period">${periodLabel}</span>
        </div>
        ${savingsText ? `<span class="plan-savings">${savingsText}</span>` : ''}
        ${perMonthRef ? `<span class="plan-total">${perMonthRef}</span>` : '<span class="plan-total">&nbsp;</span>'}
        <ul class="plan-features">
          <li>Acesso completo a todos os ritmos</li>
          <li>Acompanhamento ao vivo com viradas e finalizações</li>
          <li>Pedal Bluetooth</li>
          <li>Repertório e ritmos personalizados</li>
          <li>Modo offline</li>
          <li>Ritmos novos toda semana</li>
          ${plan.durationMonths >= 6 ? '<li>Suporte prioritário</li>' : ''}
          ${plan.durationMonths >= 36 ? '<li>Pague uma vez, toque por 3 anos</li>' : ''}
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
      if (!user) { internalNav('/login'); return; }

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

      // Salvar pedido pendente no banco
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
      } else if (this.appliedCoupon) {
        // Pedido pendente já existe mas agora tem cupom — atualizar
        await supabase.from('gdrums_transactions')
          .update({
            coupon_code: this.appliedCoupon.code,
            discount_percent: this.appliedCoupon.discount_percent,
            amount_cents: finalPriceCents,
          })
          .eq('order_nsu', existingPending.order_nsu);
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
