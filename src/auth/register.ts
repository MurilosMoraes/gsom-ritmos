// Register Page Script

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
    [this.nameInput, this.emailInput, this.passwordInput, this.confirmPasswordInput].forEach(input => {
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.form.requestSubmit();
        }
      });
    });

    // Password strength indicator
    this.passwordInput.addEventListener('input', () => {
      this.updatePasswordStrength();
    });
  }

  private async handleSubmit(e: Event): Promise<void> {
    e.preventDefault();

    // Validação básica
    if (!this.validateForm()) {
      return;
    }

    // Desabilitar botão e mostrar loader
    this.setLoading(true);
    this.hideAlert();

    try {
      const response = await authService.register({
        name: this.nameInput.value.trim(),
        email: this.emailInput.value.trim(),
        password: this.passwordInput.value
      });

      if (response.success && response.user) {
        this.showAlert('Conta criada com sucesso! Redirecionando...', 'success');

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
        this.showAlert(response.message || 'Erro ao criar conta', 'error');
        this.setLoading(false);
      }
    } catch (error) {
      console.error('Register error:', error);
      this.showAlert('Erro ao conectar com o servidor', 'error');
      this.setLoading(false);
    }
  }

  private validateForm(): boolean {
    const name = this.nameInput.value.trim();
    const email = this.emailInput.value.trim();
    const password = this.passwordInput.value;
    const confirmPassword = this.confirmPasswordInput.value;
    const acceptTerms = this.acceptTermsCheckbox.checked;

    if (!name) {
      this.showAlert('Por favor, informe seu nome completo', 'error');
      this.nameInput.focus();
      return false;
    }

    if (name.length < 3) {
      this.showAlert('Nome deve ter no mínimo 3 caracteres', 'error');
      this.nameInput.focus();
      return false;
    }

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

    if (password.length < 8) {
      this.showAlert('Senha deve ter no mínimo 8 caracteres', 'error');
      this.passwordInput.focus();
      return false;
    }

    if (!this.isStrongPassword(password)) {
      this.showAlert('Senha deve conter letras maiúsculas, minúsculas e números', 'error');
      this.passwordInput.focus();
      return false;
    }

    if (password !== confirmPassword) {
      this.showAlert('As senhas não coincidem', 'error');
      this.confirmPasswordInput.focus();
      return false;
    }

    if (!acceptTerms) {
      this.showAlert('Você deve aceitar os termos de uso', 'error');
      return false;
    }

    return true;
  }

  private isValidEmail(email: string): boolean {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }

  private isStrongPassword(password: string): boolean {
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    return hasUpperCase && hasLowerCase && hasNumber;
  }

  private updatePasswordStrength(): void {
    const password = this.passwordInput.value;
    const strengthBar = this.passwordStrength.querySelector('.strength-bar') as HTMLElement;

    if (!strengthBar) return;

    let strength = 0;
    let color = '#ff3366';
    let width = '0%';
    let text = '';

    if (password.length === 0) {
      strengthBar.style.width = '0%';
      strengthBar.style.background = '';
      return;
    }

    // Calculate strength
    if (password.length >= 8) strength++;
    if (password.length >= 12) strength++;
    if (/[a-z]/.test(password)) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^a-zA-Z0-9]/.test(password)) strength++;

    // Set color and width based on strength
    if (strength <= 2) {
      color = '#ff3366';
      width = '25%';
      text = 'Fraca';
    } else if (strength <= 4) {
      color = '#ffaa00';
      width = '50%';
      text = 'Média';
    } else if (strength <= 5) {
      color = '#00d4ff';
      width = '75%';
      text = 'Boa';
    } else {
      color = '#00ff88';
      width = '100%';
      text = 'Forte';
    }

    strengthBar.style.width = width;
    strengthBar.style.background = color;
    strengthBar.setAttribute('data-strength', text);
  }

  private setLoading(loading: boolean): void {
    this.registerBtn.disabled = loading;
    const btnText = this.registerBtn.querySelector('.btn-text') as HTMLElement;
    const btnLoader = this.registerBtn.querySelector('.btn-loader') as HTMLElement;

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
  new RegisterPage();
});
