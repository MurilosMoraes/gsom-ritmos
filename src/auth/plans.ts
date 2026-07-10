// Plan selection page with coupon support

import { authService } from './AuthService';
import { supabase } from './supabase';
import { PLANS, generateOrderNsu, createCheckoutLink } from './PaymentService';
import type { Plan } from './PaymentService';
import { internalNav, isIOSNative } from '../native/Platform';
import { purchasePlan as iapPurchase, restorePurchases as iapRestore, loadProducts as iapLoadProducts } from '../native/IAPService';
import { redirectIfRecoveryHash } from './recoveryGuard';
import { t } from '../i18n';

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
      this.showAlert(t('plans.upgrade.title'));
    } else if (isRenew && plan && plan !== 'trial') {
      // Renovação proativa (assinante pago veio antes de vencer)
      const planLabel = (PLANS.find(p => p.id === plan)?.name) || plan;
      const daysToExp = profile?.subscription_expires_at
        ? Math.ceil((new Date(profile.subscription_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : 0;
      const venceMsg = daysToExp <= 0
        ? t('plans.renew.expiresToday')
        : daysToExp === 1
          ? t('plans.renew.expiresTomorrow')
          : t('plans.renew.expiresInDays', { days: daysToExp });
      this.showAlert(t('plans.renew.message', { plan: planLabel, msg: venceMsg }));
    } else if (status === 'expired' || (status === 'trial' && profile?.subscription_expires_at && new Date(profile.subscription_expires_at) <= new Date())) {
      this.showAlert(t('plans.alert.expired'));
    }

    // Crédito de upgrade (proporcional ao tempo não usado do plano atual)
    const creditParam = parseInt(params.get('credit') || '0');
    if (isUpgrade && creditParam > 0) {
      this.upgradeCredit = creditParam;
    }

    this.setupCoupon();
    this.setupIAPRestore();
    // Renovação destaca o plano atual; upgrade respeita ?plan=X; default usa o "popular"
    const highlightPlan = isRenew && plan && plan !== 'trial'
      ? plan
      : params.get('plan');
    this.renderPlans(highlightPlan);

    // Pré-carrega produtos da App Store em background pra acelerar o
    // primeiro tap (a Apple às vezes demora 1-2s na 1ª query).
    if (isIOSNative()) {
      iapLoadProducts().catch(() => {});
    }
  }

  // ─── Restore Purchases (Apple obriga visível) ───────────────────────
  //
  // Apple Review Guideline 3.1.1: apps com IAP DEVEM ter botão pra
  // restaurar compras (caso user reinstale, troque de device, etc).
  // Renderiza um link discreto abaixo da grade de planos, só no iOS.

  private setupIAPRestore(): void {
    if (!isIOSNative()) return;

    // Container existente — adiciona após a grade de planos
    const grid = document.getElementById('plansGrid');
    if (!grid) return;

    let restoreEl = document.getElementById('iapRestoreLink');
    if (!restoreEl) {
      restoreEl = document.createElement('div');
      restoreEl.id = 'iapRestoreLink';
      restoreEl.style.cssText = 'text-align:center;margin-top:1.5rem;font-size:0.85rem;';
      restoreEl.innerHTML = `
        <a href="#" style="color:rgba(255,255,255,0.6);text-decoration:underline;">
          ${t('plans.iap.restoreLink')}
        </a>
      `;
      grid.parentElement?.insertBefore(restoreEl, grid.nextSibling);
    }

    const link = restoreEl.querySelector('a');
    link?.addEventListener('click', async (e) => {
      e.preventDefault();
      const loading = document.getElementById('plansLoading');
      if (loading) loading.classList.add('active');

      const result = await iapRestore();

      if (loading) loading.classList.remove('active');

      if (result.success) {
        window.location.href = '/payment-success.html?ios_iap=1&restore=1';
      } else {
        this.showAlert(result.error || t('plans.iap.restoreNotFound'));
      }
    });

    // Apple Guideline 3.1.2: apps com assinatura auto-renovável DEVEM
    // mostrar dentro do app os termos + links funcionais de EULA e
    // Política de Privacidade. EULA padrão Apple (não link externo de
    // compra → não viola 3.1.1).
    if (!document.getElementById('iapSubTerms')) {
      const terms = document.createElement('div');
      terms.id = 'iapSubTerms';
      terms.style.cssText = 'max-width:420px;margin:1.25rem auto 0;padding:0 1rem;text-align:center;font-size:0.72rem;line-height:1.5;color:rgba(255,255,255,0.45);';
      terms.innerHTML = `
        <p style="margin:0 0 0.6rem;">
          ${t('plans.iap.subscriptionTerms')}
        </p>
        <p style="margin:0;">
          <a href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"
             style="color:rgba(255,255,255,0.6);text-decoration:underline;">${t('plans.iap.eulaLink')}</a>
          &nbsp;·&nbsp;
          <a href="/privacy.html"
             style="color:rgba(255,255,255,0.6);text-decoration:underline;">${t('plans.iap.privacyLink')}</a>
        </p>
      `;
      restoreEl.parentElement?.insertBefore(terms, restoreEl.nextSibling);
    }
  }

  // ─── Cupom ──────────────────────────────────────────────────────────

  private setupCoupon(): void {
    const input = document.getElementById('couponInput') as HTMLInputElement;
    const btn = document.getElementById('couponBtn') as HTMLButtonElement;

    if (!input || !btn) return;

    // App Store Review Guideline 3.1.1: pagamento iOS DEVE usar IAP, e
    // a Apple não permite cupons/desconto fora do StoreKit. Esconder
    // toda a UI de cupom quando rodando no app iOS nativo.
    if (isIOSNative()) {
      const couponSection = document.getElementById('couponSection');
      if (couponSection) couponSection.style.display = 'none';
      return;
    }

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
      status.textContent = t('plans.coupon.emptyCode');
      status.className = 'coupon-status error';
      return;
    }

    btn.disabled = true;
    status.textContent = t('plans.coupon.checking');
    status.className = 'coupon-status';

    // Validar via RPC — retorna só campos mínimos se o cupom for válido
    // (ativo, na janela, com usos disponíveis). Evita expor tabela inteira pro anon.
    const { data: rpcRows, error: rpcErr } = await supabase
      .rpc('validate_coupon', { coupon_code: code });

    btn.disabled = false;

    const coupon = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;

    if (rpcErr || !coupon) {
      status.textContent = t('plans.coupon.invalid');
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
    badge.innerHTML = `${t('plans.coupon.badge', { code: coupon.code, percent: coupon.discount_percent })} <button id="removeCoupon">&times;</button>`;
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

    // No iOS, esconder planos sem IAP correspondente (hideOnIOS): a Apple
    // exige que TODO plano exibido tenha produto IAP submetido, senão
    // rejeição 2.1. Hoje: Rei dos Palcos e Modo Show 3 Dias (só web/Android).
    const visiblePlans = isIOSNative()
      ? PLANS.filter(p => !p.hideOnIOS)
      : PLANS;

    visiblePlans.forEach(plan => {
      const isHighlighted = plan.popular || highlight === plan.id;
      const card = document.createElement('div');
      card.className = 'plan-card' + (isHighlighted ? ' popular' : '');

      const discount = this.appliedCoupon?.discount_percent || 0;
      const hasDiscount = discount > 0;
      const originalPrice = plan.priceCents;
      const hasCredit = this.upgradeCredit > 0;

      // ORDEM IMPORTA: em upgrade, primeiro desconta o crédito (dinheiro
      // que o user "já tinha"), depois aplica cupom sobre o valor a pagar.
      //
      // Caso o cupom fosse aplicado ANTES (regra antiga e bugada):
      //   trimestral (R$ 81) → semestral (R$ 144) com cupom 50%
      //   - cupom 50% sobre R$ 144 = R$ 72 desconto → preço fica R$ 72
      //   - crédito R$ 74,70 → preço fica R$ 0 (saiu de graça, perdemos $)
      //
      // Ordem correta:
      //   - crédito R$ 74,70 sobre R$ 144 → diferença R$ 69,30
      //   - cupom 50% sobre R$ 69,30 = R$ 34,65 desconto
      //   - paga R$ 34,65 (justo: ele tinha crédito, ganhou + 50% no resto)
      let finalPrice = originalPrice;
      const creditApplied = hasCredit ? Math.min(this.upgradeCredit, finalPrice) : 0;
      finalPrice = Math.max(0, finalPrice - creditApplied);
      if (hasDiscount) {
        finalPrice = Math.round(finalPrice * (1 - discount / 100));
      }

      const finalPerMonth = plan.durationMonths > 0
        ? Math.round(finalPrice / plan.durationMonths / 100)
        : Math.round(finalPrice / 100);

      // Texto de economia
      let savingsText = '';
      if (hasCredit && creditApplied > 0) {
        const creditDisplay = (creditApplied / 100).toFixed(0);
        savingsText = t('plans.card.creditApplied', { amount: creditDisplay });
      } else if (hasDiscount) {
        savingsText = t('plans.card.discountApplied', { percent: discount });
      } else if (plan.savings) {
        savingsText = plan.savings;
      }

      // Plano de DIAS (Modo Show 3 Dias): valor total em destaque, sem /mês.
      const isDayPlan = !!(plan.durationDays && plan.durationDays > 0);
      // Mostrar valor total em destaque pra planos > 1 mes (ou plano de dias)
      const isMultiMonth = plan.durationMonths > 1;
      const totalDisplay = (finalPrice / 100).toFixed(2).replace('.', ',').replace(',00', '');
      const perMonthDisplay = (hasDiscount || hasCredit) ? finalPerMonth : plan.pricePerMonth;
      const periodLabel = isDayPlan
        ? `/ ${plan.durationDays} dias`
        : isMultiMonth
          ? (plan.durationMonths >= 36 ? 'total' : `/ ${plan.durationMonths} meses`)
          : '/mes';
      const amountDisplay = (isMultiMonth || isDayPlan) ? totalDisplay : perMonthDisplay;
      const perMonthRef = isMultiMonth
        ? `R$ ${perMonthDisplay}/mes${plan.savings && !hasDiscount && !hasCredit ? ' — ' + plan.savings : ''}`
        : '';

      card.innerHTML = `
        ${isHighlighted ? '<div class="plan-badge">' + (hasCredit ? t('plans.card.badgeUpgrade') : t('plans.card.badgeMostPopular')) + '</div>' : ''}
        <span class="plan-name">${plan.durationMonths >= 36 ? plan.displayName + t('plans.card.years3Suffix') : plan.displayName}</span>
        ${plan.tagline ? `<div class="plan-tagline">${plan.tagline}</div>` : ''}
        ${(hasDiscount || hasCredit) && (isMultiMonth || isDayPlan) ? `<div class="plan-original-price">R$ ${(originalPrice / 100).toFixed(2).replace('.', ',').replace(',00', '')}</div>` : ''}
        ${(hasDiscount || hasCredit) && !isMultiMonth && !isDayPlan ? `<div class="plan-original-price">R$ ${plan.pricePerMonth}/mes</div>` : ''}
        <div class="plan-price">
          <span class="plan-currency">R$</span>
          <span class="plan-amount">${amountDisplay}</span>
          <span class="plan-period">${periodLabel}</span>
        </div>
        ${savingsText ? `<span class="plan-savings">${savingsText}</span>` : ''}
        ${perMonthRef ? `<span class="plan-total">${perMonthRef}</span>` : '<span class="plan-total">&nbsp;</span>'}
        <ul class="plan-features">
          ${isDayPlan ? `
          <li>${t('plans.features.dayAccess', { days: plan.durationDays! })}</li>
          <li>${t('plans.features.dayAllRhythms')}</li>
          <li>${t('plans.features.dayLiveTracking')}</li>
          <li>${t('plans.features.dayPedalRepertoire')}</li>
          <li>${t('plans.features.dayWeekendIdeal')}</li>
          ` : `
          <li>${t('plans.features.fullAccess')}</li>
          <li>${t('plans.features.fullLiveTracking')}</li>
          <li>${t('plans.features.fullPedal')}</li>
          <li>${t('plans.features.fullRepertoire')}</li>
          <li>${t('plans.features.fullOffline')}</li>
          <li>${t('plans.features.fullNewRhythms')}</li>
          ${plan.durationMonths >= 6 ? `<li>${t('plans.features.fullPrioritySupport')}</li>` : ''}
          ${plan.durationMonths >= 36 ? `<li>${t('plans.features.fullPayOnce3Years')}</li>` : ''}
          `}
        </ul>
        <button class="plan-btn" data-plan="${plan.id}">${hasCredit ? t('plans.card.btnUpgradeTo') : t('plans.card.btnSubscribe')} ${plan.displayName}</button>
      `;

      card.querySelector('.plan-btn')!.addEventListener('click', () => this.selectPlan(plan, finalPrice));
      grid.appendChild(card);
    });
  }

  // ─── Selecionar plano ───────────────────────────────────────────────

  private async selectPlan(plan: Plan, finalPriceCents: number): Promise<void> {
    const loading = document.getElementById('plansLoading');
    if (loading) loading.classList.add('active');

    // iOS nativo: pagamento via Apple IAP (StoreKit). Sem cupom, sem
    // crédito de upgrade — Apple gerencia tudo. Compliance Guideline 3.1.1.
    if (isIOSNative()) {
      try {
        const result = await iapPurchase(plan.id);
        if (loading) loading.classList.remove('active');

        if (result.canceled) {
          // User fechou o sheet — silencioso, sem alerta.
          return;
        }
        if (!result.success) {
          this.showAlert(result.error || t('plans.iap.purchaseError'));
          return;
        }
        // Sucesso: backend já atualizou o profile. Redireciona pro app.
        window.location.href = '/payment-success.html?ios_iap=1';
      } catch (e) {
        if (loading) loading.classList.remove('active');
        this.showAlert(t('plans.iap.purchaseError'));
      }
      return;
    }

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
        this.showAlert(result.error || t('plans.checkout.genericError'));
      }
    } catch {
      if (loading) loading.classList.remove('active');
      this.showAlert(t('plans.checkout.processError'));
    }
  }

  private showAlert(message: string): void {
    const alert = document.getElementById('alertBar');
    if (alert) { alert.textContent = message; alert.style.display = 'block'; }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  if (redirectIfRecoveryHash()) return;
  new PlansPage();
});
