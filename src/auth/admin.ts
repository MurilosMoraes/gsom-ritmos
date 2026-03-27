// Admin Dashboard — dados reais do Supabase

import { supabase } from './supabase';
import { ModalManager } from '../ui/ModalManager';

const modalManager = new ModalManager();
const SUPABASE_URL = 'https://qsfziivubwdgtmwyztfw.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFzZnppaXZ1YndkZ3Rtd3l6dGZ3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjUwNjk3NiwiZXhwIjoyMDg4MDgyOTc2fQ.n5oz5D9TqkHSoYGPT7G2hGFxO5mvkvC9yA39UbNs-CE';

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

// Helper pra chamar Supabase com service_role (admin precisa ver todos os dados)
async function adminFetch(table: string, params: string = ''): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
  });
  return res.json();
}

async function adminUpdate(table: string, id: string, data: Record<string, any>): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(data),
  });
}

class AdminDashboard {
  private profiles: Profile[] = [];
  private transactions: Transaction[] = [];
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

    // Verificar admin via service_role (não confiar no client)
    const profiles = await adminFetch('gdrums_profiles', `id=eq.${user.id}&select=role`);
    if (!profiles[0] || profiles[0].role !== 'admin') {
      window.location.href = '/';
      return;
    }

    const adminName = document.getElementById('adminUserName');
    if (adminName) adminName.textContent = user.user_metadata?.name || 'Admin';

    this.setupEvents();
    await this.loadData();
    this.render();
  }

  private setupEvents(): void {
    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await supabase.auth.signOut();
      window.location.href = '/login.html';
    });

    document.querySelectorAll('.nav-item').forEach(item => {
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
    this.profiles = await adminFetch('gdrums_profiles', 'select=*&order=created_at.desc');
    this.transactions = await adminFetch('gdrums_transactions', 'select=*&order=created_at.desc');
  }

  private switchSection(section: string): void {
    this.currentSection = section;
    document.querySelectorAll('.nav-item').forEach(i => {
      i.classList.toggle('active', (i as HTMLElement).dataset.section === section);
    });
    document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
    document.getElementById(`${section}Section`)?.classList.add('active');
    this.render();
  }

  private render(): void {
    switch (this.currentSection) {
      case 'dashboard': this.renderDashboard(); break;
      case 'users': this.renderUsers(); break;
      case 'subscriptions': this.renderTransactions(); break;
    }
  }

  // ─── Dashboard ──────────────────────────────────────────────────────

  private renderDashboard(): void {
    const total = this.profiles.length;
    const active = this.profiles.filter(p =>
      p.subscription_status === 'active' && p.subscription_plan !== 'free' && p.subscription_plan !== 'trial'
    ).length;
    const trials = this.profiles.filter(p => p.subscription_status === 'trial').length;
    const confirmed = this.transactions.filter(t => t.status === 'confirmed');
    const revenue = confirmed.reduce((sum, t) => sum + (t.amount_cents || 0), 0);

    const el = (id: string) => document.getElementById(id);
    if (el('totalUsers')) el('totalUsers')!.textContent = total.toString();
    if (el('activeSubscriptions')) el('activeSubscriptions')!.textContent = active.toString();
    if (el('totalRevenue')) el('totalRevenue')!.textContent = `R$ ${(revenue / 100).toFixed(2)}`;
    if (el('growthRate')) el('growthRate')!.textContent = `${trials}`;

    // Resumo por plano
    const planCounts: Record<string, number> = {};
    this.profiles.forEach(p => {
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

    // Últimas transações
    const txChartEl = el('subscriptionsChart');
    if (txChartEl) {
      const recent = this.transactions.slice(0, 5);
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

    // Bind edit buttons
    tbody.querySelectorAll('[data-user-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const userId = (btn as HTMLElement).dataset.userId!;
        this.editUser(userId);
      });
    });

    // Bind block buttons
    tbody.querySelectorAll('[data-block-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = (btn as HTMLElement).dataset.blockId!;
        const profile = this.profiles.find(p => p.id === userId);
        if (!confirm(`Bloquear ${profile?.name}? O usuário não conseguirá mais acessar o app.`)) return;
        await this.blockUser(userId, true);
      });
    });

    // Bind unblock buttons
    tbody.querySelectorAll('[data-unblock-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = (btn as HTMLElement).dataset.unblockId!;
        await this.blockUser(userId, false);
      });
    });
  }

  private async blockUser(userId: string, block: boolean): Promise<void> {
    // 1. Desativar/ativar no Supabase Auth (impede login)
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ban_duration: block ? '876600h' : 'none', // 100 anos ou desbloquear
      }),
    });

    // 2. Atualizar status no perfil
    await adminUpdate('gdrums_profiles', userId, {
      subscription_status: block ? 'blocked' : 'expired',
      updated_at: new Date().toISOString(),
    });

    // 3. Atualizar local
    const idx = this.profiles.findIndex(p => p.id === userId);
    if (idx !== -1) {
      this.profiles[idx].subscription_status = block ? 'blocked' : 'expired';
    }

    this.renderUsers();
    this.renderDashboard();
    const profile = this.profiles.find(p => p.id === userId);
    modalManager.show('Admin', `${profile?.name} ${block ? 'bloqueado' : 'desbloqueado'}!`, block ? 'warning' : 'success');
  }

  private editUser(userId: string): void {
    const profile = this.profiles.find(p => p.id === userId);
    if (!profile) return;

    const modal = document.getElementById('editUserModal');
    if (!modal) return;

    (document.getElementById('editUserId') as HTMLInputElement).value = profile.id;
    (document.getElementById('editUserName') as HTMLInputElement).value = profile.name || '';
    (document.getElementById('editUserStatus') as HTMLSelectElement).value = profile.subscription_status;

    // Adicionar campo de plano e expiração se não existem
    let planInput = document.getElementById('editUserPlan') as HTMLSelectElement;
    let expiryInput = document.getElementById('editUserExpiry') as HTMLInputElement;

    if (!planInput) {
      const form = document.getElementById('editUserForm')!;
      const extraFields = document.createElement('div');
      extraFields.innerHTML = `
        <div class="form-group" style="margin-top:1rem;">
          <label>Plano</label>
          <select id="editUserPlan" class="form-input">
            <option value="free">Free</option>
            <option value="trial">Trial</option>
            <option value="mensal">Mensal</option>
            <option value="trimestral">Trimestral</option>
            <option value="semestral">Semestral</option>
            <option value="anual">Anual</option>
            <option value="rei-dos-palcos">Rei dos Palcos</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div class="form-group" style="margin-top:0.5rem;">
          <label>Expira em</label>
          <input type="date" id="editUserExpiry" class="form-input">
        </div>
      `;
      const submitBtn = form.querySelector('button[type="submit"]');
      form.insertBefore(extraFields, submitBtn);
      planInput = document.getElementById('editUserPlan') as HTMLSelectElement;
      expiryInput = document.getElementById('editUserExpiry') as HTMLInputElement;
    }

    planInput.value = profile.subscription_plan || 'free';
    expiryInput.value = profile.subscription_expires_at
      ? new Date(profile.subscription_expires_at).toISOString().split('T')[0]
      : '';

    // Remove old listener and add new
    const form = document.getElementById('editUserForm')!;
    const newForm = form.cloneNode(true) as HTMLFormElement;
    form.parentNode!.replaceChild(newForm, form);

    newForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const status = (document.getElementById('editUserStatus') as HTMLSelectElement).value;
      const plan = (document.getElementById('editUserPlan') as HTMLSelectElement).value;
      const expiry = (document.getElementById('editUserExpiry') as HTMLInputElement).value;

      await adminUpdate('gdrums_profiles', userId, {
        subscription_status: status,
        subscription_plan: plan,
        subscription_expires_at: expiry ? new Date(expiry).toISOString() : null,
        updated_at: new Date().toISOString(),
      });

      // Atualizar local
      const idx = this.profiles.findIndex(p => p.id === userId);
      if (idx !== -1) {
        this.profiles[idx].subscription_status = status;
        this.profiles[idx].subscription_plan = plan;
        this.profiles[idx].subscription_expires_at = expiry ? new Date(expiry).toISOString() : null;
      }

      modal.classList.remove('active');
      this.renderUsers();
      this.renderDashboard();
      modalManager.show('Admin', `Perfil de ${profile.name} atualizado!`, 'success');
    });

    modal.classList.add('active');

    // Close modal
    modal.querySelectorAll('.modal-close, [data-modal]').forEach(btn => {
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

    // Totais
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
}

window.addEventListener('DOMContentLoaded', () => {
  new AdminDashboard();
});
