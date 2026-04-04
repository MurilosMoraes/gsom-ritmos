// Register Page — Supabase auth + CPF validation

import { authService } from './AuthService';
import { supabase } from './supabase';
import { calculateTrialExpiry } from './PaymentService';
import { validateCPF, formatCPF, hashCPF } from '../utils/cpf';

class RegisterPage {
  private form: HTMLFormElement;
  private nameInput: HTMLInputElement;
  private cpfInput: HTMLInputElement;
  private phoneInput: HTMLInputElement;
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
    this.cpfInput = document.getElementById('cpf') as HTMLInputElement;
    this.phoneInput = document.getElementById('phone') as HTMLInputElement;
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

    // Máscara do CPF
    this.cpfInput.addEventListener('input', () => {
      const pos = this.cpfInput.selectionStart || 0;
      const before = this.cpfInput.value.length;
      this.cpfInput.value = formatCPF(this.cpfInput.value);
      const after = this.cpfInput.value.length;
      this.cpfInput.setSelectionRange(pos + (after - before), pos + (after - before));
    });

    // Máscara de telefone (00) 00000-0000
    this.phoneInput.addEventListener('input', () => {
      let v = this.phoneInput.value.replace(/\D/g, '').slice(0, 11);
      if (v.length > 6) v = `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
      else if (v.length > 2) v = `(${v.slice(0,2)}) ${v.slice(2)}`;
      else if (v.length > 0) v = `(${v}`;
      this.phoneInput.value = v;
    });

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

    // 1. Validar CPF
    const cpfHash = await hashCPF(this.cpfInput.value);

    // 2. Verificar se CPF já foi usado (trial único)
    const { data: existing } = await supabase
      .from('gdrums_profiles')
      .select('id')
      .eq('cpf_hash', cpfHash)
      .single();

    if (existing) {
      this.showAlert('Este CPF ja possui uma conta cadastrada. Se nao consegue acessar, entre em contato pelo WhatsApp.', 'error');
      this.setLoading(false);
      return;
    }

    // 2b. Verificar se telefone já foi usado
    const phone = this.phoneInput.value.replace(/\D/g, '');
    const { data: existingPhone } = await supabase
      .from('gdrums_profiles')
      .select('id')
      .eq('phone', phone)
      .single();

    if (existingPhone) {
      this.showAlert('Este WhatsApp ja possui uma conta cadastrada. Se nao consegue acessar, entre em contato pelo WhatsApp.', 'error');
      this.setLoading(false);
      return;
    }

    // 3. Criar conta
    const response = await authService.register({
      name: this.nameInput.value.trim(),
      email: this.emailInput.value.trim(),
      password: this.passwordInput.value
    });

    if (response.success && response.user) {
      // 4. Salvar CPF hash e telefone — com retry (trigger pode demorar pra criar o profile)
      const phone = this.phoneInput.value.replace(/\D/g, '');
      let cpfSaved = false;

      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 500));
        const { error } = await supabase
          .from('gdrums_profiles')
          .update({ cpf_hash: cpfHash, phone })
          .eq('id', response.user.id);
        if (!error) {
          cpfSaved = true;
          break;
        }
      }

      if (!cpfSaved) {
        // CPF não salvou — deletar a conta pra não ficar sem CPF
        await supabase.auth.signOut();
        this.showAlert('Erro ao finalizar cadastro. Tente novamente.', 'error');
        this.setLoading(false);
        return;
      }

      // 5. Gerar session ID único
      const sessionId = crypto.randomUUID();
      await supabase
        .from('gdrums_profiles')
        .update({ active_session_id: sessionId })
        .eq('id', response.user.id);
      localStorage.setItem('gdrums-session-id', sessionId);

      this.showAlert('Conta criada! Teste grátis por 48h ativado!', 'success');
      setTimeout(() => { window.location.href = '/'; }, 1000);
    } else {
      this.showAlert(response.message || 'Erro ao criar conta', 'error');
      this.setLoading(false);
    }
  }

  private validateForm(): boolean {
    const name = this.nameInput.value.trim();
    const cpf = this.cpfInput.value;
    const email = this.emailInput.value.trim();
    const password = this.passwordInput.value;
    const confirmPassword = this.confirmPasswordInput.value;
    const acceptTerms = this.acceptTermsCheckbox.checked;

    if (!name || name.length < 3) {
      this.showAlert('Nome deve ter pelo menos 3 caracteres', 'error');
      this.nameInput.focus();
      return false;
    }

    if (!validateCPF(cpf)) {
      this.showAlert('CPF inválido', 'error');
      this.cpfInput.focus();
      return false;
    }

    const phone = this.phoneInput.value.replace(/\D/g, '');
    if (phone.length < 10 || phone.length > 11) {
      this.showAlert('WhatsApp inválido', 'error');
      this.phoneInput.focus();
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

    if (!password.length) { strengthBar.style.width = '0%'; return; }

    let s = 0;
    if (password.length >= 6) s++;
    if (password.length >= 10) s++;
    if (/[a-z]/.test(password)) s++;
    if (/[A-Z]/.test(password)) s++;
    if (/[0-9]/.test(password)) s++;
    if (/[^a-zA-Z0-9]/.test(password)) s++;

    const cfg = s <= 2 ? { c: '#ff3366', w: '25%' } : s <= 4 ? { c: '#ffaa00', w: '50%' } : s <= 5 ? { c: '#00d4ff', w: '75%' } : { c: '#00ff88', w: '100%' };
    strengthBar.style.width = cfg.w;
    strengthBar.style.background = cfg.c;
  }

  private setLoading(loading: boolean): void {
    this.registerBtn.disabled = loading;
    const btnText = this.registerBtn.querySelector('.btn-text') as HTMLElement;
    const btnLoader = this.registerBtn.querySelector('.btn-loader') as HTMLElement;
    if (btnText) btnText.classList.toggle('hidden', loading);
    if (btnLoader) btnLoader.classList.toggle('active', loading);
  }

  private showAlert(message: string, type: 'success' | 'error'): void {
    this.alertMessage.textContent = message;
    this.alertMessage.className = `reg-alert ${type}`;
    this.alertMessage.style.display = 'block';
    if (type === 'success') setTimeout(() => this.hideAlert(), 5000);
  }

  private hideAlert(): void {
    this.alertMessage.style.display = 'none';
  }
}

window.addEventListener('DOMContentLoaded', () => { new RegisterPage(); });
