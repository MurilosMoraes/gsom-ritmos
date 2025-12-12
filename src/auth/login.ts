// Login Page Script

import { authService } from './AuthService';

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

  private init(): void {
    // Se já estiver autenticado, redirecionar
    if (authService.isAuthenticated()) {
      const user = authService.getUser();
      if (user?.role === 'admin') {
        window.location.href = '/admin.html';
      } else {
        window.location.href = '/';
      }
      return;
    }

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.form.addEventListener('submit', (e) => this.handleSubmit(e));

    // Enter key nos inputs
    [this.emailInput, this.passwordInput].forEach(input => {
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.form.requestSubmit();
        }
      });
    });
  }

  private async handleSubmit(e: Event): void {
    e.preventDefault();

    // Validação básica
    if (!this.validateForm()) {
      return;
    }

    // Desabilitar botão e mostrar loader
    this.setLoading(true);
    this.hideAlert();

    try {
      const response = await authService.login({
        email: this.emailInput.value.trim(),
        password: this.passwordInput.value,
        rememberMe: this.rememberMeCheckbox.checked
      });

      if (response.success && response.user) {
        this.showAlert('Login realizado com sucesso! Redirecionando...', 'success');

        // Registrar dispositivo
        await authService.registerDevice();

        // Redirecionar após 1 segundo
        setTimeout(() => {
          if (response.user!.role === 'admin') {
            window.location.href = '/admin.html';
          } else {
            window.location.href = '/';
          }
        }, 1000);
      } else {
        this.showAlert(response.message || 'Erro ao fazer login', 'error');
        this.setLoading(false);
      }
    } catch (error) {
      console.error('Login error:', error);
      this.showAlert('Erro ao conectar com o servidor', 'error');
      this.setLoading(false);
    }
  }

  private validateForm(): boolean {
    const email = this.emailInput.value.trim();
    const password = this.passwordInput.value;

    if (!email) {
      this.showAlert('Por favor, informe seu e-mail', 'error');
      this.emailInput.focus();
      return false;
    }

    if (!this.isValidEmail(email)) {
      this.showAlert('Por favor, informe um e-mail válido', 'error');
      this.emailInput.focus();
      return false;
    }

    if (!password) {
      this.showAlert('Por favor, informe sua senha', 'error');
      this.passwordInput.focus();
      return false;
    }

    return true;
  }

  private isValidEmail(email: string): boolean {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }

  private setLoading(loading: boolean): void {
    this.loginBtn.disabled = loading;
    const btnText = this.loginBtn.querySelector('.btn-text') as HTMLElement;
    const btnLoader = this.loginBtn.querySelector('.btn-loader') as HTMLElement;

    if (loading) {
      btnText.style.display = 'none';
      btnLoader.style.display = 'block';
    } else {
      btnText.style.display = 'block';
      btnLoader.style.display = 'none';
    }
  }

  private showAlert(message: string, type: 'success' | 'error'): void {
    this.alertMessage.textContent = message;
    this.alertMessage.className = `alert-message ${type}`;
    this.alertMessage.style.display = 'block';

    // Auto-hide após 5 segundos se for sucesso
    if (type === 'success') {
      setTimeout(() => this.hideAlert(), 5000);
    }
  }

  private hideAlert(): void {
    this.alertMessage.style.display = 'none';
  }
}

// Inicializar quando a página carregar
window.addEventListener('DOMContentLoaded', () => {
  new LoginPage();
});
