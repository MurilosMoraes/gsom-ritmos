// IndexedDB wrapper — armazenamento mais robusto que localStorage.
//
// Por que IndexedDB:
// - localStorage tem ~5MB e pode ser apagado por browsers quando disco
//   fica cheio (especialmente Safari iOS).
// - IndexedDB tem ~50MB+ e tem persistência muito maior em todos os
//   browsers modernos.
// - Sobrevive a clear de localStorage (são storages separados).
//
// Estratégia: localStorage continua sendo a fonte primária (mais rápido
// pra leitura síncrona). IndexedDB é o salva-vidas pra quando localStorage
// falhar. Toda escrita vai pros dois.

const DB_NAME = 'gdrums-store';
const DB_VERSION = 1;
const STORE_NAME = 'kv'; // key-value genérico

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB não disponível'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open falhou'));
  });
  return dbPromise;
}

/** Grava valor (qualquer JSON-serializable) — fire-and-forget. */
export async function persistSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    /* IndexedDB pode falhar (private mode iOS, etc) — ignoramos */
  }
}

/** Lê valor. Retorna null se não existe ou se IndexedDB falhar. */
export async function persistGet<T = unknown>(key: string): Promise<T | null> {
  try {
    const db = await openDB();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/** Remove valor. */
export async function persistDelete(key: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    /* noop */
  }
}

/**
 * Pede ao browser pra MARCAR este storage como persistente (não pode ser
 * apagado automaticamente quando disco fica cheio). Chrome geralmente
 * concede sem pedir confirmação se o site for PWA instalado ou tiver
 * recebido notificações. Safari iOS ignora.
 *
 * Idempotente — pode chamar várias vezes sem efeito colateral.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = await navigator.storage.persisted();
      if (already) return true;
      return await navigator.storage.persist();
    }
  } catch { /* noop */ }
  return false;
}
