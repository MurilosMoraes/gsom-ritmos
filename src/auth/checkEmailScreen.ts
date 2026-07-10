// Tela "confira seu e-mail" — COMPARTILHADA entre cadastro e login.
//
// Aparece em dois momentos, os dois só pra conta INTERNACIONAL (no Brasil
// o e-mail já nasce confirmado, então nunca cai aqui):
//   1. Logo após o cadastro (register.ts) — a conta existe mas o e-mail
//      precisa ser confirmado antes de logar.
//   2. Se a pessoa tentar LOGAR antes de confirmar (login.ts) — o Supabase
//      recusa com email_not_confirmed e a gente traz ela pra cá em vez de
//      mostrar um alerta vermelho sem saída.
//
// Reenvio inteligente: cooldown com contagem regressiva, cooldown CRESCE a
// cada reenvio (30s → 60s → 120s) e para de vez após MAX_RESENDS. O
// servidor (Supabase Auth) também tem rate limit — isto é a camada de UX.

import { supabase } from './supabase';
import { t } from '../i18n';

const MAX_RESENDS = 3;

export function showCheckEmailScreen(email: string, opts?: { onBack?: () => void }): void {
  if (document.getElementById('ceOverlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'ceOverlay';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:100000;
    background:linear-gradient(165deg,#0a0a1e 0%,#05050f 100%);
    display:flex;align-items:center;justify-content:center;padding:1.5rem;
    overflow-y:auto;font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif;
  `;
  overlay.innerHTML = `
    <div style="width:100%;max-width:400px;text-align:center;">
      <div style="width:72px;height:72px;margin:0 auto 1.25rem;border-radius:50%;
                  display:flex;align-items:center;justify-content:center;
                  background:linear-gradient(135deg,#00D4FF,#8B5CF6);color:#fff;
                  box-shadow:0 8px 32px rgba(0,212,255,0.35);">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
      </div>
      <h1 style="color:#fff;font-size:1.6rem;font-weight:800;margin:0 0 0.85rem;letter-spacing:-0.5px;">${t('auth.register.checkEmailTitle')}</h1>
      <p style="color:rgba(255,255,255,0.65);font-size:0.98rem;line-height:1.55;margin:0 0 0.6rem;">
        ${t('auth.register.checkEmailBody', { email: `<strong style="color:#fff;">${escapeHtml(email)}</strong>` })}
      </p>
      <p style="color:rgba(255,255,255,0.4);font-size:0.85rem;line-height:1.5;margin:0 0 1.6rem;">${t('auth.register.checkEmailHint')}</p>
      <button id="ceResend" style="width:100%;padding:0.95rem;border-radius:16px;cursor:pointer;
              background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,255,255,0.12);
              color:#fff;font-family:inherit;font-size:1rem;font-weight:700;margin-bottom:1rem;"></button>
      <button id="ceBack" style="background:none;border:none;color:rgba(255,255,255,0.4);
              font-size:0.85rem;font-family:inherit;cursor:pointer;text-decoration:underline;padding:0.5rem;">
        ${t('auth.register.checkEmailBackToLogin')}
      </button>
    </div>`;
  document.body.appendChild(overlay);

  const resendBtn = overlay.querySelector('#ceResend') as HTMLButtonElement;
  let resends = 0;
  let timer: number | null = null;

  const startCooldown = (seconds: number) => {
    let left = seconds;
    resendBtn.disabled = true;
    resendBtn.style.opacity = '0.55';
    const tick = () => {
      if (left <= 0) {
        if (timer) { clearInterval(timer); timer = null; }
        if (resends >= MAX_RESENDS) {
          resendBtn.textContent = t('auth.register.checkEmailResendLimit');
          resendBtn.disabled = true;
          return;
        }
        resendBtn.textContent = t('auth.register.checkEmailResend');
        resendBtn.disabled = false;
        resendBtn.style.opacity = '1';
        return;
      }
      resendBtn.textContent = t('auth.register.checkEmailResendIn', { s: left });
      left--;
    };
    tick();
    timer = window.setInterval(tick, 1000);
  };

  // Um e-mail acabou de sair (cadastro ou tentativa de login) — começa travado.
  startCooldown(30);

  resendBtn.addEventListener('click', async () => {
    if (resendBtn.disabled || resends >= MAX_RESENDS) return;
    resendBtn.disabled = true;
    resendBtn.textContent = t('auth.register.checkEmailResending');
    try {
      await supabase.auth.resend({ type: 'signup', email });
      resends++;
      resendBtn.textContent = t('auth.register.checkEmailResent');
      setTimeout(() => startCooldown(30 * Math.pow(2, resends)), 1200);
    } catch {
      resendBtn.disabled = false;
      resendBtn.style.opacity = '1';
      resendBtn.textContent = t('auth.register.checkEmailResend');
    }
  });

  overlay.querySelector('#ceBack')?.addEventListener('click', () => {
    if (timer) clearInterval(timer);
    if (opts?.onBack) { overlay.remove(); opts.onBack(); return; }
    window.location.href = '/login.html';
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
