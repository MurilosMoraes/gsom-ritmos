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

/** Monta a URL curta a partir do código. */
export function shortUrl(code: string): string {
  return `${location.origin}/r/${code}`;
}

/** Lê o código de compartilhamento do caminho atual (/r/CÓDIGO). null se não. */
export function readShareCodeFromPath(): string | null {
  const m = location.pathname.match(/^\/r\/([A-Za-z0-9]{4,16})\/?$/);
  return m ? m[1] : null;
}

/** Limpa o /r/CÓDIGO da barra de endereço (volta pra "/") sem recarregar. */
export function clearShareCodeFromPath(): void {
  try { history.replaceState(null, '', '/'); } catch { /* noop */ }
}
