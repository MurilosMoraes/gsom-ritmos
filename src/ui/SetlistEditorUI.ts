// Editor de setlist — overlay fullscreen com glass morphism

import type { SetlistManager } from '../core/SetlistManager';
import type { SetlistItem } from '../types';

export class SetlistEditorUI {
  private overlay: HTMLElement | null = null;
  private setlistManager: SetlistManager | null = null;
  private catalog: Array<{ name: string; path: string }> = [];
  private onClose?: () => void;
  private styleInjected = false;
  private dragSourceIndex: number = -1;

  constructor() {
    this.injectStyles();
  }

  open(
    catalog: Array<{ name: string; path: string }>,
    setlistManager: SetlistManager,
    onClose?: () => void
  ): void {
    this.catalog = catalog;
    this.setlistManager = setlistManager;
    this.onClose = onClose;
    this.render();
  }

  close(): void {
    if (this.overlay) {
      this.overlay.classList.add('sle-exit');
      this.overlay.addEventListener('animationend', () => {
        this.overlay?.remove();
        this.overlay = null;
      }, { once: true });
    }
    this.onClose?.();
  }

  // ─── Render ─────────────────────────────────────────────────────────

  private render(): void {
    // Remover anterior
    this.overlay?.remove();

    this.overlay = document.createElement('div');
    this.overlay.className = 'sle-overlay';

    const container = document.createElement('div');
    container.className = 'sle-container';

    // Header
    const header = document.createElement('div');
    header.className = 'sle-header';
    header.innerHTML = `
      <h2 class="sle-title">Favoritos</h2>
      <button class="sle-close-btn" aria-label="Fechar">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M15 5L5 15M5 5l10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    `;
    header.querySelector('.sle-close-btn')!.addEventListener('click', () => this.close());

    // Body (dois painéis)
    const body = document.createElement('div');
    body.className = 'sle-body';

    // Painel: Ritmos disponíveis
    const catalogPanel = document.createElement('div');
    catalogPanel.className = 'sle-panel sle-catalog';
    catalogPanel.innerHTML = `
      <div class="sle-panel-header">
        <span class="sle-panel-title">Ritmos disponíveis</span>
        <input type="text" class="sle-search" placeholder="Filtrar..." />
      </div>
      <div class="sle-panel-list sle-catalog-list"></div>
    `;

    const searchInput = catalogPanel.querySelector('.sle-search') as HTMLInputElement;
    searchInput.addEventListener('input', () => {
      this.renderCatalog(catalogPanel.querySelector('.sle-catalog-list')!, searchInput.value);
    });

    // Painel: Setlist atual
    const setlistPanel = document.createElement('div');
    setlistPanel.className = 'sle-panel sle-setlist';
    setlistPanel.innerHTML = `
      <div class="sle-panel-header">
        <span class="sle-panel-title">Seus favoritos</span>
        <button class="sle-clear-btn">Limpar</button>
      </div>
      <div class="sle-panel-list sle-setlist-list"></div>
    `;

    setlistPanel.querySelector('.sle-clear-btn')!.addEventListener('click', () => {
      this.setlistManager?.clear();
      this.renderSetlist(setlistPanel.querySelector('.sle-setlist-list')!);
      this.renderCatalog(catalogPanel.querySelector('.sle-catalog-list')!, searchInput.value);
    });

    body.append(catalogPanel, setlistPanel);
    container.append(header, body);
    this.overlay.appendChild(container);
    document.body.appendChild(this.overlay);

    // Renderizar listas
    this.renderCatalog(catalogPanel.querySelector('.sle-catalog-list')!, '');
    this.renderSetlist(setlistPanel.querySelector('.sle-setlist-list')!);

    // Animate in
    void this.overlay.offsetHeight;
    this.overlay.classList.add('sle-visible');
  }

  private renderCatalog(container: HTMLElement, filter: string): void {
    container.innerHTML = '';
    const query = filter.toLowerCase();
    const setlistPaths = new Set(this.setlistManager?.getItems().map(i => i.path) || []);

    const filtered = this.catalog.filter(r => r.name.toLowerCase().includes(query));

    if (filtered.length === 0) {
      container.innerHTML = '<div class="sle-empty">Nenhum ritmo encontrado</div>';
      return;
    }

    filtered.forEach(rhythm => {
      const inSetlist = setlistPaths.has(rhythm.path);
      const item = document.createElement('div');
      item.className = 'sle-catalog-item' + (inSetlist ? ' sle-in-setlist' : '');

      const name = document.createElement('span');
      name.className = 'sle-item-name';
      name.textContent = rhythm.name;

      const addBtn = document.createElement('button');
      addBtn.className = 'sle-add-btn';
      addBtn.innerHTML = inSetlist
        ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13 3L6 13l-3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

      if (!inSetlist) {
        addBtn.addEventListener('click', () => {
          this.setlistManager?.addItem({ name: rhythm.name, path: rhythm.path });
          const setlistList = this.overlay?.querySelector('.sle-setlist-list');
          if (setlistList) this.renderSetlist(setlistList as HTMLElement);
          this.renderCatalog(container, filter);
        });
      }

      item.append(name, addBtn);
      container.appendChild(item);
    });
  }

  private renderSetlist(container: HTMLElement): void {
    container.innerHTML = '';
    const items = this.setlistManager?.getItems() || [];

    if (items.length === 0) {
      container.innerHTML = '<div class="sle-empty">Adicione ritmos aos favoritos</div>';
      return;
    }

    items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'sle-setlist-item';
      row.setAttribute('draggable', 'true');
      row.setAttribute('data-index', index.toString());

      // Drag handle
      const handle = document.createElement('span');
      handle.className = 'sle-drag-handle';
      handle.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="4" cy="3" r="1.2" fill="currentColor"/><circle cx="10" cy="3" r="1.2" fill="currentColor"/><circle cx="4" cy="7" r="1.2" fill="currentColor"/><circle cx="10" cy="7" r="1.2" fill="currentColor"/><circle cx="4" cy="11" r="1.2" fill="currentColor"/><circle cx="10" cy="11" r="1.2" fill="currentColor"/></svg>';

      const num = document.createElement('span');
      num.className = 'sle-item-num';
      num.textContent = (index + 1).toString();

      const name = document.createElement('span');
      name.className = 'sle-item-name';
      name.textContent = item.name;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'sle-remove-btn';
      removeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M11 3L3 11M3 3l8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
      removeBtn.addEventListener('click', () => {
        this.setlistManager?.removeItem(index);
        this.renderSetlist(container);
        const catalogList = this.overlay?.querySelector('.sle-catalog-list');
        const searchInput = this.overlay?.querySelector('.sle-search') as HTMLInputElement;
        if (catalogList) this.renderCatalog(catalogList as HTMLElement, searchInput?.value || '');
      });

      row.append(handle, num, name, removeBtn);
      container.appendChild(row);

      // Drag events
      row.addEventListener('dragstart', (e) => {
        this.dragSourceIndex = index;
        row.classList.add('sle-dragging');
        e.dataTransfer?.setData('text/plain', index.toString());
      });

      row.addEventListener('dragend', () => {
        row.classList.remove('sle-dragging');
        container.querySelectorAll('.sle-drag-over').forEach(el => el.classList.remove('sle-drag-over'));
      });

      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        container.querySelectorAll('.sle-drag-over').forEach(el => el.classList.remove('sle-drag-over'));
        row.classList.add('sle-drag-over');
      });

      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('sle-drag-over');
        const targetIndex = index;
        if (this.dragSourceIndex !== targetIndex && this.dragSourceIndex >= 0) {
          this.setlistManager?.moveItem(this.dragSourceIndex, targetIndex);
          this.renderSetlist(container);
        }
        this.dragSourceIndex = -1;
      });

      // Touch drag support
      this.setupTouchDrag(row, container, index);
    });
  }

  private setupTouchDrag(row: HTMLElement, container: HTMLElement, index: number): void {
    let startY = 0;
    let clone: HTMLElement | null = null;
    let moved = false;

    const handle = row.querySelector('.sle-drag-handle') as HTMLElement;
    if (!handle) return;

    handle.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY;
      this.dragSourceIndex = index;
      moved = false;

      clone = row.cloneNode(true) as HTMLElement;
      clone.className = 'sle-setlist-item sle-touch-ghost';
      clone.style.position = 'fixed';
      clone.style.width = row.offsetWidth + 'px';
      clone.style.top = row.getBoundingClientRect().top + 'px';
      clone.style.left = row.getBoundingClientRect().left + 'px';
      clone.style.zIndex = '100001';
      clone.style.pointerEvents = 'none';
      document.body.appendChild(clone);

      row.classList.add('sle-dragging');
    }, { passive: true });

    handle.addEventListener('touchmove', (e) => {
      if (!clone) return;
      moved = true;
      e.preventDefault();
      const dy = e.touches[0].clientY - startY;
      clone.style.transform = `translateY(${dy}px)`;

      // Find target
      const items = container.querySelectorAll('.sle-setlist-item');
      items.forEach(el => el.classList.remove('sle-drag-over'));
      const touch = e.touches[0];
      items.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (touch.clientY > rect.top && touch.clientY < rect.bottom) {
          el.classList.add('sle-drag-over');
        }
      });
    }, { passive: false });

    handle.addEventListener('touchend', () => {
      clone?.remove();
      clone = null;
      row.classList.remove('sle-dragging');

      if (!moved) return;

      const overEl = container.querySelector('.sle-drag-over');
      if (overEl) {
        const targetIndex = parseInt(overEl.getAttribute('data-index') || '-1');
        if (targetIndex >= 0 && targetIndex !== this.dragSourceIndex) {
          this.setlistManager?.moveItem(this.dragSourceIndex, targetIndex);
          this.renderSetlist(container);
        }
      }
      container.querySelectorAll('.sle-drag-over').forEach(el => el.classList.remove('sle-drag-over'));
      this.dragSourceIndex = -1;
    }, { passive: true });
  }

  // ─── Styles ─────────────────────────────────────────────────────────

  private injectStyles(): void {
    if (this.styleInjected) return;
    this.styleInjected = true;

    const css = document.createElement('style');
    css.id = 'sle-styles';
    css.textContent = `
      .sle-overlay {
        position: fixed;
        inset: 0;
        background: rgba(2, 2, 12, 0.85);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        z-index: 50000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        opacity: 0;
        transition: opacity 0.2s ease;
      }
      .sle-overlay.sle-visible { opacity: 1; }
      .sle-overlay.sle-exit { opacity: 0; transition: opacity 0.18s ease; }

      .sle-container {
        width: 100%;
        max-width: 700px;
        max-height: 85vh;
        background: linear-gradient(165deg, rgba(18, 18, 38, 0.95) 0%, rgba(6, 6, 18, 0.98) 100%);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 20px;
        box-shadow: 0 32px 80px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.06);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transform: scale(0.95) translateY(10px);
        transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .sle-visible .sle-container { transform: scale(1) translateY(0); }
      .sle-exit .sle-container { transform: scale(0.97) translateY(8px); }

      .sle-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1.25rem 1.5rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      }
      .sle-title {
        font-size: 1.1rem;
        font-weight: 700;
        color: #fff;
        margin: 0;
        letter-spacing: -0.3px;
      }
      .sle-close-btn {
        background: rgba(255, 255, 255, 0.06);
        border: none;
        border-radius: 10px;
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: rgba(255, 255, 255, 0.5);
        cursor: pointer;
        transition: all 0.15s ease;
        -webkit-tap-highlight-color: transparent;
      }
      .sle-close-btn:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }

      .sle-body {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1px;
        background: rgba(255, 255, 255, 0.04);
        flex: 1;
        overflow: hidden;
      }
      @media (max-width: 550px) {
        .sle-body { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; }
      }

      .sle-panel {
        display: flex;
        flex-direction: column;
        background: rgba(8, 8, 22, 0.6);
        overflow: hidden;
      }
      .sle-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.85rem 1.25rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        gap: 0.75rem;
        flex-shrink: 0;
      }
      .sle-panel-title {
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: rgba(255, 255, 255, 0.4);
        white-space: nowrap;
      }
      .sle-search {
        flex: 1;
        max-width: 160px;
        padding: 0.4rem 0.7rem;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        color: #fff;
        font-size: 0.8rem;
        font-family: inherit;
        outline: none;
        transition: border-color 0.15s;
      }
      .sle-search:focus { border-color: rgba(0, 212, 255, 0.4); }
      .sle-search::placeholder { color: rgba(255,255,255,0.25); }

      .sle-clear-btn {
        font-size: 0.75rem;
        color: rgba(255, 100, 100, 0.7);
        background: rgba(255, 100, 100, 0.08);
        border: 1px solid rgba(255, 100, 100, 0.15);
        border-radius: 8px;
        padding: 0.35rem 0.7rem;
        cursor: pointer;
        font-family: inherit;
        font-weight: 500;
        transition: all 0.15s;
        -webkit-tap-highlight-color: transparent;
      }
      .sle-clear-btn:hover { background: rgba(255, 100, 100, 0.15); color: rgba(255, 100, 100, 0.9); }

      .sle-panel-list {
        flex: 1;
        overflow-y: auto;
        padding: 0.5rem;
        overscroll-behavior: contain;
      }
      .sle-panel-list::-webkit-scrollbar { width: 4px; }
      .sle-panel-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }

      .sle-empty {
        text-align: center;
        padding: 2rem 1rem;
        color: rgba(255, 255, 255, 0.25);
        font-size: 0.85rem;
      }

      /* Catalog items */
      .sle-catalog-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.6rem 0.8rem;
        border-radius: 10px;
        margin-bottom: 2px;
        transition: background 0.1s;
        -webkit-tap-highlight-color: transparent;
      }
      .sle-catalog-item:hover { background: rgba(255, 255, 255, 0.04); }
      .sle-catalog-item .sle-item-name {
        font-size: 0.88rem;
        color: rgba(255, 255, 255, 0.85);
        text-transform: capitalize;
      }
      .sle-catalog-item.sle-in-setlist .sle-item-name {
        color: rgba(255, 255, 255, 0.35);
      }
      .sle-add-btn {
        width: 30px;
        height: 30px;
        border-radius: 8px;
        border: none;
        background: rgba(0, 212, 255, 0.1);
        color: #00D4FF;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.15s;
        flex-shrink: 0;
        -webkit-tap-highlight-color: transparent;
      }
      .sle-add-btn:hover { background: rgba(0, 212, 255, 0.2); transform: scale(1.08); }
      .sle-in-setlist .sle-add-btn {
        background: rgba(0, 230, 140, 0.08);
        color: rgba(0, 230, 140, 0.5);
        cursor: default;
      }

      /* Setlist items */
      .sle-setlist-item {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        padding: 0.6rem 0.6rem;
        border-radius: 10px;
        margin-bottom: 2px;
        background: rgba(255, 255, 255, 0.02);
        border: 1.5px solid transparent;
        transition: all 0.12s ease;
        -webkit-tap-highlight-color: transparent;
        touch-action: pan-y;
      }
      .sle-setlist-item:hover { background: rgba(255, 255, 255, 0.05); }
      .sle-setlist-item.sle-dragging { opacity: 0.3; }
      .sle-setlist-item.sle-drag-over {
        border-color: rgba(0, 212, 255, 0.5);
        background: rgba(0, 212, 255, 0.06);
      }
      .sle-touch-ghost {
        opacity: 0.85;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        border-color: rgba(0, 212, 255, 0.4) !important;
        background: rgba(15, 15, 35, 0.95) !important;
      }

      .sle-drag-handle {
        color: rgba(255, 255, 255, 0.2);
        cursor: grab;
        padding: 0.2rem;
        touch-action: none;
        flex-shrink: 0;
      }
      .sle-drag-handle:active { cursor: grabbing; }
      .sle-item-num {
        font-size: 0.7rem;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.25);
        min-width: 18px;
        text-align: center;
        flex-shrink: 0;
      }
      .sle-setlist-item .sle-item-name {
        flex: 1;
        font-size: 0.88rem;
        color: rgba(255, 255, 255, 0.85);
        text-transform: capitalize;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sle-remove-btn {
        width: 28px;
        height: 28px;
        border-radius: 8px;
        border: none;
        background: rgba(255, 80, 80, 0.06);
        color: rgba(255, 80, 80, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.15s;
        flex-shrink: 0;
        -webkit-tap-highlight-color: transparent;
      }
      .sle-remove-btn:hover { background: rgba(255, 80, 80, 0.15); color: rgba(255, 80, 80, 0.9); }
    `;
    document.head.appendChild(css);
  }
}
