// Gerenciamento de setlist — lista ordenada de ritmos para performance ao vivo

import type { Setlist, SetlistItem } from '../types';

const STORAGE_KEY = 'gdrums-setlist';

export class SetlistManager {
  private setlist: Setlist;
  private onChange?: () => void;

  constructor() {
    this.setlist = this.load();
  }

  // ─── Callbacks ──────────────────────────────────────────────────────

  setOnChange(callback: () => void): void {
    this.onChange = callback;
  }

  private notify(): void {
    this.save();
    this.onChange?.();
  }

  // ─── Getters ────────────────────────────────────────────────────────

  getItems(): SetlistItem[] {
    return this.setlist.items;
  }

  getLength(): number {
    return this.setlist.items.length;
  }

  getCurrentIndex(): number {
    return this.setlist.currentIndex;
  }

  getCurrentItem(): SetlistItem | null {
    return this.setlist.items[this.setlist.currentIndex] || null;
  }

  getNextItem(): SetlistItem | null {
    const next = this.setlist.currentIndex + 1;
    return this.setlist.items[next] || null;
  }

  getPreviousItem(): SetlistItem | null {
    const prev = this.setlist.currentIndex - 1;
    return this.setlist.items[prev] || null;
  }

  isEmpty(): boolean {
    return this.setlist.items.length === 0;
  }

  getName(): string {
    return this.setlist.name;
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

    // Ajustar currentIndex se necessário
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

    // Ajustar currentIndex
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
    this.save();
  }

  // ─── Persistência ───────────────────────────────────────────────────

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.setlist));
    } catch {
      // localStorage cheio ou indisponível
    }
  }

  private load(): Setlist {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        return {
          name: parsed.name || 'Meu Setlist',
          items: Array.isArray(parsed.items) ? parsed.items : [],
          currentIndex: typeof parsed.currentIndex === 'number' ? parsed.currentIndex : 0
        };
      }
    } catch {
      // dados corrompidos
    }
    return { name: 'Meu Setlist', items: [], currentIndex: 0 };
  }
}
