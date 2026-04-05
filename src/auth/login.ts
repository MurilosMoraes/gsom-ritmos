// Login Page — Supabase auth

import { authService } from './AuthService';
import { supabase } from './supabase';

class LoginPage {
  private form: HTMLFormElement;
  private emailInput: HTMLInputElement;
  private passwordInput: HTMLInputElement;
  private rememberMeCheckbox: HTMLInputElement;
  private loginBtn: HTMLButtonElement;
  private alertMessage: HTMLElement;

  constructor() {
    this.form = document.getElementById('loginForm') as HTMLFormElement;
    this.emailInput = document.getElementById('email') as HTMLInputElement;
    this.passwordInput = document.getElementById('password') as HTMLInputElement;
    this.rememberMeCheckbox = document.getElementById('rememberMe') as HTMLInputElement;
    this.loginBtn = document.getElementById('loginBtn') as HTMLButtonElement;
    this.alertMessage = document.getElementById('alertMessage') as HTMLElement;

    this.init();
  }

  private async init(): Promise<void> {
    // Se já logado, redirecionar direto
    if (await authService.isAuthenticated()) {
      window.location.href = await this.getDestination();
      return;
    }
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.form.addEventListener('submit', (e) => this.handleSubmit(e));
  }

  private async handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    if (!this.validateForm()) return;

    this.setLoading(true);
    this.hideAlert();

    const response = await authService.login({
      email: this.emailInput.value.trim(),
      password: this.passwordInput.value,
      rememberMe: this.rememberMeCheckbox.checked
    });

    if (response.success && response.user) {
      // Gerar sessão única (invalida outros devices)
      const sessionId = crypto.randomUUID();
      await supabase
        .from('gdrums_profiles')
        .update({ active_session_id: sessionId })
        .eq('id', response.user.id);
      localStorage.setItem('gdrums-session-id', sessionId);

      this.showAlert('Login realizado! Redirecionando...', 'success');
      const dest = await this.getDestination();
      setTimeout(() => { window.location.href = dest; }, 600);
    } else {
      this.showAlert(response.message || 'Erro ao fazer login', 'error');
      this.setLoading(false);
    }
  }

  private async getDestination(): Promise<string> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return '/plans.html';

      const { data: profile } = await supabase
        .from('gdrums_profiles')
        .select('subscription_status, subscription_expires_at')
        .eq('id', user.id)
        .single();

      const status = profile?.subscription_status;
      if ((status === 'active' || status === 'trial') && profile?.subscription_expires_at) {
        if (new Date(profile.subscription_expires_at) > new Date()) {
          return '/';
        }
      }
      return '/plans.html';
    } catch {
      return '/plans.html';
    }
  }

  private validateForm(): boolean {
    const email = this.emailInput.value.trim();
    const password = this.passwordInput.value;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.showAlert('Informe um e-mail válido', 'error');
      this.emailInput.focus();
      return false;
    }
    if (!password) {
      this.showAlert('Informe sua senha', 'error');
      this.passwordInput.focus();
      return false;
    }
    return true;
  }

  private setLoading(loading: boolean): void {
    this.loginBtn.disabled = loading;
    const btnText = this.loginBtn.querySelector('.btn-text') as HTMLElement;
    const btnLoader = this.loginBtn.querySelector('.btn-loader') as HTMLElement;
    if (btnText) btnText.style.display = loading ? 'none' : 'block';
    if (btnLoader) btnLoader.style.display = loading ? 'block' : 'none';
  }

  private showAlert(message: string, type: 'success' | 'error'): void {
    this.alertMessage.textContent = message;
    this.alertMessage.className = `login-alert ${type}`;
    this.alertMessage.style.display = 'block';
    if (type === 'success') setTimeout(() => this.hideAlert(), 5000);
  }

  private hideAlert(): void {
    this.alertMessage.style.display = 'none';
  }
}

window.addEventListener('DOMContentLoaded', () => { new LoginPage(); });
