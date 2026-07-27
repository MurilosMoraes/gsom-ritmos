// Link CURTO de compartilhamento (Etapa 1) — publica o payload no Supabase
// e devolve um código, gerando gdrums.com.br/r/CÓDIGO. A leitura é por RPC
// (get_shared), sem acesso direto à tabela. Se o backend não estiver
// disponível (SQL ainda não aplicado / offline), o chamador cai no link
// auto-contido do ShareLink como fallback.

import { supabase } from '../auth/supabase';
import type { SharePayload } from './ShareLink';

/** Publica o payload e retorna o CÓDIGO curto. Lança em erro. */
export async function publishShare(payload: SharePayload): Promise<string> {
  const type = payload.t === 'r' ? 'rhythm' : 'setlist';
  const { data, error } = await supabase.rpc('publish_share', {
    p_type: type,
    p_title: payload.title || '',
    p_payload: payload,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'string') throw new Error('sem_codigo');
  return data;
}

/** Busca o conteúdo de um código. null se não existe / inativo / erro. */
export async function fetchShare(code: string): Promise<SharePayload | null> {
  try {
    const { data, error } = await supabase.rpc('get_shared', { p_code: code });
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || !row.payload) return null;
    const p = row.payload as SharePayload;
    return (p && (p.t === 'r' || p.t === 's')) ? p : null;
  } catch {
    return null;
  }
}

// Domínio real do produto — o link compartilhado é sempre esse (você nunca
// manda um "localhost" pra alguém). Pra testar localmente, use localTestUrl().
const SHARE_DOMAIN = 'https://gdrums.com.br';

/** Link curto REAL: gdrums.com.br/CÓDIGO (sem /r/). */
export function shortUrl(code: string): string {
  return `${SHARE_DOMAIN}/${code}`;
}

/** Link equivalente no ORIGIN atual (localhost/IP) — pra testar aqui, já que
 *  a produção ainda não tem o recurso. undefined quando já é o domínio real. */
export function localTestUrl(code: string): string | undefined {
  if (location.origin === SHARE_DOMAIN) return undefined;
  return `${location.origin}/${code}`;
}

// ─── Link curto SEM backend (teste) ────────────────────────────────────
// Guarda o payload no localStorage sob um código numérico curto. O link fica
// /r/12345, mas SÓ abre no MESMO navegador/aparelho onde foi criado (o
// conteúdo mora local). Pra cross-device (celular) é preciso o backend (SQL).
const LOCAL_SHARES_KEY = 'gdrums-local-shares';

export function saveLocalShare(payload: SharePayload): string {
  let map: Record<string, SharePayload> = {};
  try { map = JSON.parse(localStorage.getItem(LOCAL_SHARES_KEY) || '{}'); } catch { map = {}; }
  let code = '';
  do { code = String(Math.floor(10000 + Math.random() * 90000)); } while (map[code]);
  map[code] = payload;
  // mantém só os últimos 30 pra não estourar o localStorage
  const keys = Object.keys(map);
  if (keys.length > 30) for (const k of keys.slice(0, keys.length - 30)) delete map[k];
  try { localStorage.setItem(LOCAL_SHARES_KEY, JSON.stringify(map)); } catch { /* cheio */ }
  return code;
}

export function getLocalShare(code: string): SharePayload | null {
  try {
    const map = JSON.parse(localStorage.getItem(LOCAL_SHARES_KEY) || '{}');
    const p = map[code];
    return (p && (p.t === 'r' || p.t === 's')) ? p : null;
  } catch { return null; }
}

/** Lê o código de compartilhamento do caminho atual (/CÓDIGO numérico). */
export function readShareCodeFromPath(): string | null {
  const m = location.pathname.match(/^\/(\d{4,8})\/?$/);
  return m ? m[1] : null;
}

/** Limpa o /r/CÓDIGO da barra de endereço (volta pra "/") sem recarregar. */
export function clearShareCodeFromPath(): void {
  try { history.replaceState(null, '', '/'); } catch { /* noop */ }
}
