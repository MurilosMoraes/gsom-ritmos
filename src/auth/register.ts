// Register Page — Supabase auth

import { authService } from './AuthService';

class RegisterPage {
  private form: HTMLFormElement;
  private nameInput: HTMLInputElement;
  private emailInput: HTMLInputElement;
  private passwordInput: HTMLInputElement;
  private confirmPasswordInput: HTMLInputElement;
  private acceptTermsCheckbox: HTMLInputElement;
  private registerBtn: HTMLButtonElement;
  private alertMessage: HTMLElement;
  private passwordStrength: HTMLElement;

  constructor() {
    this.form = document.getElementById('registerForm') as HTMLFormElement;
    this.nameInput = document.getElementById('name') as HTMLInputElement;
    this.emailInput = document.getElementById('email') as HTMLInputElement;
    this.passwordInput = document.getElementById('password') as HTMLInputElement;
    this.confirmPasswordInput = document.getElementById('confirmPassword') as HTMLInputElement;
    this.acceptTermsCheckbox = document.getElementById('acceptTerms') as HTMLInputElement;
    this.registerBtn = document.getElementById('registerBtn') as HTMLButtonElement;
    this.alertMessage = document.getElementById('alertMessage') as HTMLElement;
    this.passwordStrength = document.getElementById('passwordStrength') as HTMLElement;

    this.init();
  }

  private async init(): Promise<void> {
    if (await authService.isAuthenticated()) {
      window.location.href = '/';
      return;
    }
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.form.addEventListener('submit', (e) => this.handleSubmit(e));
    this.passwordInput.addEventListener('input', () => this.updatePasswordStrength());
  }

  private async handleSubmit(e: Event): Promise<void> {
    e.preventDefault();

    if (!this.validateForm()) return;

    this.setLoading(true);
    this.hideAlert();

    const response = await authService.register({
      name: this.nameInput.value.trim(),
      email: this.emailInput.value.trim(),
      password: this.passwordInput.value
    });

    if (response.success) {
      this.showAlert('Conta criada! Redirecionando...', 'success');
      setTimeout(() => { window.location.href = '/plans.html'; }, 800);
    } else {
      this.showAlert(response.message || 'Erro ao criar conta', 'error');
      this.setLoading(false);
    }
  }

  private validateForm(): boolean {
    const name = this.nameInput.value.trim();
    const email = this.emailInput.value.trim();
    const password = this.passwordInput.value;
    const confirmPassword = this.confirmPasswordInput.value;
    const acceptTerms = this.acceptTermsCheckbox.checked;

    if (!name || name.length < 3) {
      this.showAlert('Nome deve ter pelo menos 3 caracteres', 'error');
      this.nameInput.focus();
      return false;
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.showAlert('E-mail inválido', 'error');
      this.emailInput.focus();
      return false;
    }

    if (password.length < 6) {
      this.showAlert('Senha deve ter pelo menos 6 caracteres', 'error');
      this.passwordInput.focus();
      return false;
    }

    if (password !== confirmPassword) {
      this.showAlert('As senhas não coincidem', 'error');
      this.confirmPasswordInput.focus();
      return false;
    }

    if (!acceptTerms) {
      this.showAlert('Aceite os termos de uso', 'error');
      return false;
    }

    return true;
  }

  private updatePasswordStrength(): void {
    const password = this.passwordInput.value;
    const strengthBar = this.passwordStrength?.querySelector('.strength-bar') as HTMLElement;
    if (!strengthBar) return;

    if (password.length === 0) {
      strengthBar.style.width = '0%';
      return;
    }

    let strength = 0;
    if (password.length >= 6) strength++;
    if (password.length >= 10) strength++;
    if (/[a-z]/.test(password)) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^a-zA-Z0-9]/.test(password)) strength++;

    const configs = [
      { max: 2, color: '#ff3366', width: '25%' },
      { max: 4, color: '#ffaa00', width: '50%' },
      { max: 5, color: '#00d4ff', width: '75%' },
      { max: 99, color: '#00ff88', width: '100%' },
    ];

    const cfg = configs.find(c => strength <= c.max) || configs[3];
    strengthBar.style.width = cfg.width;
    strengthBar.style.background = cfg.color;
  }

  private setLoading(loading: boolean): void {
    this.registerBtn.disabled = loading;
    const btnText = this.registerBtn.querySelector('.btn-text') as HTMLElement;
    const btnLoader = this.registerBtn.querySelector('.btn-loader') as HTMLElement;
    if (btnText) btnText.style.display = loading ? 'none' : 'block';
    if (btnLoader) btnLoader.style.display = loading ? 'block' : 'none';
  }

  private showAlert(message: string, type: 'success' | 'error'): void {
    this.alertMessage.textContent = message;
    this.alertMessage.className = `alert-message ${type}`;
    this.alertMessage.style.display = 'block';
    if (type === 'success') setTimeout(() => this.hideAlert(), 5000);
  }

  private hideAlert(): void {
    this.alertMessage.style.display = 'none';
  }
}

window.addEventListener('DOMContentLoaded', () => { new RegisterPage(); });
