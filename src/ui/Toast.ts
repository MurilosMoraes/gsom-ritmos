// Toast curto + undo — padrão Gmail. Substitui confirm() do navegador
// em ações reversíveis (deletar, salvar, renomear).
//
// Uso:
//   Toast.show('Ritmo salvo', { type: 'success' });
//   Toast.show('Ritmo deletado', {
//     action: { label: 'Desfazer', onClick: () => restore() },
//     durationMs: 5000,
//   });

type ToastType = 'success' | 'info' | 'warn';

interface ToastOptions {
  type?: ToastType;
  durationMs?: number;
  action?: { label: string; onClick: () => void };
}

const ICONS: Record<ToastType, string> = {
  success: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  info: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  warn: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
};

let activeEl: HTMLElement | null = null;
let activeTimer: number | null = null;

function dismiss(el: HTMLElement): void {
  el.classList.remove('active');
  setTimeout(() => el.remove(), 220);
  if (activeEl === el) activeEl = null;
  if (activeTimer !== null) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }
}

export const Toast = {
  show(message: string, options: ToastOptions = {}): void {
    const type: ToastType = options.type || 'success';
    const durationMs = options.durationMs ?? (options.action ? 5000 : 2400);

    // Fecha toast anterior
    if (activeEl) dismiss(activeEl);

    const el = document.createElement('div');
    el.className = 'x-toast';
    el.innerHTML = `
      <span class="x-toast-icon ${type}">${ICONS[type]}</span>
      <span class="x-toast-msg"></span>
      ${options.action ? `<button class="x-toast-action">${options.action.label}</button>` : ''}
    `;
    (el.querySelector('.x-toast-msg') as HTMLElement).textContent = message;

    if (options.action) {
      let acted = false;
      el.querySelector('.x-toast-action')?.addEventListener('click', () => {
        if (acted) return;
        acted = true;
        try { options.action!.onClick(); } catch { /* noop */ }
        dismiss(el);
      });
    }

    document.body.appendChild(el);
    activeEl = el;
    requestAnimationFrame(() => el.classList.add('active'));

    activeTimer = window.setTimeout(() => dismiss(el), durationMs);
  },

  dismiss(): void {
    if (activeEl) dismiss(activeEl);
  },
};
