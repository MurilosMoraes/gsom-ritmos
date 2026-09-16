// Plan selection page with coupon support

import { authService } from './AuthService';
import { supabase } from './supabase';
import { PLANS, generateOrderNsu, createCheckoutLink } from './PaymentService';
import type { Plan } from './PaymentService';
import { internalNav, isIOSNative, appHome } from '../native/Platform';
import { purchasePlan as iapPurchase, restorePurchases as iapRestore, loadProducts as iapLoadProducts } from '../native/IAPService';
import { redirectIfRecoveryHash } from './recoveryGuard';
import { initDeepLinks } from '../native/DeepLinks';
import { markAwaitingPayment } from './paymentSync';
import { t, hydrate, getLocale } from '../i18n';
import {
  readPlansIntent, isPaidActive, hasAppAccess, computeFinalPrice, loginPathWithNext,
  clearPendingNext, deviceStore,
  type ProfileLike,
} from './plansRouting';
import { buildPlanOffer, type PlanOffer, type OfferItem, type OfferSectionKey } from './planOffer';

/** dd/mm/aaaa no idioma do app. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(getLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Centavos → '74,70' / '144' (sem ',00'). */
function money(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',').replace(',00', '');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// Hidrata o HTML estático (data-i18n) ANTES de qualquer render dinâmico —
// pra pt-BR é no-op visual (valores byte-idênticos ao HTML).
hydrate();

interface AppliedCoupon {
  code: string;
  discount_percent: number;
  /** Planos em que o cupom vale. Vazio/ausente = todos. */
  planos?: string[];
}

class PlansPage {
  private appliedCoupon: AppliedCoupon | null = null;
  // Perfil lido no init. Base do crédito de upgrade (calculado por plano,
  // igual ao create-checkout; ver plansRouting.computeUpgradeCredit).
  private profile: ProfileLike | null = null;
  // O que a tela oferece pra ESTE cliente (ver planOffer.ts).
  private offer: PlanOffer | null = null;
  // Passe 3 Dias é COMPRA ÚNICA por pessoa (1x por CPF). Quem já usou não
  // vê mais o plano. Motivo: virou assinatura barata infinita — 18 contas
  // recompraram (uma delas 5x), trocando o mensal de R$29 por R$9,90
  // repetidos. Isso aqui só esconde da tela; a trava de verdade está na
  // edge function create-checkout, que recusa gerar o link de pagamento.
  private jaUsouPasse = false;

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    // Logout
    document.getElementById('plansLogoutBtn')?.addEventListener('click', async () => {
      // Saída intencional: nada de voltar pros planos no próximo login.
      clearPendingNext(deviceStore());
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

    // Sem sessão: vai pro login e VOLTA pra cá com a mesma query (renew,
    // upgrade, cupom, ref). Sem isso o login mandava assinante ativo pra
    // home e a renovação morria (caso típico: Android paga no Chrome, onde
    // o cliente quase nunca está logado).
    const loginPath = loginPathWithNext(window.location.pathname + window.location.search);
    if (!(await authService.isAuthenticated())) {
      // Tentar refresh antes de desistir
      try {
        const { error } = await supabase.auth.refreshSession();
        if (error) {
          internalNav(loginPath);
          return;
        }
      } catch {
        internalNav(loginPath);
        return;
      }
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { internalNav(loginPath); return; }

    // Chegou logado no destino: a intenção guardada pelo login está
    // cumprida. Uso único, não pode puxar o próximo login pra cá.
    clearPendingNext(deviceStore());

    const { data: profile } = await supabase
      .from('gdrums_profiles')
      .select('subscription_status, subscription_expires_at, subscription_plan')
      .eq('id', user.id)
      .single();
    this.profile = profile;
    this.setupBackToApp(profile);

    // Passe 3 Dias já usado? Se sim, some da lista (compra única por pessoa).
    // Falha de rede aqui NÃO libera o plano indevidamente: o create-checkout
    // recusa do mesmo jeito, então o pior caso é o card aparecer e o
    // pagamento ser barrado com mensagem clara.
    try {
      const { data: passes } = await supabase
        .from('gdrums_transactions')
        .select('id')
        .eq('user_id', user.id)
        .eq('plan', 'passe-3-dias')
        .eq('status', 'confirmed')
        .limit(1);
      this.jaUsouPasse = !!(passes && passes.length > 0);
    } catch { /* sem rede: mantém visível, backend barra */ }

    // Assinatura atual veio da App Store? (order_nsu apple_iap_*). Aí a
    // Apple renova sozinha e a tela não oferece "renovar". Só importa no iOS.
    let appleManaged = false;
    if (isIOSNative()) {
      try {
        const { data: lastTx } = await supabase
          .from('gdrums_transactions')
          .select('order_nsu')
          .eq('user_id', user.id)
          .eq('status', 'confirmed')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        appleManaged = !!lastTx?.order_nsu?.startsWith('apple_iap_');
      } catch { /* sem rede: oferece renovar; StoreKit avisa se já assinado */ }
    }

    const status = profile?.subscription_status;

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
            // Só sai daqui se o perfil REALMENTE ficou pago e válido. Um
            // "success" que não estendeu a validade mandava pra home, a home
            // devolvia pros planos, e o cliente ficava em loop sem conseguir
            // pagar.
            const { data: fresh } = await supabase
              .from('gdrums_profiles')
              .select('subscription_status, subscription_expires_at, subscription_plan')
              .eq('id', user.id)
              .single();
            if (isPaidActive(fresh, new Date())) {
              internalNav(appHome());
              return;
            }
          }
        } catch { /* continuar normalmente */ }
      }
    }

    // Assinante pago ativo NUNCA é mandado pra home daqui: se ele chegou nos
    // planos (push de renovação, botão do app, link com cupom), é pra
    // pagar. O QUE oferecer (renovar, upgrade, assinar) sai de buildPlanOffer.
    const intent = readPlansIntent(window.location.search);
    this.offer = buildPlanOffer({
      profile,
      intent,
      catalog: PLANS,
      ios: isIOSNative(),
      passUsed: this.jaUsouPasse,
      appleManaged,
      now: new Date(),
    });

    this.renderHero();
    this.renderCurrentPlan();
    if (status === 'trial' && this.offer.state === 'subscribe' && this.offer.daysLeft !== null && this.offer.daysLeft <= 0) {
      this.showAlert(t('plans.alert.expired'));
    }

    this.setupCoupon(intent.coupon, intent.ref);
    this.setupTrust();
    this.setupIAPRestore();
    this.renderPlans();

    // Pré-carrega produtos da App Store em background pra acelerar o
    // primeiro tap (a Apple às vezes demora 1-2s na 1ª query).
    if (isIOSNative()) {
      iapLoadProducts().catch(() => {});
    }
  }

  // ─── Voltar pro app ─────────────────────────────────────────────────
  //
  // Quem ainda tem acesso (pago ou trial válido) e abriu os planos por um
  // link/push precisa de uma saída que não seja "Sair" (logout). No app
  // nativo não existe barra de voltar. Sem acesso o botão não aparece: o
  // app devolveria o cliente pra cá e viraria loop.

  private setupBackToApp(profile: ProfileLike | null): void {
    if (!hasAppAccess(profile, new Date())) return;
    if (document.getElementById('plansBackBtn')) return;
    const actions = document.querySelector('.plans-top-actions');
    if (!actions) return;

    const btn = document.createElement('button');
    btn.id = 'plansBackBtn';
    btn.type = 'button';
    btn.className = 'plans-logout-btn';
    btn.textContent = t('plans.backToApp');
    btn.addEventListener('click', () => {
      clearPendingNext(deviceStore());
      internalNav(appHome());
    });
    actions.insertBefore(btn, actions.firstChild);
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

  private setupCoupon(fromCouponParam: string | null, fromRefParam: string | null): void {
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
    // 1. ?coupon=X ou ?cupom=X (ConversionManager, pushes do admin)
    // 2. ?ref=X     (link de afiliado direto — gdrums.com.br/plans?ref=LUCAS10)
    // 3. localStorage 'gdrums-attr-v1' — se user veio de afiliado há N dias,
    //    o cupom do afiliado é aplicado no checkout AUTOMATICAMENTE.
    //    Double-sided discount: user ganha desconto, afiliado ganha comissão.
    //    Padrão da indústria (UpPromote, Thinkific, Partnero, Rewardful).
    (async () => {
      // 1. Cupom explícito na URL (já normalizado por readPlansIntent)
      if (fromCouponParam) {
        input.value = fromCouponParam;
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
      this.renderPlans();
      return;
    }

    // Cupom válido!
    this.appliedCoupon = {
      code: coupon.code,
      discount_percent: coupon.discount_percent,
      planos: Array.isArray(coupon.planos) ? coupon.planos : [],
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
      this.renderPlans();
    });

    input.value = '';
    this.renderPlans();
  }

  // ─── Topo da tela (título conforme a situação) ──────────────────────

  private renderHero(): void {
    const offer = this.offer;
    if (!offer) return;
    const primary = offer.sections[0]?.key;
    let key: string | null = null;
    if (offer.state === 'active') key = primary === 'upgrade' ? 'upgrade' : 'renew';
    else if (offer.state === 'expired') key = 'expired';
    else if (offer.state === 'active-pass') key = 'pass';
    if (!key) return; // quem vai assinar: texto padrão do HTML

    const title = document.querySelector('.plans-title');
    const subtitle = document.querySelector('.plans-subtitle');
    if (title) title.textContent = t(`plans.hero.${key}Title`);
    if (subtitle) subtitle.textContent = t(`plans.hero.${key}Subtitle`);
  }

  // ─── Painel "Seu plano" ─────────────────────────────────────────────

  private renderCurrentPlan(): void {
    const offer = this.offer;
    const box = document.getElementById('plansCurrent');
    if (!offer || !box) return;
    if (offer.state === 'subscribe' || !offer.currentPlanId || !offer.expiresAt) return;

    const plan = PLANS.find(p => p.id === offer.currentPlanId);
    const name = plan?.displayName || offer.currentPlanId;
    const date = formatDate(offer.expiresAt);
    const days = offer.daysLeft ?? 0;
    let line: string;
    let tone = 'ok';
    if (offer.state === 'expired') { line = t('plans.current.expiredOn', { date }); tone = 'danger'; }
    else if (days <= 0) { line = t('plans.current.expiresToday', { date }); tone = 'warn'; }
    else if (days === 1) { line = t('plans.current.expiresTomorrow', { date }); tone = 'warn'; }
    else {
      line = t('plans.current.expiresIn', { date, days });
      if (days <= 7) tone = 'warn';
    }

    box.innerHTML = `
      <div class="plans-current-main">
        <span class="plans-current-label">${t('plans.current.label')}</span>
        <strong class="plans-current-name">${escapeHtml(name)}</strong>
      </div>
      <span class="plans-current-status is-${tone}">${line}</span>
    `;
    box.hidden = false;
  }

  // ─── Selos de confiança (fora do iOS: lá a compra é pela Apple) ─────

  private setupTrust(): void {
    if (!isIOSNative()) {
      const trust = document.getElementById('plansTrust');
      if (trust) trust.hidden = false;
      return;
    }
    // iOS: nada de mencionar InfinitePay/Pix (Apple 3.1.1).
    document.querySelector('.plans-footer')?.remove();
  }

  // ─── Renderizar planos ──────────────────────────────────────────────

  private renderPlans(): void {
    const grid = document.getElementById('plansGrid');
    const offer = this.offer;
    if (!grid || !offer) return;
    grid.innerHTML = '';

    // Nada a vender (topo da hierarquia, ou assinatura da Apple no topo).
    if (offer.sections.length === 0) {
      grid.appendChild(this.noteBox(offer.appleManaged ? t('plans.apple.managed') : t('plans.top.message')));
      return;
    }

    offer.sections.forEach((section, index) => {
      const el = document.createElement('section');
      el.className = 'plans-section' + (index === 0 ? ' is-primary' : ' is-secondary');
      const heading = document.createElement('h2');
      heading.className = 'plans-section-title';
      heading.textContent = this.sectionTitle(section.key, index === 0);
      el.appendChild(heading);

      const cards = document.createElement('div');
      cards.className = 'plans-cards' + (section.items.length === 1 ? ' is-single' : '');
      section.items.forEach(item => {
        const plan = PLANS.find(p => p.id === item.planId);
        if (plan) cards.appendChild(this.buildCard(plan, item, index === 0));
      });
      el.appendChild(cards);
      grid.appendChild(el);
    });

    // Assinatura da Apple com upgrade disponível: explica por que não tem "renovar".
    if (offer.appleManaged) grid.appendChild(this.noteBox(t('plans.apple.managed')));
  }

  private sectionTitle(key: OfferSectionKey, primary: boolean): string {
    if (key === 'choose') return t('plans.section.choose');
    if (primary) return t(key === 'renew' ? 'plans.section.renew' : 'plans.section.upgrade');
    return t(key === 'renew' ? 'plans.section.orRenew' : 'plans.section.orUpgrade');
  }

  private noteBox(text: string): HTMLElement {
    const note = document.createElement('p');
    note.className = 'plans-note';
    note.textContent = text;
    return note;
  }

  private buildCard(plan: Plan, item: OfferItem, primarySection: boolean): HTMLElement {
    const offer = this.offer!;
    const highlighted = item.recommended && primarySection;
    const card = document.createElement('div');
    card.className = 'plan-card' + (highlighted ? ' popular' : '') + ` is-${item.kind}`;

    // Cupom restrito a plano: o desconto so aparece nos planos em que ele
    // vale. Lista vazia = vale em todos (comportamento historico). O
    // create-checkout barra de novo no servidor, isso aqui e so a vitrine
    // (mostrar preco com desconto num plano que o backend vai recusar
    // seria enganar o cliente na hora de pagar).
    const planosDoCupom = this.appliedCoupon?.planos || [];
    const cupomValeNestePlano = planosDoCupom.length === 0 || planosDoCupom.includes(plan.id);
    const discount = cupomValeNestePlano ? (this.appliedCoupon?.discount_percent || 0) : 0;
    const hasDiscount = discount > 0;
    const originalPrice = plan.priceCents;

    // Crédito: vem da oferta (mesma conta do create-checkout; 0 no iOS).
    // ORDEM IMPORTA: primeiro o crédito, depois o cupom sobre o resto.
    // Cupom antes do crédito deixava upgrade sair de graça.
    const upgradeCredit = item.creditCents;
    const hasCredit = upgradeCredit > 0;
    const creditApplied = Math.min(upgradeCredit, originalPrice);
    const finalPrice = computeFinalPrice(originalPrice, upgradeCredit, discount);

    // Mensal com desconto mostra centavos (R$ 23,20, não R$ 23): é o valor
    // cobrado. Planos longos: referência por mês arredondada.
    const finalPerMonth = plan.durationMonths === 1
      ? money(finalPrice)
      : String(Math.round(finalPrice / Math.max(1, plan.durationMonths) / 100));

    // Plano de DIAS (Modo Show 3 Dias): valor total em destaque, sem /mês.
    const isDayPlan = !!(plan.durationDays && plan.durationDays > 0);
    const isMultiMonth = plan.durationMonths > 1;
    const totalDisplay = money(finalPrice);
    const perMonthDisplay = (hasDiscount || hasCredit) ? finalPerMonth : plan.pricePerMonth;
    const periodLabel = isDayPlan
      ? `/ ${plan.durationDays} dias`
      : isMultiMonth
        ? (plan.durationMonths >= 36 ? 'total' : `/ ${plan.durationMonths} meses`)
        : '/mês';
    const amountDisplay = (isMultiMonth || isDayPlan) ? totalDisplay : perMonthDisplay;
    const perMonthRef = isMultiMonth ? `R$ ${perMonthDisplay}/mês` : '';

    // Linha de destaque do preço
    let savingsText = '';
    if (hasCredit && creditApplied > 0) {
      const days = Math.max(0, offer.daysLeft ?? 0);
      savingsText = t('plans.card.creditDays', { amount: money(creditApplied), days });
    } else if (hasDiscount) {
      savingsText = t('plans.card.discountApplied', { percent: discount });
    } else if (plan.savings) {
      savingsText = plan.savings;
    }

    // Selo
    let badge = '';
    if (item.kind === 'renew') badge = t('plans.card.badgeCurrent');
    else if (highlighted && item.kind === 'upgrade') badge = t('plans.card.badgeRecommended');
    else if (highlighted && offer.state === 'expired' && plan.id === offer.currentPlanId) badge = t('plans.card.badgeComeback');
    else if (highlighted) badge = plan.popular ? t('plans.card.badgeMostPopular') : t('plans.card.badgeRecommended');

    // O que muda pro cliente (renovar/upgrade): novo vencimento e economia.
    const facts: string[] = [];
    if (item.kind === 'renew') facts.push(t('plans.card.renewKeepsDays'));
    if (item.kind === 'upgrade') {
      const current = PLANS.find(p => p.id === offer.currentPlanId);
      if (current && current.durationMonths > 0 && plan.durationMonths > 0) {
        const diff = Math.round((current.priceCents / current.durationMonths - plan.priceCents / plan.durationMonths) / 100);
        if (diff >= 1) facts.push(t('plans.card.cheaperPerMonth', { amount: diff, plan: current.displayName }));
      }
    }
    if (item.kind !== 'new' && item.newExpiresAt) {
      facts.push(t('plans.card.newExpiry', { date: formatDate(item.newExpiresAt) }));
    }

    // Benefícios: lista completa pra quem vai assinar; pra quem já é
    // cliente, só o que o plano novo acrescenta (ele já conhece o resto).
    const features: string[] = [];
    if (item.kind === 'new') {
      if (isDayPlan) {
        features.push(
          t('plans.features.dayAccess', { days: plan.durationDays! }),
          t('plans.features.dayAllRhythms'),
          t('plans.features.dayLiveTracking'),
          t('plans.features.dayPedalRepertoire'),
          t('plans.features.dayWeekendIdeal'),
        );
      } else {
        features.push(
          t('plans.features.fullAccess'),
          t('plans.features.fullLiveTracking'),
          t('plans.features.fullPedal'),
          t('plans.features.fullRepertoire'),
          t('plans.features.fullOffline'),
          t('plans.features.fullNewRhythms'),
        );
      }
    }
    if (item.kind !== 'renew' && !isDayPlan) {
      if (plan.durationMonths >= 6) features.push(t('plans.features.fullPrioritySupport'));
      if (plan.durationMonths >= 36) features.push(t('plans.features.fullPayOnce3Years'));
    }

    const name = plan.durationMonths >= 36 ? plan.displayName + t('plans.card.years3Suffix') : plan.displayName;
    let btnLabel: string;
    if (item.kind === 'renew') btnLabel = t('plans.card.btnRenew', { plan: plan.displayName });
    else if (item.kind === 'upgrade') btnLabel = t('plans.card.btnUpgrade', { plan: plan.displayName });
    else if (offer.state === 'expired' && plan.id === offer.currentPlanId) btnLabel = t('plans.card.btnComeback', { plan: plan.displayName });
    else btnLabel = `${t('plans.card.btnSubscribe')} ${plan.displayName}`;

    card.innerHTML = `
      ${badge ? `<div class="plan-badge">${badge}</div>` : ''}
      <span class="plan-name">${name}</span>
      ${plan.tagline && item.kind === 'new' ? `<div class="plan-tagline">${plan.tagline}</div>` : ''}
      ${(hasDiscount || hasCredit) ? `<div class="plan-original-price">R$ ${(isMultiMonth || isDayPlan) ? money(originalPrice) : plan.pricePerMonth + '/mês'}</div>` : ''}
      <div class="plan-price">
        <span class="plan-currency">R$</span>
        <span class="plan-amount">${amountDisplay}</span>
        <span class="plan-period">${periodLabel}</span>
      </div>
      ${perMonthRef ? `<span class="plan-total">${perMonthRef}</span>` : ''}
      ${savingsText ? `<span class="plan-savings">${savingsText}</span>` : ''}
      ${facts.length ? `<ul class="plan-facts">${facts.map(f => `<li>${f}</li>`).join('')}</ul>` : ''}
      ${features.length ? `<ul class="plan-features">${features.map(f => `<li>${f}</li>`).join('')}</ul>` : '<div class="plan-spacer"></div>'}
      <button class="plan-btn" data-plan="${plan.id}">${btnLabel}</button>
    `;

    card.querySelector('.plan-btn')!.addEventListener('click', () => this.selectPlan(plan, finalPrice, creditApplied));
    return card;
  }

  // ─── Selecionar plano ───────────────────────────────────────────────

  private async selectPlan(plan: Plan, finalPriceCents: number, creditCents: number): Promise<void> {
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
        upgradeCredit: creditCents,
      }));

      // Criar checkout com preço final (já com desconto)
      const checkoutPlan = { ...plan, priceCents: finalPriceCents, name: plan.name + (this.appliedCoupon ? ` (${this.appliedCoupon.code})` : '') };
      const result = await createCheckoutLink(checkoutPlan, orderNsu, redirectUrl, {
        name: user.user_metadata?.name || '',
        email: user.email || '',
      });

      if (result.success && result.url) {
        // Marca "foi pagar": se voltar pro app sem passar pelo retorno do
        // checkout, o vigia de pagamento reconhece sozinho.
        markAwaitingPayment(deviceStore());
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
  // Link/push aberto com o app já NESTA tela: sem listener aqui o toque
  // não fazia nada (cada .html é um contexto JS separado).
  initDeepLinks();
  new PlansPage();
});
