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
  // scheduleRemoteSync() usa window.setTimeout (debounce do sync remoto).
  setTimeout: (fn: any, ms?: number) => setTimeout(fn, ms),
  clearTimeout: (id: any) => clearTimeout(id),
  setInterval: (fn: any, ms?: number) => setInterval(fn, ms),
  clearInterval: (id: any) => clearInterval(id),
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

// ── localStorage com COTA simulada ────────────────────────────────────
// O bug real do cliente: repertório grande estoura o limite (~5MB) e o
// setItem lança QuotaExceededError. Sem simular isso, nenhum teste pega a
// perda de dados. __setQuota(bytes) liga o limite; __setQuota(0) desliga.
{
  const ls: any = (globalThis as any).localStorage;
  let quota = 0; // 0 = ilimitado
  const rawSet = ls.setItem.bind(ls);
  const usedBytes = (): number => {
    let n = 0;
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i)!;
      n += k.length + (ls.getItem(k) || '').length;
    }
    return n;
  };
  ls.setItem = (k: string, v: string): void => {
    if (quota > 0) {
      const prev = ls.getItem(k);
      const delta = (k.length + String(v).length) - (prev === null ? 0 : k.length + prev.length);
      if (usedBytes() + delta > quota) {
        const err: any = new Error('QuotaExceededError: localStorage cheio');
        err.name = 'QuotaExceededError';
        throw err;
      }
    }
    rawSet(k, String(v));
  };
  (globalThis as any).__setQuota = (bytes: number) => { quota = bytes; };
  (globalThis as any).__usedBytes = usedBytes;
}

// ── IndexedDB fake (só o que persistentStore.ts usa) ──────────────────
// Assíncrono de verdade (queueMicrotask) pra expor bugs de ordem que um
// fake síncrono esconderia.
{
  const dbs = new Map<string, Map<string, Map<string, any>>>(); // db -> store -> kv
  let broken = false; // __breakIDB() simula private mode / IDB indisponível

  const fire = (req: any, ok: boolean, value?: any, err?: any): void => {
    queueMicrotask(() => {
      if (ok) { req.result = value; req.onsuccess?.({ target: req }); }
      else { req.error = err || new Error('idb fail'); req.onerror?.({ target: req }); }
    });
  };

  (globalThis as any).indexedDB = {
    open(name: string, _version: number) {
      const req: any = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      if (broken) { fire(req, false, null, new Error('IDB indisponível')); return req; }
      const existed = dbs.has(name);
      if (!existed) dbs.set(name, new Map());
      const stores = dbs.get(name)!;
      const db: any = {
        objectStoreNames: { contains: (s: string) => stores.has(s) },
        createObjectStore: (s: string) => { stores.set(s, new Map()); return {}; },
        transaction(s: string, _mode?: string) {
          return {
            objectStore: (_s: string) => ({
              put(value: any, key: string) {
                const r: any = {};
                if (broken) { fire(r, false); return r; }
                stores.get(s)!.set(key, JSON.parse(JSON.stringify(value)));
                fire(r, true);
                return r;
              },
              get(key: string) {
                const r: any = {};
                if (broken) { fire(r, false); return r; }
                const v = stores.get(s)!.get(key);
                fire(r, true, v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
                return r;
              },
              delete(key: string) {
                const r: any = {};
                stores.get(s)!.delete(key);
                fire(r, true);
                return r;
              },
            }),
          };
        },
      };
      queueMicrotask(() => {
        if (!existed) { req.result = db; req.onupgradeneeded?.({ target: req }); }
        req.result = db;
        req.onsuccess?.({ target: req });
      });
      return req;
    },
  };

  // ATENÇÃO: persistentStore.ts guarda a conexão num `dbPromise` de módulo,
  // que sobrevive entre "aparelhos" no teste. Se aqui a gente só desse
  // dbs.clear(), o objeto db já aberto continuaria apontando pro Map antigo
  // e um aparelho "novo" enxergaria o IndexedDB do anterior — isolamento
  // falso, teste mentindo. Por isso esvaziamos os stores NO LUGAR.
  (globalThis as any).__clearIDB = () => {
    for (const stores of dbs.values()) for (const kv of stores.values()) kv.clear();
    broken = false;
  };
  (globalThis as any).__breakIDB = (v = true) => { broken = v; };
  (globalThis as any).__idbDump = (db: string, store: string) => {
    const s = dbs.get(db)?.get(store);
    return s ? Object.fromEntries(s) : {};
  };
}

// navigator.storage (requestPersistentStorage)
(globalThis as any).navigator.storage = {
  persist: async () => true,
  persisted: async () => false,
};

// document (SetlistManager escuta visibilitychange no construtor)
if (!(globalThis as any).document) {
  (globalThis as any).document = {
    visibilityState: 'visible',
    addEventListener() { /* noop */ },
    removeEventListener() { /* noop */ },
  };
}
