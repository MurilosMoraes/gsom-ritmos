// Gerenciamento de setlist — persistido no Supabase + cache local

import type { Setlist, SetlistItem } from '../types';

const LOCAL_KEY = 'gdrums-setlist';

export class SetlistManager {
  private setlist: Setlist;
  private onChange?: () => void;
  private userId: string | null = null;
  private supabaseClient: any = null;

  constructor() {
    this.setlist = this.loadLocal();
  }

  // ─── Init com Supabase (chamado após auth) ──────────────────────────

  async initWithUser(userId: string, supabase: any): Promise<void> {
    this.userId = userId;
    this.supabaseClient = supabase;

    // Carregar do Supabase
    const { data } = await supabase
      .from('gdrums_favorites')
      .select('items, current_index')
      .eq('user_id', userId)
      .single();

    if (data) {
      this.setlist = {
        name: 'Favoritos',
        items: Array.isArray(data.items) ? data.items : [],
        currentIndex: typeof data.current_index === 'number' ? data.current_index : 0,
      };
      this.saveLocal(); // Cache local
    } else {
      // Sem favoritos no Supabase — usar local como fallback e salvar no banco
      if (this.setlist.items.length > 0) {
        await this.saveRemote();
      }
    }
  }

  // ─── Callbacks ──────────────────────────────────────────────────────

  setOnChange(callback: () => void): void {
    this.onChange = callback;
  }

  private notify(): void {
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
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(this.setlist));
    } catch { /* localStorage cheio */ }
  }

  private loadLocal(): Setlist {
    try {
      const data = localStorage.getItem(LOCAL_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        return {
          name: parsed.name || 'Favoritos',
          items: Array.isArray(parsed.items) ? parsed.items : [],
          currentIndex: typeof parsed.currentIndex === 'number' ? parsed.currentIndex : 0,
        };
      }
    } catch { /* dados corrompidos */ }
    return { name: 'Favoritos', items: [], currentIndex: 0 };
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
