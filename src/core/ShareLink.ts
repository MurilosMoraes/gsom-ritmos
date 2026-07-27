// Compartilhamento de ritmos e repertórios via LINK auto-contido.
//
// PROTÓTIPO (Etapa 0 — sem backend): o link carrega o conteúdo INTEIRO
// embutido nele (base64 na URL, no fragmento #import=). Abrir o link em
// qualquer aparelho/conta reconstrói o ritmo/repertório localmente — sem
// tabela no Supabase, 100% reversível. Depois (Etapa 1) trocamos por um
// link curto com o payload no servidor.
//
// Repertório embute os ritmos PESSOAIS que ele referencia (senão chegaria
// quebrado na outra conta). Ritmos da biblioteca vão só pelo `path`.

export interface SharedRhythm {
  name: string;
  bpm: number;
  base?: string;      // base_rhythm_name
  data: any;          // rhythm_data (SavedProject) — clonado
}

export interface SharedSetlistItem {
  name: string;
  path: string;
  bpm?: number;
  base?: string;      // baseRhythmName
  k?: string;         // chave em `rhythms` quando é ritmo PESSOAL embutido
}

export interface SharePayload {
  v: 1;
  t: 'r' | 's';                       // rhythm | setlist
  title: string;
  // rhythm:
  bpm?: number;
  base?: string;
  data?: any;
  // setlist:
  items?: SharedSetlistItem[];
  rhythms?: Record<string, SharedRhythm>;
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

// base64 URL-safe com suporte a unicode (fallback sem compressão)
function b64EncodeUnicode(str: string): string {
  const b64 = btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64DecodeUnicode(b64url: string): string {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return decodeURIComponent(escape(atob(b64)));
}

// bytes <-> base64url
function bytesToB64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(s: string): Uint8Array {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// gzip via CompressionStream nativo (Chrome/Safari/Android modernos)
async function gzip(str: string): Promise<Uint8Array> {
  const cs = new (window as any).CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(new TextEncoder().encode(str));
  writer.close();
  const ab = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(ab);
}
async function gunzip(bytes: Uint8Array): Promise<string> {
  const ds = new (window as any).DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const ab = await new Response(ds.readable).arrayBuffer();
  return new TextDecoder().decode(ab);
}

/** Codifica o payload em string URL-safe. Comprime (gzip) quando o browser
 *  suporta — encurta MUITO o link. 1º char = modo: 'g' gzip, 'u' cru. */
async function encodeShare(payload: SharePayload): Promise<string> {
  const json = JSON.stringify(payload);
  if (typeof (window as any).CompressionStream !== 'undefined') {
    try {
      return 'g' + bytesToB64url(await gzip(json));
    } catch { /* cai pro cru */ }
  }
  return 'u' + b64EncodeUnicode(json);
}

async function decodeShare(s: string): Promise<SharePayload | null> {
  try {
    const mode = s[0];
    const body = s.slice(1);
    let json: string;
    if (mode === 'g') {
      if (typeof (window as any).DecompressionStream === 'undefined') return null;
      json = await gunzip(b64urlToBytes(body));
    } else {
      json = b64DecodeUnicode(body);
    }
    const p = JSON.parse(json);
    if (p && (p.t === 'r' || p.t === 's')) return p as SharePayload;
  } catch { /* link inválido */ }
  return null;
}

// ─── Montagem dos payloads ────────────────────────────────────────────

export function buildRhythmPayload(r: { name: string; bpm: number; base_rhythm_name?: string; rhythm_data: any }): SharePayload {
  return {
    v: 1,
    t: 'r',
    title: r.name,
    bpm: r.bpm,
    base: r.base_rhythm_name || undefined,
    data: clone(r.rhythm_data),
  };
}

/**
 * Monta o payload de um repertório embutindo os ritmos pessoais que ele usa.
 * @param getRhythm resolve um userRhythmId -> {name,bpm,base,data} ou null
 */
export function buildSetlistPayload(
  title: string,
  items: Array<{ name: string; path: string; userRhythmId?: string; baseRhythmName?: string; bpm?: number }>,
  getRhythm: (id: string) => { name: string; bpm: number; base_rhythm_name?: string; rhythm_data: any } | null | undefined,
): SharePayload {
  const rhythms: Record<string, SharedRhythm> = {};
  let n = 0;
  const outItems: SharedSetlistItem[] = items.map((it) => {
    if (it.userRhythmId) {
      const r = getRhythm(it.userRhythmId);
      if (r) {
        const k = 'r' + (n++);
        rhythms[k] = { name: r.name, bpm: r.bpm, base: r.base_rhythm_name || undefined, data: clone(r.rhythm_data) };
        return { name: it.name, path: it.path, bpm: it.bpm, base: it.baseRhythmName, k };
      }
      // ritmo pessoal não encontrado localmente — manda só a referência de nome/path
    }
    return { name: it.name, path: it.path, bpm: it.bpm, base: it.baseRhythmName };
  });
  return { v: 1, t: 's', title, items: outItems, rhythms };
}

// ─── Link ─────────────────────────────────────────────────────────────

export async function makeShareUrl(payload: SharePayload): Promise<string> {
  const encoded = await encodeShare(payload);
  return `${location.origin}/#import=${encoded}`;
}

/** Lê um payload de import da URL atual (#import=...). null se não houver. */
export async function readImportFromUrl(): Promise<SharePayload | null> {
  const h = location.hash || '';
  const m = h.match(/[#&]import=([^&]+)/);
  if (!m) return null;
  return decodeShare(m[1]);
}

/** Limpa o #import= da URL (sem recarregar). */
export function clearImportFromUrl(): void {
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch { /* noop */ }
}

// ─── Modal com o link gerado ──────────────────────────────────────────

export function showShareResultModal(url: string, title: string, typeLabel: string, testUrl?: string): void {
  const esc = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(2,2,12,0.85);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);z-index:100000;display:flex;align-items:center;justify-content:center;padding:1rem;';
  const waText = `Olha esse ${typeLabel.toLowerCase()} que separei no GDrums: ${title}\n${url}`;
  const waUrl = `https://wa.me/?text=${encodeURIComponent(waText)}`;
  overlay.innerHTML = `
    <div style="background:rgba(10,10,26,0.97);border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:1.5rem;max-width:420px;width:100%;">
      <h2 style="font-size:1.15rem;font-weight:700;color:#fff;margin:0 0 0.3rem;text-align:center;">Compartilhar</h2>
      <p style="font-size:0.78rem;color:rgba(255,255,255,0.4);text-align:center;margin:0 0 1.1rem;">${esc(typeLabel)}: <span style="color:rgba(0,212,255,0.85);font-weight:600;">${esc(title)}</span></p>
      <div style="background:rgba(0,212,255,0.05);border:1px solid rgba(0,212,255,0.2);border-radius:12px;padding:0.7rem 0.8rem;margin-bottom:0.85rem;">
        <div style="font-size:0.85rem;color:#fff;word-break:break-all;line-height:1.4;font-weight:600;">${esc(url)}</div>
      </div>
      ${testUrl ? `<div style="text-align:center;margin:0 0 0.9rem;"><a href="${esc(testUrl)}" style="font-size:0.72rem;color:rgba(0,212,255,0.75);text-decoration:underline;">testar aqui (abre no seu servidor local)</a></div>` : ''}
      <button id="shareWaBtn" style="width:100%;padding:0.8rem;border:none;border-radius:12px;background:linear-gradient(160deg,#25d366,#128c3e);color:#fff;font-size:0.92rem;font-weight:800;font-family:inherit;cursor:pointer;margin-bottom:0.6rem;display:flex;align-items:center;justify-content:center;gap:0.5rem;-webkit-text-stroke:0.6px rgba(0,0,0,0.7);text-stroke:0.6px rgba(0,0,0,0.7);paint-order:stroke fill;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.2-1.7-.9-2-1-.3-.1-.5-.2-.6.1-.2.3-.7.9-.8 1-.2.2-.3.2-.6.1-.3-.2-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5-.1-.2-.6-1.5-.9-2-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.3.3-1 .9-1 2.3s1 2.7 1.2 2.9c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.7-.7 2-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3zM12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.9-1.3A10 10 0 1 0 12 2z"/></svg>
        Mandar no WhatsApp
      </button>
      <button id="shareCopyBtn" style="width:100%;padding:0.72rem;border:none;border-radius:12px;background:rgba(0,150,255,0.15);border:1px solid rgba(0,150,255,0.35);color:#fff;font-size:0.88rem;font-weight:700;font-family:inherit;cursor:pointer;margin-bottom:0.6rem;">Copiar link</button>
      <button id="shareCloseBtn" style="width:100%;padding:0.65rem;border:none;border-radius:12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.6);font-size:0.85rem;font-weight:600;font-family:inherit;cursor:pointer;">Fechar</button>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = (): void => { overlay.remove(); (window as any).__refocusPedal?.(); };
  overlay.querySelector('#shareWaBtn')!.addEventListener('click', () => { window.open(waUrl, '_blank'); });
  const copyBtn = overlay.querySelector('#shareCopyBtn') as HTMLButtonElement;
  copyBtn.addEventListener('click', async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch { /* fallback abaixo */ }
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch { /* noop */ }
    }
    copyBtn.textContent = ok ? 'Copiado!' : 'Copie o link acima';
  });
  overlay.querySelector('#shareCloseBtn')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}
