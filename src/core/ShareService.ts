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

// Domínio real do produto — o link compartilhado é sempre esse.
const SHARE_DOMAIN = 'https://gdrums.com.br';

/** Link de compartilhamento: gdrums.com.br/?s=CÓDIGO. Usa a RAIZ (/), que
 *  sempre serve o app — não depende de rewrite de rota no Vercel (que engasga
 *  com caminho /CÓDIGO). O app lê o ?s= e importa. */
export function shortUrl(code: string): string {
  return `${SHARE_DOMAIN}/?s=${code}`;
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

/** Lê o código de compartilhamento da URL: primeiro do ?s= (raiz — o que
 *  usamos agora), e como fallback do caminho /CÓDIGO. null se não houver. */
export function readShareCodeFromPath(): string | null {
  try {
    const q = new URLSearchParams(location.search).get('s');
    if (q && /^\d{4,8}$/.test(q)) return q;
  } catch { /* noop */ }
  const m = location.pathname.match(/^\/(\d{4,8})\/?$/);
  return m ? m[1] : null;
}

/** Limpa o /r/CÓDIGO da barra de endereço (volta pra "/") sem recarregar. */
export function clearShareCodeFromPath(): void {
  try { history.replaceState(null, '', '/'); } catch { /* noop */ }
}

// ─── Comunidade (comunidade.gdrums.com.br) ─────────────────────────────
// Link de download da vitrine: gdrums.com.br/?c=CÓDIGO. O conteúdo lá é a
// RECEITA LEVE (ritmo-base + BPM + nome) — quem remonta é o app, carregando
// o ritmo da biblioteca local. Ver supabase/migrations/20260730_community*.

/** Receita leve publicada na comunidade. */
export interface CommunityRecipe {
  t: 'r' | 's';
  title: string;
  base?: string;
  bpm?: number;
  items?: Array<{ name: string; path?: string; base?: string; bpm?: number }>;
}

/** Lê o código da comunidade da URL (?c=CÓDIGO). null se não houver. */
export function readCommunityCodeFromPath(): string | null {
  try {
    const q = new URLSearchParams(location.search).get('c');
    if (q && /^\d{4,8}$/.test(q)) return q;
  } catch { /* noop */ }
  return null;
}

/** Busca a receita publicada na comunidade (e conta +1 download). */
export async function fetchCommunity(code: string): Promise<CommunityRecipe | null> {
  try {
    const { supabase } = await import('../auth/supabase');
    const { data, error } = await supabase.rpc('community_get', { p_code: code });
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    const p = row?.payload as CommunityRecipe | undefined;
    return (p && (p.t === 'r' || p.t === 's')) ? p : null;
  } catch {
    return null;
  }
}
