// OfflineDownloader — baixa todos os ritmos + samples pra cache do
// Service Worker, garantindo que o app funcione 100% offline.
//
// Estratégia:
// - Lê manifests (rhythm + midi)
// - Faz fetch de cada arquivo pra disparar o Service Worker cachear
// - Marca em localStorage que essa versão do manifest tá baixada
// - Se aparecer manifest novo (version diferente), oferece re-download
//
// Não bloqueia: user pode pular e baixar depois pelo menu.

import { persistSet, persistGet } from '../utils/persistentStore';

const READY_KEY = 'gdrums-offline-ready'; // localStorage flag
const READY_IDB_KEY = 'offline_ready';    // IndexedDB persistente

export interface OfflineStatus {
  ready: boolean;
  manifestVersion: number | null;
}

export interface DownloadProgress {
  current: number;
  total: number;
  currentFile: string;
  failed: string[];
}

export type DownloadCallback = (progress: DownloadProgress) => void;

/** Lê o status atual do offline (versão baixada vs versão atual). */
export async function getOfflineStatus(): Promise<OfflineStatus> {
  // Tenta localStorage primeiro
  const lsRaw = localStorage.getItem(READY_KEY);
  if (lsRaw) {
    try {
      const parsed = JSON.parse(lsRaw);
      return { ready: true, manifestVersion: parsed.version || null };
    } catch { /* segue pro IDB */ }
  }
  // Fallback IndexedDB
  try {
    const idb = await persistGet<{ version: number }>(READY_IDB_KEY);
    if (idb) {
      return { ready: true, manifestVersion: idb.version };
    }
  } catch { /* noop */ }
  return { ready: false, manifestVersion: null };
}

/** Marca que tudo foi baixado pra essa versão do manifest. */
async function markReady(version: number): Promise<void> {
  const data = { version, downloadedAt: new Date().toISOString() };
  try {
    localStorage.setItem(READY_KEY, JSON.stringify(data));
  } catch { /* noop */ }
  await persistSet(READY_IDB_KEY, data);
}

/**
 * Baixa todos os ritmos + samples. Chama callback de progresso a cada
 * arquivo. Tolera falhas individuais (lista em failed[]).
 *
 * AbortSignal opcional pra permitir cancelar.
 */
export async function downloadEverything(
  onProgress: DownloadCallback,
  signal?: AbortSignal,
): Promise<{ success: boolean; version: number; failed: string[] }> {
  // 1. Lê manifests
  const [rhythmManifest, midiManifest] = await Promise.all([
    fetch('/rhythm/manifest.json', { signal }).then(r => r.json()),
    fetch('/midi/manifest.json', { signal }).then(r => r.json()),
  ]);

  const version = rhythmManifest.version || 0;
  const rhythmFiles: string[] = (rhythmManifest.rhythms || []).map((f: string) => `/rhythm/${f}`);
  const midiFiles: string[] = (midiManifest.files || []).map((f: string) => `/midi/${f}`);
  const allFiles = [...rhythmFiles, ...midiFiles];

  const total = allFiles.length;
  const failed: string[] = [];

  // 2. Baixa em paralelo limitado (4 por vez) — não trava o browser
  const CONCURRENT = 4;
  let cursor = 0;
  let done = 0;

  async function downloadOne(url: string): Promise<void> {
    try {
      // Cache-first se já tiver no SW; senão baixa.
      // Encode URL pra evitar problemas com espaços/acentos
      const encoded = url.split('/').map(p => p.includes('.json') || p.includes('.wav') || p.includes('.mp3') ? encodeURIComponent(p) : p).join('/');
      const res = await fetch(encoded, { signal, cache: 'default' });
      if (!res.ok) {
        failed.push(url);
      } else {
        // Consome o body pra garantir que entrou no cache do SW
        await res.blob();
      }
    } catch {
      if (signal?.aborted) throw new Error('aborted');
      failed.push(url);
    } finally {
      done++;
      onProgress({
        current: done,
        total,
        currentFile: url.split('/').pop() || url,
        failed: [...failed],
      });
    }
  }

  // Worker pool
  const workers: Promise<void>[] = [];
  for (let i = 0; i < CONCURRENT; i++) {
    workers.push((async () => {
      while (cursor < allFiles.length) {
        if (signal?.aborted) return;
        const idx = cursor++;
        await downloadOne(allFiles[idx]);
      }
    })());
  }

  try {
    await Promise.all(workers);
  } catch (e) {
    if (signal?.aborted) {
      return { success: false, version, failed };
    }
    throw e;
  }

  // 3. Marca como ready (mesmo se algumas falharam — user pode tentar de novo)
  const success = failed.length === 0;
  if (success) {
    await markReady(version);
  }

  return { success, version, failed };
}
