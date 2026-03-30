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
    await this.loadData();
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
    }
  }

  // ─── Dashboard ──────────────────────────────────────────────────────

  private renderDashboard(): void {
    const adminIds = new Set(this.profiles.filter(p => p.role === 'admin').map(p => p.id));

    const realUsers = this.profiles.filter(p => p.role !== 'admin');
    const total = realUsers.length;
    const active = realUsers.filter(p =>
      p.subscription_status === 'active' && p.subscription_plan !== 'free' && p.subscription_plan !== 'trial'
    ).length;
    const trials = realUsers.filter(p => p.subscription_status === 'trial').length;
    const confirmed = this.transactions.filter(t => t.status === 'confirmed' && !adminIds.has(t.user_id));
    const revenue = confirmed.reduce((sum, t) => sum + (t.amount_cents || 0), 0);

    const el = (id: string) => document.getElementById(id);
    if (el('totalUsers')) el('totalUsers')!.textContent = total.toString();
    if (el('activeSubscriptions')) el('activeSubscriptions')!.textContent = active.toString();
    if (el('totalRevenue')) el('totalRevenue')!.textContent = `R$ ${(revenue / 100).toFixed(2)}`;
    if (el('growthRate')) el('growthRate')!.textContent = `${trials}`;

    // Resumo por plano (sem admins)
    const planCounts: Record<string, number> = {};
    realUsers.forEach(p => {
      if (p.subscription_status === 'active' || p.subscription_status === 'trial') {
        planCounts[p.subscription_plan] = (planCounts[p.subscription_plan] || 0) + 1;
      }
    });

    const chartEl = el('usersChart');
    if (chartEl) {
      chartEl.innerHTML = `
        <div style="padding:1rem;">
          <h4 style="color:#fff;margin:0 0 1rem;font-size:0.9rem;">Distribuição por plano</h4>
          ${Object.entries(planCounts).map(([plan, count]) => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0;border-bottom:1px solid rgba(255,255,255,0.05);">
              <span style="color:rgba(255,255,255,0.7);font-size:0.85rem;text-transform:capitalize;">${plan || 'sem plano'}</span>
              <span style="color:#00D4FF;font-weight:700;font-size:0.85rem;">${count}</span>
            </div>
          `).join('')}
        </div>
      `;
    }

    const txChartEl = el('subscriptionsChart');
    if (txChartEl) {
      const recent = this.transactions.filter(t => !adminIds.has(t.user_id)).slice(0, 5);
      txChartEl.innerHTML = `
        <div style="padding:1rem;">
          <h4 style="color:#fff;margin:0 0 1rem;font-size:0.9rem;">Últimas transações</h4>
          ${recent.length === 0 ? '<p style="color:rgba(255,255,255,0.3);font-size:0.8rem;">Nenhuma transação</p>' : ''}
          ${recent.map(t => {
            const user = this.profiles.find(p => p.id === t.user_id);
            const statusColor = t.status === 'confirmed' ? '#00D4FF' : t.status === 'pending' ? '#F97316' : '#ff3366';
            return `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:0.8rem;">
                <div>
                  <span style="color:rgba(255,255,255,0.7);">${user?.name || 'Desconhecido'}</span>
                  <span style="color:rgba(255,255,255,0.3);margin-left:0.5rem;">${t.plan}</span>
                </div>
                <div>
                  <span style="color:${statusColor};font-weight:600;">R$ ${(t.amount_cents / 100).toFixed(2)}</span>
                  <span style="color:rgba(255,255,255,0.2);margin-left:0.5rem;">${t.payment_method || ''}</span>
                </div>
              </div>
            `;
          }).join('')}
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
        p.subscription_status === this.userFilter;
      return matchSearch && matchFilter;
    });

    tbody.innerHTML = filtered.map(p => {
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

    tbody.innerHTML = filtered.map(t => {
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

    const summaryEl = document.getElementById('transactionsSummary');
    if (summaryEl) {
      summaryEl.innerHTML = `
        <span style="color:#00D4FF;font-weight:600;">Confirmado: R$ ${(confirmedTotal / 100).toFixed(2)}</span>
        <span style="color:#F97316;font-weight:600;margin-left:1.5rem;">Pendente: R$ ${(pendingTotal / 100).toFixed(2)}</span>
        <span style="color:rgba(255,255,255,0.3);margin-left:1.5rem;">${filtered.length} transações</span>
      `;
    }
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
}

window.addEventListener('DOMContentLoaded', () => {
  new AdminDashboard();
});
