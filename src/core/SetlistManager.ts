// Gerenciamento de setlist — persistido no Supabase + cache local.
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

import type { Setlist, SetlistItem } from '../types';
import { persistSet, persistGet, requestPersistentStorage } from '../utils/persistentStore';

const LOCAL_KEY = 'gdrums-setlist';
const LOCAL_BACKUP_KEY = 'gdrums-setlist-backup'; // Cópia adicional em caso de corrupção
const IDB_KEY = 'setlist'; // chave no IndexedDB

interface TimedSetlist extends Setlist {
  lastModified?: number; // timestamp ms da última edição (do device que editou)
}

export class SetlistManager {
  private setlist: TimedSetlist;
  private onChange?: () => void;
  private userId: string | null = null;
  private supabaseClient: any = null;

  constructor() {
    this.setlist = this.loadLocal();
    // Storage persistente (Chrome/Firefox) — pede ao browser pra não apagar
    // IndexedDB quando disco encher. Idempotente, fire-and-forget.
    requestPersistentStorage().catch(() => { /* noop */ });
    // Se localStorage estava vazio mas IndexedDB pode ter backup, recupera
    // assíncrono. Isso cobre o caso onde o browser limpou localStorage mas
    // preservou IndexedDB (cenário comum em Safari iOS).
    if (this.setlist.items.length === 0) {
      this.tryRestoreFromIndexedDB();
    }
  }

  private async tryRestoreFromIndexedDB(): Promise<void> {
    try {
      const recovered = await persistGet<TimedSetlist>(IDB_KEY);
      if (recovered && Array.isArray(recovered.items) && recovered.items.length > 0) {
        // Só restaura se ainda estiver vazio (não pisa em algo que o
        // user já adicionou nesse meio tempo).
        if (this.setlist.items.length === 0) {
          console.warn('[SetlistManager] Recuperando setlist do IndexedDB:', recovered.items.length, 'itens');
          this.setlist = recovered;
          // Re-grava no localStorage pra próxima vez ser síncrono
          this.writeToLocalStorage();
          this.onChange?.();
        }
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
      // Carregar do Supabase — incluindo updated_at pra comparar timestamps
      const { data, error } = await supabase
        .from('gdrums_favorites')
        .select('items, current_index, updated_at')
        .eq('user_id', userId)
        .maybeSingle();

      // Erro de rede — preserva local intacto
      if (error) {
        console.warn('[SetlistManager] Falha ao ler banco:', error);
        return;
      }

      const localItems = this.setlist.items;
      const localLastModified = this.setlist.lastModified || 0;
      const localHasItems = localItems.length > 0;

      // Caso 1: banco não tem registro (user novo ou nunca sincronizou)
      if (!data) {
        if (localHasItems) {
          // Local tem setlist mas banco não conhece — sobe pro banco
          await this.saveRemote();
        }
        return;
      }

      const remoteItems: SetlistItem[] = Array.isArray(data.items) ? data.items : [];
      const remoteHasItems = remoteItems.length > 0;
      const remoteLastModified = data.updated_at ? new Date(data.updated_at).getTime() : 0;

      // Caso 2: banco vazio mas local tem itens — DEFESA CRÍTICA
      // Cenário: outro device bugou e gravou items:[] no banco. Se eu aceitar,
      // este device também fica vazio. Em vez disso, mando o local pro banco.
      if (!remoteHasItems && localHasItems) {
        console.warn('[SetlistManager] Banco vazio mas local tem ' + localItems.length + ' itens — preservando local e re-sincronizando');
        await this.saveRemote();
        return;
      }

      // Caso 3: ambos têm itens — quem é mais novo ganha
      if (remoteHasItems && localHasItems) {
        if (remoteLastModified > localLastModified) {
          // Banco é mais recente — adota
          this.setlist = {
            name: 'Favoritos',
            items: remoteItems,
            currentIndex: typeof data.current_index === 'number' ? data.current_index : 0,
            lastModified: remoteLastModified,
          };
          this.saveLocal();
        } else if (localLastModified > remoteLastModified) {
          // Local é mais recente — empurra pro banco
          await this.saveRemote();
        }
        // Se timestamps iguais ou ambos zero — assume mesmo estado, não mexe
        return;
      }

      // Caso 4: só banco tem itens, local vazio
      // SUTIL: precisa distinguir entre (a) local nunca teve nada vs
      // (b) user esvaziou local intencionalmente.
      // (a) → adota banco. (b) → mantém vazio se local foi atualizado mais
      // recentemente que o banco (clear() updated o lastModified).
      if (remoteHasItems) {
        if (localLastModified > remoteLastModified && localLastModified > 0) {
          // User apagou local DEPOIS do banco — respeita a vontade dele,
          // sobe o vazio pro banco
          await this.saveRemote();
        } else {
          // Local nunca foi tocado ou é mais antigo que banco — adota banco
          this.setlist = {
            name: 'Favoritos',
            items: remoteItems,
            currentIndex: typeof data.current_index === 'number' ? data.current_index : 0,
            lastModified: remoteLastModified,
          };
          this.saveLocal();
        }
      }
      // Caso 5: ambos vazios — nada a fazer
    } catch (e) {
      // Falha de rede / parsing — preserva local intacto
      console.warn('[SetlistManager] Erro no initWithUser, preservando local:', e);
    }
  }

  // ─── Callbacks ──────────────────────────────────────────────────────

  setOnChange(callback: () => void): void {
    this.onChange = callback;
  }

  private notify(): void {
    // Toda mudança no setlist atualiza o timestamp local — fundamental
    // pra o merge no initWithUser saber "qual lado é mais novo".
    this.setlist.lastModified = Date.now();
    this.saveLocal();
    this.saveRemote(); // fire-and-forget
    this.onChange?.();
  }

  // ─── Getters ────────────────────────────────────────────────────────

  getItems(): SetlistItem[] { return this.setlist.items; }
  getLength(): number { return this.setlist.items.length; }
  getCurrentIndex(): number { return this.setlist.currentIndex; }
  isEmpty(): boolean { return this.setlist.items.length === 0; }
  getName(): string { return this.setlist.name; }

  getCurrentItem(): SetlistItem | null {
    return this.setlist.items[this.setlist.currentIndex] || null;
  }

  getNextItem(): SetlistItem | null {
    return this.setlist.items[this.setlist.currentIndex + 1] || null;
  }

  getPreviousItem(): SetlistItem | null {
    return this.setlist.items[this.setlist.currentIndex - 1] || null;
  }

  // ─── Navigation ─────────────────────────────────────────────────────

  next(): SetlistItem | null {
    if (this.setlist.currentIndex < this.setlist.items.length - 1) {
      this.setlist.currentIndex++;
      this.notify();
      return this.getCurrentItem();
    }
    return null;
  }

  previous(): SetlistItem | null {
    if (this.setlist.currentIndex > 0) {
      this.setlist.currentIndex--;
      this.notify();
      return this.getCurrentItem();
    }
    return null;
  }

  goTo(index: number): SetlistItem | null {
    if (index >= 0 && index < this.setlist.items.length) {
      this.setlist.currentIndex = index;
      this.notify();
      return this.getCurrentItem();
    }
    return null;
  }

  // ─── CRUD ───────────────────────────────────────────────────────────

  addItem(item: SetlistItem): void {
    this.setlist.items.push({ ...item });
    this.notify();
  }

  removeItem(index: number): void {
    if (index < 0 || index >= this.setlist.items.length) return;
    this.setlist.items.splice(index, 1);
    if (this.setlist.currentIndex >= this.setlist.items.length) {
      this.setlist.currentIndex = Math.max(0, this.setlist.items.length - 1);
    }
    this.notify();
  }

  moveItem(fromIndex: number, toIndex: number): void {
    const items = this.setlist.items;
    if (fromIndex < 0 || fromIndex >= items.length) return;
    if (toIndex < 0 || toIndex >= items.length) return;

    const [item] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, item);

    if (this.setlist.currentIndex === fromIndex) {
      this.setlist.currentIndex = toIndex;
    } else if (fromIndex < this.setlist.currentIndex && toIndex >= this.setlist.currentIndex) {
      this.setlist.currentIndex--;
    } else if (fromIndex > this.setlist.currentIndex && toIndex <= this.setlist.currentIndex) {
      this.setlist.currentIndex++;
    }

    this.notify();
  }

  clear(): void {
    this.setlist.items = [];
    this.setlist.currentIndex = 0;
    this.notify();
  }

  setName(name: string): void {
    this.setlist.name = name;
    this.saveLocal();
  }

  // ─── Persistência Local (cache) ─────────────────────────────────────

  private saveLocal(): void {
    this.writeToLocalStorage();
    // IndexedDB em paralelo (fire-and-forget) — última linha de defesa
    // pra quando localStorage for limpo pelo browser. Só grava setlists
    // com itens (não sobrescreve IDB bom com vazio em caso de bug).
    if (this.setlist.items.length > 0) {
      persistSet(IDB_KEY, this.setlist).catch(() => { /* noop */ });
    }
  }

  private writeToLocalStorage(): void {
    try {
      const serialized = JSON.stringify(this.setlist);
      localStorage.setItem(LOCAL_KEY, serialized);
      // Backup secundário: se o LOCAL_KEY for corrompido por algum motivo
      // (escrita parcial, browser cleanup, etc), o backup salva a vida.
      // Atualiza só quando tem itens — não sobrescreve backup bom com vazio.
      if (this.setlist.items.length > 0) {
        localStorage.setItem(LOCAL_BACKUP_KEY, serialized);
      }
    } catch { /* localStorage cheio — toleramos */ }
  }

  private loadLocal(): TimedSetlist {
    // Tenta KEY principal primeiro
    const main = this.tryParseSetlist(localStorage.getItem(LOCAL_KEY));
    if (main && main.items.length > 0) return main;

    // Se vazio ou corrompido, tenta o backup
    const backup = this.tryParseSetlist(localStorage.getItem(LOCAL_BACKUP_KEY));
    if (backup && backup.items.length > 0) {
      console.warn('[SetlistManager] LOCAL_KEY vazio, recuperando do backup com ' + backup.items.length + ' itens');
      return backup;
    }

    // Se nada bom, retorna o que tiver (vazio é OK)
    return main || { name: 'Favoritos', items: [], currentIndex: 0, lastModified: 0 };
  }

  private tryParseSetlist(raw: string | null): TimedSetlist | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return {
        name: parsed.name || 'Favoritos',
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
      await this.supabaseClient
        .from('gdrums_favorites')
        .upsert({
          user_id: this.userId,
          items: this.setlist.items,
          current_index: this.setlist.currentIndex,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
    } catch { /* silencioso */ }
  }
}
