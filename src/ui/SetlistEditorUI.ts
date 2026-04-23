// Editor de setlist — overlay fullscreen com glass morphism

import type { SetlistManager } from '../core/SetlistManager';
import type { SetlistItem } from '../types';
import type { PreviewPlayer } from '../core/PreviewPlayer';

export interface CatalogItem {
  name: string;
  path: string;
  userRhythmId?: string;
  isPersonal?: boolean;
  baseRhythmName?: string; // ritmo de referência (só personal)
  bpm?: number;            // BPM salvo (só personal)
  category?: string;       // categoria do manifest ('Brasileiro', 'Gaúcho', etc)
  rhythmData?: any;        // JSON do ritmo (só personal, pra preview offline)
}

// Normaliza pra busca fuzzy pt-BR (ignora acento e caixa)
function normForSearch(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export class SetlistEditorUI {
  private overlay: HTMLElement | null = null;
  private setlistManager: SetlistManager | null = null;
  private catalog: CatalogItem[] = [];
  private onClose?: () => void;
  private styleInjected = false;
  private dragSourceIndex: number = -1;
  private activeCategory: string = 'all'; // 'all' | 'Meus' | 'Favoritos' | <category name>
  private currentQuery: string = '';
  private previewPlayer: PreviewPlayer | null = null;
  // Em mobile (<=640px) alternamos entre 'catalog' e 'setlist' em tabs.
  private mobileTab: 'catalog' | 'setlist' = 'catalog';
  // Função que resolve rhythm data de um CatalogItem (pra preview)
  private resolveRhythmData:
    | ((item: CatalogItem) => Promise<any | null>)
    | null = null;
  private previewUnsubscribe: (() => void) | null = null;

  constructor() {
    this.injectStyles();
  }

  open(
    catalog: CatalogItem[],
    setlistManager: SetlistManager,
    onClose?: () => void,
    opts?: {
      previewPlayer?: PreviewPlayer;
      resolveRhythmData?: (item: CatalogItem) => Promise<any | null>;
    }
  ): void {
    this.catalog = catalog;
    this.setlistManager = setlistManager;
    this.onClose = onClose;
    this.previewPlayer = opts?.previewPlayer || null;
    this.resolveRhythmData = opts?.resolveRhythmData || null;

    // Subscribe pra re-pintar botões de preview quando estado muda
    this.previewUnsubscribe?.();
    this.previewUnsubscribe = this.previewPlayer?.onChange(() => {
      this.updatePreviewButtons();
    }) || null;

    this.render();
  }

  close(): void {
    // Para preview ativo ao fechar
    this.previewPlayer?.stop();
    this.previewUnsubscribe?.();
    this.previewUnsubscribe = null;

    if (this.overlay) {
      this.overlay.classList.add('sle-exit');
      this.overlay.addEventListener('transitionend', () => {
        this.overlay?.remove();
        this.overlay = null;
      }, { once: true });
      // Fallback — se transitionend não disparar (ex: display:none), remover após timeout
      const ref = this.overlay;
      setTimeout(() => {
        if (ref.parentNode) {
          ref.remove();
          this.overlay = null;
        }
      }, 300);
    }
    this.onClose?.();
  }

  /** Atualiza classe 'playing' nos botões de preview quando estado muda */
  private updatePreviewButtons(): void {
    if (!this.overlay || !this.previewPlayer) return;
    this.overlay.querySelectorAll<HTMLElement>('[data-preview-id]').forEach(btn => {
      const id = btn.dataset.previewId || '';
      btn.classList.toggle('sle-preview-btn-playing', this.previewPlayer!.isActive(id));
    });
  }

  // ─── Render ─────────────────────────────────────────────────────────

  private render(): void {
    // Remover anterior (forçar limpeza)
    this.overlay?.remove();
    this.overlay = null;
    // Limpar qualquer overlay órfão
    document.querySelectorAll('.sle-overlay').forEach(el => el.remove());

    this.overlay = document.createElement('div');
    this.overlay.className = 'sle-overlay';

    const container = document.createElement('div');
    container.className = 'sle-container';

    // Header — com tabs em mobile (catálogo | repertório)
    const header = document.createElement('div');
    header.className = 'sle-header';
    const setlistCount = this.setlistManager?.getItems().length || 0;
    header.innerHTML = `
      <div class="sle-header-left">
        <h2 class="sle-title">Repertório</h2>
        <div class="sle-tabs-mobile" role="tablist">
          <button class="sle-tab ${this.mobileTab === 'catalog' ? 'active' : ''}" data-tab="catalog" role="tab">
            Catálogo
          </button>
          <button class="sle-tab ${this.mobileTab === 'setlist' ? 'active' : ''}" data-tab="setlist" role="tab">
            Meu show <span class="sle-tab-count">${setlistCount}</span>
          </button>
        </div>
      </div>
      <button class="sle-close-btn" aria-label="Fechar">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M15 5L5 15M5 5l10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    `;
    header.querySelector('.sle-close-btn')!.addEventListener('click', () => this.close());

    // Body (dois painéis)
    const body = document.createElement('div');
    body.className = `sle-body mobile-tab-${this.mobileTab}`;

    // Painel: Ritmos disponíveis
    const catalogPanel = document.createElement('div');
    catalogPanel.className = 'sle-panel sle-catalog';

    // Contagens por categoria (pros chips mostrarem badges)
    const countMeus = this.catalog.filter(c => c.isPersonal).length;
    const cats = Array.from(new Set(
      this.catalog.filter(c => !c.isPersonal && c.category).map(c => c.category as string)
    )).sort();

    catalogPanel.innerHTML = `
      <div class="sle-panel-header-v2">
        <div class="sle-search-wrap">
          <svg class="sle-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" class="sle-search-v2" placeholder="Buscar ritmo..." autocomplete="off" />
          <button class="sle-search-clear" aria-label="Limpar" style="display:none;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="sle-chips">
          <button class="sle-chip active" data-cat="all">Todos <span class="sle-chip-count">${this.catalog.length}</span></button>
          ${countMeus > 0 ? `<button class="sle-chip" data-cat="Meus">Meus <span class="sle-chip-count">${countMeus}</span></button>` : ''}
          ${cats.map(cat => {
            const n = this.catalog.filter(c => c.category === cat).length;
            return `<button class="sle-chip" data-cat="${cat}">${cat} <span class="sle-chip-count">${n}</span></button>`;
          }).join('')}
        </div>
      </div>
      <div class="sle-panel-list sle-catalog-list"></div>
    `;

    const searchInput = catalogPanel.querySelector('.sle-search-v2') as HTMLInputElement;
    const searchClear = catalogPanel.querySelector('.sle-search-clear') as HTMLElement;
    const catalogList = () => catalogPanel.querySelector('.sle-catalog-list') as HTMLElement;

    searchInput.addEventListener('input', () => {
      this.currentQuery = searchInput.value;
      searchClear.style.display = this.currentQuery ? 'flex' : 'none';
      this.renderCatalog(catalogList(), this.currentQuery);
    });
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      this.currentQuery = '';
      searchClear.style.display = 'none';
      this.renderCatalog(catalogList(), '');
      searchInput.focus();
    });

    // Chips
    catalogPanel.querySelectorAll<HTMLElement>('[data-cat]').forEach(chip => {
      chip.addEventListener('click', () => {
        this.activeCategory = chip.dataset.cat || 'all';
        catalogPanel.querySelectorAll('.sle-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.renderCatalog(catalogList(), this.currentQuery);
      });
    });

    // Painel: Setlist atual
    const setlistPanel = document.createElement('div');
    setlistPanel.className = 'sle-panel sle-setlist';
    setlistPanel.innerHTML = `
      <div class="sle-panel-header">
        <span class="sle-panel-title">Seu repertório</span>
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

    // Tabs mobile — alterna entre catálogo/setlist sem perder estado
    header.querySelectorAll<HTMLElement>('.sle-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const next = tab.dataset.tab as 'catalog' | 'setlist';
        if (next === this.mobileTab) return;
        this.mobileTab = next;
        // Atualiza classes sem re-renderizar tudo
        header.querySelectorAll('.sle-tab').forEach(t => t.classList.toggle('active', (t as HTMLElement).dataset.tab === next));
        body.className = `sle-body mobile-tab-${next}`;
      });
    });

    // Renderizar listas
    this.renderCatalog(catalogPanel.querySelector('.sle-catalog-list')!, '');
    this.renderSetlist(setlistPanel.querySelector('.sle-setlist-list')!);

    // Animate in
    void this.overlay.offsetHeight;
    this.overlay.classList.add('sle-visible');
  }

  private renderCatalog(container: HTMLElement, filter: string): void {
    container.innerHTML = '';
    const query = normForSearch(filter);
    const setlistPaths = new Set(this.setlistManager?.getItems().map(i => i.path) || []);
    void setlistPaths;

    // 1) Filtra por categoria ativa
    let filtered = this.catalog;
    if (this.activeCategory === 'Meus') {
      filtered = filtered.filter(r => r.isPersonal);
    } else if (this.activeCategory !== 'all') {
      filtered = filtered.filter(r => r.category === this.activeCategory);
    }
    // 2) Filtra por query fuzzy (normalizando acento/caixa)
    if (query) {
      filtered = filtered.filter(r => normForSearch(r.name).includes(query));
    }

    if (filtered.length === 0) {
      container.innerHTML = query
        ? `<div class="sle-empty">Nada achado pra "${filter}"</div>`
        : '<div class="sle-empty">Nenhum ritmo nessa categoria</div>';
      return;
    }

    const canPreview = !!this.previewPlayer;

    filtered.forEach(rhythm => {
      // Contar quantas vezes está no repertório
      const items = this.setlistManager?.getItems() || [];
      const count = rhythm.userRhythmId
        ? items.filter(i => i.userRhythmId === rhythm.userRhythmId).length
        : items.filter(i => i.path === rhythm.path && !i.userRhythmId).length;

      const item = document.createElement('div');
      item.className = 'sle-catalog-item';

      const name = document.createElement('span');
      name.className = 'sle-item-name';
      const badge = rhythm.isPersonal
        ? ' <span class="sle-item-badge-personal">meu</span>'
        : '';
      const countBadge = count > 0
        ? ` <span class="sle-item-badge-count">${count}x</span>`
        : '';
      name.innerHTML = (rhythm.isPersonal ? `<span class="sle-item-personal">${rhythm.name}</span>` : rhythm.name) + badge + countBadge;

      const actions = document.createElement('div');
      actions.className = 'sle-item-actions';

      // Preview
      if (canPreview) {
        const previewId = rhythm.userRhythmId || rhythm.path;
        const previewBtn = document.createElement('button');
        previewBtn.className = 'sle-preview-btn';
        previewBtn.setAttribute('data-preview-id', previewId);
        previewBtn.setAttribute('aria-label', 'Ouvir preview');
        previewBtn.innerHTML = this.iconPreview();
        if (this.previewPlayer?.isActive(previewId)) {
          previewBtn.classList.add('sle-preview-btn-playing');
        }
        previewBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.togglePreview(previewId, {
            name: rhythm.name,
            path: rhythm.path,
            userRhythmId: rhythm.userRhythmId,
            bpm: rhythm.bpm,
          });
        });
        actions.appendChild(previewBtn);
      }

      // Add
      const addBtn = document.createElement('button');
      addBtn.className = 'sle-add-btn';
      addBtn.setAttribute('aria-label', 'Adicionar ao repertório');
      addBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      addBtn.addEventListener('click', () => {
        const setlistItem: SetlistItem = { name: rhythm.name, path: rhythm.path };
        if (rhythm.userRhythmId) setlistItem.userRhythmId = rhythm.userRhythmId;
        if (rhythm.baseRhythmName) setlistItem.baseRhythmName = rhythm.baseRhythmName;
        if (rhythm.bpm) setlistItem.bpm = rhythm.bpm;
        this.setlistManager?.addItem(setlistItem);
        const setlistList = this.overlay?.querySelector('.sle-setlist-list');
        if (setlistList) this.renderSetlist(setlistList as HTMLElement);
        this.renderCatalog(container, filter);
      });
      actions.appendChild(addBtn);

      item.append(name, actions);
      container.appendChild(item);
    });

    // Sincroniza estado do preview (pode haver um ativo reaparecer após filtro)
    this.updatePreviewButtons();
  }

  private renderSetlist(container: HTMLElement): void {
    container.innerHTML = '';
    const items = this.setlistManager?.getItems() || [];

    // Atualiza badge da tab "Meu show" no header (mobile)
    const tabCount = this.overlay?.querySelector('.sle-tab[data-tab="setlist"] .sle-tab-count');
    if (tabCount) tabCount.textContent = String(items.length);

    if (items.length === 0) {
      container.innerHTML = `
        <div class="sle-empty-pro">
          <svg class="sle-empty-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          <div class="sle-empty-title">Monte seu repertório</div>
          <div class="sle-empty-desc">Toque no <strong>+</strong> ao lado de um ritmo do catálogo pra adicionar aqui.</div>
        </div>
      `;
      return;
    }

    const canPreview = !!this.previewPlayer;

    items.forEach((item, index) => {
      const isFirst = index === 0;
      const isLast = index === items.length - 1;

      const row = document.createElement('div');
      row.className = 'sle-setlist-item';
      // Drag-drop HTML5 ainda ativo em desktop (CSS controla cursor no handle)
      row.setAttribute('draggable', 'true');
      row.setAttribute('data-index', index.toString());

      // Grip visual (também serve pra desktop drag handle)
      const handle = document.createElement('span');
      handle.className = 'sle-drag-handle';
      handle.setAttribute('aria-hidden', 'true');
      handle.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="4" cy="3" r="1.3" fill="currentColor"/><circle cx="10" cy="3" r="1.3" fill="currentColor"/><circle cx="4" cy="7" r="1.3" fill="currentColor"/><circle cx="10" cy="7" r="1.3" fill="currentColor"/><circle cx="4" cy="11" r="1.3" fill="currentColor"/><circle cx="10" cy="11" r="1.3" fill="currentColor"/></svg>';

      const num = document.createElement('span');
      num.className = 'sle-item-num';
      num.textContent = (index + 1).toString();

      const name = document.createElement('span');
      name.className = 'sle-item-name';
      name.innerHTML = item.userRhythmId
        ? `<span class="sle-item-personal">${item.name}</span>`
        : item.name;

      // Actions: preview + up/down + remove
      const actions = document.createElement('div');
      actions.className = 'sle-item-actions';

      // Preview
      if (canPreview) {
        const previewId = item.userRhythmId || item.path;
        const previewBtn = document.createElement('button');
        previewBtn.className = 'sle-preview-btn';
        previewBtn.setAttribute('data-preview-id', previewId);
        previewBtn.setAttribute('aria-label', 'Ouvir preview');
        previewBtn.innerHTML = this.iconPreview();
        if (this.previewPlayer?.isActive(previewId)) {
          previewBtn.classList.add('sle-preview-btn-playing');
        }
        previewBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.togglePreview(previewId, {
            name: item.name,
            path: item.path,
            userRhythmId: item.userRhythmId,
            bpm: item.bpm,
          });
        });
        actions.appendChild(previewBtn);
      }

      // Up
      const upBtn = document.createElement('button');
      upBtn.className = 'sle-reorder-btn';
      upBtn.setAttribute('aria-label', 'Mover pra cima');
      upBtn.disabled = isFirst;
      upBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>';
      upBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isFirst) return;
        this.setlistManager?.moveItem(index, index - 1);
        this.renderSetlist(container);
      });
      actions.appendChild(upBtn);

      // Down
      const downBtn = document.createElement('button');
      downBtn.className = 'sle-reorder-btn';
      downBtn.setAttribute('aria-label', 'Mover pra baixo');
      downBtn.disabled = isLast;
      downBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
      downBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isLast) return;
        this.setlistManager?.moveItem(index, index + 1);
        this.renderSetlist(container);
      });
      actions.appendChild(downBtn);

      // Remove
      const removeBtn = document.createElement('button');
      removeBtn.className = 'sle-remove-btn';
      removeBtn.setAttribute('aria-label', 'Remover do repertório');
      removeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M11 3L3 11M3 3l8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setlistManager?.removeItem(index);
        this.renderSetlist(container);
        const catalogList = this.overlay?.querySelector('.sle-catalog-list');
        if (catalogList) this.renderCatalog(catalogList as HTMLElement, this.currentQuery);
      });
      actions.appendChild(removeBtn);

      row.append(handle, num, name, actions);
      container.appendChild(row);

      // ─── Drag-drop HTML5 (desktop) ──────────────────────────────
      // Em mobile trocamos por botões ▲▼; o drag fica disponível só como
      // bonus em desktop (mouse é preciso, dedo não).
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
    });

    // Após render, re-sincroniza estado do preview pros botões recém-criados
    this.updatePreviewButtons();
  }

  private iconPreview(): string {
    return `
      <svg class="sle-preview-icon-play" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      <svg class="sle-preview-icon-stop" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
    `;
  }

  /**
   * Toggle do preview: se já tá tocando esse id, para; senão, inicia.
   * Resolve o rhythmData sob demanda via callback do chamador.
   */
  private async togglePreview(id: string, item: { name: string; path: string; userRhythmId?: string; bpm?: number }): Promise<void> {
    if (!this.previewPlayer) return;
    if (this.previewPlayer.isActive(id)) {
      this.previewPlayer.stop();
      return;
    }
    // Resume AudioContext síncrono NÃO é possível aqui (é async) —
    // mas o PreviewPlayer já trata suspended state.
    if (!this.resolveRhythmData) return;
    try {
      const catalogItem = this.catalog.find(c =>
        (item.userRhythmId && c.userRhythmId === item.userRhythmId) ||
        (!item.userRhythmId && c.path === item.path)
      );
      if (!catalogItem) return;
      const rhythmData = await this.resolveRhythmData(catalogItem);
      if (!rhythmData) return;
      // BPM correto: prioriza item.bpm (que o catalog popula pro pessoal);
      // pro de biblioteca, deixa o rhythmData.tempo original.
      const bpmOverride = item.bpm || catalogItem.bpm;
      await this.previewPlayer.play(id, rhythmData, bpmOverride ? { bpmOverride } : undefined);
    } catch (err) {
      console.warn('[SetlistEditor] preview falhou:', err);
    }
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

      /* ─── Busca v2 — header com search + chips de categoria ─── */
      .sle-panel-header-v2 {
        padding: 0.85rem 1rem 0.6rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
      }
      .sle-search-wrap {
        position: relative;
        display: flex;
        align-items: center;
      }
      .sle-search-v2 {
        width: 100%;
        padding: 0.6rem 2.2rem 0.6rem 2.2rem;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 10px;
        color: #fff;
        font-size: 0.9rem;
        font-family: inherit;
        outline: none;
        transition: border-color 0.15s, background 0.15s;
        -webkit-appearance: none;
      }
      .sle-search-v2::placeholder { color: rgba(255, 255, 255, 0.25); }
      .sle-search-v2:focus {
        border-color: rgba(255, 255, 255, 0.22);
        background: rgba(255, 255, 255, 0.06);
      }
      .sle-search-icon {
        position: absolute;
        left: 0.7rem;
        color: rgba(255, 255, 255, 0.35);
        pointer-events: none;
      }
      .sle-search-clear {
        position: absolute;
        right: 0.4rem;
        background: transparent;
        border: none;
        color: rgba(255, 255, 255, 0.4);
        width: 26px;
        height: 26px;
        border-radius: 7px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: background 0.12s, color 0.12s;
        -webkit-tap-highlight-color: transparent;
      }
      .sle-search-clear:hover {
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
      }

      .sle-chips {
        display: flex;
        gap: 0.35rem;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        padding-bottom: 2px;
        scrollbar-width: none;
      }
      .sle-chips::-webkit-scrollbar { display: none; }
      .sle-chip {
        flex-shrink: 0;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.7);
        padding: 0.35rem 0.75rem;
        border-radius: 999px;
        font-size: 0.75rem;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
        transition: background 0.12s, color 0.12s, border-color 0.12s;
        -webkit-tap-highlight-color: transparent;
        white-space: nowrap;
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
      }
      .sle-chip:hover {
        background: rgba(255, 255, 255, 0.07);
        color: #fff;
      }
      .sle-chip.active {
        background: #fff;
        color: #0a0a0f;
        border-color: #fff;
      }
      .sle-chip-count {
        font-size: 0.66rem;
        opacity: 0.55;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .sle-chip.active .sle-chip-count { opacity: 0.65; }

      /* ─── Header v2 — título + tabs mobile ─── */
      .sle-header-left {
        display: flex; align-items: center;
        gap: 1rem;
        min-width: 0;
        flex: 1;
      }
      .sle-tabs-mobile {
        display: none;
        background: rgba(255, 255, 255, 0.04);
        border-radius: 10px;
        padding: 3px;
        gap: 2px;
      }
      .sle-tab {
        background: transparent;
        border: none;
        color: rgba(255, 255, 255, 0.55);
        font-family: inherit;
        font-size: 0.78rem;
        font-weight: 600;
        padding: 0.45rem 0.75rem;
        border-radius: 8px;
        cursor: pointer;
        transition: background 0.14s, color 0.14s;
        -webkit-tap-highlight-color: transparent;
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        white-space: nowrap;
      }
      .sle-tab.active {
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
      }
      .sle-tab-count {
        font-size: 0.66rem;
        font-weight: 700;
        padding: 0.05rem 0.35rem;
        border-radius: 5px;
        background: rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.75);
        font-variant-numeric: tabular-nums;
      }
      .sle-tab.active .sle-tab-count {
        background: rgba(62, 232, 167, 0.15);
        color: #3ee8a7;
      }

      /* Em mobile, exibe tabs e esconde um painel por vez */
      @media (max-width: 640px) {
        .sle-tabs-mobile { display: inline-flex; }
        .sle-title { display: none; }
        .sle-body {
          grid-template-columns: 1fr !important;
          grid-template-rows: 1fr !important;
        }
        .sle-body.mobile-tab-catalog .sle-setlist { display: none; }
        .sle-body.mobile-tab-setlist .sle-catalog { display: none; }
        .sle-container { max-height: 92vh; }
        .sle-header { padding: 0.85rem 1rem; }
      }

      /* ─── Item actions (catálogo e setlist) ─── */
      .sle-item-actions {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        flex-shrink: 0;
      }
      .sle-item-personal { color: #8B5CF6; }
      .sle-item-badge-personal {
        font-size: 0.58rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: rgba(139, 92, 246, 0.65);
        padding: 0.1rem 0.4rem;
        border: 1px solid rgba(139, 92, 246, 0.25);
        border-radius: 5px;
        margin-left: 0.35rem;
      }
      .sle-item-badge-count {
        font-size: 0.6rem;
        font-weight: 700;
        background: rgba(62, 232, 167, 0.12);
        color: #3ee8a7;
        padding: 0.1rem 0.4rem;
        border-radius: 5px;
        margin-left: 0.35rem;
      }

      /* ─── Preview button ─── */
      .sle-preview-btn {
        width: 32px; height: 32px;
        border-radius: 8px;
        border: 1px solid rgba(62, 232, 167, 0.2);
        background: rgba(62, 232, 167, 0.06);
        color: #3ee8a7;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer;
        transition: background 0.12s, border-color 0.12s, transform 0.08s;
        flex-shrink: 0;
        -webkit-tap-highlight-color: transparent;
        position: relative;
      }
      .sle-preview-btn:hover {
        background: rgba(62, 232, 167, 0.12);
        border-color: rgba(62, 232, 167, 0.35);
      }
      .sle-preview-btn:active { transform: scale(0.92); }
      .sle-preview-icon-play { display: block; margin-left: 1px; }
      .sle-preview-icon-stop { display: none; }
      .sle-preview-btn-playing {
        background: rgba(62, 232, 167, 0.22);
        border-color: rgba(62, 232, 167, 0.55);
      }
      .sle-preview-btn-playing .sle-preview-icon-play { display: none; }
      .sle-preview-btn-playing .sle-preview-icon-stop { display: block; }
      .sle-preview-btn-playing::before {
        content: '';
        position: absolute; inset: -3px;
        border-radius: 10px;
        border: 2px solid rgba(62, 232, 167, 0.35);
        animation: slePreviewRing 1.4s ease-in-out infinite;
        pointer-events: none;
      }
      @keyframes slePreviewRing {
        0%, 100% { opacity: 0.25; transform: scale(0.95); }
        50%      { opacity: 0.75; transform: scale(1.1); }
      }

      /* ─── Reorder buttons ▲▼ ─── */
      .sle-reorder-btn {
        width: 32px; height: 32px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.03);
        color: rgba(255, 255, 255, 0.7);
        display: flex; align-items: center; justify-content: center;
        cursor: pointer;
        transition: background 0.12s, color 0.12s, transform 0.08s;
        flex-shrink: 0;
        -webkit-tap-highlight-color: transparent;
        font-family: inherit;
      }
      .sle-reorder-btn:hover {
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
      }
      .sle-reorder-btn:active { transform: scale(0.92); }
      .sle-reorder-btn:disabled {
        opacity: 0.25;
        cursor: not-allowed;
      }
      .sle-reorder-btn:disabled:hover {
        background: rgba(255, 255, 255, 0.03);
        color: rgba(255, 255, 255, 0.7);
      }

      /* Remove btn maior quando está na action row */
      .sle-setlist-item .sle-remove-btn {
        width: 32px; height: 32px;
      }

      /* ─── Item numérico grande (ordinal) ─── */
      .sle-setlist-item .sle-item-num {
        font-size: 0.88rem;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.5);
        min-width: 26px;
        text-align: center;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.5px;
      }

      /* Empty state pro setlist (mais ilustrativo que o catálogo) */
      .sle-empty-pro {
        text-align: center;
        padding: 2.5rem 1rem;
        color: rgba(255, 255, 255, 0.55);
      }
      .sle-empty-icon {
        color: rgba(255, 255, 255, 0.3);
        margin-bottom: 0.75rem;
      }
      .sle-empty-title {
        font-size: 0.95rem;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.9);
        margin-bottom: 0.4rem;
      }
      .sle-empty-desc {
        font-size: 0.82rem;
        line-height: 1.5;
        max-width: 260px;
        margin: 0 auto;
      }
      .sle-empty-desc strong {
        color: #3ee8a7;
        font-weight: 700;
      }

      /* Em mobile, esconde o grip handle (drag-drop não é o caminho principal) */
      @media (max-width: 640px) {
        .sle-setlist-item .sle-drag-handle { display: none; }
        .sle-preview-btn,
        .sle-reorder-btn {
          width: 38px; height: 38px;
        }
        .sle-setlist-item .sle-remove-btn {
          width: 38px; height: 38px;
        }
        .sle-add-btn {
          width: 38px; height: 38px;
        }
        .sle-setlist-item, .sle-catalog-item {
          padding: 0.7rem 0.6rem;
        }
      }

      /* -webkit-overflow-scrolling em iOS */
      .sle-panel-list {
        -webkit-overflow-scrolling: touch;
      }
    `;
    document.head.appendChild(css);
  }
}
