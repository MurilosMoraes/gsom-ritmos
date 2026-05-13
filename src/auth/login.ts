// Login Page — Supabase auth

import { authService } from './AuthService';
import { supabase } from './supabase';
import { AttributionService } from '../native/AttributionService';
import { loginSchema, zodErrorsToFieldMap } from './schemas';
import { isNativeApp, openExternal } from '../native/Platform';
import { setupPasswordToggle } from '../utils/passwordToggle';

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
    // Detectar recovery token na URL (reset de senha via email).
    //
    // Supabase pode mandar em 2 formatos dependendo do flow configurado:
    //   1) Implicit flow (legacy): #access_token=...&type=recovery  no HASH
    //   2) PKCE flow (default em supabase-js v2.x):  ?code=...      na QUERY
    //
    // Browsers diferentes lidam de jeitos diferentes — Safari iOS especialmente
    // tem problemas com hash em redirects + PWA standalone. Por isso a gente
    // checa AMBOS formatos.
    //
    // Tem ainda 3 estados:
    //   (a) já processado (sessão criada antes desse JS rodar)
    //   (b) processando (vai disparar PASSWORD_RECOVERY no onAuthStateChange)
    //   (c) inválido/expirado (nada acontece — timeout)
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    const looksLikeRecovery =
      hash.includes('type=recovery') ||
      hash.includes('type=magiclink') ||
      hash.includes('access_token=') ||
      // PKCE: code= na query string. Confirma que é recovery pelo type
      // que o Supabase agora também passa como query param.
      /[?&]code=/.test(search);

    if (looksLikeRecovery) {
      // PKCE: precisa trocar code → session antes de continuar. Implicit já
      // processa sozinho no detectSessionInUrl do supabase-js.
      const codeMatch = search.match(/[?&]code=([^&]+)/);
      if (codeMatch) {
        try {
          await supabase.auth.exchangeCodeForSession(codeMatch[1]);
        } catch (e) {
          console.warn('[recovery] exchangeCodeForSession falhou:', e);
        }
      }

      const ok = await this.waitForRecoverySession();
      if (ok) {
        await this.handlePasswordRecovery();
        return;
      }
      // Token inválido/expirado → mostra erro mas deixa o form de login
      this.showAlert('Link de recuperação inválido ou expirado. Peça outro.', 'error');
      this.setupEventListeners();
      this.setupNativeRegisterLink();
      return;
    }

    // Se já logado, redirecionar direto
    if (await authService.isAuthenticated()) {
      window.location.href = await this.getDestination();
      return;
    }
    this.setupEventListeners();
    this.setupNativeRegisterLink();
  }

  /**
   * Aguarda o Supabase processar o token do hash. Retorna true se
   * conseguiu uma sessão válida (de recovery), false se deu timeout.
   *
   * Estratégia: usa onAuthStateChange + getSession em paralelo. Quem
   * chegar primeiro com sessão ganha. Timeout 4s pra evitar travar a UI.
   */
  private waitForRecoverySession(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        resolve(ok);
      };

      // 1. Listener do SDK — pega quando o hash for processado
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (done) return;
        if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
          finish(true);
        }
      });

      // 2. Polling defensivo — caso o evento já tenha disparado antes
      let tries = 0;
      const interval = setInterval(async () => {
        if (done) { clearInterval(interval); return; }
        const { data: { session } } = await supabase.auth.getSession();
        if (session) { clearInterval(interval); finish(true); }
        if (++tries >= 20) clearInterval(interval); // 20 * 200ms = 4s
      }, 200);

      // 3. Timeout final
      setTimeout(() => {
        clearInterval(interval);
        subscription?.unsubscribe();
        finish(false);
      }, 4500);
    });
  }

  /** No app nativo (iOS/Android), os links pra cadastro abrem o site
   *  externo pra: (a) compliance Apple/Google — cadastro+pagamento em
   *  fluxo único na web, evita questionamento sobre IAP, (b) garantir
   *  que cadastro novo passe pelo funil de pagamento normal do site.
   *  Pega TODOS os links com href="/register" — incluindo o CTA novo
   *  "Criar conta grátis" e o link clássico. */
  private setupNativeRegisterLink(): void {
    if (!isNativeApp()) return;
    const selectors = 'a[href="/register"], a[href="/register.html"], #loginTrialCta';
    document.querySelectorAll<HTMLAnchorElement>(selectors).forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        openExternal('https://gdrums.com.br/register');
      });
    });
  }

  private async handlePasswordRecovery(): Promise<void> {
    // Caller (init) já confirmou que existe sessão de recovery.
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
        history.replaceState(null, '', '/login');
        setTimeout(async () => {
          window.location.href = await this.getDestination();
        }, 1000);
      }
    });
  }

  private setupEventListeners(): void {
    this.form.addEventListener('submit', (e) => this.handleSubmit(e));

    const forgotBtn = document.getElementById('forgotPasswordBtn') as HTMLElement;
    forgotBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      this.openForgotPasswordModal();
    });

    const backBtn = document.getElementById('loginBackBtn') as HTMLButtonElement | null;
    backBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      this.resetToEmailStep();
    });

    // Enter no campo email avança pro step 2
    this.emailInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && this.loginStep === 'email') {
        e.preventDefault();
        this.form.requestSubmit();
      }
    });

    // Se a URL veio com ?email=X, pré-preenche e já avança
    const params = new URLSearchParams(window.location.search);
    const emailParam = params.get('email');
    if (emailParam) {
      this.emailInput.value = emailParam;
    }
  }

  /**
   * Modal explícito de recuperação de senha. Antes era "1 clique manda email"
   * — usuário velho clicava sem querer. Agora exige: ver tela, conferir email,
   * clicar "Enviar link". Inclui botão "Cancelar" pra escapar.
   */
  private openForgotPasswordModal(): void {
    // Já existe? Não duplica.
    if (document.getElementById('forgotPasswordModal')) return;

    const modal = document.createElement('div');
    modal.id = 'forgotPasswordModal';
    modal.className = 'fp-modal-backdrop';
    modal.innerHTML = `
      <div class="fp-modal-card" role="dialog" aria-modal="true" aria-labelledby="fpModalTitle">
        <h2 id="fpModalTitle" class="fp-modal-title">Recuperar senha</h2>
        <p class="fp-modal-sub">
          Vamos enviar um link no seu e-mail pra você criar uma senha nova.
          Confere o e-mail e clica em "Enviar link".
        </p>

        <div class="fp-field">
          <label for="fpEmailInput">Seu e-mail</label>
          <input type="email" id="fpEmailInput" placeholder="seu@email.com" autocomplete="email" />
        </div>

        <div class="fp-modal-alert" id="fpAlert" role="alert"></div>

        <div class="fp-modal-actions">
          <button type="button" class="fp-btn-cancel" id="fpCancelBtn">Cancelar</button>
          <button type="button" class="fp-btn-send" id="fpSendBtn">
            <span class="fp-btn-text">Enviar link</span>
            <span class="fp-btn-loader"><div class="spinner-sm"></div></span>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const emailInput = modal.querySelector<HTMLInputElement>('#fpEmailInput')!;
    const sendBtn = modal.querySelector<HTMLButtonElement>('#fpSendBtn')!;
    const cancelBtn = modal.querySelector<HTMLButtonElement>('#fpCancelBtn')!;
    const alertEl = modal.querySelector<HTMLElement>('#fpAlert')!;

    // Pré-preenche se o user já digitou no login
    emailInput.value = this.emailInput.value.trim();

    // Foca o campo se vazio, senão foca o botão pra UX direta
    setTimeout(() => {
      if (!emailInput.value) emailInput.focus();
      else sendBtn.focus();
    }, 50);

    const closeModal = () => {
      modal.remove();
    };

    cancelBtn.addEventListener('click', closeModal);

    // Fecha clicando fora do card
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // ESC fecha
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    // Enter no campo manda
    emailInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendBtn.click();
    });

    let sending = false;
    sendBtn.addEventListener('click', async () => {
      if (sending) return;

      const email = emailInput.value.trim();
      if (!email || !email.includes('@')) {
        this.fpAlert(alertEl, 'Digite um e-mail válido', 'error');
        emailInput.focus();
        return;
      }

      sending = true;
      this.fpSetLoading(sendBtn, true);
      this.fpAlert(alertEl, '', null);

      // SEMPRE manda pro site público (não pro app nativo).
      // Se usar window.location.origin no app: vira capacitor://localhost
      // → o link no email não abre, navegador cai na landing e mostra
      // "Cadastrar grátis" — o user pensa que tem que cadastrar de novo.
      // URL fixa garante que abra sempre na tela de redefinir senha.
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: 'https://gdrums.com.br/login.html',
      });

      if (error) {
        this.fpSetLoading(sendBtn, false);
        sending = false;
        this.fpAlert(alertEl, 'Não foi possível enviar. Confere o e-mail e tenta de novo.', 'error');
        return;
      }

      this.fpAlert(alertEl, 'Link enviado! Verifica seu e-mail (e a caixa de spam).', 'success');
      // Espera o user ler antes de fechar
      setTimeout(() => {
        closeModal();
      }, 2500);
    });
  }

  private fpSetLoading(btn: HTMLButtonElement, loading: boolean): void {
    btn.disabled = loading;
    const text = btn.querySelector<HTMLElement>('.fp-btn-text');
    const loader = btn.querySelector<HTMLElement>('.fp-btn-loader');
    if (text) text.style.display = loading ? 'none' : 'inline';
    if (loader) loader.style.display = loading ? 'inline-flex' : 'none';
  }

  private fpAlert(el: HTMLElement, msg: string, type: 'success' | 'error' | null): void {
    if (!msg || !type) {
      el.style.display = 'none';
      el.textContent = '';
      el.className = 'fp-modal-alert';
      return;
    }
    el.textContent = msg;
    el.className = `fp-modal-alert ${type}`;
    el.style.display = 'block';
  }

  // Step do fluxo inteligente: 'email' = pede email, 'password' = email
  // já confirmado, pede senha.
  private loginStep: 'email' | 'password' = 'email';

  private async handleSubmit(e: Event): Promise<void> {
    e.preventDefault();

    if (this.loginStep === 'email') {
      await this.handleEmailStep();
    } else {
      await this.handlePasswordStep();
    }
  }

  /**
   * Step 1 — Verifica o estado do email antes de pedir senha.
   * - complete: avança pra step 2 (campo senha)
   * - incomplete: faz login E redireciona pra /completar-cadastro
   * - not_found: vai pro /register com email pré-preenchido
   */
  private async handleEmailStep(): Promise<void> {
    const email = this.emailInput.value.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      this.showAlert('Digite um e-mail válido', 'error');
      this.emailInput.focus();
      return;
    }

    this.setLoading(true);
    this.hideAlert();

    try {
      const { data, error } = await supabase.rpc('check_email_status', { p_email: email });
      if (error) throw error;

      const status = (data as { status?: string } | null)?.status;

      if (status === 'not_found') {
        // Conta não existe — leva pro cadastro pré-preenchido
        this.setLoading(false);
        const dest = `/register?email=${encodeURIComponent(email)}`;
        if (isNativeApp()) {
          openExternal('https://gdrums.com.br' + dest);
        } else {
          window.location.href = dest;
        }
        return;
      }

      // 'complete' ou 'incomplete' — em ambos os casos pede senha. Se
      // incomplete, depois do login a gente redireciona pra completar.
      this.advanceToPasswordStep(email, status === 'incomplete');
      this.setLoading(false);
    } catch (err) {
      this.showAlert('Não foi possível verificar o e-mail. Tente novamente.', 'error');
      this.setLoading(false);
    }
  }

  /** Avança a UI do step 1 → step 2 (mostra senha, esconde campo email). */
  private incompleteAccount = false;

  private advanceToPasswordStep(email: string, incomplete: boolean): void {
    this.loginStep = 'password';
    this.incompleteAccount = incomplete;

    const emailField = document.getElementById('emailField');
    const passwordField = document.getElementById('passwordField');
    const options = document.getElementById('loginOptions');
    const backBtn = document.getElementById('loginBackBtn');
    const btnText = document.getElementById('loginBtnText');

    if (emailField) emailField.style.display = 'none';
    if (passwordField) passwordField.style.display = '';
    if (options) options.style.display = '';
    if (backBtn) backBtn.style.display = '';
    if (btnText) btnText.textContent = 'Entrar';

    // Pill mostrando o email travado, com botão pra trocar
    let pill = document.getElementById('loginEmailPill');
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'loginEmailPill';
      pill.className = 'login-email-pill';
      pill.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2"/>
          <polyline points="3,7 12,13 21,7"/>
        </svg>
        <span></span>
      `;
      this.form.insertBefore(pill, this.form.firstChild);
    }
    const span = pill.querySelector('span');
    if (span) span.textContent = email;

    // Aviso se conta incompleta
    if (incomplete) {
      this.showAlert('Sua conta precisa de uns dados extras. Após entrar a gente termina o cadastro.', 'success');
    }

    // Foca o campo senha
    setTimeout(() => this.passwordInput.focus(), 50);
  }

  /** Volta pro step 1 (trocar email). */
  private resetToEmailStep(): void {
    this.loginStep = 'email';
    this.incompleteAccount = false;

    const emailField = document.getElementById('emailField');
    const passwordField = document.getElementById('passwordField');
    const options = document.getElementById('loginOptions');
    const backBtn = document.getElementById('loginBackBtn');
    const btnText = document.getElementById('loginBtnText');
    const pill = document.getElementById('loginEmailPill');

    if (emailField) emailField.style.display = '';
    if (passwordField) passwordField.style.display = 'none';
    if (options) options.style.display = 'none';
    if (backBtn) backBtn.style.display = 'none';
    if (btnText) btnText.textContent = 'Continuar';
    if (pill) pill.remove();
    this.passwordInput.value = '';
    this.hideAlert();
    this.emailInput.focus();
  }

  /** Step 2 — faz login propriamente dito. */
  private async handlePasswordStep(): Promise<void> {
    // Validação via Zod (email já tá ok do step 1, valida senha)
    const password = this.passwordInput.value;
    if (!password || password.length < 6) {
      this.showAlert('Digite sua senha (mínimo 6 caracteres)', 'error');
      this.passwordInput.focus();
      return;
    }

    this.setLoading(true);
    this.hideAlert();

    const response = await authService.login({
      email: this.emailInput.value.trim(),
      password,
      rememberMe: this.rememberMeCheckbox.checked,
    });

    if (response.success && response.user) {
      // Sessão única (invalida outros devices)
      const sessionId = crypto.randomUUID();
      await supabase
        .from('gdrums_profiles')
        .update({ active_session_id: sessionId })
        .eq('id', response.user.id);
      localStorage.setItem('gdrums-session-id', sessionId);

      // Se conta incompleta, vai pra /completar-cadastro em vez do app
      if (this.incompleteAccount) {
        this.showAlert('Login feito! Falta um passo...', 'success');
        setTimeout(() => { window.location.href = '/completar-cadastro.html'; }, 600);
        return;
      }

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
      if (!user) return '/plans';

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
      return '/plans';
    } catch {
      return '/plans';
    }
  }

  private validateForm(): boolean {
    const result = loginSchema.safeParse({
      email: this.emailInput.value,
      password: this.passwordInput.value,
    });

    if (result.success) {
      this.showFieldError(this.emailInput, null);
      this.showFieldError(this.passwordInput, null);
      return true;
    }

    const errors = zodErrorsToFieldMap(result.error);
    this.showFieldError(this.emailInput, errors.email || null);
    this.showFieldError(this.passwordInput, errors.password || null);

    // Focar no primeiro campo com erro
    const first = errors.email ? this.emailInput : this.passwordInput;
    first.focus();
    return false;
  }

  /**
   * Mostra ou limpa erro inline abaixo do input.
   * Cria o elemento na primeira vez.
   */
  private showFieldError(input: HTMLInputElement, msg: string | null): void {
    const parent = input.parentElement;
    if (!parent) return;
    let errEl = parent.querySelector('.login-field-error') as HTMLElement | null;
    if (!errEl) {
      errEl = document.createElement('div');
      errEl.className = 'login-field-error';
      errEl.setAttribute('role', 'alert');
      parent.appendChild(errEl);
    }
    if (msg) {
      errEl.textContent = msg;
      errEl.classList.add('active');
      input.classList.add('login-input-error');
    } else {
      errEl.textContent = '';
      errEl.classList.remove('active');
      input.classList.remove('login-input-error');
    }
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

window.addEventListener('DOMContentLoaded', () => {
  AttributionService.init();
  setupPasswordToggle(); // olhinho em todos os input[type=password] da página
  new LoginPage();
});
