// Gerenciamento de setlists (MÚLTIPLOS repertórios) — Supabase + cache local.
//
// REGRA DE OURO: nunca, jamais, em hipótese alguma, perder repertório do user.
// Setlist é o trabalho dele — montar pode levar meses. Preferimos manter um
// item duplicado por engano do que perder um setlist legítimo.
//
// Defesas implementadas:
// 1. Timestamp em cada edição (lastModified) — quem é mais novo ganha
// 2. NUNCA aceitar banco vazio sobrescrevendo local com itens (caso típico
//    de outro device ter zerado setlist por bug)
// 3. Backup local nunca é apagado por logout/troca de sessão
// 4. initWithUser faz MERGE inteligente quando ambos os lados têm dados
//
// v2 (2026-06): MÚLTIPLOS repertórios (até MAX_SETLISTS). User toca na
// igreja, no pagode, no sertanejo — cada contexto tem seu repertório.
// - API pública antiga (getItems/next/addItem/...) continua operando no
//   repertório ATIVO — consumidores (main.ts, SetlistEditorUI) não quebram.
// - Storage local: chave nova 'gdrums-setlists-v2'. Migração automática do
//   formato antigo ('gdrums-setlist') na primeira carga.
// - Supabase: coluna nova `setlists` (jsonb) na gdrums_favorites. Os campos
//   antigos items/current_index continuam recebendo o repertório ativo
//   (dual-write) pra apps antigos em outros devices não quebrarem.

import type { Setlist, SetlistItem } from '../types';
import { persistSet, persistGet, requestPersistentStorage } from '../utils/persistentStore';

const LOCAL_KEY_V2 = 'gdrums-setlists-v2';
const LOCAL_BACKUP_KEY_V2 = 'gdrums-setlists-v2-backup';
const IDB_KEY_V2 = 'setlists-v2';

// Chaves do formato antigo (v1) — só leitura, pra migração
const LEGACY_LOCAL_KEY = 'gdrums-setlist';
const LEGACY_BACKUP_KEY = 'gdrums-setlist-backup';
const LEGACY_IDB_KEY = 'setlist';

export const MAX_SETLISTS = 10;

export interface NamedSetlist extends Setlist {
  id: string;
}

interface MultiSetlistState {
  setlists: NamedSetlist[];
  activeId: string;
  lastModified?: number; // timestamp ms da última edição (do device que editou)
}

function genId(): string {
  return (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ||
    String(Date.now()) + Math.random().toString(16).slice(2);
}

function emptyState(): MultiSetlistState {
  const id = genId();
  return {
    setlists: [{ id, name: 'Meu repertório', items: [], currentIndex: 0 }],
    activeId: id,
    lastModified: 0,
  };
}

export class SetlistManager {
  private state: MultiSetlistState;
  private onChange?: () => void;
  private userId: string | null = null;
  private supabaseClient: any = null;

  constructor() {
    this.state = this.loadLocal();
    // Storage persistente (Chrome/Firefox) — pede ao browser pra não apagar
    // IndexedDB quando disco encher. Idempotente, fire-and-forget.
    requestPersistentStorage().catch(() => { /* noop */ });
    // Se localStorage estava vazio mas IndexedDB pode ter backup, recupera
    // assíncrono. Cobre o caso onde o browser limpou localStorage mas
    // preservou IndexedDB (cenário comum em Safari iOS).
    if (this.totalItemCount() === 0) {
      this.tryRestoreFromIndexedDB();
    }
  }

  // ─── Helpers internos ───────────────────────────────────────────────

  /** Repertório ativo — toda a API v1 opera nele. */
  private active(): NamedSetlist {
    const found = this.state.setlists.find(s => s.id === this.state.activeId);
    if (found) return found;
    // activeId órfão (corrupção/migração) — adota o primeiro
    if (this.state.setlists.length === 0) {
      this.state = emptyState();
    }
    this.state.activeId = this.state.setlists[0].id;
    return this.state.setlists[0];
  }

  private totalItemCount(): number {
    return this.state.setlists.reduce((n, s) => n + s.items.length, 0);
  }

  private async tryRestoreFromIndexedDB(): Promise<void> {
    try {
      // v2 primeiro
      const recovered = await persistGet<MultiSetlistState>(IDB_KEY_V2);
      if (recovered && Array.isArray(recovered.setlists) &&
          recovered.setlists.reduce((n, s) => n + (s.items?.length || 0), 0) > 0) {
        if (this.totalItemCount() === 0) {
          console.warn('[SetlistManager] Recuperando setlists v2 do IndexedDB');
          this.state = this.normalizeState(recovered);
          this.writeToLocalStorage();
          this.onChange?.();
        }
        return;
      }
      // Fallback: IDB do formato v1 (pré-migração)
      const legacy = await persistGet<Setlist & { lastModified?: number }>(LEGACY_IDB_KEY);
      if (legacy && Array.isArray(legacy.items) && legacy.items.length > 0 &&
          this.totalItemCount() === 0) {
        console.warn('[SetlistManager] Recuperando setlist v1 do IndexedDB:', legacy.items.length, 'itens');
        const id = genId();
        this.state = {
          setlists: [{ id, name: legacy.name || 'Meu repertório', items: legacy.items, currentIndex: legacy.currentIndex || 0 }],
          activeId: id,
          lastModified: legacy.lastModified || 0,
        };
        this.writeToLocalStorage();
        this.onChange?.();
      }
    } catch { /* IDB pode não estar disponível */ }
  }

  // ─── Init com Supabase (chamado após auth) ──────────────────────────

  async initWithUser(userId: string, supabase: any): Promise<void> {
    this.userId = userId;
    this.supabaseClient = supabase;

    // Offline: mantém local. Quando voltar online, saveRemote vai sincronizar.
    if (!navigator.onLine) return;

    try {
      const { data, error } = await supabase
        .from('gdrums_favorites')
        .select('items, current_index, setlists, updated_at')
        .eq('user_id', userId)
        .maybeSingle();

      // Erro de rede — preserva local intacto
      if (error) {
        console.warn('[SetlistManager] Falha ao ler banco:', error);
        return;
      }

      const localCount = this.totalItemCount();
      const localLastModified = this.state.lastModified || 0;
      const localHasItems = localCount > 0;

      // Caso 1: banco não tem registro (user novo ou nunca sincronizou)
      if (!data) {
        if (localHasItems) {
          await this.saveRemote();
        }
        return;
      }

      // Estado remoto: prioriza coluna nova `setlists`; se não existe,
      // reconstrói do formato antigo (items/current_index)
      let remoteState: MultiSetlistState | null = null;
      if (data.setlists && Array.isArray(data.setlists?.setlists)) {
        remoteState = this.normalizeState(data.setlists as MultiSetlistState);
        // ── Detecção de escrita de APP ANTIGO (período de transição) ──
        // O app novo SEMPRE grava items + setlists juntos (dual-write
        // consistente: items === itens do repertório ativo). Se as
        // colunas divergem, um app antigo (PWA cacheada em outro device)
        // gravou só items DEPOIS — adota items no repertório ativo pra
        // não perder as edições feitas lá.
        if (Array.isArray(data.items) && data.items.length > 0) {
          const act = remoteState.setlists.find(s => s.id === remoteState!.activeId);
          if (act && JSON.stringify(act.items) !== JSON.stringify(data.items)) {
            console.warn('[SetlistManager] items (app antigo) diverge do setlists — adotando items no repertório ativo');
            act.items = data.items;
            act.currentIndex = Math.min(
              typeof data.current_index === 'number' ? data.current_index : 0,
              Math.max(0, data.items.length - 1)
            );
          }
        }
      } else if (Array.isArray(data.items) && data.items.length > 0) {
        const id = genId();
        remoteState = {
          setlists: [{ id, name: 'Meu repertório', items: data.items, currentIndex: typeof data.current_index === 'number' ? data.current_index : 0 }],
          activeId: id,
        };
      }

      const remoteCount = remoteState
        ? remoteState.setlists.reduce((n, s) => n + s.items.length, 0)
        : 0;
      const remoteHasItems = remoteCount > 0;
      const remoteLastModified = data.updated_at ? new Date(data.updated_at).getTime() : 0;

      // Caso 2: banco vazio mas local tem itens — DEFESA CRÍTICA
      if (!remoteHasItems && localHasItems) {
        console.warn('[SetlistManager] Banco vazio mas local tem ' + localCount + ' itens — preservando local e re-sincronizando');
        await this.saveRemote();
        return;
      }

      // Caso 3: ambos têm itens — quem é mais novo ganha
      if (remoteHasItems && localHasItems) {
        if (remoteLastModified > localLastModified) {
          this.state = { ...remoteState!, lastModified: remoteLastModified };
          this.saveLocal();
          this.onChange?.();
        } else if (localLastModified > remoteLastModified) {
          await this.saveRemote();
        }
        return;
      }

      // Caso 4: só banco tem itens, local vazio
      if (remoteHasItems) {
        if (localLastModified > remoteLastModified && localLastModified > 0) {
          // User apagou local DEPOIS do banco — respeita, sobe o vazio
          await this.saveRemote();
        } else {
          this.state = { ...remoteState!, lastModified: remoteLastModified };
          this.saveLocal();
          this.onChange?.();
        }
      }
      // Caso 5: ambos vazios — nada a fazer
    } catch (e) {
      console.warn('[SetlistManager] Erro no initWithUser, preservando local:', e);
    }
  }

  // ─── Callbacks ──────────────────────────────────────────────────────

  setOnChange(callback: () => void): void {
    this.onChange = callback;
  }

  private notify(): void {
    // Toda mudança atualiza o timestamp local — fundamental pra o merge
    // no initWithUser saber "qual lado é mais novo".
    this.state.lastModified = Date.now();
    this.saveLocal();
    this.saveRemote(); // fire-and-forget
    this.onChange?.();
  }

  // ─── API de MÚLTIPLOS repertórios ───────────────────────────────────

  getSetlists(): Array<{ id: string; name: string; count: number; active: boolean }> {
    return this.state.setlists.map(s => ({
      id: s.id,
      name: s.name,
      count: s.items.length,
      active: s.id === this.state.activeId,
    }));
  }

  getActiveSetlistId(): string {
    return this.active().id;
  }

  /** Troca o repertório ativo. Retorna false se id não existe. */
  switchSetlist(id: string): boolean {
    if (!this.state.setlists.some(s => s.id === id)) return false;
    if (this.state.activeId === id) return true;
    this.state.activeId = id;
    this.notify();
    return true;
  }

  /** Cria repertório novo (e ativa). Retorna null se bateu o limite. */
  createSetlist(name: string): string | null {
    if (this.state.setlists.length >= MAX_SETLISTS) return null;
    const id = genId();
    const cleanName = (name || '').trim() || `Repertório ${this.state.setlists.length + 1}`;
    this.state.setlists.push({ id, name: cleanName.slice(0, 40), items: [], currentIndex: 0 });
    this.state.activeId = id;
    this.notify();
    return id;
  }

  renameSetlist(id: string, name: string): boolean {
    const s = this.state.setlists.find(x => x.id === id);
    if (!s) return false;
    const cleanName = (name || '').trim();
    if (!cleanName) return false;
    s.name = cleanName.slice(0, 40);
    this.notify();
    return true;
  }

  /** Exclui repertório. Não deixa excluir o último (sempre existe 1). */
  deleteSetlist(id: string): boolean {
    if (this.state.setlists.length <= 1) return false;
    const idx = this.state.setlists.findIndex(x => x.id === id);
    if (idx === -1) return false;
    this.state.setlists.splice(idx, 1);
    if (this.state.activeId === id) {
      this.state.activeId = this.state.setlists[Math.max(0, idx - 1)].id;
    }
    this.notify();
    return true;
  }

  getMaxSetlists(): number { return MAX_SETLISTS; }

  /** Duplica um repertório (itens copiados, nome "X (cópia)"). Null se bateu o limite. */
  duplicateSetlist(id: string): string | null {
    if (this.state.setlists.length >= MAX_SETLISTS) return null;
    const src = this.state.setlists.find(x => x.id === id);
    if (!src) return null;
    const newId = genId();
    this.state.setlists.push({
      id: newId,
      name: `${src.name} (cópia)`.slice(0, 40),
      items: src.items.map(i => ({ ...i })),
      currentIndex: 0,
    });
    this.notify();
    return newId;
  }

  /** Adiciona item num repertório ESPECÍFICO sem trocar o ativo.
   *  Usado pelo "salvar ritmo → escolher repertório de destino". */
  addItemTo(setlistId: string, item: SetlistItem): boolean {
    const s = this.state.setlists.find(x => x.id === setlistId);
    if (!s) return false;
    s.items.push(item);
    this.notify();
    return true;
  }

  // ─── Getters (API v1 — operam no repertório ATIVO) ──────────────────

  getItems(): SetlistItem[] { return this.active().items; }
  getLength(): number { return this.active().items.length; }
  getCurrentIndex(): number { return this.active().currentIndex; }
  isEmpty(): boolean { return this.active().items.length === 0; }
  getName(): string { return this.active().name; }

  getCurrentItem(): SetlistItem | null {
    const a = this.active();
    return a.items[a.currentIndex] || null;
  }

  getNextItem(): SetlistItem | null {
    const a = this.active();
    return a.items[a.currentIndex + 1] || null;
  }

  getPreviousItem(): SetlistItem | null {
    const a = this.active();
    return a.items[a.currentIndex - 1] || null;
  }

  // ─── Navigation ─────────────────────────────────────────────────────

  next(): SetlistItem | null {
    const a = this.active();
    if (a.currentIndex < a.items.length - 1) {
      a.currentIndex++;
      this.notify();
      return this.getCurrentItem();
    }
    return null;
  }

  previous(): SetlistItem | null {
    const a = this.active();
    if (a.currentIndex > 0) {
      a.currentIndex--;
      this.notify();
      return this.getCurrentItem();
    }
    return null;
  }

  goTo(index: number): SetlistItem | null {
    const a = this.active();
    if (index >= 0 && index < a.items.length) {
      a.currentIndex = index;
      this.notify();
      return this.getCurrentItem();
    }
    return null;
  }

  // ─── CRUD (no repertório ativo) ─────────────────────────────────────

  addItem(item: SetlistItem): void {
    this.active().items.push({ ...item });
    this.notify();
  }

  removeItem(index: number): void {
    const a = this.active();
    if (index < 0 || index >= a.items.length) return;
    a.items.splice(index, 1);
    if (a.currentIndex >= a.items.length) {
      a.currentIndex = Math.max(0, a.items.length - 1);
    }
    this.notify();
  }

  moveItem(fromIndex: number, toIndex: number): void {
    const a = this.active();
    const items = a.items;
    if (fromIndex < 0 || fromIndex >= items.length) return;
    if (toIndex < 0 || toIndex >= items.length) return;

    const [item] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, item);

    if (a.currentIndex === fromIndex) {
      a.currentIndex = toIndex;
    } else if (fromIndex < a.currentIndex && toIndex >= a.currentIndex) {
      a.currentIndex--;
    } else if (fromIndex > a.currentIndex && toIndex <= a.currentIndex) {
      a.currentIndex++;
    }

    this.notify();
  }

  clear(): void {
    const a = this.active();
    a.items = [];
    a.currentIndex = 0;
    this.notify();
  }

  setName(name: string): void {
    this.active().name = name;
    this.saveLocal();
  }

  // ─── Persistência Local (cache) ─────────────────────────────────────

  private saveLocal(): void {
    this.writeToLocalStorage();
    // IndexedDB em paralelo (fire-and-forget) — última linha de defesa.
    // Só grava estados com itens (não sobrescreve IDB bom com vazio).
    if (this.totalItemCount() > 0) {
      persistSet(IDB_KEY_V2, this.state).catch(() => { /* noop */ });
    }
  }

  private writeToLocalStorage(): void {
    try {
      const serialized = JSON.stringify(this.state);
      localStorage.setItem(LOCAL_KEY_V2, serialized);
      // Backup secundário — não sobrescreve backup bom com vazio
      if (this.totalItemCount() > 0) {
        localStorage.setItem(LOCAL_BACKUP_KEY_V2, serialized);
      }
    } catch { /* localStorage cheio — toleramos */ }
  }

  private loadLocal(): MultiSetlistState {
    // 1. Formato v2 (principal, depois backup)
    const main = this.tryParseState(localStorage.getItem(LOCAL_KEY_V2));
    if (main && main.setlists.reduce((n, s) => n + s.items.length, 0) > 0) return main;

    const backup = this.tryParseState(localStorage.getItem(LOCAL_BACKUP_KEY_V2));
    if (backup && backup.setlists.reduce((n, s) => n + s.items.length, 0) > 0) {
      console.warn('[SetlistManager] v2 principal vazio, recuperando do backup');
      return backup;
    }

    // 2. MIGRAÇÃO do formato v1 ('gdrums-setlist') — primeira carga após
    //    o update. O setlist único antigo vira o primeiro repertório.
    const legacy = this.tryParseLegacy(localStorage.getItem(LEGACY_LOCAL_KEY)) ||
                   this.tryParseLegacy(localStorage.getItem(LEGACY_BACKUP_KEY));
    if (legacy && legacy.items.length > 0) {
      console.warn('[SetlistManager] Migrando setlist v1 → v2 (' + legacy.items.length + ' itens)');
      const id = genId();
      const migrated: MultiSetlistState = {
        setlists: [{ id, name: legacy.name || 'Meu repertório', items: legacy.items, currentIndex: legacy.currentIndex || 0 }],
        activeId: id,
        lastModified: legacy.lastModified || 0,
      };
      // NÃO apagar as chaves v1 — se o user voltar pra versão antiga do
      // app, o repertório dele continua lá. Custo: alguns KB.
      return migrated;
    }

    // 3. Nada em lugar nenhum — estado vazio com 1 repertório default
    return main || emptyState();
  }

  private tryParseState(raw: string | null): MultiSetlistState | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.setlists)) return null;
      return this.normalizeState(parsed);
    } catch { return null; }
  }

  private normalizeState(parsed: any): MultiSetlistState {
    const setlists: NamedSetlist[] = (Array.isArray(parsed.setlists) ? parsed.setlists : [])
      .slice(0, MAX_SETLISTS)
      .map((s: any, i: number) => ({
        id: typeof s.id === 'string' && s.id ? s.id : genId(),
        name: typeof s.name === 'string' && s.name.trim() ? s.name.slice(0, 40) : `Repertório ${i + 1}`,
        items: Array.isArray(s.items) ? s.items : [],
        currentIndex: typeof s.currentIndex === 'number' ? s.currentIndex : 0,
      }));
    if (setlists.length === 0) return emptyState();
    const activeId = setlists.some(s => s.id === parsed.activeId)
      ? parsed.activeId
      : setlists[0].id;
    return {
      setlists,
      activeId,
      lastModified: typeof parsed.lastModified === 'number' ? parsed.lastModified : 0,
    };
  }

  private tryParseLegacy(raw: string | null): (Setlist & { lastModified?: number }) | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return {
        name: parsed.name || 'Meu repertório',
        items: Array.isArray(parsed.items) ? parsed.items : [],
        currentIndex: typeof parsed.currentIndex === 'number' ? parsed.currentIndex : 0,
        lastModified: typeof parsed.lastModified === 'number' ? parsed.lastModified : 0,
      };
    } catch { return null; }
  }

  // ─── Persistência Supabase ──────────────────────────────────────────

  private async saveRemote(): Promise<void> {
    if (!this.userId || !this.supabaseClient) return;
    try {
      const a = this.active();
      await this.supabaseClient
        .from('gdrums_favorites')
        .upsert({
          user_id: this.userId,
          // DUAL-WRITE: campos antigos recebem o repertório ATIVO — apps
          // antigos em outros devices continuam funcionando (leem 1 setlist)
          items: a.items,
          current_index: a.currentIndex,
          // Campo novo: estado completo dos múltiplos repertórios
          setlists: {
            setlists: this.state.setlists,
            activeId: this.state.activeId,
          },
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
    } catch { /* silencioso */ }
  }
}
