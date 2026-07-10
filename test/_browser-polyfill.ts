// Polyfill mínimo de browser pra rodar SetlistManager/UserRhythmService
// REAIS no Node (tsx). Instala como efeito colateral — IMPORTE ESTE ARQUIVO
// ANTES de qualquer import dos módulos do app (em ESM os imports avaliam em
// ordem, então este roda primeiro e os globais já existem quando i18n/classes
// lerem localStorage/navigator no load).

// ── localStorage (Map-backed) ─────────────────────────────────────────
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  get length(): number { return this.m.size; }
}
(globalThis as any).localStorage = new MemStorage();

// ── navigator (onLine mutável) ────────────────────────────────────────
(globalThis as any).navigator = { onLine: true, language: 'pt-BR' };

// ── window (event bus pra disparar 'online') ──────────────────────────
const listeners: Record<string, Array<(e: any) => void>> = {};
(globalThis as any).window = {
  addEventListener(ev: string, cb: (e: any) => void) { (listeners[ev] ||= []).push(cb); },
  removeEventListener(ev: string, cb: (e: any) => void) { listeners[ev] = (listeners[ev] || []).filter(f => f !== cb); },
  dispatchEvent(evt: any) { (listeners[evt.type] || []).forEach(cb => cb(evt)); return true; },
};

// Helper de teste: simula a rede voltando (seta onLine + dispara 'online').
(globalThis as any).__fireOnline = () => {
  (globalThis as any).navigator.onLine = true;
  (listeners['online'] || []).forEach(cb => cb({ type: 'online' }));
};
(globalThis as any).__setOffline = () => { (globalThis as any).navigator.onLine = false; };
(globalThis as any).__setOnline = () => { (globalThis as any).navigator.onLine = true; };
// Zera os listeners 'online' entre blocos de teste (cada instância nova de
// SetlistManager/UserRhythmService registra o seu — sem limpar, um
// __fireOnline dispararia saveRemote de instâncias de testes anteriores).
(globalThis as any).__clearListeners = () => { for (const k of Object.keys(listeners)) delete listeners[k]; };

// ── crypto.randomUUID (fallback determinístico se faltar) ─────────────
const g = globalThis as any;
if (!g.crypto || typeof g.crypto.randomUUID !== 'function') {
  let n = 0;
  g.crypto = { ...(g.crypto || {}), randomUUID: () => `uuid-${(++n).toString(16).padStart(8, '0')}-test` };
}

export {};
