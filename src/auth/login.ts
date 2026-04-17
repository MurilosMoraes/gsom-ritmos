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
    // Detectar recovery token na URL (reset de senha via email)
    const hash = window.location.hash;
    if (hash.includes('type=recovery') || hash.includes('type=magiclink')) {
      // Supabase coloca #access_token=...&type=recovery na URL.
      // O client SDK detecta e faz login automático via onAuthStateChange.
      // Esperar o Supabase processar o token e mostrar form de nova senha.
      await this.handlePasswordRecovery();
      return;
    }

    // Se já logado, redirecionar direto
    if (await authService.isAuthenticated()) {
      window.location.href = await this.getDestination();
      return;
    }
    this.setupEventListeners();
  }

  private async handlePasswordRecovery(): Promise<void> {
    // Aguardar Supabase processar o token do hash
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      // Token inválido ou expirado
      this.showAlert('Link de recuperação inválido ou expirado. Peça outro.', 'error');
      this.setupEventListeners();
      return;
    }

    // Esconder formulário de login, mostrar form de nova senha
    const card = document.querySelector('.login-card') as HTMLElement;
    const title = card.querySelector('.login-title') as HTMLElement;
    const sub = card.querySelector('.login-sub') as HTMLElement;

    title.textContent = 'Nova senha';
    sub.textContent = 'Digite sua nova senha abaixo';

    this.form.innerHTML = `
      <div class="login-field">
        <label for="newPassword">Nova senha</label>
        <input type="password" id="newPassword" required placeholder="Mínimo 6 caracteres" autocomplete="new-password" />
      </div>
      <div class="login-field">
        <label for="confirmPassword">Confirmar senha</label>
        <input type="password" id="confirmPassword" required placeholder="Repita a senha" autocomplete="new-password" />
      </div>
      <button type="submit" class="login-btn" id="resetBtn">
        <span class="btn-text">Salvar nova senha</span>
        <span class="btn-loader"><div class="spinner-sm"></div></span>
      </button>
    `;

    // Esconder links irrelevantes
    const options = card.querySelector('.login-options') as HTMLElement;
    const divider = card.querySelector('.login-divider') as HTMLElement;
    const footer = card.querySelector('.login-footer') as HTMLElement;
    if (options) options.style.display = 'none';
    if (divider) divider.style.display = 'none';
    if (footer) footer.style.display = 'none';

    this.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newPass = (document.getElementById('newPassword') as HTMLInputElement).value;
      const confirm = (document.getElementById('confirmPassword') as HTMLInputElement).value;
      const btn = document.getElementById('resetBtn') as HTMLButtonElement;

      if (newPass.length < 6) {
        this.showAlert('A senha precisa ter pelo menos 6 caracteres', 'error');
        return;
      }
      if (newPass !== confirm) {
        this.showAlert('As senhas não conferem', 'error');
        return;
      }

      btn.disabled = true;
      const btnText = btn.querySelector('.btn-text') as HTMLElement;
      const btnLoader = btn.querySelector('.btn-loader') as HTMLElement;
      if (btnText) btnText.style.display = 'none';
      if (btnLoader) btnLoader.style.display = 'block';

      const { error } = await supabase.auth.updateUser({ password: newPass });

      if (error) {
        this.showAlert('Erro ao atualizar senha. Tente novamente.', 'error');
        btn.disabled = false;
        if (btnText) btnText.style.display = 'block';
        if (btnLoader) btnLoader.style.display = 'none';
      } else {
        this.showAlert('Senha atualizada! Redirecionando...', 'success');
        // Limpar hash da URL
        history.replaceState(null, '', '/login.html');
        setTimeout(async () => {
          window.location.href = await this.getDestination();
        }, 1000);
      }
    });
  }

  private setupEventListeners(): void {
    this.form.addEventListener('submit', (e) => this.handleSubmit(e));

    const forgotBtn = document.getElementById('forgotPasswordBtn') as HTMLElement;
    let forgotCooldown = false;
    forgotBtn?.addEventListener('click', async (e) => {
      e.preventDefault();
      if (forgotCooldown) return;

      const email = this.emailInput.value.trim();
      if (!email) {
        this.showAlert('Digite seu e-mail primeiro', 'error');
        this.emailInput.focus();
        return;
      }

      // Bloquear cliques repetidos + feedback visual
      forgotCooldown = true;
      const originalText = forgotBtn.textContent || '';
      forgotBtn.textContent = 'Enviando...';
      forgotBtn.style.opacity = '0.5';
      forgotBtn.style.pointerEvents = 'none';

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/login.html`,
      });

      if (error) {
        this.showAlert('Erro ao enviar e-mail de recuperação. Verifique o e-mail digitado.', 'error');
        forgotBtn.textContent = originalText;
        forgotBtn.style.opacity = '1';
        forgotBtn.style.pointerEvents = 'auto';
        forgotCooldown = false;
      } else {
        this.showAlert('E-mail de recuperação enviado! Verifique sua caixa de entrada.', 'success');
        forgotBtn.textContent = 'E-mail enviado!';
        // Cooldown de 60s pra não martelar
        setTimeout(() => {
          forgotBtn.textContent = originalText;
          forgotBtn.style.opacity = '1';
          forgotBtn.style.pointerEvents = 'auto';
          forgotCooldown = false;
        }, 60000);
      }
    });
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
