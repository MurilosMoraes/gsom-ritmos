// Admin Dashboard — chamadas via Edge Function (sem service key no frontend)

import { supabase } from './supabase';
import { ModalManager } from '../ui/ModalManager';

const modalManager = new ModalManager();
const ADMIN_API_URL = 'https://qsfziivubwdgtmwyztfw.supabase.co/functions/v1/admin-api';

interface Profile {
  id: string;
  name: string;
  role: string;
  subscription_status: string;
  subscription_plan: string;
  subscription_expires_at: string | null;
  created_at: string;
  updated_at: string;
  active_session_id: string | null;
  phone: string | null;
  cpf_hash: string | null;
  last_contacted_at: string | null;
  contact_method: string | null;
  email?: string;
}

interface Transaction {
  id: string;
  user_id: string;
  order_nsu: string;
  transaction_nsu: string;
  plan: string;
  amount_cents: number;
  status: string;
  payment_method: string;
  receipt_url: string;
  created_at: string;
  coupon_code: string | null;
}

interface Coupon {
  id: string;
  code: string;
  discount_percent: number;
  max_uses: number;
  current_uses: number;
  valid_from: string;
  valid_until: string;
  active: boolean;
  created_at: string;
}

// ─── Helper: validar telefone BR ───────────────────────────────────
// 82 usuários salvaram phone com prefix "55" (código país) e perderam 2
// dígitos no final. Detectar e mostrar como inválido na UI pra não mandar
// WhatsApp quebrado.
interface PhoneValidation {
  ok: boolean;
  e164?: string;       // "5511999015522" (pronto pra wa.me)
  display?: string;    // "(11) 99901-5522"
  reason?: string;     // motivo da invalidez
}
function validateBrPhone(phone: string | null | undefined): PhoneValidation {
  if (!phone) return { ok: false, reason: 'vazio' };
  const raw = phone.replace(/\D/g, '');
  // Formato salvo correto: 11 dígitos (DDD + 9xxxxxxxx) ou 10 (DDD fixo)
  if (raw.length === 11 && raw[2] === '9') {
    const display = `(${raw.slice(0,2)}) ${raw.slice(2,7)}-${raw.slice(7)}`;
    return { ok: true, e164: `55${raw}`, display };
  }
  if (raw.length === 10) {
    const display = `(${raw.slice(0,2)}) ${raw.slice(2,6)}-${raw.slice(6)}`;
    return { ok: true, e164: `55${raw}`, display };
  }
  // 11 dígitos começando com "55" e 3º dígito não é "9" → prefix de país colado
  // (cadastro antigo perdeu os 2 últimos dígitos). Não tenta corrigir.
  if (raw.length === 11 && raw.startsWith('55')) {
    return { ok: false, reason: 'incompleto (faltam 2 dígitos)' };
  }
  return { ok: false, reason: 'formato inválido' };
}

// ─── Helper: chamar Edge Function admin-api com token do usuário ────

async function getAuthToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || '';
}

async function adminCall(body: Record<string, any>): Promise<any> {
  const token = await getAuthToken();
  const res = await fetch(ADMIN_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro na API admin');
  return data;
}

async function adminFetch(table: string): Promise<any[]> {
  return await adminCall({
    action: 'fetch',
    table,
    params: { select: '*', order: { column: 'created_at', ascending: false } },
  });
}

async function adminUpdate(table: string, id: string, data: Record<string, any>): Promise<void> {
  await adminCall({ action: 'update', table, id, data });
}

async function adminInsert(table: string, data: Record<string, any>): Promise<void> {
  await adminCall({ action: 'insert', table, data });
}

async function adminBanUser(userId: string, ban: boolean): Promise<void> {
  await adminCall({ action: 'ban_user', id: userId, data: { ban } });
}

/**
 * Chama funções agregadas no Postgres (admin_kpi_summary, admin_signup_funnel,
 * admin_medium_funnel). Rápido porque agrega no DB sem puxar linha por linha.
 */
async function adminRpc(rpc: string, rpcArgs?: Record<string, any>): Promise<any> {
  return await adminCall({ action: 'rpc', rpc, rpcArgs: rpcArgs || {} });
}

// ─── Skeleton helpers ────────────────────────────────────────────────

function kpiSkeleton(count = 4): string {
  return Array.from({ length: count }).map(() => `
    <div class="adm-skel-kpi">
      <span class="adm-skel"></span>
      <span class="adm-skel val"></span>
      <span class="adm-skel sub"></span>
    </div>
  `).join('');
}

function funnelSkeleton(rows = 4): string {
  return `<div class="adm-funnel">${Array.from({ length: rows }).map((_, i) => {
    const w = 95 - i * 18;
    return `
      <div class="adm-skel-funnel-step">
        <span class="adm-skel"></span>
        <span class="adm-skel" style="width:${Math.max(w, 20)}%;"></span>
        <span class="adm-skel"></span>
        <span class="adm-skel"></span>
      </div>
    `;
  }).join('')}</div>`;
}

function tableSkeleton(rows = 5): string {
  return `<div class="adm-skel-table">${Array.from({ length: rows }).map(() => `
    <div class="adm-skel-row">
      <span class="adm-skel"></span>
      <span class="adm-skel"></span>
      <span class="adm-skel"></span>
    </div>
  `).join('')}</div>`;
}

function cardSkeleton(lines = 4): string {
  return Array.from({ length: lines }).map(() =>
    `<span class="adm-skel adm-skel-line" style="width:${70 + Math.random() * 25}%;"></span>`
  ).join('');
}

// ─── Delta pill ──────────────────────────────────────────────────────

interface DeltaOpts {
  current: number;
  previous: number;
  isNegativeMetric?: boolean;   // true if "going up" is bad (churn, expired)
  compareLabel?: string;        // "vs 7d"
  format?: 'int' | 'pct' | 'cents';
}

function deltaPill(opts: DeltaOpts): string {
  const { current, previous, isNegativeMetric = false, compareLabel = 'vs anterior', format = 'int' } = opts;
  if (previous <= 0) return `<span class="adm-kpi-sub">${compareLabel}: —</span>`;
  const change = ((current - previous) / previous) * 100;
  const rounded = Math.round(change * 10) / 10;
  let dir: 'up' | 'down' | 'flat' = rounded === 0 ? 'flat' : rounded > 0 ? 'up' : 'down';
  const mod = isNegativeMetric
    ? (dir === 'up' ? ' negative' : dir === 'down' ? ' positive' : '')
    : '';
  const arrow = dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→';
  const abs = Math.abs(rounded);
  const displayPrev = format === 'cents'
    ? `R$ ${(previous / 100).toFixed(0)}`
    : format === 'pct'
    ? `${previous}%`
    : String(previous);
  return `
    <span class="adm-kpi-delta ${dir}${mod}">${arrow} ${abs.toFixed(1)}%</span>
    <span class="adm-kpi-sub">${compareLabel} (${displayPrev})</span>
  `;
}

// ─── Relative time ───────────────────────────────────────────────────

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'nunca';
  const d = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - d;
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (mins < 1) return 'agora mesmo';
  if (mins < 60) return `há ${mins}min`;
  if (hours < 24) return `há ${hours}h`;
  if (days < 30) return `há ${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `há ${months}mês`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

// ─── Empty state ─────────────────────────────────────────────────────

interface EmptyOpts {
  icon?: string;     // SVG path
  title: string;
  desc?: string;
  ctaLabel?: string;
  ctaId?: string;
  inline?: boolean;
}

function emptyState(opts: EmptyOpts): string {
  const icon = opts.icon || `<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>`;
  const cta = opts.ctaLabel && opts.ctaId
    ? `<button class="adm-btn adm-btn-primary" id="${opts.ctaId}">${opts.ctaLabel}</button>`
    : '';
  return `
    <div class="adm-empty${opts.inline ? ' adm-empty-inline' : ''}">
      <svg class="adm-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">${icon}</svg>
      <div class="adm-empty-title">${opts.title}</div>
      ${opts.desc ? `<div class="adm-empty-desc">${opts.desc}</div>` : ''}
      ${cta}
    </div>
  `;
}

// ─── Currency helpers ────────────────────────────────────────────────

const fmtBRL = (cents: number | null | undefined, decimals = 0): string => {
  const v = (cents || 0) / 100;
  return `R$ ${v.toFixed(decimals).replace('.', ',')}`;
};

const fmtBRLFull = (cents: number | null | undefined): string => fmtBRL(cents, 2);

class AdminDashboard {
  private profiles: Profile[] = [];
  private transactions: Transaction[] = [];
  private coupons: Coupon[] = [];
  private demoTotal = 0;
  private demoUnique = 0;
  private currentSection = 'dashboard';
  private userSearch = '';
  private userFilter = 'all';
  private txSearch = '';
  private txFilter = 'all';
  private userPage = 0;
  private txPage = 0;
  private leadsPage = 0;
  private leadsSearch = '';
  private leadsFilter = 'all';
  private readonly PAGE_SIZE = 20;

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.location.href = '/login'; return; }

    // Verificar admin via query direta (RLS libera select do próprio profile).
    // Antes buscava 827 profiles via edge fn e procurava — lento e frágil.
    // A própria edge fn valida role em cada chamada, então mesmo que essa
    // check passe indevidamente (não passa), o backend bloqueia.
    try {
      const { data: myProfile, error } = await supabase
        .from('gdrums_profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      if (error || !myProfile || myProfile.role !== 'admin') {
        console.error('[admin] not admin:', { error, myProfile, userId: user.id });
        window.location.href = '/';
        return;
      }
    } catch (e) {
      console.error('[admin] role check failed:', e);
      window.location.href = '/';
      return;
    }

    const adminName = document.getElementById('adminUserName');
    if (adminName) adminName.textContent = user.user_metadata?.name || 'Admin';

    this.setupEvents();
    this.setupEditForm();
    this.setupCouponForm();
    this.setupAffiliateForm();

    // Render skeletons imediatamente para feedback instantâneo
    this.renderSkeletons();

    // loadData/loadAffiliates podem falhar (edge fn, rede, tabela ausente).
    // NÃO redirecionar — erros só logam. Dashboard parcial é melhor que kick.
    try {
      await this.loadData();
    } catch (e) {
      console.error('[admin] loadData failed:', e);
    }
    try {
      await this.loadAffiliates();
    } catch (e) {
      console.error('[admin] loadAffiliates failed:', e);
    }
    this.render();
  }

  private renderSkeletons(): void {
    const kpiGrid = document.getElementById('kpiGrid');
    if (kpiGrid) kpiGrid.innerHTML = kpiSkeleton(7);
    const acqKpiGrid = document.getElementById('acqKpiGrid');
    if (acqKpiGrid) acqKpiGrid.innerHTML = kpiSkeleton(6);
    ['usersChart', 'regionChart', 'subscriptionsChart', 'dataChart'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = cardSkeleton(4);
    });
    ['acqGlobalFunnel', 'acqSourceTable', 'acqMediumTable', 'acqCampaignTable'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = funnelSkeleton(4);
    });
    const affContent = document.getElementById('affiliatesContent');
    if (affContent) {
      affContent.innerHTML = `<div class="adm-affiliates-grid">${
        Array.from({ length: 2 }).map(() => `
          <div class="adm-aff-card">
            <div class="adm-aff-head">
              <div style="flex:1;">
                <span class="adm-skel" style="width:60%;height:16px;display:block;margin-bottom:0.3rem;"></span>
                <span class="adm-skel" style="width:40%;height:10px;display:block;"></span>
              </div>
              <span class="adm-skel" style="width:70px;height:22px;"></span>
            </div>
            <span class="adm-skel" style="width:100%;height:50px;display:block;"></span>
            <div class="adm-aff-stats">
              <span class="adm-skel" style="height:30px;"></span>
              <span class="adm-skel" style="height:30px;"></span>
              <span class="adm-skel" style="height:30px;"></span>
            </div>
          </div>
        `).join('')
      }</div>`;
    }
  }

  private setupEvents(): void {
    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await supabase.auth.signOut();
      window.location.href = '/login';
    });

    document.querySelectorAll('.adm-nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const section = (item as HTMLElement).dataset.section;
        if (section) this.switchSection(section);
      });
    });

    document.getElementById('userSearchInput')?.addEventListener('input', (e) => {
      this.userSearch = (e.target as HTMLInputElement).value.toLowerCase();
      this.renderUsers();
    });

    document.getElementById('userStatusFilter')?.addEventListener('change', (e) => {
      this.userFilter = (e.target as HTMLSelectElement).value;
      this.renderUsers();
    });

    document.getElementById('subscriptionSearchInput')?.addEventListener('input', (e) => {
      this.txSearch = (e.target as HTMLInputElement).value.toLowerCase();
      this.renderTransactions();
    });

    document.getElementById('subscriptionStatusFilter')?.addEventListener('change', (e) => {
      this.txFilter = (e.target as HTMLSelectElement).value;
      this.renderTransactions();
    });

    // Leads
    document.getElementById('leadsSearchInput')?.addEventListener('input', (e) => {
      this.leadsSearch = (e.target as HTMLInputElement).value.toLowerCase();
      this.leadsPage = 0;
      this.renderLeads();
    });
    document.getElementById('leadsFilter')?.addEventListener('change', (e) => {
      this.leadsFilter = (e.target as HTMLSelectElement).value;
      this.leadsPage = 0;
      this.renderLeads();
    });

    // Refresh
    document.getElementById('refreshDataBtn')?.addEventListener('click', async () => {
      await this.loadData();
      this.render();
      modalManager.show('Admin', 'Dados atualizados!', 'success');
    });
  }

  private async loadData(): Promise<void> {
    this.profiles = await adminFetch('gdrums_profiles');
    this.transactions = await adminFetch('gdrums_transactions');
    this.coupons = await adminFetch('gdrums_coupons');

    // Demo access stats
    try {
      const demoData = await adminFetch('gdrums_demo_access');
      this.demoTotal = demoData.length;
      this.demoUnique = new Set(demoData.map((d: any) => d.fingerprint)).size;
    } catch { /* tabela pode não existir */ }

    // Buscar emails via Edge Function
    try {
      const emails = await adminCall({ action: 'fetch_emails' });
      if (Array.isArray(emails)) {
        emails.forEach((u: { id: string; email: string }) => {
          const p = this.profiles.find(pr => pr.id === u.id);
          if (p) p.email = u.email;
        });
      }
    } catch { /* continuar sem emails */ }
  }

  private switchSection(section: string): void {
    this.currentSection = section;
    document.querySelectorAll('.adm-nav-item').forEach(i => {
      i.classList.toggle('active', (i as HTMLElement).dataset.section === section);
    });
    document.querySelectorAll('.adm-section').forEach(s => s.classList.remove('active'));
    document.getElementById(`${section}Section`)?.classList.add('active');
    this.render();
  }

  private render(): void {
    switch (this.currentSection) {
      case 'dashboard': this.renderDashboard(); break;
      case 'acquisition': this.renderAcquisition(); break;
      case 'users': this.renderUsers(); break;
      case 'subscriptions': this.renderTransactions(); break;
      case 'coupons': this.renderCoupons(); break;
      case 'leads': this.renderLeads(); break;
      case 'affiliates': this.renderAffiliates(); break;
      case 'payouts': this.renderPayouts(); break;
    }
  }

  // ─── Acquisition (funil por origem) ────────────────────────────────

  private acqDaysBack = 30;

  private async renderAcquisition(): Promise<void> {
    const rangeSelect = document.getElementById('acqRangeSelect') as HTMLSelectElement;
    if (rangeSelect && !rangeSelect.dataset.bound) {
      rangeSelect.value = String(this.acqDaysBack);
      rangeSelect.addEventListener('change', () => {
        this.acqDaysBack = parseInt(rangeSelect.value);
        this.renderAcquisition();
      });
      rangeSelect.dataset.bound = '1';
    }

    const refreshBtn = document.getElementById('refreshAcqBtn');
    if (refreshBtn && !refreshBtn.dataset.bound) {
      refreshBtn.addEventListener('click', () => this.renderAcquisition());
      refreshBtn.dataset.bound = '1';
    }

    const kpiGrid = document.getElementById('acqKpiGrid');
    const globalFunnel = document.getElementById('acqGlobalFunnel');
    const sourceTable = document.getElementById('acqSourceTable');
    const mediumTable = document.getElementById('acqMediumTable');
    const campaignTable = document.getElementById('acqCampaignTable');

    // Skeletons enquanto carrega
    if (kpiGrid) kpiGrid.innerHTML = kpiSkeleton(6);
    if (globalFunnel) globalFunnel.innerHTML = funnelSkeleton(3);
    if (sourceTable) sourceTable.innerHTML = funnelSkeleton(4);
    if (mediumTable) mediumTable.innerHTML = funnelSkeleton(4);
    if (campaignTable) campaignTable.innerHTML = funnelSkeleton(5);

    try {
      const [kpi, byS, byM, kpiPrev] = await Promise.all([
        adminRpc('admin_kpi_summary', { days_back: this.acqDaysBack }),
        adminRpc('admin_signup_funnel', { days_back: this.acqDaysBack }),
        adminRpc('admin_medium_funnel', { days_back: this.acqDaysBack }),
        // Período anterior (pra delta) — mesmo tamanho de janela, mas antes
        adminRpc('admin_kpi_summary', { days_back: this.acqDaysBack * 2 }).catch(() => null),
      ]);

      const kpiRow = Array.isArray(kpi) ? kpi[0] : kpi;
      const prevRow = kpiPrev ? (Array.isArray(kpiPrev) ? kpiPrev[0] : kpiPrev) : null;

      // Calcular período anterior (subtrai o atual do total 2× janela)
      const prevDemos = prevRow ? Math.max(0, (prevRow.demos_unicos || 0) - (kpiRow?.demos_unicos || 0)) : 0;
      const prevCadastros = prevRow ? Math.max(0, (prevRow.cadastros || 0) - (kpiRow?.cadastros || 0)) : 0;
      const prevPagos = prevRow ? Math.max(0, (prevRow.pagos || 0) - (kpiRow?.pagos || 0)) : 0;
      const prevReceita = prevRow ? Math.max(0, (prevRow.receita_cents || 0) - (kpiRow?.receita_cents || 0)) : 0;

      const convGlobal = kpiRow && kpiRow.cadastros > 0
        ? +((kpiRow.pagos / kpiRow.cadastros) * 100).toFixed(1)
        : 0;
      const prevConv = prevCadastros > 0
        ? +((prevPagos / prevCadastros) * 100).toFixed(1)
        : 0;

      const rangeLabel = `vs ${this.acqDaysBack}d anteriores`;

      if (kpiGrid) {
        kpiGrid.innerHTML = `
          <div class="adm-kpi">
            <span class="adm-kpi-accent blue"></span>
            <span class="adm-kpi-label">Demos únicos</span>
            <span class="adm-kpi-value">${kpiRow?.demos_unicos ?? 0}</span>
            <div class="adm-kpi-meta">${deltaPill({ current: kpiRow?.demos_unicos ?? 0, previous: prevDemos, compareLabel: rangeLabel })}</div>
          </div>
          <div class="adm-kpi">
            <span class="adm-kpi-accent purple"></span>
            <span class="adm-kpi-label">Cadastros</span>
            <span class="adm-kpi-value">${kpiRow?.cadastros ?? 0}</span>
            <div class="adm-kpi-meta">${deltaPill({ current: kpiRow?.cadastros ?? 0, previous: prevCadastros, compareLabel: rangeLabel })}</div>
          </div>
          <div class="adm-kpi">
            <span class="adm-kpi-accent green"></span>
            <span class="adm-kpi-label">Pagantes</span>
            <span class="adm-kpi-value">${kpiRow?.pagos ?? 0}</span>
            <div class="adm-kpi-meta">${deltaPill({ current: kpiRow?.pagos ?? 0, previous: prevPagos, compareLabel: rangeLabel })}</div>
          </div>
          <div class="adm-kpi">
            <span class="adm-kpi-accent orange"></span>
            <span class="adm-kpi-label">Conversão demo→pago</span>
            <span class="adm-kpi-value">${convGlobal}%</span>
            <div class="adm-kpi-meta">${deltaPill({ current: convGlobal, previous: prevConv, compareLabel: rangeLabel, format: 'pct' })}</div>
          </div>
          <div class="adm-kpi">
            <span class="adm-kpi-accent gold"></span>
            <span class="adm-kpi-label">Receita</span>
            <span class="adm-kpi-value">${fmtBRL(kpiRow?.receita_cents)}</span>
            <div class="adm-kpi-meta">${deltaPill({ current: kpiRow?.receita_cents ?? 0, previous: prevReceita, compareLabel: rangeLabel, format: 'cents' })}</div>
          </div>
          <div class="adm-kpi">
            <span class="adm-kpi-accent red"></span>
            <span class="adm-kpi-label">Mediana até pagar</span>
            <span class="adm-kpi-value">${kpiRow?.mediana_h_ate_pagar ?? '—'}<small>h</small></span>
            <div class="adm-kpi-meta"><span class="adm-kpi-sub">tempo de decisão</span></div>
          </div>
        `;
      }

      // ─── Funil global (Demo → Cadastro → Pago) — forma trapezoidal real ─
      if (globalFunnel) {
        const demos = kpiRow?.demos_unicos ?? 0;
        const cadastros = kpiRow?.cadastros ?? 0;
        const pagos = kpiRow?.pagos ?? 0;

        if (demos === 0 && cadastros === 0) {
          globalFunnel.innerHTML = emptyState({
            title: 'Sem dados no período',
            desc: 'Selecione uma janela maior ou aguarde acessos.',
            inline: true,
          });
        } else {
          const topVal = Math.max(demos, cadastros, pagos, 1);
          const steps = [
            { label: 'Demo acessou', value: demos, color: '#00d4ff', prev: null as number | null },
            { label: 'Criou conta', value: cadastros, color: '#8b5cf6', prev: demos },
            { label: 'Pagou plano', value: pagos, color: '#00e68c', prev: cadastros },
          ];

          // Cada nível tem largura proporcional ao valor. Desenhamos como
          // "trapezoides empilhados" com padding horizontal que faz o efeito
          // de funil (mais largo em cima, fino embaixo).
          const svgW = 800;
          const stepH = 90;
          const gapH = 14;
          const totalH = steps.length * stepH + (steps.length - 1) * gapH;

          // Função: largura da barra num certo nível, em % do SVG
          const widthOf = (v: number) => (v / topVal) * 100;

          globalFunnel.innerHTML = `
            <div class="adm-funnel-visual">
              <svg viewBox="0 0 ${svgW} ${totalH}" preserveAspectRatio="none" style="width:100%;height:auto;min-height:${totalH}px;">
                ${steps.map((s, i) => {
                  const w = widthOf(s.value);
                  const nextStep = steps[i + 1];
                  const wNext = nextStep ? widthOf(nextStep.value) : w;
                  const y = i * (stepH + gapH);
                  const cxLeft = (100 - w) / 2;
                  const cxRight = cxLeft + w;
                  const cxLeftNext = (100 - wNext) / 2;
                  const cxRightNext = cxLeftNext + wNext;

                  // Coordenadas em pixels (% do svgW)
                  const x1 = (cxLeft / 100) * svgW;
                  const x2 = (cxRight / 100) * svgW;
                  const x3 = nextStep ? (cxRightNext / 100) * svgW : x2;
                  const x4 = nextStep ? (cxLeftNext / 100) * svgW : x1;

                  // Polígono do "trapézio" (barra principal) deste nível
                  const topY = y;
                  const bottomY = y + stepH;

                  // Conector pro próximo nível (polígono que liga bottom deste ao top do próximo)
                  const connectorY1 = bottomY;
                  const connectorY2 = bottomY + gapH;
                  const connectorPoints = nextStep
                    ? `${x1},${connectorY1} ${x2},${connectorY1} ${x3},${connectorY2} ${x4},${connectorY2}`
                    : '';

                  return `
                    <polygon
                      points="${x1},${topY} ${x2},${topY} ${x2},${bottomY} ${x1},${bottomY}"
                      fill="${s.color}" fill-opacity="0.18"
                      stroke="${s.color}" stroke-opacity="0.5" stroke-width="1"
                    />
                    ${connectorPoints ? `
                      <polygon
                        points="${connectorPoints}"
                        fill="${s.color}" fill-opacity="0.06"
                      />
                    ` : ''}
                    <text
                      x="${svgW / 2}" y="${topY + stepH / 2 - 6}"
                      text-anchor="middle" dominant-baseline="middle"
                      fill="#eef0f4" font-size="22" font-weight="700"
                      font-family="-apple-system, 'Inter', sans-serif"
                    >${s.value.toLocaleString('pt-BR')}</text>
                    <text
                      x="${svgW / 2}" y="${topY + stepH / 2 + 18}"
                      text-anchor="middle" dominant-baseline="middle"
                      fill="rgba(238, 240, 244, 0.55)" font-size="12" font-weight="500"
                      font-family="-apple-system, 'Inter', sans-serif"
                    >${s.label}</text>
                  `;
                }).join('')}
              </svg>

              <div class="adm-funnel-legend">
                ${steps.map((s, i) => {
                  const dropPct = s.prev !== null && s.prev > 0 ? ((s.prev - s.value) / s.prev) * 100 : 0;
                  const convPct = s.prev !== null && s.prev > 0 ? (s.value / s.prev) * 100 : 100;
                  const dropClass = s.prev === null ? 'muted' : dropPct >= 80 ? 'bad' : dropPct >= 50 ? 'warn' : 'ok';
                  const isTop = s.prev === null;
                  return `
                    <div class="adm-funnel-legend-row">
                      <span class="adm-funnel-legend-dot" style="background:${s.color};"></span>
                      <span class="adm-funnel-legend-label">${s.label}</span>
                      <span class="adm-funnel-legend-value">${s.value.toLocaleString('pt-BR')}</span>
                      ${isTop
                        ? `<span class="adm-funnel-legend-meta">topo do funil</span>`
                        : `<span class="adm-funnel-drop ${dropClass}">${convPct.toFixed(1)}% convertem · ${dropPct.toFixed(0)}% caem</span>`}
                      ${i === steps.length - 1 && steps[0].value > 0
                        ? `<span class="adm-funnel-legend-meta">conv. global: ${((s.value / steps[0].value) * 100).toFixed(2)}%</span>`
                        : ''}
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          `;
        }
      }

      const renderFunnelTable = (rows: any[], firstCol: string, idLabel?: string): string => {
        if (!rows || !rows.length) {
          return emptyState({ title: 'Sem dados no período', desc: 'Aguarde novos cadastros ou mude o range.', inline: true });
        }
        const topCount = Math.max(...rows.map(r => r.cadastros || 0), 1);
        return `
          <div class="adm-table-wrap" style="border:none;background:transparent;">
            <table class="adm-table" style="min-width:0;">
              <thead>
                <tr>
                  <th>${firstCol}</th>
                  <th class="num">Cadastros</th>
                  <th class="num">Pagos</th>
                  <th class="num">Conv.</th>
                  <th class="num">Receita</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(r => {
                  const name = r.source || r.medium || '(sem)';
                  const conv = Number(r.conversao_pct) || 0;
                  const convClass = conv >= 15 ? 'cell-good' : conv >= 8 ? 'cell-strong' : 'cell-muted';
                  const barPct = ((r.cadastros || 0) / topCount) * 100;
                  return `
                    <tr>
                      <td class="cell-strong" style="text-transform:capitalize;">
                        <div>${name}</div>
                        <div style="height:3px;background:rgba(255,255,255,0.04);border-radius:2px;margin-top:3px;overflow:hidden;width:100%;">
                          <div style="height:100%;width:${barPct}%;background:linear-gradient(90deg,var(--a-cyan),var(--a-purple));"></div>
                        </div>
                      </td>
                      <td class="num">${r.cadastros}</td>
                      <td class="num">${r.pagos}</td>
                      <td class="num ${convClass}">${conv}%</td>
                      <td class="num">${fmtBRL(r.receita_cents)}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `;
        void idLabel;
      };

      if (sourceTable) sourceTable.innerHTML = renderFunnelTable(byS || [], 'Origem');
      if (mediumTable) mediumTable.innerHTML = renderFunnelTable(byM || [], 'Canal');

      // Campanhas: usa os profiles já carregados (agrupa por signup_campaign).
      // IDs numéricos longos (15+ dígitos) vêm de anúncios Meta/Facebook/Instagram
      // (campaign_id ou ad_id do Ads Manager). Não agrega nada mostrar o ID cru —
      // melhor rotular como "Meta Ads" e deixar que a gente identifique por ID
      // separadamente se precisar.
      if (campaignTable) {
        const since = Date.now() - this.acqDaysBack * 86400000;
        const profs = this.profiles.filter(p => p.created_at && new Date(p.created_at).getTime() > since);

        // Normaliza campaign: ID numérico Meta → agrupa em "Meta Ads"
        const normalizeCampaign = (raw: string | null | undefined): string => {
          if (!raw) return '(direto)';
          // Meta IDs são 15-20 dígitos numéricos puros. Usamos isso pra agrupar.
          if (/^\d{13,}$/.test(raw)) return 'Meta Ads';
          return raw;
        };

        const byCamp = new Map<string, { cadastros: number; pagos: number; receita: number }>();
        profs.forEach((p: any) => {
          const c = normalizeCampaign(p.signup_campaign);
          const curr = byCamp.get(c) || { cadastros: 0, pagos: 0, receita: 0 };
          curr.cadastros += 1;
          const isPaid = p.subscription_plan !== 'free' && p.subscription_plan !== 'trial'
            && p.subscription_status === 'active';
          if (isPaid) {
            curr.pagos += 1;
            // Receita estimada: soma das transações confirmadas desse user
            const userTxs = this.transactions.filter(t => t.user_id === p.id && t.status === 'confirmed');
            curr.receita += userTxs.reduce((s, t) => s + (t.amount_cents || 0), 0);
          }
          byCamp.set(c, curr);
        });
        const campArr = Array.from(byCamp.entries())
          .map(([name, v]) => ({
            source: name,
            cadastros: v.cadastros,
            pagos: v.pagos,
            conversao_pct: v.cadastros > 0 ? +((v.pagos / v.cadastros) * 100).toFixed(1) : 0,
            receita_cents: v.receita,
          }))
          .sort((a, b) => b.cadastros - a.cadastros)
          .slice(0, 20);
        campaignTable.innerHTML = renderFunnelTable(campArr, 'Campanha');
      }
    } catch (e) {
      console.error('[admin] renderAcquisition failed:', e);
      if (kpiGrid) {
        kpiGrid.innerHTML = emptyState({
          title: 'Erro ao carregar',
          desc: 'As RPCs de agregação não responderam. Veja o console (F12) pra detalhes.',
        });
      }
    }
  }

  // ─── DDD → Estado ──────────────────────────────────────────────────

  private static readonly DDD_STATE: Record<string, string> = {
    '11':'SP','12':'SP','13':'SP','14':'SP','15':'SP','16':'SP','17':'SP','18':'SP','19':'SP',
    '21':'RJ','22':'RJ','24':'RJ',
    '27':'ES','28':'ES',
    '31':'MG','32':'MG','33':'MG','34':'MG','35':'MG','37':'MG','38':'MG',
    '41':'PR','42':'PR','43':'PR','44':'PR','45':'PR','46':'PR',
    '47':'SC','48':'SC','49':'SC',
    '51':'RS','53':'RS','54':'RS','55':'RS',
    '61':'DF','62':'GO','63':'TO','64':'GO','65':'MT','66':'MT','67':'MS','68':'AC','69':'RO',
    '71':'BA','73':'BA','74':'BA','75':'BA','77':'BA',
    '79':'SE',
    '81':'PE','82':'AL','83':'PB','84':'RN','85':'CE','86':'PI','87':'PE','88':'CE','89':'PI',
    '91':'PA','92':'AM','93':'PA','94':'PA','95':'RR','96':'AP','97':'AM','98':'MA','99':'MA',
  };

  private getStateFromPhone(phone: string | null): string {
    if (!phone || phone.length < 4) return '??';
    // Remover código de país se tiver (55)
    const clean = phone.startsWith('55') && phone.length > 11 ? phone.slice(2) : phone;
    const ddd = clean.slice(0, 2);
    return AdminDashboard.DDD_STATE[ddd] || '??';
  }

  // ─── Dashboard ──────────────────────────────────────────────────────

  private renderDashboard(): void {
    const adminIds = new Set(this.profiles.filter(p => p.role === 'admin').map(p => p.id));
    const realUsers = this.profiles.filter(p => p.role !== 'admin');
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 86400000);
    const in3days = new Date(today.getTime() + 3 * 86400000);
    const weekAgo = new Date(today.getTime() - 7 * 86400000);
    const twoWeeksAgo = new Date(today.getTime() - 14 * 86400000);

    // Classificar usuários
    const active = realUsers.filter(p =>
      p.subscription_status === 'active' && p.subscription_plan !== 'free' && p.subscription_plan !== 'trial'
    );
    const trialsActive = realUsers.filter(p =>
      p.subscription_status === 'trial' && p.subscription_expires_at && new Date(p.subscription_expires_at) > now
    );
    const expired = realUsers.filter(p => {
      if (p.subscription_status === 'expired' || p.subscription_status === 'canceled') return true;
      if (p.subscription_expires_at && new Date(p.subscription_expires_at) <= now) return true;
      return false;
    });
    const expiringToday = realUsers.filter(p => {
      if (!p.subscription_expires_at) return false;
      const exp = new Date(p.subscription_expires_at);
      return exp >= today && exp < tomorrow;
    });
    const expiring3days = realUsers.filter(p => {
      if (!p.subscription_expires_at) return false;
      const exp = new Date(p.subscription_expires_at);
      return exp > tomorrow && exp <= in3days;
    });
    const expiredRecent = expired.filter(p => {
      if (!p.subscription_expires_at) return false;
      return new Date(p.subscription_expires_at) >= weekAgo;
    });
    const withPhone = realUsers.filter(p => !!p.phone);
    const withCpf = realUsers.filter(p => !!p.cpf_hash);
    const confirmed = this.transactions.filter(t => t.status === 'confirmed' && !adminIds.has(t.user_id));
    const revenue = confirmed.reduce((sum, t) => sum + (t.amount_cents || 0), 0);

    // ─── Deltas vs período anterior (7d) ──────────────────────────
    const signupsLast7d = realUsers.filter(p => new Date(p.created_at) >= weekAgo).length;
    const signupsPrev7d = realUsers.filter(p => {
      const d = new Date(p.created_at);
      return d >= twoWeeksAgo && d < weekAgo;
    }).length;
    const revenueLast7d = confirmed.filter(t => new Date(t.created_at) >= weekAgo)
      .reduce((s, t) => s + (t.amount_cents || 0), 0);
    const revenuePrev7d = confirmed.filter(t => {
      const d = new Date(t.created_at);
      return d >= twoWeeksAgo && d < weekAgo;
    }).reduce((s, t) => s + (t.amount_cents || 0), 0);
    const paidLast7d = confirmed.filter(t => new Date(t.created_at) >= weekAgo).length;
    const paidPrev7d = confirmed.filter(t => {
      const d = new Date(t.created_at);
      return d >= twoWeeksAgo && d < weekAgo;
    }).length;
    const expiredLast7d = expired.filter(p =>
      p.subscription_expires_at && new Date(p.subscription_expires_at) >= weekAgo
    ).length;
    const expiredPrev7d = expired.filter(p => {
      if (!p.subscription_expires_at) return false;
      const d = new Date(p.subscription_expires_at);
      return d >= twoWeeksAgo && d < weekAgo;
    }).length;

    // Conversão global (entre quem já passou pelo trial)
    const totalFunnel = trialsActive.length + active.length + expired.length;
    const conversionRate = totalFunnel > 0 ? (active.length / totalFunnel) * 100 : 0;

    // Novos hoje
    const newToday = realUsers.filter(p => new Date(p.created_at) >= today).length;

    // Atualizar subtítulo com contexto
    const subtitle = document.getElementById('dashboardSubtitle');
    if (subtitle) {
      subtitle.textContent = `${realUsers.length} usuários · ${fmtBRL(revenue)} de receita total · ${confirmed.length} vendas`;
    }

    // ─── KPIs ─────────────────────────────────────────────────────
    const el = (id: string) => document.getElementById(id);
    const kpiGrid = el('kpiGrid');
    if (kpiGrid) {
      kpiGrid.innerHTML = `
        <div class="adm-kpi">
          <span class="adm-kpi-accent blue"></span>
          <span class="adm-kpi-label">Total usuários</span>
          <span class="adm-kpi-value">${realUsers.length}</span>
          <div class="adm-kpi-meta">
            ${deltaPill({ current: signupsLast7d, previous: signupsPrev7d, compareLabel: 'vs 7d' })}
          </div>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi-accent green"></span>
          <span class="adm-kpi-label">Assinantes pagos</span>
          <span class="adm-kpi-value">${active.length}</span>
          <div class="adm-kpi-meta">
            ${deltaPill({ current: paidLast7d, previous: paidPrev7d, compareLabel: 'novas vs 7d' })}
          </div>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi-accent gold"></span>
          <span class="adm-kpi-label">Faturamento</span>
          <span class="adm-kpi-value">${fmtBRL(revenue)}</span>
          <div class="adm-kpi-meta">
            ${deltaPill({ current: revenueLast7d, previous: revenuePrev7d, compareLabel: 'vs 7d', format: 'cents' })}
          </div>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi-accent purple"></span>
          <span class="adm-kpi-label">Em trial ativo</span>
          <span class="adm-kpi-value">${trialsActive.length}</span>
          <div class="adm-kpi-meta">
            <span class="adm-kpi-sub">${expiringToday.length} expiram hoje · ${expiring3days.length} em 3d</span>
          </div>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi-accent red"></span>
          <span class="adm-kpi-label">Expirados</span>
          <span class="adm-kpi-value">${expired.length}</span>
          <div class="adm-kpi-meta">
            ${deltaPill({ current: expiredLast7d, previous: expiredPrev7d, isNegativeMetric: true, compareLabel: 'últ. 7d' })}
          </div>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi-accent orange"></span>
          <span class="adm-kpi-label">Conversão trial → pago</span>
          <span class="adm-kpi-value">${conversionRate.toFixed(1)}%</span>
          <div class="adm-kpi-meta">
            <span class="adm-kpi-sub">${active.length} de ${totalFunnel} trials</span>
          </div>
        </div>
        <div class="adm-kpi">
          <span class="adm-kpi-accent blue"></span>
          <span class="adm-kpi-label">Demo (únicos / total)</span>
          <span class="adm-kpi-value">${this.demoUnique}<small> / ${this.demoTotal}</small></span>
          <div class="adm-kpi-meta">
            <span class="adm-kpi-sub">fingerprint anônimo</span>
          </div>
        </div>
      `;
    }

    // ─── Alertas ──────────────────────────────────────────────────
    const alertsEl = el('dashAlerts');
    if (alertsEl) {
      const alerts: string[] = [];

      if (expiringToday.length > 0) {
        alerts.push(`<div class="adm-alert adm-alert-danger" style="cursor:pointer;" data-goto-leads="expiring_today">
          <span class="adm-alert-count">${expiringToday.length}</span>
          <span class="adm-alert-text">expirando hoje: ${expiringToday.map(p => p.name?.split(' ')[0]).join(', ')}</span>
        </div>`);
      }
      if (expiring3days.length > 0) {
        alerts.push(`<div class="adm-alert adm-alert-warn" style="cursor:pointer;" data-goto-leads="expiring_3days">
          <span class="adm-alert-count">${expiring3days.length}</span>
          <span class="adm-alert-text">expiram nos proximos 3 dias</span>
        </div>`);
      }
      if (newToday > 0) {
        alerts.push(`<div class="adm-alert adm-alert-info">
          <span class="adm-alert-count">${newToday}</span>
          <span class="adm-alert-text">novos cadastros hoje</span>
        </div>`);
      }
      if (expiredRecent.length > 0) {
        alerts.push(`<div class="adm-alert adm-alert-warn" style="cursor:pointer;" data-goto-leads="expired_7days">
          <span class="adm-alert-count">${expiredRecent.length}</span>
          <span class="adm-alert-text">expiraram nos ultimos 7 dias — leads quentes</span>
        </div>`);
      }

      alertsEl.innerHTML = alerts.join('');

      // Clicar no alerta navega pra Leads com filtro
      alertsEl.querySelectorAll('[data-goto-leads]').forEach(alert => {
        alert.addEventListener('click', () => {
          const filter = (alert as HTMLElement).dataset.gotoLeads!;
          this.leadsFilter = filter;
          this.leadsPage = 0;
          const filterSelect = document.getElementById('leadsFilter') as HTMLSelectElement;
          if (filterSelect) filterSelect.value = filter;
          this.switchSection('leads');
        });
      });
    }

    // ─── Cards ────────────────────────────────────────────────────

    // Distribuição por plano
    const chartEl = el('usersChart');
    if (chartEl) {
      const planCounts: Record<string, number> = {};
      realUsers.forEach(p => {
        if (p.subscription_status === 'active' || (p.subscription_status === 'trial' && p.subscription_expires_at && new Date(p.subscription_expires_at) > now)) {
          planCounts[p.subscription_plan] = (planCounts[p.subscription_plan] || 0) + 1;
        }
      });
      const maxPlan = Math.max(...Object.values(planCounts), 1);

      chartEl.innerHTML = Object.entries(planCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([plan, count]) => `
          <div class="adm-bar-row">
            <span class="adm-bar-label" style="width:60px;font-size:0.68rem;">${plan}</span>
            <div class="adm-bar-track"><div class="adm-bar-fill" style="width:${(count/maxPlan*100)}%"></div></div>
            <span class="adm-bar-count">${count}</span>
          </div>
        `).join('') || '<div style="color:var(--a-text3);font-size:0.75rem;">Nenhum ativo</div>';
    }

    // Distribuição por região (DDD)
    const regionEl = el('regionChart');
    if (regionEl) {
      const regionCounts: Record<string, number> = {};
      withPhone.forEach(p => {
        const state = this.getStateFromPhone(p.phone);
        if (state !== '??') regionCounts[state] = (regionCounts[state] || 0) + 1;
      });
      const sorted = Object.entries(regionCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
      const maxRegion = sorted.length > 0 ? sorted[0][1] : 1;

      regionEl.innerHTML = sorted.length > 0
        ? sorted.map(([state, count]) => `
          <div class="adm-bar-row">
            <span class="adm-bar-label">${state}</span>
            <div class="adm-bar-track"><div class="adm-bar-fill" style="width:${(count/maxRegion*100)}%;background:linear-gradient(90deg,var(--a-green),var(--a-cyan));"></div></div>
            <span class="adm-bar-count">${count}</span>
          </div>
        `).join('')
        : '<div style="color:var(--a-text3);font-size:0.75rem;">Sem dados de telefone</div>';
    }

    // Ultimas transações
    const txChartEl = el('subscriptionsChart');
    if (txChartEl) {
      const recent = this.transactions.filter(t => !adminIds.has(t.user_id)).slice(0, 6);
      txChartEl.innerHTML = recent.length === 0
        ? '<div style="color:var(--a-text3);font-size:0.75rem;">Nenhuma transacao</div>'
        : recent.map(t => {
          const user = this.profiles.find(p => p.id === t.user_id);
          const isConfirmed = t.status === 'confirmed';
          return `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.3rem 0;border-bottom:1px solid rgba(255,255,255,0.03);font-size:0.72rem;">
              <div style="display:flex;align-items:center;gap:0.4rem;min-width:0;">
                <span style="width:6px;height:6px;border-radius:50%;background:${isConfirmed ? 'var(--a-green)' : 'var(--a-orange)'};flex-shrink:0;"></span>
                <span style="color:var(--a-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${user?.name?.split(' ')[0] || '?'}</span>
                <span style="color:var(--a-text3);">${t.plan}</span>
              </div>
              <span style="color:${isConfirmed ? 'var(--a-green)' : 'var(--a-orange)'};font-weight:700;flex-shrink:0;">R$ ${(t.amount_cents/100).toFixed(0)}</span>
            </div>
          `;
        }).join('');
    }

    // Dados completude
    const dataEl = el('dataChart');
    if (dataEl) {
      const total = realUsers.length || 1;
      const cpfPct = Math.round((withCpf.length / total) * 100);
      const phonePct = Math.round((withPhone.length / total) * 100);
      const emailPct = Math.round((realUsers.filter(p => !!p.email).length / total) * 100);

      dataEl.innerHTML = `
        <div class="adm-bar-row">
          <span class="adm-bar-label" style="width:40px;">CPF</span>
          <div class="adm-bar-track"><div class="adm-bar-fill" style="width:${cpfPct}%;background:var(--a-purple);"></div></div>
          <span class="adm-bar-count">${cpfPct}%</span>
        </div>
        <div class="adm-bar-row">
          <span class="adm-bar-label" style="width:40px;">Tel</span>
          <div class="adm-bar-track"><div class="adm-bar-fill" style="width:${phonePct}%;background:var(--a-green);"></div></div>
          <span class="adm-bar-count">${phonePct}%</span>
        </div>
        <div class="adm-bar-row">
          <span class="adm-bar-label" style="width:40px;">Email</span>
          <div class="adm-bar-track"><div class="adm-bar-fill" style="width:${emailPct}%;background:var(--a-cyan);"></div></div>
          <span class="adm-bar-count">${emailPct}%</span>
        </div>
      `;
    }
  }

  // ─── Usuários ───────────────────────────────────────────────────────

  private renderUsers(): void {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;

    let filtered = this.profiles.filter(p => {
      const matchSearch = !this.userSearch ||
        p.name?.toLowerCase().includes(this.userSearch) ||
        p.id.toLowerCase().includes(this.userSearch);
      const matchFilter = this.userFilter === 'all' ||
        p.subscription_status === this.userFilter ||
        (this.userFilter === 'expired' && p.subscription_expires_at && new Date(p.subscription_expires_at) <= new Date());
      return matchSearch && matchFilter;
    });

    // Paginação
    const totalPages = Math.ceil(filtered.length / this.PAGE_SIZE);
    if (this.userPage >= totalPages) this.userPage = Math.max(0, totalPages - 1);
    const start = this.userPage * this.PAGE_SIZE;
    const paged = filtered.slice(start, start + this.PAGE_SIZE);

    // Counter
    const countEl = document.getElementById('usersCount');
    if (countEl) countEl.textContent = `${filtered.length} usuários`;

    // Empty state (mas só renderiza dentro de <tr><td colspan="8">)
    if (paged.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="padding:0;">${emptyState({
        title: 'Nenhum usuário',
        desc: this.userSearch || this.userFilter !== 'all' ? 'Ajuste os filtros acima pra ver mais resultados.' : 'Ainda não há usuários cadastrados.',
        inline: true,
      })}</td></tr>`;
      const pagEl = document.getElementById('usersPagination');
      if (pagEl) pagEl.innerHTML = '';
      return;
    }

    tbody.innerHTML = paged.map(p => {
      const statusColor = p.subscription_status === 'active' ? 'success' :
        p.subscription_status === 'trial' ? 'warning' : 'error';
      const expires = p.subscription_expires_at
        ? new Date(p.subscription_expires_at).toLocaleDateString('pt-BR')
        : '—';
      const isExpired = p.subscription_expires_at && new Date(p.subscription_expires_at) < new Date();
      const created = new Date(p.created_at).toLocaleDateString('pt-BR');

      return `
        <tr>
          <td style="font-size:0.7rem;color:rgba(255,255,255,0.3);">${p.id.slice(0, 8)}...</td>
          <td>${p.name || '—'}</td>
          <td><span class="badge badge-primary">${p.role}</span></td>
          <td><span class="badge badge-${statusColor}">${p.subscription_status}</span></td>
          <td>${p.subscription_plan || '—'}</td>
          <td style="${isExpired ? 'color:#ff3366;' : ''}">${expires}</td>
          <td>${created}</td>
          <td>
            <div class="action-buttons">
              <button class="btn-action btn-edit" data-user-id="${p.id}">Editar</button>
              ${p.role !== 'admin' ? (
                p.subscription_status === 'blocked'
                  ? `<button class="btn-action btn-edit" data-unblock-id="${p.id}" style="color:#00D4FF;">Desbloquear</button>`
                  : `<button class="btn-action btn-delete" data-block-id="${p.id}">Bloquear</button>`
              ) : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('[data-user-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const userId = (btn as HTMLElement).dataset.userId!;
        this.editUser(userId);
      });
    });

    tbody.querySelectorAll('[data-block-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = (btn as HTMLElement).dataset.blockId!;
        const profile = this.profiles.find(p => p.id === userId);
        if (!confirm(`Bloquear ${profile?.name}? O usuário não conseguirá mais acessar o app.`)) return;
        await this.blockUser(userId, true);
      });
    });

    tbody.querySelectorAll('[data-unblock-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = (btn as HTMLElement).dataset.unblockId!;
        await this.blockUser(userId, false);
      });
    });

    // Paginação
    const pagEl = document.getElementById('usersPagination');
    if (pagEl) {
      pagEl.innerHTML = totalPages > 1 ? `
        <button class="adm-btn adm-btn-sm adm-btn-ghost" ${this.userPage === 0 ? 'disabled' : ''} id="userPrev">&laquo; Anterior</button>
        <span style="font-size:0.78rem;color:rgba(255,255,255,0.4);">${this.userPage + 1} / ${totalPages}</span>
        <button class="adm-btn adm-btn-sm adm-btn-ghost" ${this.userPage >= totalPages - 1 ? 'disabled' : ''} id="userNext">Próximo &raquo;</button>
      ` : '';
      pagEl.querySelector('#userPrev')?.addEventListener('click', () => { this.userPage--; this.renderUsers(); });
      pagEl.querySelector('#userNext')?.addEventListener('click', () => { this.userPage++; this.renderUsers(); });
    }
  }

  private async blockUser(userId: string, block: boolean): Promise<void> {
    // 1. Ban/unban no Supabase Auth via Edge Function
    await adminBanUser(userId, block);

    // 2. Atualizar status no perfil
    await adminUpdate('gdrums_profiles', userId, {
      subscription_status: block ? 'expired' : 'expired',
      updated_at: new Date().toISOString(),
    });

    // 3. Atualizar local
    const idx = this.profiles.findIndex(p => p.id === userId);
    if (idx !== -1) {
      this.profiles[idx].subscription_status = 'expired';
    }

    this.renderUsers();
    this.renderDashboard();
    const profile = this.profiles.find(p => p.id === userId);
    modalManager.show('Admin', `${profile?.name} ${block ? 'bloqueado' : 'desbloqueado'}!`, block ? 'warning' : 'success');
  }

  private currentEditUserId: string | null = null;

  private editUser(userId: string): void {
    const profile = this.profiles.find(p => p.id === userId);
    if (!profile) return;

    this.currentEditUserId = userId;

    const modal = document.getElementById('editUserModal')!;
    (document.getElementById('editUserId') as HTMLInputElement).value = profile.id;
    (document.getElementById('editUserName') as HTMLInputElement).value = profile.name || '';
    (document.getElementById('editUserStatus') as HTMLSelectElement).value = profile.subscription_status;
    (document.getElementById('editUserPlan') as HTMLSelectElement).value = profile.subscription_plan || 'trial';
    const expiryInput = document.getElementById('editUserExpiry') as HTMLInputElement;
    expiryInput.value = profile.subscription_expires_at
      ? new Date(profile.subscription_expires_at).toISOString().split('T')[0]
      : '';

    modal.classList.add('active');
  }

  private setupEditForm(): void {
    const form = document.getElementById('editUserForm');
    const modal = document.getElementById('editUserModal');
    if (!form || !modal) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!this.currentEditUserId) return;

      const status = (document.getElementById('editUserStatus') as HTMLSelectElement).value;
      const plan = (document.getElementById('editUserPlan') as HTMLSelectElement).value;
      const expiry = (document.getElementById('editUserExpiry') as HTMLInputElement).value;

      await adminUpdate('gdrums_profiles', this.currentEditUserId, {
        subscription_status: status,
        subscription_plan: plan,
        subscription_expires_at: expiry ? new Date(expiry).toISOString() : null,
        updated_at: new Date().toISOString(),
      });

      const idx = this.profiles.findIndex(p => p.id === this.currentEditUserId);
      if (idx !== -1) {
        this.profiles[idx].subscription_status = status;
        this.profiles[idx].subscription_plan = plan;
        this.profiles[idx].subscription_expires_at = expiry ? new Date(expiry).toISOString() : null;
      }

      modal.classList.remove('active');
      this.renderUsers();
      this.renderDashboard();
      const profile = this.profiles.find(p => p.id === this.currentEditUserId);
      modalManager.show('Admin', `Perfil de ${profile?.name} atualizado!`, 'success');
    });

    modal.querySelectorAll('.adm-modal-close, [data-modal]').forEach(btn => {
      btn.addEventListener('click', () => modal.classList.remove('active'));
    });
  }

  // ─── Transações ─────────────────────────────────────────────────────

  private renderTransactions(): void {
    const tbody = document.getElementById('subscriptionsTableBody');
    if (!tbody) return;

    let filtered = this.transactions.filter(t => {
      const user = this.profiles.find(p => p.id === t.user_id);
      const matchSearch = !this.txSearch ||
        user?.name?.toLowerCase().includes(this.txSearch) ||
        t.order_nsu.toLowerCase().includes(this.txSearch) ||
        t.plan.toLowerCase().includes(this.txSearch);
      const matchFilter = this.txFilter === 'all' || t.status === this.txFilter;
      return matchSearch && matchFilter;
    });

    // Paginação
    const totalPages = Math.ceil(filtered.length / this.PAGE_SIZE);
    if (this.txPage >= totalPages) this.txPage = Math.max(0, totalPages - 1);
    const start = this.txPage * this.PAGE_SIZE;
    const paged = filtered.slice(start, start + this.PAGE_SIZE);

    if (paged.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="padding:0;">${emptyState({
        title: 'Nenhuma transação',
        desc: this.txSearch || this.txFilter !== 'all' ? 'Ajuste os filtros acima.' : 'Assim que alguém pagar, aparece aqui.',
        inline: true,
      })}</td></tr>`;
      const summaryEl = document.getElementById('transactionsSummary');
      if (summaryEl) summaryEl.innerHTML = '';
      const pagEl = document.getElementById('txPagination');
      if (pagEl) pagEl.innerHTML = '';
      return;
    }

    tbody.innerHTML = paged.map(t => {
      const user = this.profiles.find(p => p.id === t.user_id);
      const statusColor = t.status === 'confirmed' ? 'success' : t.status === 'pending' ? 'warning' : 'error';
      const date = new Date(t.created_at).toLocaleDateString('pt-BR', {
        day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
      });

      return `
        <tr>
          <td>${user?.name || '—'}</td>
          <td><span class="badge badge-primary">${t.plan}</span></td>
          <td><span class="badge badge-${statusColor}">${t.status}</span></td>
          <td>R$ ${(t.amount_cents / 100).toFixed(2)}</td>
          <td>${t.payment_method || '—'}</td>
          <td>${t.coupon_code || '—'}</td>
          <td>${date}</td>
          <td>
            ${t.receipt_url ? `<a href="${t.receipt_url}" target="_blank" style="color:#00D4FF;text-decoration:none;font-size:0.8rem;">Recibo</a>` : '—'}
          </td>
        </tr>
      `;
    }).join('');

    const confirmedTotal = filtered.filter(t => t.status === 'confirmed').reduce((s, t) => s + t.amount_cents, 0);
    const pendingTotal = filtered.filter(t => t.status === 'pending').reduce((s, t) => s + t.amount_cents, 0);
    const pendingOld = this.transactions.filter(t => {
      if (t.status !== 'pending') return false;
      const age = Date.now() - new Date(t.created_at).getTime();
      return age > 48 * 60 * 60 * 1000; // > 48h
    }).length;

    const summaryEl = document.getElementById('transactionsSummary');
    if (summaryEl) {
      summaryEl.innerHTML = `
        <span style="color:var(--a-cyan,#00D4FF);font-weight:600;">Confirmado: R$ ${(confirmedTotal / 100).toFixed(2)}</span>
        <span style="color:var(--a-orange,#F97316);font-weight:600;">Pendente: R$ ${(pendingTotal / 100).toFixed(2)}</span>
        <span style="color:var(--a-text3,rgba(255,255,255,0.3));">${filtered.length} transacoes</span>
        ${pendingOld > 0 ? `<button class="adm-btn adm-btn-sm adm-btn-danger" id="expirePendingBtn" style="margin-left:auto;">Expirar ${pendingOld} pendentes &gt;48h</button>` : ''}
      `;

      // Expirar pendentes antigas via Edge Function (RLS bloqueia update de status)
      summaryEl.querySelector('#expirePendingBtn')?.addEventListener('click', async () => {
        if (!confirm(`Expirar ${pendingOld} transacoes pendentes com mais de 48h?`)) return;
        const old = this.transactions.filter(t => {
          if (t.status !== 'pending') return false;
          return (Date.now() - new Date(t.created_at).getTime()) > 48 * 60 * 60 * 1000;
        });
        for (const t of old) {
          await adminCall({ action: 'update', table: 'gdrums_transactions', id: t.id, data: { status: 'expired' } });
        }
        await this.loadData();
        this.renderTransactions();
        this.renderDashboard();
        modalManager.show('Admin', `${old.length} transações expiradas!`, 'success');
      });
    }

    // Paginação
    const pagEl = document.getElementById('txPagination');
    if (pagEl) {
      pagEl.innerHTML = totalPages > 1 ? `
        <button class="adm-btn adm-btn-sm adm-btn-ghost" ${this.txPage === 0 ? 'disabled' : ''} id="txPrev">&laquo; Anterior</button>
        <span style="font-size:0.78rem;color:rgba(255,255,255,0.4);">${this.txPage + 1} / ${totalPages}</span>
        <button class="adm-btn adm-btn-sm adm-btn-ghost" ${this.txPage >= totalPages - 1 ? 'disabled' : ''} id="txNext">Próximo &raquo;</button>
      ` : '';
      pagEl.querySelector('#txPrev')?.addEventListener('click', () => { this.txPage--; this.renderTransactions(); });
      pagEl.querySelector('#txNext')?.addEventListener('click', () => { this.txPage++; this.renderTransactions(); });
    }
  }

  // ─── Leads (expirados para contato) ─────────────────────────────────

  private renderLeads(): void {
    const tbody = document.getElementById('leadsTableBody');
    if (!tbody) return;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 86400000);
    const in3days = new Date(today.getTime() + 3 * 86400000);
    const weekAgo = new Date(today.getTime() - 7 * 86400000);

    // Leads = todos nao-admin (expirados + expirando)
    let leads = this.profiles.filter(p => {
      if (p.role === 'admin') return false;
      if (p.subscription_status === 'active' && p.subscription_plan !== 'trial' && p.subscription_plan !== 'free') return false;
      return true;
    });

    // Filtros
    if (this.leadsSearch) {
      leads = leads.filter(l =>
        l.name?.toLowerCase().includes(this.leadsSearch) ||
        l.email?.toLowerCase().includes(this.leadsSearch) ||
        l.phone?.includes(this.leadsSearch) ||
        l.id.toLowerCase().includes(this.leadsSearch)
      );
    }

    if (this.leadsFilter === 'expiring_today') {
      leads = leads.filter(l => {
        if (!l.subscription_expires_at) return false;
        const exp = new Date(l.subscription_expires_at);
        return exp >= today && exp < tomorrow;
      });
    } else if (this.leadsFilter === 'expiring_3days') {
      leads = leads.filter(l => {
        if (!l.subscription_expires_at) return false;
        const exp = new Date(l.subscription_expires_at);
        return exp >= today && exp <= in3days;
      });
    } else if (this.leadsFilter === 'expired_7days') {
      leads = leads.filter(l => {
        if (!l.subscription_expires_at) return false;
        const exp = new Date(l.subscription_expires_at);
        return exp < today && exp >= weekAgo;
      });
    } else if (this.leadsFilter === 'trial_expired') {
      leads = leads.filter(l => l.subscription_plan === 'trial' && l.subscription_expires_at && new Date(l.subscription_expires_at) <= now);
    } else if (this.leadsFilter === 'sub_expired') {
      leads = leads.filter(l => l.subscription_plan !== 'trial' && l.subscription_plan !== 'free' && l.subscription_expires_at && new Date(l.subscription_expires_at) <= now);
    } else if (this.leadsFilter === 'has_phone') {
      leads = leads.filter(l => !!l.phone);
    } else if (this.leadsFilter === 'not_contacted') {
      leads = leads.filter(l => !l.last_contacted_at);
    } else if (this.leadsFilter === 'contacted') {
      leads = leads.filter(l => !!l.last_contacted_at);
    } else if (this.leadsFilter === 'all') {
      // Mostrar so expirados por padrao
      leads = leads.filter(l => {
        if (l.subscription_status === 'expired' || l.subscription_status === 'canceled') return true;
        if (l.subscription_expires_at && new Date(l.subscription_expires_at) <= now) return true;
        return false;
      });
    }

    // Summary
    const withPhone = leads.filter(l => !!l.phone).length;
    const withEmail = leads.filter(l => !!l.email).length;
    const contacted = leads.filter(l => !!l.last_contacted_at).length;
    const summaryEl = document.getElementById('leadsSummary');
    if (summaryEl) {
      summaryEl.innerHTML = `
        <span style="color:var(--a-red);font-weight:600;">${leads.length} leads</span>
        <span style="color:var(--a-cyan);font-weight:600;">${withEmail} email</span>
        <span style="color:var(--a-green);font-weight:600;">${withPhone} whats</span>
        <span style="color:var(--a-text3);">${contacted} contatados</span>
        <button class="adm-btn adm-btn-sm adm-btn-primary" id="sendAllEmailsBtn" style="margin-left:auto;">Email pra ${withEmail - contacted}</button>
        <button class="adm-btn adm-btn-sm adm-btn-outline" id="sendTestEmailBtn">Teste</button>
      `;

      summaryEl.querySelector('#sendAllEmailsBtn')?.addEventListener('click', async () => {
        const emailLeads = leads.filter(l => !!l.email && !l.last_contacted_at);
        if (!confirm(`Enviar cupom pra ${emailLeads.length} leads nao contatados?`)) return;
        let sent = 0; let failed = 0;
        for (const l of emailLeads) {
          try {
            await this.sendRecoveryEmail(l.email!, l.name);
            await this.markContacted(l.id, 'email');
            sent++;
          } catch { failed++; }
        }
        await this.loadData();
        this.renderLeads();
        modalManager.show('Email', `${sent} enviados, ${failed} falharam`, sent > 0 ? 'success' : 'error');
      });

      summaryEl.querySelector('#sendTestEmailBtn')?.addEventListener('click', async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user?.email) return;
        if (!confirm(`Enviar teste pra ${user.email}?`)) return;
        try {
          await this.sendRecoveryEmail(user.email, user.user_metadata?.name || 'Admin');
          modalManager.show('Email', `Teste enviado!`, 'success');
        } catch (e) {
          modalManager.show('Email', `Erro: ${e}`, 'error');
        }
      });
    }

    const countEl = document.getElementById('leadsCount');
    if (countEl) countEl.textContent = `${leads.length} leads`;

    // Paginacao
    const totalPages = Math.ceil(leads.length / this.PAGE_SIZE);
    if (this.leadsPage >= totalPages) this.leadsPage = Math.max(0, totalPages - 1);
    const start = this.leadsPage * this.PAGE_SIZE;
    const paged = leads.slice(start, start + this.PAGE_SIZE);

    if (paged.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding:0;">${emptyState({
        title: 'Nenhum lead no filtro',
        desc: this.leadsSearch || this.leadsFilter !== 'all' ? 'Ajuste os filtros acima pra ver mais leads.' : 'Ainda não há usuários expirados. Bom sinal!',
        inline: true,
      })}</td></tr>`;
      const pagEl = document.getElementById('leadsPagination');
      if (pagEl) pagEl.innerHTML = '';
      return;
    }

    // Mensagem WhatsApp pronta
    const whatsMsg = (name: string) => {
      const first = (name || '').split(' ')[0] || '';
      return encodeURIComponent(`Oi${first ? ' ' + first : ''}! Tudo bem?\n\nRecebemos seu cadastro no nosso Aplicativo de ritmos GDrums e liberamos um cupom especial de 50% OFF pra voce!\n\nPosso te enviar por aqui?`);
    };

    tbody.innerHTML = paged.map(l => {
      const expires = l.subscription_expires_at
        ? new Date(l.subscription_expires_at).toLocaleDateString('pt-BR')
        : '--';
      const isExpired = l.subscription_expires_at && new Date(l.subscription_expires_at) <= now;
      const expiresColor = isExpired ? 'var(--a-red)' : 'var(--a-gold)';

      // Contato (WhatsApp com mensagem pronta + email)
      const phoneValid = validateBrPhone(l.phone);
      const phoneLink = l.phone
        ? (phoneValid.ok
          ? `<a href="https://wa.me/${phoneValid.e164}?text=${whatsMsg(l.name)}" target="_blank" style="color:var(--a-green);text-decoration:none;font-size:0.7rem;" title="Abrir WhatsApp: ${phoneValid.display}">WhatsApp</a>`
          : `<span style="color:var(--a-red);font-size:0.7rem;opacity:0.7;" title="Número ${phoneValid.reason} — contate por email">⚠ tel inválido</span>`)
        : '';
      const emailLink = l.email
        ? `<a href="mailto:${l.email}" style="color:var(--a-cyan);text-decoration:none;font-size:0.7rem;" title="${l.email}">Email</a>`
        : '';
      const contactLinks = [phoneLink, emailLink].filter(Boolean).join(' ');

      // Status de contato
      let contactStatus = '';
      if (l.last_contacted_at) {
        const method = l.contact_method === 'whatsapp' ? 'W' : l.contact_method === 'email' ? 'E' : '?';
        const date = new Date(l.last_contacted_at).toLocaleDateString('pt-BR');
        contactStatus = `<span class="badge badge-success" title="Contatado em ${date}">${method} ${date}</span>`;
      } else {
        contactStatus = '<span style="color:var(--a-text3);font-size:0.65rem;">Pendente</span>';
      }

      // Acoes
      const actions: string[] = [];
      if (l.phone && phoneValid.ok) {
        actions.push(`<button class="btn-action btn-edit" data-whats-id="${l.id}" style="font-size:0.6rem;">WhatsApp</button>`);
      }
      if (l.email) {
        actions.push(`<button class="btn-action btn-edit" data-email-id="${l.id}" style="font-size:0.6rem;">Email</button>`);
      }

      return `
        <tr>
          <td>${l.name || '--'}</td>
          <td>${contactLinks || '<span style="color:var(--a-text3);">--</span>'}</td>
          <td><span class="badge badge-${l.subscription_plan === 'trial' ? 'warning' : 'primary'}">${l.subscription_plan}</span></td>
          <td style="color:${expiresColor};">${expires}</td>
          <td>${contactStatus}</td>
          <td><div class="action-buttons">${actions.join('')}</div></td>
        </tr>
      `;
    }).join('');

    // Paginacao
    const pagEl = document.getElementById('leadsPagination');
    if (pagEl) {
      pagEl.innerHTML = totalPages > 1 ? `
        <button class="adm-btn adm-btn-sm adm-btn-ghost" ${this.leadsPage === 0 ? 'disabled' : ''} id="leadsPrev">&laquo;</button>
        <span style="font-size:0.72rem;color:var(--a-text3);">${this.leadsPage + 1} / ${totalPages}</span>
        <button class="adm-btn adm-btn-sm adm-btn-ghost" ${this.leadsPage >= totalPages - 1 ? 'disabled' : ''} id="leadsNext">&raquo;</button>
      ` : '';
      pagEl.querySelector('#leadsPrev')?.addEventListener('click', () => { this.leadsPage--; this.renderLeads(); });
      pagEl.querySelector('#leadsNext')?.addEventListener('click', () => { this.leadsPage++; this.renderLeads(); });
    }

    // Bind WhatsApp (abre + marca como contatado)
    tbody.querySelectorAll('[data-whats-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.whatsId!;
        const lead = paged.find(l => l.id === id);
        if (!lead?.phone) return;
        const v = validateBrPhone(lead.phone);
        if (!v.ok || !v.e164) {
          modalManager.show('WhatsApp', `Número inválido (${v.reason}). Contate por email.`, 'warning');
          return;
        }
        window.open(`https://wa.me/${v.e164}?text=${whatsMsg(lead.name)}`, '_blank');
        await this.markContacted(id, 'whatsapp');
        this.renderLeads();
      });
    });

    // Bind Email (envia + marca)
    tbody.querySelectorAll('[data-email-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.emailId!;
        const lead = paged.find(l => l.id === id);
        if (!lead?.email) return;
        (btn as HTMLButtonElement).disabled = true;
        (btn as HTMLElement).textContent = '...';
        try {
          await this.sendRecoveryEmail(lead.email, lead.name);
          await this.markContacted(id, 'email');
          (btn as HTMLElement).textContent = 'OK';
          (btn as HTMLElement).style.color = 'var(--a-green)';
          this.renderLeads();
        } catch {
          (btn as HTMLElement).textContent = 'Erro';
          (btn as HTMLElement).style.color = 'var(--a-red)';
        }
      });
    });
  }

  private async markContacted(userId: string, method: string): Promise<void> {
    const profile = this.profiles.find(p => p.id === userId);
    if (profile) {
      profile.last_contacted_at = new Date().toISOString();
      profile.contact_method = method;
    }
    await adminCall({
      action: 'update',
      table: 'gdrums_profiles',
      id: userId,
      data: {
        last_contacted_at: new Date().toISOString(),
        contact_method: method,
      },
    });
  }

  // ─── Envio de email ───────────────────────────────────────────────

  private async sendRecoveryEmail(to: string, name: string): Promise<void> {
    const token = await getAuthToken();
    const res = await fetch('https://qsfziivubwdgtmwyztfw.supabase.co/functions/v1/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ to, name }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Erro ao enviar');
  }

  // ─── Cupons ────────────────────────────────────────────────────────

  private setupCouponForm(): void {
    const modal = document.getElementById('couponModal');
    const form = document.getElementById('couponForm');
    if (!modal || !form) return;

    document.getElementById('addCouponBtn')?.addEventListener('click', () => {
      (document.getElementById('couponModalTitle') as HTMLElement).textContent = 'Novo Cupom';
      (document.getElementById('couponEditId') as HTMLInputElement).value = '';
      (document.getElementById('couponCode') as HTMLInputElement).value = '';
      (document.getElementById('couponCode') as HTMLInputElement).disabled = false;
      (document.getElementById('couponDiscount') as HTMLInputElement).value = '';
      (document.getElementById('couponMaxUses') as HTMLInputElement).value = '';
      (document.getElementById('couponValidFrom') as HTMLInputElement).value = new Date().toISOString().split('T')[0];
      (document.getElementById('couponValidUntil') as HTMLInputElement).value = '';
      modal.classList.add('active');
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const editId = (document.getElementById('couponEditId') as HTMLInputElement).value;
      const code = (document.getElementById('couponCode') as HTMLInputElement).value.trim().toUpperCase();
      const discount = parseInt((document.getElementById('couponDiscount') as HTMLInputElement).value);
      const maxUses = parseInt((document.getElementById('couponMaxUses') as HTMLInputElement).value);
      const validFrom = (document.getElementById('couponValidFrom') as HTMLInputElement).value;
      const validUntil = (document.getElementById('couponValidUntil') as HTMLInputElement).value;

      if (!code || !discount || !maxUses || !validFrom || !validUntil) return;

      const payload = {
        code,
        discount_percent: discount,
        max_uses: maxUses,
        valid_from: new Date(validFrom).toISOString(),
        valid_until: new Date(validUntil + 'T23:59:59').toISOString(),
        active: true,
      };

      if (editId) {
        await adminUpdate('gdrums_coupons', editId, payload);
      } else {
        await adminInsert('gdrums_coupons', payload);
      }

      modal.classList.remove('active');
      await this.loadData();
      this.renderCoupons();
      modalManager.show('Admin', editId ? 'Cupom atualizado!' : `Cupom ${code} criado!`, 'success');
    });

    modal.querySelectorAll('[data-modal]').forEach(btn => {
      btn.addEventListener('click', () => modal.classList.remove('active'));
    });
  }

  private renderCoupons(): void {
    const tbody = document.getElementById('couponsTableBody');
    if (!tbody) return;

    if (this.coupons.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="padding:0;">${emptyState({
        title: 'Nenhum cupom criado',
        desc: 'Crie cupons promocionais com desconto, limite de uso e validade.',
        ctaLabel: '+ Novo Cupom',
        ctaId: 'emptyCouponCTA',
        inline: true,
      })}</td></tr>`;
      document.getElementById('emptyCouponCTA')?.addEventListener('click', () => {
        document.getElementById('addCouponBtn')?.click();
      });
      return;
    }

    tbody.innerHTML = this.coupons.map(c => {
      const now = new Date();
      const isExpired = new Date(c.valid_until) < now;
      const isFull = c.current_uses >= c.max_uses;
      const isActive = c.active && !isExpired && !isFull;

      const statusBadge = isActive
        ? '<span class="badge badge-success">Ativo</span>'
        : isExpired
          ? '<span class="badge badge-error">Expirado</span>'
          : isFull
            ? '<span class="badge badge-warning">Esgotado</span>'
            : '<span class="badge badge-error">Inativo</span>';

      const from = new Date(c.valid_from).toLocaleDateString('pt-BR');
      const until = new Date(c.valid_until).toLocaleDateString('pt-BR');

      return `
        <tr>
          <td><strong style="letter-spacing:0.5px;">${c.code}</strong></td>
          <td>${c.discount_percent}%</td>
          <td>${c.current_uses} / ${c.max_uses}</td>
          <td>${from}</td>
          <td>${until}</td>
          <td>${statusBadge}</td>
          <td>
            <div class="action-buttons">
              <button class="btn-action btn-edit" data-coupon-edit="${c.id}">Editar</button>
              <button class="btn-action ${c.active ? 'btn-delete' : 'btn-edit'}" data-coupon-toggle="${c.id}">
                ${c.active ? 'Desativar' : 'Ativar'}
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('[data-coupon-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.couponEdit!;
        const coupon = this.coupons.find(c => c.id === id);
        if (!coupon) return;

        const modal = document.getElementById('couponModal')!;
        (document.getElementById('couponModalTitle') as HTMLElement).textContent = 'Editar Cupom';
        (document.getElementById('couponEditId') as HTMLInputElement).value = coupon.id;
        (document.getElementById('couponCode') as HTMLInputElement).value = coupon.code;
        (document.getElementById('couponCode') as HTMLInputElement).disabled = true;
        (document.getElementById('couponDiscount') as HTMLInputElement).value = coupon.discount_percent.toString();
        (document.getElementById('couponMaxUses') as HTMLInputElement).value = coupon.max_uses.toString();
        (document.getElementById('couponValidFrom') as HTMLInputElement).value = new Date(coupon.valid_from).toISOString().split('T')[0];
        (document.getElementById('couponValidUntil') as HTMLInputElement).value = new Date(coupon.valid_until).toISOString().split('T')[0];
        modal.classList.add('active');
      });
    });

    tbody.querySelectorAll('[data-coupon-toggle]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.couponToggle!;
        const coupon = this.coupons.find(c => c.id === id);
        if (!coupon) return;

        await adminUpdate('gdrums_coupons', id, { active: !coupon.active });
        await this.loadData();
        this.renderCoupons();
        modalManager.show('Admin', `Cupom ${coupon.code} ${coupon.active ? 'desativado' : 'ativado'}!`, 'success');
      });
    });
  }

  // ─── Afiliados ─────────────────────────────────────────────────────

  private affiliates: any[] = [];

  private setupAffiliateForm(): void {
    const modal = document.getElementById('affiliateModal');
    const form = document.getElementById('affiliateForm');
    if (!modal || !form) return;

    document.getElementById('addAffiliateBtn')?.addEventListener('click', () => {
      modal.classList.add('active');
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = (document.getElementById('affName') as HTMLInputElement).value.trim();
      const email = (document.getElementById('affEmail2') as HTMLInputElement).value.trim();
      const password = (document.getElementById('affPass') as HTMLInputElement).value;
      const phone = (document.getElementById('affPhone') as HTMLInputElement).value.replace(/\D/g, '') || null;
      const pix_key = (document.getElementById('affPix') as HTMLInputElement).value.trim() || null;
      const coupon_code = (document.getElementById('affCoupon') as HTMLInputElement).value.trim().toUpperCase();
      const coupon_discount_percent = parseInt((document.getElementById('affDiscount') as HTMLInputElement).value) || 10;
      const commission_percent = parseInt((document.getElementById('affCommission2') as HTMLInputElement).value) || 20;

      if (!name || !email || !password || !coupon_code) return;

      try {
        const token = await getAuthToken();
        const res = await fetch('https://qsfziivubwdgtmwyztfw.supabase.co/functions/v1/affiliate-api', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            action: 'create',
            name, email, password, phone, pix_key,
            coupon_code, coupon_discount_percent, commission_percent,
          }),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          modalManager.show('Erro', data.error || 'Erro ao criar afiliado', 'error');
          return;
        }
        modal.classList.remove('active');
        (form as HTMLFormElement).reset();
        await this.loadAffiliates();
        this.renderAffiliates();
        modalManager.show('Afiliados', `Afiliado ${name} criado com cupom ${coupon_code}!`, 'success');
      } catch (e) {
        modalManager.show('Erro', String(e), 'error');
      }
    });

    modal.querySelectorAll('[data-modal]').forEach(btn => {
      btn.addEventListener('click', () => modal.classList.remove('active'));
    });
  }

  private async loadAffiliates(): Promise<void> {
    // Prioridade: RPC admin_affiliate_stats (stats calculados ao vivo).
    // Fallback: edge function affiliate-api (sem stats fresh).
    try {
      const stats = await adminRpc('admin_affiliate_stats');
      if (Array.isArray(stats) && stats.length > 0) {
        // Normaliza aff_* → nomes sem prefixo pro render
        this.affiliates = stats.map((s: any) => ({
          id: s.aff_id,
          name: s.aff_name,
          email: s.aff_email,
          phone: s.aff_phone,
          pix_key: s.aff_pix_key,
          coupon_code: s.aff_coupon_code,
          commission_percent: s.aff_commission_percent,
          coupon_discount_percent: s.aff_coupon_discount_percent,
          active: s.aff_active,
          created_at: s.aff_created_at,
          paid_commission: s.paid_commission_cents,
          paid_commission_cents: s.paid_commission_cents,
          total_sales: s.total_sales,
          total_revenue: s.total_revenue_cents,
          total_revenue_cents: s.total_revenue_cents,
          total_commission: s.total_commission_cents,
          total_commission_cents: s.total_commission_cents,
          pending_commission_cents: s.pending_commission_cents,
          last_sale_at: s.last_sale_at,
          coupon_uses: s.coupon_uses,
          coupon_max_uses: s.coupon_max_uses,
        }));
        return;
      }
    } catch (e) {
      console.warn('[admin] admin_affiliate_stats RPC falhou, tentando edge fn:', e);
    }

    try {
      const token = await getAuthToken();
      const res = await fetch('https://qsfziivubwdgtmwyztfw.supabase.co/functions/v1/affiliate-api', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'list' }),
      });
      const data = await res.json();
      this.affiliates = Array.isArray(data) ? data : [];
    } catch {
      this.affiliates = [];
    }
  }

  private renderAffiliates(): void {
    const content = document.getElementById('affiliatesContent');
    const summary = document.getElementById('affiliatesSummary');
    const subtitle = document.getElementById('affiliatesSubtitle');
    if (!content) return;

    // Sem afiliados → empty state
    if (this.affiliates.length === 0) {
      if (summary) summary.style.display = 'none';
      if (subtitle) subtitle.textContent = 'Parceiros que divulgam o GDrums';
      content.innerHTML = emptyState({
        title: 'Nenhum afiliado cadastrado',
        desc: 'Afiliados recebem um cupom exclusivo e ganham comissão em cada venda feita através dele.',
        ctaLabel: '+ Novo Afiliado',
        ctaId: 'emptyAffiliateCTA',
      });
      document.getElementById('emptyAffiliateCTA')?.addEventListener('click', () => {
        document.getElementById('affiliateModal')?.classList.add('active');
      });
      return;
    }

    // Estatísticas agregadas (para strip superior)
    const totalPending = this.affiliates.reduce((s, a) => {
      const pending = (a.pending_commission_cents ?? (a.total_commission - a.paid_commission)) || 0;
      return s + pending;
    }, 0);
    const totalRevenue = this.affiliates.reduce((s, a) => s + ((a.total_revenue_cents ?? a.total_revenue) || 0), 0);
    const totalSales = this.affiliates.reduce((s, a) => s + ((a.total_sales || 0) as number), 0);
    const activeCount = this.affiliates.filter(a => a.active).length;

    if (subtitle) {
      subtitle.textContent = `${activeCount} ativos · ${totalSales} vendas · ${fmtBRL(totalRevenue)} movimentados`;
    }

    if (summary) {
      summary.style.display = 'flex';
      summary.innerHTML = `
        <span><strong style="color:var(--a-gold);">${fmtBRLFull(totalPending)}</strong> em comissões a pagar</span>
        <span style="color:var(--a-text3);">·</span>
        <span><strong>${totalSales}</strong> vendas totais</span>
        <span style="color:var(--a-text3);">·</span>
        <span><strong>${fmtBRL(totalRevenue)}</strong> em receita</span>
      `;
    }

    // Cards
    content.innerHTML = `<div class="adm-affiliates-grid">${
      this.affiliates.map(a => {
        const pending = (a.pending_commission_cents ?? (a.total_commission - a.paid_commission)) || 0;
        const totalComm = (a.total_commission_cents ?? a.total_commission) || 0;
        const paidComm = (a.paid_commission_cents ?? a.paid_commission) || 0;
        const revenue = (a.total_revenue_cents ?? a.total_revenue) || 0;
        const lastSale = a.last_sale_at ? relativeTime(a.last_sale_at) : 'nenhuma';
        const couponUses = a.coupon_uses ?? 0;
        const couponMax = a.coupon_max_uses ?? 0;

        return `
          <div class="adm-aff-card ${a.active ? '' : 'inactive'}">
            <div class="adm-aff-head">
              <div style="min-width:0;flex:1;">
                <div class="adm-aff-name">${a.name}</div>
                <div class="adm-aff-email" title="${a.email || ''}">${a.email || ''}</div>
              </div>
              <span class="adm-aff-coupon" title="Cupom exclusivo">${a.coupon_code}</span>
            </div>

            <div class="adm-aff-pending ${pending > 0 ? '' : 'zero'}">
              <div>
                <div class="adm-aff-pending-label">Comissão a pagar</div>
                <div class="adm-aff-pending-value">${fmtBRLFull(pending)}</div>
              </div>
              ${pending > 0 ? `<button class="adm-btn adm-btn-primary adm-btn-sm" data-pay-affiliate="${a.id}" data-pay-amount="${pending}">Pagar PIX</button>` : ''}
            </div>

            <div class="adm-aff-stats">
              <div class="adm-aff-stat">
                <span class="adm-aff-stat-label">Vendas</span>
                <span class="adm-aff-stat-value">${a.total_sales || 0}</span>
              </div>
              <div class="adm-aff-stat">
                <span class="adm-aff-stat-label">Receita</span>
                <span class="adm-aff-stat-value">${fmtBRL(revenue)}</span>
              </div>
              <div class="adm-aff-stat">
                <span class="adm-aff-stat-label">Comissão total</span>
                <span class="adm-aff-stat-value">${fmtBRL(totalComm)}</span>
              </div>
            </div>

            <div class="adm-aff-meta">
              <span>Última venda: <strong>${lastSale}</strong></span>
              <span style="color:var(--a-text3);">·</span>
              <span>Cupom: <strong>${couponUses}${couponMax > 0 && couponMax < 9999 ? `/${couponMax}` : ''} usos</strong></span>
              ${paidComm > 0 ? `<span style="color:var(--a-text3);">·</span><span>Pago: <strong>${fmtBRL(paidComm)}</strong></span>` : ''}
            </div>

            <div class="adm-aff-actions">
              <button class="adm-btn adm-btn-outline adm-btn-sm" data-toggle-affiliate="${a.id}">${a.active ? 'Desativar' : 'Ativar'}</button>
              ${a.pix_key ? `<button class="adm-btn adm-btn-ghost adm-btn-sm" data-copy-pix="${a.pix_key.replace(/"/g, '&quot;')}">Copiar PIX</button>` : ''}
            </div>
          </div>
        `;
      }).join('')
    }</div>`;

    // Pagar comissão
    content.querySelectorAll('[data-pay-affiliate]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.payAffiliate!;
        const amount = parseInt((btn as HTMLElement).dataset.payAmount || '0');
        const aff = this.affiliates.find(a => a.id === id);
        if (!confirm(`Marcar pagamento de ${fmtBRLFull(amount)} pra ${aff?.name}?\n\nIsso adiciona ao "paid_commission" — faça o PIX manualmente antes.`)) return;

        try {
          const token = await getAuthToken();
          const res = await fetch('https://qsfziivubwdgtmwyztfw.supabase.co/functions/v1/affiliate-api', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ action: 'pay', affiliate_id: id, amount }),
          });
          if (!res.ok) throw new Error('payment failed');
          await this.loadAffiliates();
          this.renderAffiliates();
          modalManager.show('Afiliados', `Pagamento de ${fmtBRLFull(amount)} registrado!`, 'success');
        } catch {
          modalManager.show('Erro', 'Erro ao registrar pagamento', 'error');
        }
      });
    });

    // Toggle ativo/inativo
    content.querySelectorAll('[data-toggle-affiliate]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.toggleAffiliate!;
        const aff = this.affiliates.find(a => a.id === id);
        if (!aff) return;

        await adminCall({
          action: 'update',
          table: 'gdrums_affiliates',
          id,
          data: { active: !aff.active, updated_at: new Date().toISOString() },
        });
        await this.loadAffiliates();
        this.renderAffiliates();
        modalManager.show('Afiliados', `${aff.name} ${aff.active ? 'desativado' : 'ativado'}`, 'success');
      });
    });

    // Copy PIX
    content.querySelectorAll('[data-copy-pix]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const pix = (btn as HTMLElement).dataset.copyPix || '';
        try {
          await navigator.clipboard.writeText(pix);
          const original = (btn as HTMLElement).textContent;
          (btn as HTMLElement).textContent = 'Copiado!';
          setTimeout(() => { (btn as HTMLElement).textContent = original || 'Copiar PIX'; }, 1500);
        } catch {
          modalManager.show('PIX', pix, 'info');
        }
      });
    });
  }

  // ─── Saques (Payouts) ─────────────────────────────────────────────
  private payoutsStatus: 'pending' | 'paid' | 'canceled' | 'all' = 'pending';
  private payoutsList: any[] = [];
  private payoutsBound = false;

  private async renderPayouts(): Promise<void> {
    const content = document.getElementById('payoutsContent');
    const summary = document.getElementById('payoutsSummary');
    const subtitle = document.getElementById('payoutsSubtitle');
    const filter = document.getElementById('payoutsStatusFilter') as HTMLSelectElement | null;
    if (!content) return;

    // Bind só uma vez pros eventos do filter/refresh
    if (!this.payoutsBound) {
      this.payoutsBound = true;
      filter?.addEventListener('change', () => {
        this.payoutsStatus = (filter.value as any) || 'pending';
        this.renderPayouts();
      });
      document.getElementById('refreshPayoutsBtn')?.addEventListener('click', () => this.renderPayouts());
    }
    if (filter) filter.value = this.payoutsStatus;

    // Skeleton imediato
    content.innerHTML = `<div class="adm-affiliates-grid">${
      Array.from({ length: 2 }).map(() => `
        <div class="adm-aff-card">
          <span class="adm-skel" style="width:60%;height:16px;display:block;margin-bottom:0.35rem;"></span>
          <span class="adm-skel" style="width:40%;height:10px;display:block;margin-bottom:0.75rem;"></span>
          <span class="adm-skel" style="width:100%;height:50px;display:block;"></span>
        </div>
      `).join('')
    }</div>`;

    // Busca lista de saques via edge fn affiliate-api
    try {
      const token = await getAuthToken();
      const res = await fetch('https://qsfziivubwdgtmwyztfw.supabase.co/functions/v1/affiliate-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: 'list_payouts',
          status: this.payoutsStatus === 'all' ? null : this.payoutsStatus,
        }),
      });
      const data = await res.json();
      this.payoutsList = Array.isArray(data) ? data : [];
    } catch (e) {
      console.error('[admin] list_payouts falhou:', e);
      this.payoutsList = [];
    }

    // Summary
    const totalPending = this.payoutsList.filter(p => p.status === 'pending').reduce((s, p) => s + (p.amount_cents || 0), 0);
    const countPending = this.payoutsList.filter(p => p.status === 'pending').length;
    if (subtitle) {
      subtitle.textContent = `${this.payoutsList.length} ${this.payoutsStatus === 'all' ? 'total' : this.payoutsStatus === 'pending' ? 'pendentes' : this.payoutsStatus === 'paid' ? 'pagos' : 'cancelados'}`;
    }
    if (summary && countPending > 0) {
      summary.style.display = 'flex';
      summary.innerHTML = `
        <span><strong style="color:var(--a-gold);">${fmtBRLFull(totalPending)}</strong> em saques a pagar</span>
        <span style="color:var(--a-text3);">·</span>
        <span>${countPending} ${countPending === 1 ? 'solicitação pendente' : 'solicitações pendentes'}</span>
      `;
    } else if (summary) {
      summary.style.display = 'none';
    }

    // Empty
    if (this.payoutsList.length === 0) {
      content.innerHTML = emptyState({
        title: this.payoutsStatus === 'pending' ? 'Nada pendente' : 'Nenhum saque no filtro',
        desc: this.payoutsStatus === 'pending'
          ? 'Todas as solicitações foram processadas ou ainda não houve pedidos.'
          : 'Ajuste o filtro acima pra ver outros status.',
      });
      return;
    }

    // Cards
    content.innerHTML = `<div class="adm-affiliates-grid">${
      this.payoutsList.map(p => {
        const statusClass = p.status === 'pending' ? 'badge-warning'
          : p.status === 'paid' ? 'badge-success' : 'badge-error';
        const statusLabel = p.status === 'pending' ? 'pendente'
          : p.status === 'paid' ? 'pago' : 'cancelado';
        const requested = relativeTime(p.requested_at);
        const paid = p.paid_at ? relativeTime(p.paid_at) : null;
        return `
          <div class="adm-aff-card">
            <div class="adm-aff-head">
              <div style="min-width:0;flex:1;">
                <div class="adm-aff-name">${p.affiliate_name}</div>
                <div class="adm-aff-email" title="${p.affiliate_email || ''}">${p.affiliate_email || ''}</div>
              </div>
              <span class="badge ${statusClass}">${statusLabel}</span>
            </div>

            <div class="adm-aff-pending" style="background:linear-gradient(135deg,rgba(0,212,255,0.08),rgba(0,212,255,0.02));border-color:rgba(0,212,255,0.2);">
              <div>
                <div class="adm-aff-pending-label">Valor do saque</div>
                <div class="adm-aff-pending-value" style="color:var(--a-cyan);">${fmtBRLFull(p.amount_cents)}</div>
              </div>
            </div>

            <div style="font-size:0.78rem;color:var(--a-text2);display:flex;flex-direction:column;gap:0.25rem;">
              <div><strong style="color:var(--a-text);">Chave PIX:</strong> <span class="cell-mono">${p.pix_key}</span>${p.pix_key_label ? ` <span style="color:var(--a-text3);">(${p.pix_key_label})</span>` : ''}</div>
              <div><strong style="color:var(--a-text);">Solicitado:</strong> ${requested}</div>
              ${paid ? `<div><strong style="color:var(--a-text);">Pago:</strong> ${paid}</div>` : ''}
              ${p.admin_note ? `<div style="color:var(--a-text3);font-style:italic;">nota: ${p.admin_note}</div>` : ''}
            </div>

            <div class="adm-aff-actions">
              <button class="adm-btn adm-btn-ghost adm-btn-sm" data-copy-pix="${(p.pix_key || '').replace(/"/g, '&quot;')}">Copiar PIX</button>
              ${p.status === 'pending' ? `
                <button class="adm-btn adm-btn-primary adm-btn-sm" data-mark-paid="${p.payout_id}">Marcar como pago</button>
                <button class="adm-btn adm-btn-outline adm-btn-sm" data-cancel="${p.payout_id}">Cancelar</button>
              ` : ''}
            </div>
          </div>
        `;
      }).join('')
    }</div>`;

    // Bind ações
    content.querySelectorAll<HTMLElement>('[data-copy-pix]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const pix = btn.dataset.copyPix || '';
        try {
          await navigator.clipboard.writeText(pix);
          const original = btn.textContent;
          btn.textContent = 'Copiado!';
          setTimeout(() => { btn.textContent = original || 'Copiar PIX'; }, 1500);
        } catch {
          modalManager.show('PIX', pix, 'info');
        }
      });
    });

    content.querySelectorAll<HTMLElement>('[data-mark-paid]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.markPaid!;
        const row = this.payoutsList.find(p => p.payout_id === id);
        if (!row) return;
        if (!confirm(`Confirmar que você já pagou ${fmtBRLFull(row.amount_cents)} pra ${row.affiliate_name}?\n\nIsso adiciona ao paid_commission e marca o saque como pago.`)) return;
        try {
          const token = await getAuthToken();
          const res = await fetch('https://qsfziivubwdgtmwyztfw.supabase.co/functions/v1/affiliate-api', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ action: 'mark_payout_paid', payout_id: id }),
          });
          if (!res.ok) throw new Error('falha');
          await this.renderPayouts();
          modalManager.show('Saques', 'Saque marcado como pago!', 'success');
        } catch {
          modalManager.show('Erro', 'Não foi possível marcar como pago', 'error');
        }
      });
    });

    content.querySelectorAll<HTMLElement>('[data-cancel]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.cancel!;
        const note = prompt('Motivo do cancelamento (opcional):');
        if (note === null) return; // usuário cancelou
        try {
          const token = await getAuthToken();
          await fetch('https://qsfziivubwdgtmwyztfw.supabase.co/functions/v1/affiliate-api', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ action: 'cancel_payout', payout_id: id, admin_note: note || null }),
          });
          await this.renderPayouts();
          modalManager.show('Saques', 'Saque cancelado', 'info');
        } catch {
          modalManager.show('Erro', 'Não foi possível cancelar', 'error');
        }
      });
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new AdminDashboard();
});
