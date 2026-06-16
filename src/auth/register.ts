// Register Page — Supabase auth + CPF validation

import { authService } from './AuthService';
import { supabase } from './supabase';
import { validateCPF, formatCPF } from '../utils/cpf';
import { AttributionService } from '../native/AttributionService';
import { isNativeApp } from '../native/Platform';
import { registerSchema, zodErrorsToFieldMap } from './schemas';
import { updateRhythmCountInDom } from '../utils/rhythmCount';
import { redirectIfRecoveryHash } from './recoveryGuard';
import { setupPasswordToggle } from '../utils/passwordToggle';
import { trackLead } from '../utils/metaTracking';

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
    // Pré-pegar email da URL ANTES do check de sessão. Regex tolerante:
    // precisa ter @ e pelo menos 1 char antes e depois. Ponto no domínio
    // é opcional — é preferível o user começar a digitar e a validação do
    // Zod no submit corrigir, do que barrar aqui.
    const qs = new URLSearchParams(window.location.search);
    const prefillEmail = (qs.get('email') || '').trim();
    const emailFromUrl = prefillEmail.length > 0 && /^[^\s@]+@[^\s@]+$/.test(prefillEmail)
      ? prefillEmail : null;

    // Log de debug: ajuda a entender quando o fluxo desvia
    // (usuário reportou 'vai pro login em vez do cadastro')
    console.log('[register] init — emailFromUrl:', emailFromUrl);

    // ─── Regra de redirecionamento ───
    // 1. Se veio com ?email= (intenção clara de cadastrar): faz signOut
    //    de sessão residual SE houver e renderiza o form normalmente.
    //    Nunca joga pra home nesse caso — o user QUER criar conta.
    // 2. Sem ?email=: comportamento antigo (se autenticado → home).
    if (emailFromUrl) {
      // Força signOut (silencioso, não bloqueia). Se não tem sessão, é no-op.
      try {
        const { supabase } = await import('./supabase');
        await supabase.auth.signOut();
        console.log('[register] signOut silencioso feito pra permitir cadastro novo');
      } catch (e) {
        console.warn('[register] signOut falhou, continuando:', e);
      }
    } else if (await authService.isAuthenticated()) {
      console.log('[register] autenticado sem email — redirecionando pra /');
      window.location.href = '/';
      return;
    }

    // Social proof dinâmico — fire-and-forget, não bloqueia o formulário
    this.loadSocialProof();

    // Pré-preencher email se veio via ?email= (demo quick signup)
    if (emailFromUrl) {
      this.emailInput.value = emailFromUrl;
      // Foca no próximo campo (nome) pra user continuar o fluxo
      setTimeout(() => this.nameInput.focus(), 50);
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
    const stripCountryCode = (raw: string): string => {
      // Começando com "+" o user claramente digitou código de país — remove 55
      // (já passou pelo replace(/\D/g, '')). Se começa com 55 e tem 12+ dígitos
      // (55 + DDD 2d + pelo menos 8d) também remove.
      if (raw.length >= 12 && raw.startsWith('55')) return raw.slice(2);
      // Caso crítico que aparece em produção: user digita "+55" e a máscara
      // corta em 11. Detecta: 11 dígitos começando com "55" onde o 3º e 5º
      // dígito formam DDD válido + 9 (celular). Ex: "55119901522" = 55+11+9+6d
      if (raw.length === 11 && raw.startsWith('55')) {
        const ddd = raw.slice(2, 4);
        const fifth = raw[4];
        // DDDs BR válidos começam em 11-99 com pares específicos.
        // Heurística: se o 3º-4º é DDD válido E o 5º é '9' (celular), é +55 colado
        const validDdds = ['11','12','13','14','15','16','17','18','19','21','22','24','27','28','31','32','33','34','35','37','38','41','42','43','44','45','46','47','48','49','51','53','54','55','61','62','63','64','65','66','67','68','69','71','73','74','75','77','79','81','82','83','84','85','86','87','88','89','91','92','93','94','95','96','97','98','99'];
        if (validDdds.includes(ddd) && fifth === '9') return raw.slice(2);
      }
      return raw;
    };

    this.phoneInput.addEventListener('input', () => {
      let raw = this.phoneInput.value.replace(/\D/g, '');
      raw = stripCountryCode(raw);
      let v = raw.slice(0, 11);
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
    this.setupFieldValidation();
  }

  /**
   * Validação inline campo-a-campo com Zod.
   *
   * Pro UX ficar bom:
   * - onblur valida o campo saindo (mostra erro específico abaixo)
   * - input limpa o erro do campo se tinha
   * - submit valida tudo e foca no primeiro campo com erro
   *
   * O formato 'registerSchema' é composto e tem cross-field (password match).
   * Quando o usuário só digitou o name, não faz sentido disparar erro do CPF.
   * Por isso onblur só mostra o erro DAQUELE campo, validando com um schema
   * parcial baseado nos valores atuais.
   */
  private setupFieldValidation(): void {
    const fields: Array<{ input: HTMLInputElement; key: string; getValue?: () => any }> = [
      { input: this.nameInput, key: 'name' },
      { input: this.cpfInput, key: 'cpf' },
      { input: this.phoneInput, key: 'phone' },
      { input: this.emailInput, key: 'email' },
      { input: this.passwordInput, key: 'password' },
      { input: this.confirmPasswordInput, key: 'confirmPassword' },
    ];

    for (const f of fields) {
      // Cria container de erro (abaixo do input) se ainda não existe
      let errEl = f.input.parentElement?.querySelector('.reg-field-error') as HTMLElement | null;
      if (!errEl) {
        errEl = document.createElement('div');
        errEl.className = 'reg-field-error';
        errEl.setAttribute('role', 'alert');
        f.input.parentElement?.appendChild(errEl);
      }

      // onblur: valida esse campo sozinho
      f.input.addEventListener('blur', () => {
        const fieldErr = this.validateSingleField();
        this.renderFieldError(f.key, fieldErr[f.key] || null);
      });

      // onchange/input: limpa o erro se user tá corrigindo
      f.input.addEventListener('input', () => {
        this.renderFieldError(f.key, null);
      });
    }

    // Checkbox: valida ao trocar estado
    this.acceptTermsCheckbox.addEventListener('change', () => {
      const fieldErr = this.validateSingleField();
      this.renderFieldError('acceptTerms', fieldErr.acceptTerms || null);
    });
  }

  private validateSingleField(): Record<string, string> {
    const payload = {
      name: this.nameInput.value,
      cpf: this.cpfInput.value,
      phone: this.phoneInput.value,
      email: this.emailInput.value,
      password: this.passwordInput.value,
      confirmPassword: this.confirmPasswordInput.value,
      acceptTerms: this.acceptTermsCheckbox.checked,
    };
    const result = registerSchema.safeParse(payload);
    if (result.success) return {};
    return zodErrorsToFieldMap(result.error);
  }

  private renderFieldError(fieldKey: string, msg: string | null): void {
    const input = this.getInputByKey(fieldKey);
    if (!input) return;
    const parent = input.parentElement;
    if (!parent) return;
    const errEl = parent.querySelector('.reg-field-error') as HTMLElement | null;
    if (!errEl) return;

    if (msg) {
      errEl.textContent = msg;
      errEl.classList.add('active');
      input.classList.add('reg-input-error');
    } else {
      errEl.textContent = '';
      errEl.classList.remove('active');
      input.classList.remove('reg-input-error');
    }
  }

  private getInputByKey(key: string): HTMLInputElement | null {
    switch (key) {
      case 'name': return this.nameInput;
      case 'cpf': return this.cpfInput;
      case 'phone': return this.phoneInput;
      case 'email': return this.emailInput;
      case 'password': return this.passwordInput;
      case 'confirmPassword': return this.confirmPasswordInput;
      case 'acceptTerms': return this.acceptTermsCheckbox;
      default: return null;
    }
  }

  private async handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    if (!this.validateForm()) return;

    this.setLoading(true);
    this.hideAlert();

    // FLUXO NOVO: tudo via Edge Function register-account.
    // Servidor cria user + perfil COMPLETO numa única chamada com rollback
    // real se algo falhar. Cliente nunca fica com conta órfã.

    const attr = AttributionService.getAttribution() || AttributionService.captureNow();

    try {
      const SUPABASE_URL = 'https://qsfziivubwdgtmwyztfw.supabase.co';
      const ANON_KEY = 'sb_publishable_qjW2fGXMHtQvqVKgyyiiUg_HczRwmXy';

      const response = await fetch(`${SUPABASE_URL}/functions/v1/register-account`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
          'apikey': ANON_KEY,
        },
        body: JSON.stringify({
          name: this.nameInput.value.trim(),
          email: this.emailInput.value.trim(),
          password: this.passwordInput.value,
          cpf: this.cpfInput.value,
          phone: this.phoneInput.value.replace(/\D/g, ''),
          signup_source: attr.source,
          signup_medium: attr.medium,
          signup_campaign: attr.campaign,
          signup_referrer: attr.referrer,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        // Mapeia erros estruturados pra mensagens claras
        const code = result.code;
        let msg = result.error || 'Erro ao criar conta. Tente novamente.';
        if (code === 'cpf_duplicate') msg = 'Este CPF já possui uma conta cadastrada. Se não consegue acessar, fale com o suporte.';
        else if (code === 'phone_duplicate') msg = 'Este WhatsApp já possui uma conta cadastrada. Se não consegue acessar, fale com o suporte.';
        else if (code === 'email_duplicate') msg = 'Este e-mail já está cadastrado. Faça login normalmente.';
        this.showAlert(msg, 'error');
        this.setLoading(false);
        return;
      }

      // Conta criada de fato → conversão real. Dispara Lead (Pixel +
      // CAPI, dedup por eventID). email/phone vão hasheados no server.
      // Antes do signIn/redirect pra garantir que roda mesmo com o
      // keepalive sobrevivendo à navegação.
      trackLead({
        email: this.emailInput.value.trim(),
        phone: this.phoneInput.value.replace(/\D/g, ''),
      });

      // Sucesso: servidor garantiu que conta tá completa. Agora faz signIn
      // pelo cliente pra gerar a sessão JWT local.
      const signIn = await supabase.auth.signInWithPassword({
        email: this.emailInput.value.trim(),
        password: this.passwordInput.value,
      });

      if (signIn.error || !signIn.data.session) {
        // Servidor criou tudo mas signIn falhou — improvável. User pode
        // fazer login manual.
        this.showAlert('Conta criada! Faça login pra entrar.', 'success');
        setTimeout(() => { window.location.href = '/login.html'; }, 1500);
        return;
      }

      // Grava session_id local (servidor já gravou no profile)
      if (result.session_id) {
        localStorage.setItem('gdrums-session-id', result.session_id);
      }

      // Tela de boas-vindas: o ponto onde a galera que veio da DEMO
      // (anúncio Insta/Face → navegador) se perdia. Antes caía direto no
      // app web e ao fechar a aba não achava mais o GDrums. Agora deixa
      // GRITANTE: baixe o app na loja + 48h grátis sem cartão.
      //
      // ⚠️ SÓ NA WEB. No app NATIVO (Capacitor) o cara JÁ tem o app —
      // mostrar 'baixe na loja' seria absurdo. Lá entra direto no app.
      if (isNativeApp()) {
        this.showAlert('Conta criada! Teste grátis por 48h ativado!', 'success');
        setTimeout(() => { window.location.href = '/'; }, 1000);
      } else {
        this.showWelcomeDownload();
      }
    } catch (err) {
      this.showAlert('Erro de conexão. Verifique sua internet e tente novamente.', 'error');
      this.setLoading(false);
    }
  }

  /**
   * Tela de boas-vindas pós-cadastro — converte o cadastro em DOWNLOAD.
   * Detecta o aparelho e destaca a loja certa. Botão "continuar no
   * navegador" pra quem não quer baixar (não bloqueia).
   */
  private showWelcomeDownload(): void {
    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(ua) && (navigator as any).maxTouchPoints > 1);
    const isAndroid = /Android/i.test(ua);
    const APP_STORE = 'https://apps.apple.com/br/app/gdrums/id6766099516';
    const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.gdrums.app&hl=pt';

    const appStoreBtn = `
      <a href="${APP_STORE}" class="wd-store-btn ${isIOS ? 'wd-store-primary' : ''}" target="_blank" rel="noopener">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 12.04c-.03-2.6 2.13-3.85 2.23-3.91-1.21-1.78-3.1-2.02-3.77-2.05-1.6-.16-3.13.94-3.94.94-.81 0-2.07-.92-3.4-.9-1.75.03-3.36 1.02-4.26 2.58-1.82 3.16-.47 7.83 1.3 10.39.86 1.25 1.89 2.66 3.23 2.61 1.3-.05 1.79-.84 3.36-.84 1.57 0 2.01.84 3.39.81 1.4-.02 2.28-1.28 3.14-2.54.99-1.46 1.4-2.87 1.42-2.94-.03-.01-2.72-1.04-2.75-4.13l.32.02-.02-.02M14.53 4.42c.72-.87 1.2-2.08 1.07-3.29-1.03.04-2.28.69-3.02 1.56-.66.77-1.24 2-1.09 3.18 1.15.09 2.32-.58 3.04-1.45"/></svg>
        <span class="wd-store-txt"><small>Baixar na</small>App Store</span>
      </a>`;
    const playStoreBtn = `
      <a href="${PLAY_STORE}" class="wd-store-btn ${isAndroid ? 'wd-store-primary' : ''}" target="_blank" rel="noopener">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M3.6 2.2c-.3.3-.5.8-.5 1.4v16.8c0 .6.2 1.1.5 1.4l.1.1 9.4-9.4v-.2L3.6 2.2M16.5 15.3l-3.1-3.1 3.1-3.1 3.7 2.1c1.1.6 1.1 1.6 0 2.2l-3.7 1.9M12.9 11.9l-9 9c.4.4 1 .4 1.7 0l10.6-6-3.3-3M5.6 2.9c-.7-.4-1.3-.4-1.7 0l9 9 3.3-3L5.6 2.9"/></svg>
        <span class="wd-store-txt"><small>Baixar no</small>Google Play</span>
      </a>`;
    // Aparelho conhecido → mostra a loja certa primeiro
    const stores = isIOS ? appStoreBtn + playStoreBtn
                 : isAndroid ? playStoreBtn + appStoreBtn
                 : appStoreBtn + playStoreBtn;

    const overlay = document.createElement('div');
    overlay.className = 'wd-overlay';
    overlay.innerHTML = `
      <div class="wd-card">
        <div class="wd-check">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <h1 class="wd-title">Conta criada! 🎉</h1>
        <div class="wd-badge">✓ 48 horas grátis — sem cartão</div>
        <p class="wd-sub">Agora <strong>baixe o app</strong> pra tocar com tudo: pedal Bluetooth, mais de 130 ritmos e seu repertório no palco.</p>
        <div class="wd-stores">${stores}</div>
        <button class="wd-continue" id="wdContinue">Continuar no navegador por enquanto</button>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('wd-visible'));

    overlay.querySelector('#wdContinue')?.addEventListener('click', () => {
      window.location.href = '/';
    });

    this.injectWelcomeStyles();
  }

  private injectWelcomeStyles(): void {
    if (document.getElementById('wd-styles')) return;
    const css = document.createElement('style');
    css.id = 'wd-styles';
    css.textContent = `
      .wd-overlay {
        position: fixed; inset: 0; z-index: 100000;
        background: linear-gradient(165deg, #0a0a1e 0%, #05050f 100%);
        display: flex; align-items: center; justify-content: center;
        padding: 1.5rem; opacity: 0; transition: opacity 0.3s ease;
        overflow-y: auto;
      }
      .wd-overlay.wd-visible { opacity: 1; }
      .wd-card {
        width: 100%; max-width: 400px; text-align: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
      }
      .wd-check {
        width: 72px; height: 72px; margin: 0 auto 1.25rem;
        border-radius: 50%; display: flex; align-items: center; justify-content: center;
        background: linear-gradient(135deg, #00E68C, #00D4FF); color: #04140d;
        box-shadow: 0 8px 32px rgba(0, 230, 140, 0.35);
        animation: wdPop 0.45s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes wdPop { from { transform: scale(0.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }
      .wd-title { color: #fff; font-size: 1.6rem; font-weight: 800; margin: 0 0 0.85rem; letter-spacing: -0.5px; }
      .wd-badge {
        display: inline-block; margin-bottom: 1.1rem;
        background: rgba(0, 230, 140, 0.12); border: 1.5px solid rgba(0, 230, 140, 0.5);
        color: #00E68C; font-size: 0.88rem; font-weight: 800;
        padding: 0.45rem 1rem; border-radius: 999px;
      }
      .wd-sub { color: rgba(255,255,255,0.65); font-size: 0.98rem; line-height: 1.55; margin: 0 0 1.6rem; }
      .wd-sub strong { color: #fff; }
      .wd-stores { display: flex; flex-direction: column; gap: 0.7rem; margin-bottom: 1.1rem; }
      .wd-store-btn {
        display: flex; align-items: center; justify-content: center; gap: 0.7rem;
        padding: 0.95rem; border-radius: 16px; text-decoration: none;
        background: rgba(255,255,255,0.06); border: 1.5px solid rgba(255,255,255,0.12);
        color: #fff; transition: transform 0.12s, border-color 0.12s, background 0.12s;
      }
      .wd-store-btn:active { transform: scale(0.97); }
      .wd-store-primary {
        background: linear-gradient(135deg, #00D4FF, #8B5CF6);
        border-color: transparent;
        box-shadow: 0 8px 28px rgba(0, 212, 255, 0.3);
      }
      .wd-store-txt { display: flex; flex-direction: column; align-items: flex-start; line-height: 1.15; font-weight: 700; font-size: 1.05rem; }
      .wd-store-txt small { font-size: 0.68rem; font-weight: 500; opacity: 0.8; text-transform: uppercase; letter-spacing: 0.5px; }
      .wd-continue {
        background: none; border: none; color: rgba(255,255,255,0.4);
        font-size: 0.85rem; font-family: inherit; cursor: pointer;
        text-decoration: underline; padding: 0.5rem;
      }
      .wd-continue:hover { color: rgba(255,255,255,0.7); }
    `;
    document.head.appendChild(css);
  }

  private validateForm(): boolean {
    // Validação completa via Zod — mais robusta que a sequência de ifs anterior.
    // Mensagens em PT-BR vêm do schema (src/auth/schemas.ts).
    const payload = {
      name: this.nameInput.value,
      cpf: this.cpfInput.value,
      phone: this.phoneInput.value,
      email: this.emailInput.value,
      password: this.passwordInput.value,
      confirmPassword: this.confirmPasswordInput.value,
      acceptTerms: this.acceptTermsCheckbox.checked,
    };
    const result = registerSchema.safeParse(payload);

    // Limpar erros antigos de TODOS os campos
    ['name', 'cpf', 'phone', 'email', 'password', 'confirmPassword', 'acceptTerms'].forEach(k => {
      this.renderFieldError(k, null);
    });

    if (result.success) return true;

    const errors = zodErrorsToFieldMap(result.error);
    // Renderiza todos os erros + foca no primeiro campo com problema
    const order = ['name', 'cpf', 'phone', 'email', 'password', 'confirmPassword', 'acceptTerms'];
    let firstErrorField: string | null = null;
    for (const key of order) {
      if (errors[key]) {
        this.renderFieldError(key, errors[key]);
        if (!firstErrorField) firstErrorField = key;
      }
    }
    if (firstErrorField) {
      const input = this.getInputByKey(firstErrorField);
      input?.focus();
      // Alert genérico no topo só pra reforçar que algo tá errado
      this.showAlert('Verifique os campos destacados em vermelho.', 'error');
    }
    return false;
  }

  // Mantém validateCPF import utilizado (algumas checagens anti-duplicata
  // consomem ele indiretamente via hashCPF/formatCPF). Referência explícita
  // pra o TypeScript não reclamar de import morto.
  private _unusedCheck = () => validateCPF;

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

  /**
   * Busca números reais (RPC pública) e injeta no elemento #socialProof
   * como texto discreto. Se falhar, não mostra nada — progressive enhancement.
   */
  private async loadSocialProof(): Promise<void> {
    try {
      const { data, error } = await supabase.rpc('social_proof_stats');
      if (error || !data) return;
      const row = Array.isArray(data) ? data[0] : data;
      const el = document.getElementById('socialProof');
      if (!el || !row) return;
      const ativos = Number(row.musicos_ativos || 0);
      const cad30 = Number(row.cadastros_ultimo_mes || 0);
      // Só mostra se tem números significativos (>100) pra não parecer vazio
      if (ativos < 100) return;
      el.innerHTML = `
        <span><strong>${ativos.toLocaleString('pt-BR')}</strong> músicos usando agora</span>
        <span class="sp-sep"></span>
        <span><strong>${cad30.toLocaleString('pt-BR')}</strong> cadastros este mês</span>
      `;
      el.classList.add('sp-ready');
    } catch {
      // Silencioso — se RPC falhar, a página continua sem social proof
    }
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

window.addEventListener('DOMContentLoaded', () => {
  if (redirectIfRecoveryHash()) return;
  AttributionService.init();
  updateRhythmCountInDom();
  setupPasswordToggle();
  new RegisterPage();
});
