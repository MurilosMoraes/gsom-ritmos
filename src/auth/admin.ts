// Admin Dashboard Script

import { authService } from './AuthService';
import type { User, DeviceInfo } from './AuthService';

interface Subscription {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  plan: string;
  status: 'active' | 'expired' | 'canceled';
  startDate: string;
  expiryDate: string;
  autoRenew: boolean;
  amount: number;
}

class AdminDashboard {
  private currentSection: string = 'dashboard';
  private users: User[] = [];
  private subscriptions: Subscription[] = [];

  // Pagination
  private usersCurrentPage: number = 1;
  private usersPerPage: number = 10;
  private subscriptionsCurrentPage: number = 1;
  private subscriptionsPerPage: number = 10;

  // Filters
  private userSearchQuery: string = '';
  private userStatusFilter: string = 'all';
  private subscriptionSearchQuery: string = '';
  private subscriptionStatusFilter: string = 'all';

  // Modal state
  private currentEditingUserId: string | null = null;
  private currentEditingSubscriptionId: string | null = null;
  private currentDeletingId: string | null = null;
  private currentDeletingType: 'user' | 'subscription' | null = null;

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    // Verificar se está autenticado e é admin
    if (!authService.isAuthenticated()) {
      window.location.href = '/login.html';
      return;
    }

    const user = authService.getUser();
    if (!user || user.role !== 'admin') {
      window.location.href = '/';
      return;
    }

    // Atualizar nome do admin
    const adminUserName = document.getElementById('adminUserName');
    if (adminUserName) {
      adminUserName.textContent = user.name;
    }

    this.setupEventListeners();
    await this.loadData();
    this.renderDashboard();
  }

  private setupEventListeners(): void {
    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    logoutBtn?.addEventListener('click', () => {
      authService.logout();
      window.location.href = '/login.html';
    });

    // Navigation
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const section = (item as HTMLElement).dataset.section;
        if (section) {
          this.switchSection(section);
        }
      });
    });

    // User search and filters
    const userSearchInput = document.getElementById('userSearchInput') as HTMLInputElement;
    userSearchInput?.addEventListener('input', () => {
      this.userSearchQuery = userSearchInput.value.trim().toLowerCase();
      this.usersCurrentPage = 1;
      this.renderUsersTable();
    });

    const userStatusFilter = document.getElementById('userStatusFilter') as HTMLSelectElement;
    userStatusFilter?.addEventListener('change', () => {
      this.userStatusFilter = userStatusFilter.value;
      this.usersCurrentPage = 1;
      this.renderUsersTable();
    });

    // Subscription search and filters
    const subscriptionSearchInput = document.getElementById('subscriptionSearchInput') as HTMLInputElement;
    subscriptionSearchInput?.addEventListener('input', () => {
      this.subscriptionSearchQuery = subscriptionSearchInput.value.trim().toLowerCase();
      this.subscriptionsCurrentPage = 1;
      this.renderSubscriptionsTable();
    });

    const subscriptionStatusFilter = document.getElementById('subscriptionStatusFilter') as HTMLSelectElement;
    subscriptionStatusFilter?.addEventListener('change', () => {
      this.subscriptionStatusFilter = subscriptionStatusFilter.value;
      this.subscriptionsCurrentPage = 1;
      this.renderSubscriptionsTable();
    });

    // Modal close buttons
    const modalCloseButtons = document.querySelectorAll('.modal-close, [data-modal]');
    modalCloseButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modal = (e.target as HTMLElement).dataset.modal ||
                     (e.target as HTMLElement).closest('[data-modal]')?.getAttribute('data-modal');
        if (modal) {
          this.closeModal(modal);
        }
      });
    });

    // Edit user form
    const editUserForm = document.getElementById('editUserForm') as HTMLFormElement;
    editUserForm?.addEventListener('submit', (e) => this.handleEditUserSubmit(e));

    // Edit subscription form
    const editSubscriptionForm = document.getElementById('editSubscriptionForm') as HTMLFormElement;
    editSubscriptionForm?.addEventListener('submit', (e) => this.handleEditSubscriptionSubmit(e));

    // Confirm delete
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    confirmDeleteBtn?.addEventListener('click', () => this.handleConfirmDelete());

    // Add user button
    const addUserBtn = document.getElementById('addUserBtn');
    addUserBtn?.addEventListener('click', () => this.addNewUser());
  }

  private switchSection(section: string): void {
    this.currentSection = section;

    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.remove('active');
      if ((item as HTMLElement).dataset.section === section) {
        item.classList.add('active');
      }
    });

    // Update sections
    document.querySelectorAll('.admin-section').forEach(sec => {
      sec.classList.remove('active');
    });

    const sectionElement = document.getElementById(`${section}Section`);
    if (sectionElement) {
      sectionElement.classList.add('active');
    }

    // Render appropriate content
    switch (section) {
      case 'dashboard':
        this.renderDashboard();
        break;
      case 'users':
        this.renderUsersTable();
        break;
      case 'subscriptions':
        this.renderSubscriptionsTable();
        break;
    }
  }

  private async loadData(): Promise<void> {
    // Em produção, isso seria uma chamada à API
    // Por enquanto, usamos dados mock
    this.users = this.generateMockUsers();
    this.subscriptions = this.generateMockSubscriptions();
  }

  private generateMockUsers(): User[] {
    const users: User[] = [];
    const names = ['João Silva', 'Maria Santos', 'Pedro Oliveira', 'Ana Costa', 'Carlos Souza',
                   'Juliana Lima', 'Ricardo Alves', 'Fernanda Rocha', 'Lucas Martins', 'Camila Ferreira'];
    const statuses: Array<'active' | 'inactive' | 'blocked'> = ['active', 'active', 'active', 'inactive', 'blocked'];

    for (let i = 0; i < 25; i++) {
      const name = names[i % names.length];
      const email = `${name.toLowerCase().replace(' ', '.')}${i}@example.com`;
      const status = statuses[i % statuses.length];

      users.push({
        id: `user_${i + 1}`,
        name: `${name} ${i + 1}`,
        email,
        role: 'user',
        status,
        subscription: {
          plan: 'professional',
          status: i % 4 === 0 ? 'expired' : 'active',
          startDate: new Date(2024, 0, 1).toISOString(),
          expiryDate: new Date(2025, i % 12, 1).toISOString(),
          autoRenew: i % 2 === 0
        },
        maxDevices: 2,
        devices: [
          {
            id: `device_${i}_1`,
            name: 'Chrome - Windows',
            fingerprint: `device_fp_${i}_1`,
            lastAccess: new Date(2024, 11, 10).toISOString(),
            ip: '192.168.1.1',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        ],
        createdAt: new Date(2024, 0, 1).toISOString(),
        lastLogin: new Date(2024, 11, 10).toISOString()
      });
    }

    return users;
  }

  private generateMockSubscriptions(): Subscription[] {
    return this.users.map(user => ({
      id: `sub_${user.id}`,
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      plan: user.subscription?.plan || 'professional',
      status: user.subscription?.status || 'active',
      startDate: user.subscription?.startDate || new Date().toISOString(),
      expiryDate: user.subscription?.expiryDate || new Date().toISOString(),
      autoRenew: user.subscription?.autoRenew || false,
      amount: 49.00
    }));
  }

  private renderDashboard(): void {
    const totalUsers = this.users.length;
    const activeSubscriptions = this.subscriptions.filter(s => s.status === 'active').length;
    const totalRevenue = activeSubscriptions * 49;
    const growthRate = 15.5; // Mock

    document.getElementById('totalUsers')!.textContent = totalUsers.toString();
    document.getElementById('activeSubscriptions')!.textContent = activeSubscriptions.toString();
    document.getElementById('totalRevenue')!.textContent = `R$ ${totalRevenue.toLocaleString('pt-BR')}`;
    document.getElementById('growthRate')!.textContent = `${growthRate}%`;

    // Em produção, aqui renderizaríamos os gráficos com Chart.js
    this.renderSimpleChart('usersChart', 'Usuários por dia');
    this.renderSimpleChart('subscriptionsChart', 'Status das assinaturas');
  }

  private renderSimpleChart(containerId: string, title: string): void {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `
      <div style="padding: 2rem; text-align: center; color: var(--text-secondary);">
        <p>Gráfico: ${title}</p>
        <p style="margin-top: 1rem; font-size: 0.875rem;">
          Integração com Chart.js será implementada na produção
        </p>
      </div>
    `;
  }

  private renderUsersTable(): void {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;

    // Filter users
    let filteredUsers = this.users.filter(user => {
      const matchesSearch = this.userSearchQuery === '' ||
        user.name.toLowerCase().includes(this.userSearchQuery) ||
        user.email.toLowerCase().includes(this.userSearchQuery);

      const matchesStatus = this.userStatusFilter === 'all' ||
        user.status === this.userStatusFilter;

      return matchesSearch && matchesStatus;
    });

    // Pagination
    const startIndex = (this.usersCurrentPage - 1) * this.usersPerPage;
    const endIndex = startIndex + this.usersPerPage;
    const paginatedUsers = filteredUsers.slice(startIndex, endIndex);

    // Render table rows
    tbody.innerHTML = paginatedUsers.map(user => {
      const statusClass = user.status === 'active' ? 'success' :
                         user.status === 'blocked' ? 'error' : 'warning';
      const subscriptionStatus = user.subscription?.status === 'active' ? 'Ativa' : 'Expirada';
      const subscriptionClass = user.subscription?.status === 'active' ? 'success' : 'error';
      const lastAccess = user.devices[0]?.lastAccess ?
        new Date(user.devices[0].lastAccess).toLocaleDateString('pt-BR') : 'Nunca';

      return `
        <tr>
          <td>${user.id}</td>
          <td>${user.name}</td>
          <td>${user.email}</td>
          <td><span class="badge badge-${statusClass}">${this.translateStatus(user.status)}</span></td>
          <td><span class="badge badge-${subscriptionClass}">${subscriptionStatus}</span></td>
          <td>${lastAccess}</td>
          <td>${user.devices.length}/${user.maxDevices}</td>
          <td>
            <div class="action-buttons">
              <button class="btn-action btn-edit" onclick="window.adminDashboard.editUser('${user.id}')">
                Editar
              </button>
              <button class="btn-action btn-delete" onclick="window.adminDashboard.deleteUser('${user.id}')">
                Excluir
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Render pagination
    this.renderPagination('usersPagination', filteredUsers.length, this.usersCurrentPage, this.usersPerPage, 'users');
  }

  private renderSubscriptionsTable(): void {
    const tbody = document.getElementById('subscriptionsTableBody');
    if (!tbody) return;

    // Filter subscriptions
    let filteredSubscriptions = this.subscriptions.filter(sub => {
      const matchesSearch = this.subscriptionSearchQuery === '' ||
        sub.userName.toLowerCase().includes(this.subscriptionSearchQuery) ||
        sub.userEmail.toLowerCase().includes(this.subscriptionSearchQuery);

      const matchesStatus = this.subscriptionStatusFilter === 'all' ||
        sub.status === this.subscriptionStatusFilter;

      return matchesSearch && matchesStatus;
    });

    // Pagination
    const startIndex = (this.subscriptionsCurrentPage - 1) * this.subscriptionsPerPage;
    const endIndex = startIndex + this.subscriptionsPerPage;
    const paginatedSubscriptions = filteredSubscriptions.slice(startIndex, endIndex);

    // Render table rows
    tbody.innerHTML = paginatedSubscriptions.map(sub => {
      const statusClass = sub.status === 'active' ? 'success' :
                         sub.status === 'canceled' ? 'error' : 'warning';
      const startDate = new Date(sub.startDate).toLocaleDateString('pt-BR');
      const expiryDate = new Date(sub.expiryDate).toLocaleDateString('pt-BR');

      return `
        <tr>
          <td>${sub.id}</td>
          <td>${sub.userName}</td>
          <td><span class="badge badge-primary">${sub.plan}</span></td>
          <td><span class="badge badge-${statusClass}">${this.translateSubscriptionStatus(sub.status)}</span></td>
          <td>${startDate}</td>
          <td>${expiryDate}</td>
          <td>R$ ${sub.amount.toFixed(2)}</td>
          <td>
            <div class="action-buttons">
              <button class="btn-action btn-edit" onclick="window.adminDashboard.editSubscription('${sub.id}')">
                Editar
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Render pagination
    this.renderPagination('subscriptionsPagination', filteredSubscriptions.length,
                         this.subscriptionsCurrentPage, this.subscriptionsPerPage, 'subscriptions');
  }

  private renderPagination(containerId: string, totalItems: number, currentPage: number,
                          itemsPerPage: number, type: 'users' | 'subscriptions'): void {
    const container = document.getElementById(containerId);
    if (!container) return;

    const totalPages = Math.ceil(totalItems / itemsPerPage);
    if (totalPages <= 1) {
      container.innerHTML = '';
      return;
    }

    let buttons = '';

    // Previous button
    buttons += `
      <button class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''}
              onclick="window.adminDashboard.changePage('${type}', ${currentPage - 1})">
        ← Anterior
      </button>
    `;

    // Page numbers
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
        buttons += `
          <button class="pagination-btn ${i === currentPage ? 'active' : ''}"
                  onclick="window.adminDashboard.changePage('${type}', ${i})">
            ${i}
          </button>
        `;
      } else if (i === currentPage - 3 || i === currentPage + 3) {
        buttons += '<span class="pagination-ellipsis">...</span>';
      }
    }

    // Next button
    buttons += `
      <button class="pagination-btn" ${currentPage === totalPages ? 'disabled' : ''}
              onclick="window.adminDashboard.changePage('${type}', ${currentPage + 1})">
        Próximo →
      </button>
    `;

    container.innerHTML = buttons;
  }

  public changePage(type: 'users' | 'subscriptions', page: number): void {
    if (type === 'users') {
      this.usersCurrentPage = page;
      this.renderUsersTable();
    } else {
      this.subscriptionsCurrentPage = page;
      this.renderSubscriptionsTable();
    }
  }

  public addNewUser(): void {
    this.currentEditingUserId = null;

    // Clear form
    (document.getElementById('editUserId') as HTMLInputElement).value = '';
    (document.getElementById('editUserName') as HTMLInputElement).value = '';
    (document.getElementById('editUserEmail') as HTMLInputElement).value = '';
    (document.getElementById('editUserStatus') as HTMLSelectElement).value = 'active';
    (document.getElementById('editUserMaxDevices') as HTMLInputElement).value = '2';

    // Change modal title
    const modalTitle = document.querySelector('#editUserModal .modal-header h3');
    if (modalTitle) {
      modalTitle.textContent = 'Adicionar Novo Usuário';
    }

    this.openModal('editUserModal');
  }

  public editUser(userId: string): void {
    const user = this.users.find(u => u.id === userId);
    if (!user) return;

    this.currentEditingUserId = userId;

    // Populate form
    (document.getElementById('editUserId') as HTMLInputElement).value = user.id;
    (document.getElementById('editUserName') as HTMLInputElement).value = user.name;
    (document.getElementById('editUserEmail') as HTMLInputElement).value = user.email;
    (document.getElementById('editUserStatus') as HTMLSelectElement).value = user.status;
    (document.getElementById('editUserMaxDevices') as HTMLInputElement).value = user.maxDevices.toString();

    // Change modal title back
    const modalTitle = document.querySelector('#editUserModal .modal-header h3');
    if (modalTitle) {
      modalTitle.textContent = 'Editar Usuário';
    }

    this.openModal('editUserModal');
  }

  public editSubscription(subscriptionId: string): void {
    const subscription = this.subscriptions.find(s => s.id === subscriptionId);
    if (!subscription) return;

    this.currentEditingSubscriptionId = subscriptionId;

    // Populate form
    (document.getElementById('editSubscriptionId') as HTMLInputElement).value = subscription.id;
    (document.getElementById('editSubscriptionStatus') as HTMLSelectElement).value = subscription.status;

    const expiryDate = new Date(subscription.expiryDate);
    const formattedDate = expiryDate.toISOString().split('T')[0];
    (document.getElementById('editSubscriptionExpiry') as HTMLInputElement).value = formattedDate;

    (document.getElementById('editSubscriptionAutoRenew') as HTMLSelectElement).value =
      subscription.autoRenew ? 'true' : 'false';

    this.openModal('editSubscriptionModal');
  }

  public deleteUser(userId: string): void {
    const user = this.users.find(u => u.id === userId);
    if (!user) return;

    this.currentDeletingId = userId;
    this.currentDeletingType = 'user';

    const deleteMessage = document.getElementById('deleteMessage');
    if (deleteMessage) {
      deleteMessage.textContent = `Tem certeza que deseja excluir o usuário "${user.name}"?`;
    }

    this.openModal('deleteModal');
  }

  private handleEditUserSubmit(e: Event): void {
    e.preventDefault();

    const name = (document.getElementById('editUserName') as HTMLInputElement).value;
    const email = (document.getElementById('editUserEmail') as HTMLInputElement).value;
    const status = (document.getElementById('editUserStatus') as HTMLSelectElement).value as 'active' | 'inactive' | 'blocked';
    const maxDevices = parseInt((document.getElementById('editUserMaxDevices') as HTMLInputElement).value);

    if (!name || !email) {
      alert('Por favor, preencha todos os campos obrigatórios.');
      return;
    }

    if (this.currentEditingUserId) {
      // Update existing user
      const userIndex = this.users.findIndex(u => u.id === this.currentEditingUserId);
      if (userIndex !== -1) {
        this.users[userIndex].name = name;
        this.users[userIndex].email = email;
        this.users[userIndex].status = status;
        this.users[userIndex].maxDevices = maxDevices;
      }
      alert('Usuário atualizado com sucesso!');
    } else {
      // Add new user
      const newUser: User = {
        id: `user_${Date.now()}`,
        name,
        email,
        role: 'user',
        status,
        subscription: {
          plan: 'professional',
          status: 'active',
          startDate: new Date().toISOString(),
          expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // +30 days
          autoRenew: true
        },
        maxDevices,
        devices: [],
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString()
      };

      this.users.push(newUser);

      // Add corresponding subscription
      this.subscriptions.push({
        id: `sub_${newUser.id}`,
        userId: newUser.id,
        userName: newUser.name,
        userEmail: newUser.email,
        plan: 'professional',
        status: 'active',
        startDate: newUser.subscription!.startDate,
        expiryDate: newUser.subscription!.expiryDate,
        autoRenew: true,
        amount: 49.00
      });

      alert('Usuário criado com sucesso!');
    }

    this.closeModal('editUserModal');
    this.renderUsersTable();
    this.renderDashboard();

    // Em produção, aqui seria uma chamada à API
  }

  private handleEditSubscriptionSubmit(e: Event): void {
    e.preventDefault();

    if (!this.currentEditingSubscriptionId) return;

    const status = (document.getElementById('editSubscriptionStatus') as HTMLSelectElement).value as 'active' | 'expired' | 'canceled';
    const expiryDate = (document.getElementById('editSubscriptionExpiry') as HTMLInputElement).value;
    const autoRenew = (document.getElementById('editSubscriptionAutoRenew') as HTMLSelectElement).value === 'true';

    // Update subscription
    const subIndex = this.subscriptions.findIndex(s => s.id === this.currentEditingSubscriptionId);
    if (subIndex !== -1) {
      this.subscriptions[subIndex].status = status;
      this.subscriptions[subIndex].expiryDate = new Date(expiryDate).toISOString();
      this.subscriptions[subIndex].autoRenew = autoRenew;

      // Update user's subscription too
      const user = this.users.find(u => u.id === this.subscriptions[subIndex].userId);
      if (user && user.subscription) {
        user.subscription.status = status;
        user.subscription.expiryDate = new Date(expiryDate).toISOString();
        user.subscription.autoRenew = autoRenew;
      }
    }

    this.closeModal('editSubscriptionModal');
    this.renderSubscriptionsTable();
    this.renderUsersTable();

    // Em produção, aqui seria uma chamada à API
    alert('Assinatura atualizada com sucesso!');
  }

  private handleConfirmDelete(): void {
    if (!this.currentDeletingId || !this.currentDeletingType) return;

    if (this.currentDeletingType === 'user') {
      // Remove user
      this.users = this.users.filter(u => u.id !== this.currentDeletingId);
      // Remove associated subscription
      this.subscriptions = this.subscriptions.filter(s => s.userId !== this.currentDeletingId);

      this.renderUsersTable();
      this.renderDashboard();

      // Em produção, aqui seria uma chamada à API
      alert('Usuário excluído com sucesso!');
    }

    this.closeModal('deleteModal');
    this.currentDeletingId = null;
    this.currentDeletingType = null;
  }

  private openModal(modalId: string): void {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
    }
  }

  private closeModal(modalId: string): void {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
    }
  }

  private translateStatus(status: string): string {
    const translations: Record<string, string> = {
      active: 'Ativo',
      inactive: 'Inativo',
      blocked: 'Bloqueado'
    };
    return translations[status] || status;
  }

  private translateSubscriptionStatus(status: string): string {
    const translations: Record<string, string> = {
      active: 'Ativa',
      expired: 'Expirada',
      canceled: 'Cancelada'
    };
    return translations[status] || status;
  }
}

// Initialize and expose to window
let adminDashboardInstance: AdminDashboard;

window.addEventListener('DOMContentLoaded', () => {
  adminDashboardInstance = new AdminDashboard();
  (window as any).adminDashboard = adminDashboardInstance;
});
