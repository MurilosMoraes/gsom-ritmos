// Editor de setlist — overlay fullscreen com glass morphism

import type { SetlistManager } from '../core/SetlistManager';
import type { SetlistItem } from '../types';
import type { PreviewPlayer } from '../core/PreviewPlayer';
import { t } from '../i18n';

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
  // Em mobile (<=640px) navegamos em TELAS empilhadas (sem tabs):
  // hub (lista de repertórios) → setlist (itens do ativo) → catalog
  // (adicionar ritmos). Desktop ignora isso (2 colunas lado a lado).
  private mobileView: 'hub' | 'setlist' | 'catalog' = 'hub';
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

    // Tela inicial no mobile: SEMPRE o hub (lista de repertórios) — mesmo
    // com 1 só. Pular direto pra dentro obrigava o user a "voltar" só pra
    // conseguir criar um repertório novo (comportamento errado).
    this.mobileView = 'hub';

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
      // Refocus síncrono no pedalInput dentro do user gesture (iOS exige).
      // O hasModalOpen() em main.ts ignora .sle-overlay.sle-exit, então
      // o focus volta na hora — sem precisar tocar a tela depois.
      (window as any).__refocusPedal?.();
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

    // Header — voltar contextual (mobile) + título dinâmico
    const header = document.createElement('div');
    header.className = 'sle-header';
    header.innerHTML = `
      <div class="sle-header-left">
        <button class="sle-back-btn" aria-label="${t('ui.setlist.backAriaLabel')}" style="display:none;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <h2 class="sle-title">${t('ui.setlist.title')}</h2>
      </div>
      <button class="sle-close-btn" aria-label="${t('ui.setlist.closeAriaLabel')}">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M15 5L5 15M5 5l10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    `;
    header.querySelector('.sle-close-btn')!.addEventListener('click', () => this.close());
    header.querySelector('.sle-back-btn')!.addEventListener('click', () => {
      // catalog → setlist → hub
      this.setMobileView(this.mobileView === 'catalog' ? 'setlist' : 'hub');
    });

    // Body (3 painéis: hub mobile-only + catálogo + setlist)
    const body = document.createElement('div');
    body.className = `sle-body mobile-view-${this.mobileView}`;

    // Painel: HUB de repertórios (mobile) — cards grandes
    const hubPanel = document.createElement('div');
    hubPanel.className = 'sle-panel sle-hub';
    hubPanel.innerHTML = '<div class="sle-panel-list sle-hub-list"></div>';

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
          <input type="text" class="sle-search-v2" placeholder="${t('ui.setlist.searchPlaceholder')}" autocomplete="off" />
          <button class="sle-search-clear" aria-label="${t('ui.setlist.clearAriaLabel')}" style="display:none;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="sle-chips">
          <button class="sle-chip active" data-cat="all">${t('ui.setlist.chipAll')} <span class="sle-chip-count">${this.catalog.length}</span></button>
          ${countMeus > 0 ? `<button class="sle-chip" data-cat="Meus">${t('ui.setlist.chipMeus')} <span class="sle-chip-count">${countMeus}</span></button>` : ''}
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

    // Painel: Setlist atual — com seletor de MÚLTIPLOS repertórios.
    // User toca na igreja, no pagode, no sertanejo — cada um tem o seu.
    const setlistPanel = document.createElement('div');
    setlistPanel.className = 'sle-panel sle-setlist';
    setlistPanel.innerHTML = `
      <div class="sle-setlists-bar"></div>
      <div class="sle-panel-header">
        <span class="sle-panel-title">${t('ui.setlist.panelTitle')}</span>
        <button class="sle-clear-btn">${t('ui.setlist.clearButton')}</button>
      </div>
      <div class="sle-panel-list sle-setlist-list"></div>
      <button class="sle-cta-add" type="button">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
        ${t('ui.setlist.addRhythmsButton')}
      </button>
    `;

    // Limpar com dupla confirmação — toque acidental aqui apagava o
    // repertório inteiro de uma vez
    const clearBtn = setlistPanel.querySelector('.sle-clear-btn') as HTMLElement;
    clearBtn.addEventListener('click', () => {
      if (!clearBtn.dataset.confirming) {
        clearBtn.dataset.confirming = '1';
        clearBtn.classList.add('sle-clear-btn-confirm');
        clearBtn.textContent = t('ui.setlist.clearConfirm');
        // Auto-cancela em 3s sem confirmação
        window.setTimeout(() => {
          if (!clearBtn.isConnected || !clearBtn.dataset.confirming) return;
          delete clearBtn.dataset.confirming;
          clearBtn.classList.remove('sle-clear-btn-confirm');
          clearBtn.textContent = t('ui.setlist.clearButton');
        }, 3000);
        return;
      }
      delete clearBtn.dataset.confirming;
      clearBtn.classList.remove('sle-clear-btn-confirm');
      clearBtn.textContent = t('ui.setlist.clearButton');
      this.setlistManager?.clear();
      this.renderSetlist(setlistPanel.querySelector('.sle-setlist-list')!);
      this.renderCatalog(catalogPanel.querySelector('.sle-catalog-list')!, searchInput.value);
    });

    // CTA mobile: lista → tela de adicionar ritmos
    setlistPanel.querySelector('.sle-cta-add')!.addEventListener('click', () => {
      this.setMobileView('catalog');
    });

    const refreshAll = (): void => {
      // Após trocar/criar/excluir repertório: re-render de tudo
      this.renderSetlist(setlistPanel.querySelector('.sle-setlist-list')!);
      this.renderCatalog(catalogPanel.querySelector('.sle-catalog-list')!, searchInput.value);
      this.renderHub(hubPanel.querySelector('.sle-hub-list') as HTMLElement, refreshAll);
      this.syncHeader();
    };

    // Render dos chips de repertórios (desktop; no mobile o hub cobre)
    this.renderSetlistsBar(
      setlistPanel.querySelector('.sle-setlists-bar') as HTMLElement,
      refreshAll
    );

    body.append(hubPanel, catalogPanel, setlistPanel);
    container.append(header, body);
    this.overlay.appendChild(container);
    document.body.appendChild(this.overlay);

    // Renderizar listas
    this.renderHub(hubPanel.querySelector('.sle-hub-list') as HTMLElement, refreshAll);
    this.renderCatalog(catalogPanel.querySelector('.sle-catalog-list')!, '');
    this.renderSetlist(setlistPanel.querySelector('.sle-setlist-list')!);
    this.syncHeader();

    // Animate in
    void this.overlay.offsetHeight;
    this.overlay.classList.add('sle-visible');
  }

  /** Troca a tela do mobile (hub → setlist → catalog) e sincroniza header. */
  private setMobileView(view: 'hub' | 'setlist' | 'catalog'): void {
    this.mobileView = view;
    const body = this.overlay?.querySelector('.sle-body');
    if (body) body.className = `sle-body mobile-view-${view}`;
    this.syncHeader();
  }

  /** Header contextual: título + botão voltar conforme a tela mobile. */
  private syncHeader(): void {
    if (!this.overlay) return;
    const title = this.overlay.querySelector('.sle-title') as HTMLElement | null;
    const back = this.overlay.querySelector('.sle-back-btn') as HTMLElement | null;
    if (!title || !back) return;

    const isMobile = window.matchMedia('(max-width: 640px)').matches;
    if (!isMobile) {
      title.textContent = t('ui.setlist.title');
      back.style.display = 'none';
      return;
    }
    const lists = this.setlistManager?.getSetlists() || [];
    const hasHub = lists.length > 1 || true; // hub sempre acessível pelo voltar
    void hasHub;
    switch (this.mobileView) {
      case 'hub':
        title.textContent = t('ui.setlist.hubTitle');
        back.style.display = 'none';
        break;
      case 'setlist':
        title.textContent = this.setlistManager?.getName() || t('ui.setlist.title');
        back.style.display = 'inline-flex';
        break;
      case 'catalog':
        title.textContent = t('ui.setlist.addRhythmsTitle');
        back.style.display = 'inline-flex';
        break;
    }
  }

  // ─── HUB de repertórios (mobile) ────────────────────────────────────
  //
  // Cards grandes: tap abre o repertório (vira o ativo); ações por card:
  // renomear (inline), duplicar, excluir (dupla confirmação). "+ Novo"
  // no fim com contador N/MAX. Inputs funcionam no iPhone (sle-overlay
  // tá no hasModalOpen() do pedal).

  private renderHub(container: HTMLElement, onChanged: () => void): void {
    const mgr = this.setlistManager;
    if (!mgr) return;
    const lists = mgr.getSetlists();
    const max = mgr.getMaxSetlists();

    container.innerHTML = `
      ${lists.map(l => `
        <div class="sle-hub-card ${l.active ? 'active' : ''}" data-hub-id="${l.id}">
          <div class="sle-hub-card-main">
            <span class="sle-hub-card-name">${this.escapeHtml(l.name)}</span>
            <span class="sle-hub-card-meta">${l.count} ${l.count === 1 ? t('ui.setlist.rhythmSingular') : t('ui.setlist.rhythmPlural')}${l.active ? ` · <span class="sle-hub-ativo">${t('ui.setlist.activeLabel')}</span>` : ''}</span>
          </div>
          <div class="sle-hub-card-actions">
            <button class="sle-hub-act sle-hub-rename" data-id="${l.id}" aria-label="${t('ui.setlist.renameAriaLabel')}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
            </button>
            <button class="sle-hub-act sle-hub-dup" data-id="${l.id}" aria-label="${t('ui.setlist.duplicateAriaLabel')}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            ${lists.length > 1 ? `<button class="sle-hub-act sle-hub-del" data-id="${l.id}" aria-label="${t('ui.setlist.deleteAriaLabel')}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>` : ''}
            <button class="sle-hub-act sle-hub-open" data-id="${l.id}" aria-label="${t('ui.setlist.editAriaLabel')}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </button>
          </div>
        </div>
      `).join('')}
      ${lists.length < max
        ? `<button class="sle-hub-new" type="button">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
            ${t('ui.setlist.newRepertoire')} <span class="sle-hub-new-count">${lists.length}/${max}</span>
          </button>`
        : `<div class="sle-hub-limit">${t('ui.setlist.hubLimit', { max })}</div>`}
    `;

    // Tap no card: SELECIONA o repertório e FECHA o modal (vai tocar).
    // Entrar na lista pra editar é só pelo botão de editar (risquinhos).
    container.querySelectorAll<HTMLElement>('.sle-hub-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.sle-hub-act')) return;
        const id = card.dataset.hubId!;
        mgr.switchSetlist(id);
        this.close(); // onClose do main.ts carrega o ritmo atual do repertório
      });
    });

    // Editar (abrir a lista do repertório)
    container.querySelectorAll<HTMLElement>('.sle-hub-open').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        mgr.switchSetlist(btn.dataset.id!);
        onChanged();
        this.setMobileView('setlist');
      });
    });

    // Renomear inline (substitui o conteúdo do card pelo editor)
    container.querySelectorAll<HTMLElement>('.sle-hub-rename').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id!;
        const card = container.querySelector(`.sle-hub-card[data-hub-id="${id}"]`) as HTMLElement;
        const current = mgr.getSetlists().find(l => l.id === id);
        if (!card || !current) return;
        card.innerHTML = `
          <div class="sle-setlist-edit" style="flex:1;">
            <input type="text" class="sle-setlist-edit-input" value="${this.escapeHtml(current.name)}" maxlength="40" autocomplete="off" />
            <button class="sle-setlist-edit-save" aria-label="${t('ui.setlist.saveAriaLabel')}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </button>
            <button class="sle-setlist-edit-cancel" aria-label="${t('ui.setlist.cancelAriaLabel')}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        `;
        const input = card.querySelector('.sle-setlist-edit-input') as HTMLInputElement;
        const save = (): void => {
          const name = input.value.trim();
          if (name) mgr.renameSetlist(id, name);
          onChanged();
        };
        card.querySelector('.sle-setlist-edit-save')?.addEventListener('click', (ev) => { ev.stopPropagation(); save(); });
        card.querySelector('.sle-setlist-edit-cancel')?.addEventListener('click', (ev) => { ev.stopPropagation(); onChanged(); });
        input.addEventListener('click', (ev) => ev.stopPropagation());
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); save(); }
          if (ev.key === 'Escape') onChanged();
        });
        input.focus();
        input.select();
      });
    });

    // Duplicar
    container.querySelectorAll<HTMLElement>('.sle-hub-dup').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const newId = mgr.duplicateSetlist(btn.dataset.id!);
        if (!newId) return; // bateu o limite
        onChanged();
      });
    });

    // Excluir (dupla confirmação no próprio botão)
    container.querySelectorAll<HTMLElement>('.sle-hub-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!btn.dataset.confirming) {
          btn.dataset.confirming = '1';
          btn.innerHTML = `<span style="font-size:0.68rem;font-weight:800;">${t('ui.setlist.deleteConfirm')}</span>`;
          btn.classList.add('sle-hub-del-confirm');
          return;
        }
        mgr.deleteSetlist(btn.dataset.id!);
        onChanged();
      });
    });

    // Novo repertório → cria e abre rename na hora
    container.querySelector('.sle-hub-new')?.addEventListener('click', () => {
      const id = mgr.createSetlist(t('ui.setlist.newRepertoireName', { n: lists.length + 1 }));
      if (!id) return;
      onChanged();
      const renameBtn = container.querySelector(`.sle-hub-rename[data-id="${id}"]`) as HTMLElement | null;
      renameBtn?.click();
    });
  }

  // ─── Barra de múltiplos repertórios ─────────────────────────────────
  //
  // Chips: tap no inativo troca; tap no ativo abre edição inline
  // (renomear/excluir); "+" cria novo (até MAX). Inputs aqui funcionam
  // no iPhone porque o sle-overlay é detectado pelo hasModalOpen() do
  // pedal (o pedal libera o foco enquanto o editor está aberto).

  private renderSetlistsBar(container: HTMLElement, onSwitched: () => void): void {
    const mgr = this.setlistManager;
    if (!mgr || typeof (mgr as any).getSetlists !== 'function') {
      container.style.display = 'none';
      return;
    }

    const lists = mgr.getSetlists();
    const max = mgr.getMaxSetlists();

    container.innerHTML = `
      <div class="sle-setlists-chips">
        ${lists.map(l => `
          <button class="sle-setlist-chip ${l.active ? 'active' : ''}" data-setlist-id="${l.id}">
            <span class="sle-setlist-chip-name">${this.escapeHtml(l.name)}</span>
            <span class="sle-setlist-chip-count">${l.count}</span>
            ${l.active ? '<svg class="sle-setlist-chip-edit" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>' : ''}
          </button>
        `).join('')}
        ${lists.length < max
          ? `<button class="sle-setlist-chip sle-setlist-new" aria-label="${t('ui.setlist.newRepertoire')}"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> ${t('ui.setlist.newLabel')}</button>`
          : ''}
      </div>
    `;

    // Tap nos chips
    container.querySelectorAll<HTMLElement>('[data-setlist-id]').forEach(chip => {
      chip.addEventListener('click', () => {
        const id = chip.dataset.setlistId!;
        const isActive = chip.classList.contains('active');
        if (!isActive) {
          mgr.switchSetlist(id);
          this.renderSetlistsBar(container, onSwitched);
          onSwitched();
        } else {
          // Chip ativo: abre edição inline (renomear/excluir)
          this.openSetlistEditInline(container, id, onSwitched);
        }
      });
    });

    // Criar novo
    container.querySelector('.sle-setlist-new')?.addEventListener('click', () => {
      const id = mgr.createSetlist(t('ui.setlist.newRepertoireName', { n: lists.length + 1 }));
      if (!id) return;
      this.renderSetlistsBar(container, onSwitched);
      onSwitched();
      // Abre rename na hora — user já dá o nome certo ("Igreja", "Pagode"...)
      this.openSetlistEditInline(container, id, onSwitched);
    });
  }

  /** Edição inline do repertório: input pra renomear + excluir + cancelar. */
  private openSetlistEditInline(container: HTMLElement, id: string, onSwitched: () => void): void {
    const mgr = this.setlistManager!;
    const lists = mgr.getSetlists();
    const current = lists.find(l => l.id === id);
    if (!current) return;
    const canDelete = lists.length > 1;

    container.innerHTML = `
      <div class="sle-setlist-edit">
        <input type="text" class="sle-setlist-edit-input" value="${this.escapeHtml(current.name)}" maxlength="40" autocomplete="off" />
        <button class="sle-setlist-edit-save" aria-label="${t('ui.setlist.saveAriaLabel')}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
        ${canDelete ? `<button class="sle-setlist-edit-delete" aria-label="${t('ui.setlist.deleteRepertoireAriaLabel')}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>` : ''}
        <button class="sle-setlist-edit-cancel" aria-label="${t('ui.setlist.cancelAriaLabel')}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `;

    const input = container.querySelector('.sle-setlist-edit-input') as HTMLInputElement;
    const save = () => {
      const name = input.value.trim();
      if (name) mgr.renameSetlist(id, name);
      this.renderSetlistsBar(container, onSwitched);
      onSwitched();
    };

    container.querySelector('.sle-setlist-edit-save')?.addEventListener('click', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') { this.renderSetlistsBar(container, onSwitched); }
    });
    container.querySelector('.sle-setlist-edit-cancel')?.addEventListener('click', () => {
      this.renderSetlistsBar(container, onSwitched);
    });
    container.querySelector('.sle-setlist-edit-delete')?.addEventListener('click', () => {
      // Dupla confirmação leve: troca o botão por "confirmar?" no 1º tap
      const btn = container.querySelector('.sle-setlist-edit-delete') as HTMLElement;
      if (!btn.dataset.confirming) {
        btn.dataset.confirming = '1';
        btn.innerHTML = `<span style="font-size:0.7rem;font-weight:700;">${t('ui.setlist.deleteConfirm')}</span>`;
        btn.classList.add('sle-setlist-edit-delete-confirm');
        return;
      }
      mgr.deleteSetlist(id);
      this.renderSetlistsBar(container, onSwitched);
      onSwitched();
    });

    // Foco no input com seleção do texto (renomeia rápido).
    // Funciona no iPhone: sle-overlay tá no hasModalOpen() → pedal não rouba.
    input.focus();
    input.select();
  }

  private escapeHtml(s: string): string {
    return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
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
        ? `<div class="sle-empty">${t('ui.setlist.emptySearchResult', { filter })}</div>`
        : `<div class="sle-empty">${t('ui.setlist.emptyCategory')}</div>`;
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
        ? ` <span class="sle-item-badge-personal">${t('ui.setlist.myBadge')}</span>`
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
        previewBtn.setAttribute('aria-label', t('ui.setlist.previewAriaLabel'));
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
      const addId = rhythm.userRhythmId || rhythm.path;
      const addBtn = document.createElement('button');
      addBtn.className = 'sle-add-btn';
      addBtn.setAttribute('aria-label', t('ui.setlist.addAriaLabel'));
      addBtn.setAttribute('data-add-id', addId);
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
        // Feedback ✓ no botão recém-renderizado (confirma que adicionou
        // sem fechar a tela — dá pra meter 10 ritmos em sequência)
        const fresh = container.querySelector(`[data-add-id="${CSS.escape(addId)}"]`) as HTMLElement | null;
        if (fresh) {
          fresh.classList.add('sle-add-flash');
          fresh.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
          setTimeout(() => {
            fresh.classList.remove('sle-add-flash');
            fresh.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
          }, 700);
        }
      });
      actions.appendChild(addBtn);

      item.append(name, actions);
      container.appendChild(item);
    });

    // Sincroniza estado do preview (pode haver um ativo reaparecer após filtro)
    this.updatePreviewButtons();
  }

  /** Anima a troca (slide) das duas linhas e só depois re-renderiza — dá o
   *  efeito da música de cima trocar de lugar com a de baixo. */
  private animateSwapAndRender(container: HTMLElement, indexA: number, indexB: number): void {
    const commit = () => {
      this.setlistManager?.moveItem(indexA, indexB);
      this.setlistManager?.goTo(indexB); // deixa o ritmo movido selecionado
      this.renderSetlist(container);
    };
    const rowA = container.querySelector(`.sle-setlist-item[data-index="${indexA}"]`) as HTMLElement | null;
    const rowB = container.querySelector(`.sle-setlist-item[data-index="${indexB}"]`) as HTMLElement | null;
    if (!rowA || !rowB) { commit(); return; }
    const dist = rowB.getBoundingClientRect().top - rowA.getBoundingClientRect().top;
    const ease = 'transform 0.34s cubic-bezier(0.22, 0.61, 0.36, 1)'; // suave
    rowA.style.transition = rowB.style.transition = ease;
    rowA.style.zIndex = '5';
    rowB.style.zIndex = '4';
    void rowA.offsetHeight; // reflow antes do transform
    rowA.style.transform = `translateY(${dist}px)`;
    rowB.style.transform = `translateY(${-dist}px)`;
    let done = false;
    const finish = () => { if (done) return; done = true; commit(); };
    rowA.addEventListener('transitionend', finish, { once: true });
    window.setTimeout(finish, 400); // fallback caso o transitionend não dispare
  }

  private renderSetlist(container: HTMLElement): void {
    container.innerHTML = '';
    const items = this.setlistManager?.getItems() || [];

    if (items.length === 0) {
      container.innerHTML = `
        <div class="sle-empty-pro">
          <svg class="sle-empty-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          <div class="sle-empty-title">${t('ui.setlist.emptyTitle')}</div>
          <div class="sle-empty-desc">${t('ui.setlist.emptyDesc')}</div>
        </div>
      `;
      return;
    }

    const canPreview = !!this.previewPlayer;
    const currentIdx = this.setlistManager?.getCurrentIndex() ?? -1;

    items.forEach((item, index) => {
      const isFirst = index === 0;
      const isLast = index === items.length - 1;

      const row = document.createElement('div');
      row.className = 'sle-setlist-item';
      // Posição do show: ATUAL bem visível + "a seguir" sutil (no palco
      // o músico pensa sempre 1 música à frente)
      if (index === currentIdx) row.classList.add('sle-now');
      else if (index === currentIdx + 1) row.classList.add('sle-next');
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
        previewBtn.setAttribute('aria-label', t('ui.setlist.previewAriaLabel'));
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
      upBtn.setAttribute('aria-label', t('ui.setlist.moveUpAriaLabel'));
      upBtn.disabled = isFirst;
      upBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>';
      upBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isFirst) return;
        this.animateSwapAndRender(container, index, index - 1);
      });
      actions.appendChild(upBtn);

      // Down
      const downBtn = document.createElement('button');
      downBtn.className = 'sle-reorder-btn';
      downBtn.setAttribute('aria-label', t('ui.setlist.moveDownAriaLabel'));
      downBtn.disabled = isLast;
      downBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
      downBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isLast) return;
        this.animateSwapAndRender(container, index, index + 1);
      });
      actions.appendChild(downBtn);

      // Remove
      const removeBtn = document.createElement('button');
      removeBtn.className = 'sle-remove-btn';
      removeBtn.setAttribute('aria-label', t('ui.setlist.removeAriaLabel'));
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
      /* ── Barra de múltiplos repertórios ────────────────────────────
         Cards GRANDES com wrap (sem scroll horizontal — web friendly),
         bordas neon vivas, "+ Novo" verde destacado. */
      .sle-setlists-bar {
        padding: 0.7rem 0.85rem 0.2rem;
        flex-shrink: 0;
      }
      .sle-setlists-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem;
      }
      .sle-setlist-chip {
        display: inline-flex;
        align-items: center;
        gap: 0.45rem;
        padding: 0.65rem 0.9rem;
        min-height: 44px;
        border-radius: 12px;
        border: 1.5px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.035);
        color: rgba(255, 255, 255, 0.7);
        font-size: 0.85rem;
        font-weight: 700;
        font-family: inherit;
        white-space: nowrap;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition: all 0.15s;
      }
      .sle-setlist-chip.active {
        background: rgba(0, 212, 255, 0.1);
        border-color: rgba(0, 212, 255, 0.8);
        color: #fff;
        box-shadow: 0 0 14px rgba(0, 212, 255, 0.22);
      }
      .sle-setlist-chip-count {
        font-size: 0.7rem;
        padding: 0.1rem 0.45rem;
        border-radius: 999px;
        background: rgba(0, 212, 255, 0.15);
        color: rgba(0, 212, 255, 0.95);
        font-variant-numeric: tabular-nums;
      }
      .sle-setlist-chip:not(.active) .sle-setlist-chip-count {
        background: rgba(255, 255, 255, 0.07);
        color: rgba(255, 255, 255, 0.5);
      }
      .sle-setlist-chip-edit { opacity: 0.7; margin-left: 0.15rem; }
      .sle-setlist-new {
        border-style: dashed;
        color: #00E68C;
        border-color: rgba(0, 230, 140, 0.55);
        background: rgba(0, 230, 140, 0.05);
        box-shadow: 0 0 10px rgba(0, 230, 140, 0.12);
      }
      .sle-setlist-edit {
        display: flex;
        gap: 0.4rem;
        align-items: center;
      }
      .sle-setlist-edit-input {
        flex: 1;
        min-width: 0;
        padding: 0.5rem 0.7rem;
        border-radius: 10px;
        border: 1px solid rgba(0, 212, 255, 0.4);
        background: rgba(255, 255, 255, 0.05);
        color: #fff;
        font-size: 0.85rem;
        font-family: inherit;
        outline: none;
      }
      .sle-setlist-edit button {
        width: 34px;
        height: 34px;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.05);
        color: rgba(255, 255, 255, 0.7);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        flex-shrink: 0;
        font-family: inherit;
      }
      .sle-setlist-edit-save {
        border-color: rgba(0, 230, 140, 0.4) !important;
        color: #00E68C !important;
      }
      .sle-setlist-edit-delete {
        border-color: rgba(255, 68, 102, 0.35) !important;
        color: #ff6b83 !important;
      }
      .sle-setlist-edit-delete-confirm {
        width: auto !important;
        padding: 0 0.6rem;
        background: rgba(255, 68, 102, 0.15) !important;
      }

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
      .sle-clear-btn-confirm {
        background: rgba(255, 68, 102, 0.22) !important;
        border-color: rgba(255, 68, 102, 0.6) !important;
        color: #ff8298 !important;
        font-weight: 800;
      }

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

      /* ─── Header — voltar contextual + título dinâmico ─── */
      .sle-header-left {
        display: flex; align-items: center;
        gap: 0.6rem;
        min-width: 0;
        flex: 1;
      }
      .sle-back-btn {
        width: 36px; height: 36px;
        border-radius: 10px;
        border: 1px solid rgba(0, 212, 255, 0.3);
        background: rgba(0, 212, 255, 0.06);
        color: #00D4FF;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        flex-shrink: 0;
        -webkit-tap-highlight-color: transparent;
        transition: background 0.12s;
      }
      .sle-back-btn:active { background: rgba(0, 212, 255, 0.15); }
      .sle-title {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* ─── HUB de repertórios (mobile) ─── */
      .sle-hub { display: none; }
      .sle-hub-list { padding: 0.75rem; }
      .sle-hub-card {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        padding: 0.9rem 0.9rem;
        min-height: 64px;
        border-radius: 14px;
        border: 1.5px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.03);
        margin-bottom: 0.5rem;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition: border-color 0.12s, background 0.12s;
      }
      .sle-hub-card.active {
        border-color: rgba(0, 212, 255, 0.7);
        background: rgba(0, 212, 255, 0.07);
        box-shadow: 0 0 14px rgba(0, 212, 255, 0.15);
      }
      .sle-hub-card-main {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
      }
      .sle-hub-card-name {
        font-size: 0.98rem;
        font-weight: 700;
        color: #fff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sle-hub-card-meta {
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.45);
      }
      .sle-hub-ativo {
        color: #00D4FF;
        font-weight: 800;
        letter-spacing: 0.08em;
      }
      .sle-hub-card-actions {
        display: flex;
        align-items: center;
        gap: 0.3rem;
        flex-shrink: 0;
      }
      .sle-hub-act {
        width: 38px; height: 38px;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.04);
        color: rgba(255, 255, 255, 0.65);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        font-family: inherit;
      }
      .sle-hub-del { color: #ff6b83; border-color: rgba(255, 68, 102, 0.3); }
      .sle-hub-del-confirm {
        width: auto !important;
        padding: 0 0.55rem;
        background: rgba(255, 68, 102, 0.18) !important;
      }
      .sle-hub-open {
        color: #00D4FF;
        border-color: rgba(0, 212, 255, 0.35) !important;
        background: rgba(0, 212, 255, 0.06) !important;
      }
      .sle-hub-new {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        min-height: 54px;
        border-radius: 14px;
        border: 1.5px dashed rgba(0, 230, 140, 0.55);
        background: rgba(0, 230, 140, 0.05);
        color: #00E68C;
        font-size: 0.9rem;
        font-weight: 700;
        font-family: inherit;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        margin-top: 0.25rem;
      }
      .sle-hub-new-count {
        font-size: 0.7rem;
        opacity: 0.7;
        font-variant-numeric: tabular-nums;
      }
      .sle-hub-limit {
        text-align: center;
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.35);
        padding: 0.75rem 0;
      }

      /* ─── CTA "+ ADICIONAR RITMOS" (mobile, fixo no fim da lista) ─── */
      .sle-cta-add {
        display: none;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        margin: 0.6rem 0.75rem calc(0.6rem + env(safe-area-inset-bottom, 0px));
        min-height: 52px;
        border-radius: 14px;
        border: none;
        background: linear-gradient(135deg, #00D4FF, #0095cc);
        color: #021018;
        font-size: 0.9rem;
        font-weight: 800;
        letter-spacing: 0.05em;
        font-family: inherit;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        box-shadow: 0 4px 18px rgba(0, 212, 255, 0.3);
        flex-shrink: 0;
      }
      .sle-cta-add:active { transform: scale(0.98); }

      /* ─── Feedback ✓ no botão de adicionar ─── */
      .sle-add-flash {
        background: rgba(0, 230, 140, 0.25) !important;
        color: #00E68C !important;
        transform: scale(1.12);
      }

      /* ─── Posição do show na lista (ATUAL / a seguir) ─── */
      .sle-setlist-item.sle-now {
        border-color: rgba(0, 212, 255, 0.65);
        background: rgba(0, 212, 255, 0.08);
        box-shadow: 0 0 12px rgba(0, 212, 255, 0.12);
      }
      .sle-setlist-item.sle-now .sle-item-num {
        color: #00D4FF;
      }
      .sle-setlist-item.sle-next {
        border-color: rgba(0, 212, 255, 0.2);
      }

      /* Em mobile: telas empilhadas (hub → setlist → catalog) */
      @media (max-width: 640px) {
        .sle-body {
          grid-template-columns: 1fr !important;
          grid-template-rows: 1fr !important;
        }
        .sle-body.mobile-view-hub .sle-catalog,
        .sle-body.mobile-view-hub .sle-setlist { display: none; }
        .sle-body.mobile-view-hub .sle-hub { display: flex; }
        .sle-body.mobile-view-setlist .sle-catalog,
        .sle-body.mobile-view-setlist .sle-hub { display: none; }
        .sle-body.mobile-view-catalog .sle-setlist,
        .sle-body.mobile-view-catalog .sle-hub { display: none; }
        .sle-container { max-height: 92vh; height: 92vh; }
        .sle-header { padding: 0.85rem 1rem; }
        .sle-cta-add { display: flex; }
        /* No mobile o hub substitui a barra de chips */
        .sle-setlists-bar { display: none; }
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

      /* ════ DESKTOP (>640px): alinhado à linguagem nova do app ════
         Antes: vidro antigo, chip ativo BRANCO, painéis colados com
         divisor de 1px — destoava do resto (neon cyan). Agora: painéis
         em cards separados, pills neon, container mais largo. */
      @media (min-width: 641px) {
        .sle-container {
          max-width: 1120px;
          max-height: 88vh;
          background: linear-gradient(165deg, rgba(12, 14, 34, 0.97) 0%, rgba(5, 6, 16, 0.99) 100%);
          border: 1px solid rgba(0, 212, 255, 0.14);
          box-shadow: 0 32px 80px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 212, 255, 0.05);
        }
        .sle-header {
          padding: 1.1rem 1.4rem;
          border-bottom: 1px solid rgba(0, 212, 255, 0.1);
        }
        .sle-title {
          font-size: 1.05rem;
          letter-spacing: 0.02em;
        }
        /* Painéis viram CARDS separados (não mais colados por 1px) */
        .sle-body {
          gap: 0.9rem;
          background: transparent;
          padding: 0.9rem;
        }
        .sle-panel {
          background: rgba(10, 10, 28, 0.55);
          border: 1px solid rgba(255, 255, 255, 0.07);
          border-radius: 16px;
        }
        /* Chip de categoria ativo: NEON cyan (era branco, destoava) */
        .sle-chip.active {
          background: rgba(0, 212, 255, 0.1);
          color: #00D4FF;
          border-color: #00D4FF;
          box-shadow: 0 0 10px rgba(0, 212, 255, 0.18);
        }
        .sle-chip.active .sle-chip-count { opacity: 1; color: rgba(0, 212, 255, 0.8); }
        /* Busca no padrão dos painéis laterais */
        .sle-search-v2 {
          border-color: rgba(0, 212, 255, 0.3);
          border-radius: 12px;
        }
        .sle-search-v2:focus {
          border-color: rgba(0, 212, 255, 0.8);
          background: rgba(255, 255, 255, 0.05);
          box-shadow: 0 0 0 3px rgba(0, 212, 255, 0.12);
        }
        .sle-search-icon { color: rgba(0, 212, 255, 0.6); }
        /* Itens do catálogo: hover neon + borda visível */
        .sle-catalog-item {
          border: 1px solid rgba(255, 255, 255, 0.05);
          background: rgba(255, 255, 255, 0.02);
          margin-bottom: 4px;
        }
        .sle-catalog-item:hover {
          border-color: rgba(0, 212, 255, 0.35);
          background: rgba(0, 212, 255, 0.04);
        }
        /* Itens do repertório com borda visível */
        .sle-setlist-item {
          border: 1.5px solid rgba(255, 255, 255, 0.06);
          margin-bottom: 4px;
        }
        /* Barra de repertórios: respiro melhor */
        .sle-setlists-bar {
          padding: 0.8rem 0.85rem 0.4rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }
        .sle-setlist-chip {
          padding: 0.5rem 0.8rem;
          min-height: 40px;
          border-radius: 999px;
          font-size: 0.8rem;
        }
        .sle-panel-header {
          padding: 0.75rem 1rem;
        }
        .sle-panel-title {
          color: rgba(0, 212, 255, 0.75);
          letter-spacing: 0.08em;
        }
      }
    `;
    document.head.appendChild(css);
  }
}
