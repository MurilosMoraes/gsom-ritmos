// Sistema de modais — glass morphism design

export class ModalManager {
  private overlay: HTMLElement | null = null;
  private styleInjected = false;

  constructor() {
    this.injectStyles();
    this.createOverlay();
  }

  // ─── Alert / Info modal ─────────────────────────────────────────────

  show(title: string, message: string, type: 'info' | 'error' | 'warning' | 'success' = 'info'): Promise<void> {
    // Para mensagens curtas de sucesso/info, usar toast em vez de modal
    if (type === 'success' || (type === 'info' && message.length < 80)) {
      return this.showToast(message, type);
    }

    return new Promise((resolve) => {
      if (!this.overlay) return resolve();

      const modal = this.buildModal(type);
      const icon = this.buildIcon(type);
      const titleEl = this.el('h3', 'gm-title', title);
      const messageEl = this.el('p', 'gm-message', message);

      const btn = this.el('button', 'gm-btn gm-btn-primary', 'Entendi') as HTMLButtonElement;
      btn.style.setProperty('--btn-color', this.getColor(type));
      btn.onclick = () => { this.dismiss(modal, resolve); };

      const content = this.el('div', 'gm-content');
      content.append(icon, titleEl, messageEl, btn);
      modal.appendChild(content);

      this.present(modal);

      // Fechar com ESC
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); this.dismiss(modal, resolve); }
      };
      document.addEventListener('keydown', onKey);

      // Fechar ao clicar no backdrop
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.dismiss(modal, resolve);
      });
    });
  }

  // ─── Confirm modal ──────────────────────────────────────────────────

  confirm(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.overlay) return resolve(false);

      const modal = this.buildModal('info');
      const icon = this.buildIcon('info');
      const titleEl = this.el('h3', 'gm-title', title);
      const messageEl = this.el('p', 'gm-message', message);

      const btnRow = this.el('div', 'gm-btn-row');

      const cancelBtn = this.el('button', 'gm-btn gm-btn-ghost', 'Cancelar') as HTMLButtonElement;
      cancelBtn.onclick = () => { this.dismiss(modal, () => resolve(false)); };

      const confirmBtn = this.el('button', 'gm-btn gm-btn-primary', 'Confirmar') as HTMLButtonElement;
      confirmBtn.style.setProperty('--btn-color', this.getColor('info'));
      confirmBtn.onclick = () => { this.dismiss(modal, () => resolve(true)); };

      btnRow.append(cancelBtn, confirmBtn);

      const content = this.el('div', 'gm-content');
      content.append(icon, titleEl, messageEl, btnRow);
      modal.appendChild(content);

      this.present(modal);

      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); this.dismiss(modal, () => resolve(false)); }
      };
      document.addEventListener('keydown', onKey);
    });
  }

  // ─── Toast (notificação flutuante) ──────────────────────────────────

  private showToast(message: string, type: 'info' | 'error' | 'warning' | 'success'): Promise<void> {
    return new Promise((resolve) => {
      const toast = document.createElement('div');
      toast.className = `gm-toast gm-toast-${type}`;

      const dot = this.el('span', 'gm-toast-dot');
      dot.style.background = this.getColor(type);
      const text = this.el('span', 'gm-toast-text', message);

      toast.append(dot, text);
      document.body.appendChild(toast);

      // Force reflow for animation
      void toast.offsetHeight;
      toast.classList.add('gm-toast-visible');

      const remove = () => {
        toast.classList.remove('gm-toast-visible');
        toast.classList.add('gm-toast-exit');
        toast.addEventListener('animationend', () => {
          toast.remove();
          resolve();
        }, { once: true });
      };

      // Auto-dismiss
      setTimeout(remove, 2200);

      // Tap to dismiss
      toast.addEventListener('click', remove, { once: true });
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  hide(): void {
    if (this.overlay) {
      this.overlay.style.display = 'none';
      this.overlay.innerHTML = '';
    }
  }

  private createOverlay(): void {
    this.overlay = document.createElement('div');
    this.overlay.className = 'gm-overlay';
    document.body.appendChild(this.overlay);
  }

  private buildModal(type: string): HTMLElement {
    const modal = document.createElement('div');
    modal.className = `gm-modal gm-modal-${type}`;
    return modal;
  }

  private present(modal: HTMLElement): void {
    if (!this.overlay) return;
    this.overlay.innerHTML = '';
    this.overlay.appendChild(modal);
    this.overlay.style.display = 'flex';
    // Force reflow then animate
    void this.overlay.offsetHeight;
    this.overlay.classList.add('gm-overlay-visible');
    modal.classList.add('gm-modal-visible');
  }

  private dismiss(modal: HTMLElement, callback: () => void): void {
    modal.classList.remove('gm-modal-visible');
    modal.classList.add('gm-modal-exit');
    this.overlay?.classList.remove('gm-overlay-visible');
    this.overlay?.classList.add('gm-overlay-exit');

    modal.addEventListener('animationend', () => {
      this.overlay?.classList.remove('gm-overlay-exit');
      if (this.overlay) {
        this.overlay.style.display = 'none';
        this.overlay.innerHTML = '';
      }
      callback();
    }, { once: true });
  }

  private el(tag: string, className: string, text?: string): HTMLElement {
    const e = document.createElement(tag);
    e.className = className;
    if (text) e.textContent = text;
    return e;
  }

  private buildIcon(type: 'info' | 'error' | 'warning' | 'success'): HTMLElement {
    const wrapper = this.el('div', 'gm-icon');
    wrapper.style.setProperty('--icon-color', this.getColor(type));

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '28');
    svg.setAttribute('height', '28');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    const paths: Record<string, string[]> = {
      info:    ['M12 16v-4', 'M12 8h.01', 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z'],
      error:   ['M18 6 6 18', 'M6 6l12 12', 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z'],
      warning: ['M12 9v4', 'M12 17h.01', 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z'],
      success: ['M20 6 9 17l-5-5', 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z'],
    };

    (paths[type] || paths.info).forEach(d => {
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    });

    wrapper.appendChild(svg);
    return wrapper;
  }

  private getColor(type: string): string {
    const colors: Record<string, string> = {
      info: '#00D4FF',
      error: '#FF4466',
      warning: '#FFB020',
      success: '#00E68C',
    };
    return colors[type] || colors.info;
  }

  // ─── CSS injection ──────────────────────────────────────────────────

  private injectStyles(): void {
    if (this.styleInjected) return;
    this.styleInjected = true;

    const css = document.createElement('style');
    css.id = 'gm-modal-styles';
    css.textContent = `
      /* ── Overlay ── */
      .gm-overlay {
        position: fixed;
        inset: 0;
        background: rgba(2, 2, 12, 0.6);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 99999;
        padding: 1.5rem;
        opacity: 0;
        transition: opacity 0.2s ease;
      }
      .gm-overlay-visible { opacity: 1; }
      .gm-overlay-exit { opacity: 0; transition: opacity 0.18s ease; }

      /* ── Modal card ── */
      .gm-modal {
        width: 100%;
        max-width: 380px;
        opacity: 0;
        transform: scale(0.92) translateY(12px);
      }
      .gm-modal-visible {
        animation: gmEnter 0.28s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      .gm-modal-exit {
        animation: gmExit 0.18s ease forwards;
      }

      @keyframes gmEnter {
        from { opacity: 0; transform: scale(0.92) translateY(12px); }
        to   { opacity: 1; transform: scale(1) translateY(0); }
      }
      @keyframes gmExit {
        from { opacity: 1; transform: scale(1) translateY(0); }
        to   { opacity: 0; transform: scale(0.95) translateY(8px); }
      }

      /* ── Content ── */
      .gm-content {
        background: linear-gradient(165deg, rgba(18, 18, 38, 0.95) 0%, rgba(8, 8, 22, 0.98) 100%);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 20px;
        padding: 2rem 1.75rem 1.75rem;
        box-shadow:
          0 24px 80px rgba(0, 0, 0, 0.5),
          0 0 0 1px rgba(255, 255, 255, 0.04),
          inset 0 1px 0 rgba(255, 255, 255, 0.06);
        text-align: center;
      }

      /* ── Icon ── */
      .gm-icon {
        width: 52px;
        height: 52px;
        border-radius: 16px;
        background: color-mix(in srgb, var(--icon-color) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--icon-color) 20%, transparent);
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 1.25rem;
        color: var(--icon-color);
      }

      /* ── Text ── */
      .gm-title {
        margin: 0 0 0.5rem;
        font-size: 1.15rem;
        font-weight: 700;
        color: #FFFFFF;
        letter-spacing: -0.3px;
        line-height: 1.3;
      }
      .gm-message {
        margin: 0 0 1.5rem;
        font-size: 0.9rem;
        color: rgba(255, 255, 255, 0.55);
        line-height: 1.55;
      }

      /* ── Buttons ── */
      .gm-btn {
        padding: 0.7rem 1.5rem;
        border-radius: 12px;
        font-size: 0.9rem;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
        transition: all 0.15s ease;
        border: none;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
        user-select: none;
        min-height: 44px;
      }
      .gm-btn:active { transform: scale(0.96); }

      .gm-btn-primary {
        width: 100%;
        background: linear-gradient(135deg, var(--btn-color), color-mix(in srgb, var(--btn-color) 70%, #8B5CF6));
        color: white;
        box-shadow: 0 4px 20px color-mix(in srgb, var(--btn-color) 35%, transparent);
      }
      .gm-btn-primary:hover {
        box-shadow: 0 6px 28px color-mix(in srgb, var(--btn-color) 50%, transparent);
        transform: translateY(-1px);
      }

      .gm-btn-ghost {
        flex: 1;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.7);
      }
      .gm-btn-ghost:hover {
        background: rgba(255, 255, 255, 0.1);
        color: white;
      }

      .gm-btn-row {
        display: flex;
        gap: 0.75rem;
      }
      .gm-btn-row .gm-btn-primary { flex: 1.3; }

      /* ── Toast ── */
      .gm-toast {
        position: fixed;
        top: calc(env(safe-area-inset-top, 0px) + 1rem);
        left: 50%;
        transform: translateX(-50%) translateY(-20px);
        background: linear-gradient(165deg, rgba(18, 18, 38, 0.92) 0%, rgba(8, 8, 22, 0.96) 100%);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 14px;
        padding: 0.75rem 1.25rem;
        display: flex;
        align-items: center;
        gap: 0.6rem;
        z-index: 100000;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.04);
        opacity: 0;
        pointer-events: auto;
        cursor: pointer;
        max-width: calc(100vw - 2rem);
      }
      .gm-toast-visible {
        animation: gmToastIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      .gm-toast-exit {
        animation: gmToastOut 0.2s ease forwards;
      }

      @keyframes gmToastIn {
        from { opacity: 0; transform: translateX(-50%) translateY(-20px) scale(0.95); }
        to   { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
      }
      @keyframes gmToastOut {
        from { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        to   { opacity: 0; transform: translateX(-50%) translateY(-12px) scale(0.97); }
      }

      .gm-toast-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
        box-shadow: 0 0 8px currentColor;
      }
      .gm-toast-text {
        font-size: 0.875rem;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.9);
        line-height: 1.4;
      }
    `;
    document.head.appendChild(css);
  }
}
