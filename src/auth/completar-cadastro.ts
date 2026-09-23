// /completar-cadastro — pra usuários já logados que não têm CPF/phone.
//
// Casos: Romilson (pagante legado), qualquer fantasma que sobrar, e o
// guard do main.ts que redireciona pra cá quando detecta perfil incompleto.

import { supabase } from './supabase';
import { validateCPF, formatCPF, hashCPF } from '../utils/cpf';
import { internalNav, appHome, isNativeApp } from '../native/Platform';
import { peekPendingNext, nextForPlatform, deviceStore } from './plansRouting';
import { t, hydrate } from '../i18n';
import { bootIntencao } from '../native/bootIntencao';

// Hidrata o HTML estático (data-i18n) ANTES de qualquer render dinâmico —
// pra pt-BR é no-op visual (valores byte-idênticos ao HTML).
hydrate();

class CompletarCadastroPage {
  private cpfInput!: HTMLInputElement;
  private phoneInput!: HTMLInputElement;
  private cpfError!: HTMLElement;
  private phoneError!: HTMLElement;
  private submitBtn!: HTMLButtonElement;
  private submitText!: HTMLElement;
  private alertEl!: HTMLElement;

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    // Tem que estar logado pra completar perfil
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      internalNav('/login');
      return;
    }

    // CPF é documento brasileiro: conta de fora não tem o que completar aqui.
    // Sem isso, estrangeiro que caísse nesta URL ficava preso (o formulário
    // exige CPF válido e a página não tem saída além de sair da conta).
    try {
      const { data: perfil } = await supabase
        .from('gdrums_profiles')
        .select('country')
        .eq('id', session.user.id)
        .maybeSingle();
      if (perfil && perfil.country && perfil.country !== 'BR') {
        internalNav(appHome());
        return;
      }
    } catch { /* sem rede: segue no formulário, que é o caminho de hoje */ }

    this.cpfInput = document.getElementById('ccCpf') as HTMLInputElement;
    this.phoneInput = document.getElementById('ccPhone') as HTMLInputElement;
    this.cpfError = document.getElementById('ccCpfError') as HTMLElement;
    this.phoneError = document.getElementById('ccPhoneError') as HTMLElement;
    this.submitBtn = document.getElementById('ccSubmit') as HTMLButtonElement;
    this.submitText = document.getElementById('ccSubmitText') as HTMLElement;
    this.alertEl = document.getElementById('ccAlert') as HTMLElement;

    // Máscaras
    this.cpfInput.addEventListener('input', () => {
      this.cpfInput.value = formatCPF(this.cpfInput.value);
    });
    this.phoneInput.addEventListener('input', () => {
      this.phoneInput.value = this.formatPhone(this.phoneInput.value);
    });

    document.getElementById('ccForm')?.addEventListener('submit', (e) => this.handleSubmit(e));
    document.getElementById('ccLogout')?.addEventListener('click', async () => {
      await supabase.auth.signOut();
      localStorage.removeItem('gdrums-session-id');
      internalNav('/login');
    });

    setTimeout(() => this.cpfInput.focus(), 100);
  }

  private formatPhone(s: string): string {
    const d = s.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }

  private async handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    this.clearErrors();

    const cpfRaw = this.cpfInput.value;
    const phoneRaw = this.phoneInput.value.replace(/\D/g, '');

    if (!validateCPF(cpfRaw)) {
      this.showFieldError('cpf', t('auth.completarCadastro.cpfInvalid'));
      this.cpfInput.focus();
      return;
    }
    // WhatsApp é OPCIONAL (igual ao cadastro, Apple 5.1.1). Se preencher, valida.
    if (phoneRaw.length > 0 && (phoneRaw.length < 10 || phoneRaw.length > 11)) {
      this.showFieldError('phone', t('auth.completarCadastro.phoneInvalidFull'));
      this.phoneInput.focus();
      return;
    }

    this.setLoading(true);
    this.hideAlert();

    try {
      const cpfHashHex = await hashCPF(cpfRaw);
      const { data, error } = await supabase.rpc('complete_my_profile', {
        p_cpf_hash: cpfHashHex,
        p_phone: phoneRaw || null,
      });

      if (error) {
        this.setLoading(false);
        this.showAlert(t('auth.completarCadastro.saveError'), 'error');
        return;
      }

      const res = data as { success?: boolean; error?: string } | null;
      if (!res?.success) {
        this.setLoading(false);
        const code = res?.error;
        if (code === 'cpf_duplicate') {
          this.showFieldError('cpf', t('auth.completarCadastro.cpfDuplicate'));
        } else if (code === 'phone_duplicate') {
          this.showFieldError('phone', t('auth.completarCadastro.phoneDuplicate'));
        } else if (code === 'invalid_cpf') {
          this.showFieldError('cpf', t('auth.completarCadastro.cpfInvalid'));
        } else if (code === 'invalid_phone') {
          this.showFieldError('phone', t('auth.completarCadastro.phoneInvalid'));
        } else {
          this.showAlert(t('auth.completarCadastro.saveFailedGeneric'), 'error');
        }
        return;
      }

      this.showAlert(t('auth.completarCadastro.success'), 'success');
      // Veio de um link de compra (login guardou a intenção): segue pra lá
      // em vez de cair na home. A página de destino consome a intenção.
      const pending = peekPendingNext(deviceStore());
      const dest = pending ? nextForPlatform(pending, isNativeApp()) : appHome();
      setTimeout(() => { internalNav(dest); }, 800);
    } catch {
      this.setLoading(false);
      this.showAlert(t('auth.completarCadastro.connectionError'), 'error');
    }
  }

  private setLoading(loading: boolean): void {
    this.submitBtn.disabled = loading;
    this.submitText.textContent = loading ? t('auth.completarCadastro.savingBtn') : t('auth.completarCadastro.concludeBtn');
  }

  private showAlert(msg: string, type: 'success' | 'error'): void {
    this.alertEl.textContent = msg;
    this.alertEl.className = `cc-alert ${type}`;
    this.alertEl.style.display = 'block';
  }
  private hideAlert(): void { this.alertEl.style.display = 'none'; }

  private showFieldError(field: 'cpf' | 'phone', msg: string): void {
    const el = field === 'cpf' ? this.cpfError : this.phoneError;
    el.textContent = msg;
    el.classList.add('active');
  }
  private clearErrors(): void {
    this.cpfError.classList.remove('active');
    this.phoneError.classList.remove('active');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  bootIntencao();
  new CompletarCadastroPage();
});
