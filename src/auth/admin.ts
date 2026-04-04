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

class AdminDashboard {
  private profiles: Profile[] = [];
  private transactions: Transaction[] = [];
  private coupons: Coupon[] = [];
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
    if (!user) { window.location.href = '/login.html'; return; }

    // Verificar admin via Edge Function (service key fica no backend)
    try {
      const profiles = await adminCall({
        action: 'fetch',
        table: 'gdrums_profiles',
        params: { select: 'id,role', order: { column: 'created_at', ascending: false } },
      });
      const myProfile = profiles.find((p: any) => p.id === user.id);
      if (!myProfile || myProfile.role !== 'admin') {
        window.location.href = '/';
        return;
      }
    } catch {
      window.location.href = '/';
      return;
    }

    const adminName = document.getElementById('adminUserName');
    if (adminName) adminName.textContent = user.user_metadata?.name || 'Admin';

    this.setupEvents();
    this.setupEditForm();
    this.setupCouponForm();
    this.setupAffiliateForm();
    await this.loadData();
    await this.loadAffiliates();
    this.render();
  }

  private setupEvents(): void {
    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await supabase.auth.signOut();
      window.location.href = '/login.html';
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
      case 'users': this.renderUsers(); break;
      case 'subscriptions': this.renderTransactions(); break;
      case 'coupons': this.renderCoupons(); break;
      case 'leads': this.renderLeads(); break;
      case 'affiliates': this.renderAffiliates(); break;
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
    const conversionRate = trialsActive.length + active.length + expired.length > 0
      ? ((active.length / (trialsActive.length + active.length + expired.length)) * 100).toFixed(1)
      : '0';

    // Novos hoje
    const newToday = realUsers.filter(p => new Date(p.created_at) >= today).length;

    // ─── KPIs ─────────────────────────────────────────────────────
    const el = (id: string) => document.getElementById(id);
    const kpiGrid = el('kpiGrid');
    if (kpiGrid) {
      kpiGrid.innerHTML = `
        <div class="adm-kpi">
          <div class="adm-kpi-icon adm-kpi-blue"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/></svg></div>
          <div class="adm-kpi-body"><span class="adm-kpi-value">${realUsers.length}</span><span class="adm-kpi-label">Total usuarios</span></div>
        </div>
        <div class="adm-kpi">
          <div class="adm-kpi-icon adm-kpi-green"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
          <div class="adm-kpi-body"><span class="adm-kpi-value">${active.length}</span><span class="adm-kpi-label">Assinantes pagos</span></div>
        </div>
        <div class="adm-kpi">
          <div class="adm-kpi-icon adm-kpi-gold"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg></div>
          <div class="adm-kpi-body"><span class="adm-kpi-value">R$ ${(revenue / 100).toFixed(0)}</span><span class="adm-kpi-label">Faturamento</span></div>
        </div>
        <div class="adm-kpi">
          <div class="adm-kpi-icon adm-kpi-purple"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
          <div class="adm-kpi-body"><span class="adm-kpi-value">${trialsActive.length}</span><span class="adm-kpi-label">Em trial</span></div>
        </div>
        <div class="adm-kpi">
          <div class="adm-kpi-icon adm-kpi-red"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>
          <div class="adm-kpi-body"><span class="adm-kpi-value">${expired.length}</span><span class="adm-kpi-label">Expirados</span></div>
        </div>
        <div class="adm-kpi">
          <div class="adm-kpi-icon adm-kpi-orange"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></div>
          <div class="adm-kpi-body"><span class="adm-kpi-value">${conversionRate}%</span><span class="adm-kpi-label">Conversao</span></div>
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
    (document.getElementById('editUserPlan') as HTMLSelectElement).value = profile.subscription_plan || 'free';
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

    // Mensagem WhatsApp pronta
    const whatsMsg = (name: string) => {
      const first = (name || '').split(' ')[0] || 'Boa tarde';
      return encodeURIComponent(`Boa tarde ${first}! Tudo bem?\n\nVi que seu periodo de teste no GDrums acabou. Gostou da experiencia? Conseguiu testar com o pedal no ensaio?\n\nQueria te avisar que a gente ta com um cupom de lancamento com 30% de desconto em qualquer plano. O mensal sai por R$ 20 e pouco.\n\nO cupom e LANCAMENTO e vale ate dia 21/04.\n\nSe tiver alguma duvida sobre o app, pode me chamar aqui que te ajudo na hora.\n\nAbraco!`);
    };

    tbody.innerHTML = paged.map(l => {
      const expires = l.subscription_expires_at
        ? new Date(l.subscription_expires_at).toLocaleDateString('pt-BR')
        : '--';
      const isExpired = l.subscription_expires_at && new Date(l.subscription_expires_at) <= now;
      const expiresColor = isExpired ? 'var(--a-red)' : 'var(--a-gold)';

      // Contato (WhatsApp com mensagem pronta + email)
      const phoneLink = l.phone
        ? `<a href="https://wa.me/55${l.phone}?text=${whatsMsg(l.name)}" target="_blank" style="color:var(--a-green);text-decoration:none;font-size:0.7rem;" title="Abrir WhatsApp com mensagem">WhatsApp</a>`
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
      if (l.phone) {
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
        window.open(`https://wa.me/55${lead.phone}?text=${whatsMsg(lead.name)}`, '_blank');
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
      this.affiliates = await res.json();
    } catch {
      this.affiliates = [];
    }
  }

  private renderAffiliates(): void {
    const tbody = document.getElementById('affiliatesTableBody');
    if (!tbody) return;

    if (this.affiliates.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--a-text3);padding:2rem;">Nenhum afiliado cadastrado</td></tr>';
      return;
    }

    tbody.innerHTML = this.affiliates.map(a => {
      const commission = (a.total_commission || 0) / 100;
      const paid = (a.paid_commission || 0) / 100;
      const pending = commission - paid;

      return `
        <tr>
          <td>
            <div>${a.name}</div>
            <div style="font-size:0.65rem;color:var(--a-text3);">${a.email}</div>
          </td>
          <td><span class="badge badge-purple" style="letter-spacing:1px;">${a.coupon_code}</span></td>
          <td>${a.total_sales || 0}</td>
          <td style="color:var(--a-green);">R$ ${commission.toFixed(2)}</td>
          <td>R$ ${paid.toFixed(2)}</td>
          <td style="color:${pending > 0 ? 'var(--a-gold)' : 'var(--a-text3)'};">R$ ${pending.toFixed(2)}</td>
          <td>
            <div class="action-buttons">
              ${pending > 0 ? `<button class="btn-action btn-edit" data-pay-affiliate="${a.id}" data-pay-amount="${Math.round(pending * 100)}" style="font-size:0.6rem;">Pagar</button>` : ''}
              <button class="btn-action ${a.active ? 'btn-delete' : 'btn-edit'}" data-toggle-affiliate="${a.id}" style="font-size:0.6rem;">${a.active ? 'Desativar' : 'Ativar'}</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Pagar comissao
    tbody.querySelectorAll('[data-pay-affiliate]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.payAffiliate!;
        const amount = parseInt((btn as HTMLElement).dataset.payAmount || '0');
        const aff = this.affiliates.find(a => a.id === id);
        if (!confirm(`Marcar pagamento de R$ ${(amount/100).toFixed(2)} pra ${aff?.name}?`)) return;

        try {
          const token = await getAuthToken();
          await fetch('https://qsfziivubwdgtmwyztfw.supabase.co/functions/v1/affiliate-api', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ action: 'pay', affiliate_id: id, amount }),
          });
          await this.loadAffiliates();
          this.renderAffiliates();
          modalManager.show('Afiliados', `Pagamento de R$ ${(amount/100).toFixed(2)} registrado!`, 'success');
        } catch {
          modalManager.show('Erro', 'Erro ao registrar pagamento', 'error');
        }
      });
    });

    // Toggle ativo/inativo
    tbody.querySelectorAll('[data-toggle-affiliate]').forEach(btn => {
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
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new AdminDashboard();
});
