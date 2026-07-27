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

// base64 URL-safe com suporte a unicode
function b64EncodeUnicode(str: string): string {
  const b64 = btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64DecodeUnicode(b64url: string): string {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return decodeURIComponent(escape(atob(b64)));
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

export function makeShareUrl(payload: SharePayload): string {
  const encoded = b64EncodeUnicode(JSON.stringify(payload));
  return `${location.origin}/#import=${encoded}`;
}

/** Lê um payload de import da URL atual (#import=...). null se não houver. */
export function readImportFromUrl(): SharePayload | null {
  try {
    const h = location.hash || '';
    const m = h.match(/[#&]import=([^&]+)/);
    if (!m) return null;
    const payload = JSON.parse(b64DecodeUnicode(m[1]));
    if (payload && (payload.t === 'r' || payload.t === 's')) return payload as SharePayload;
  } catch { /* link inválido */ }
  return null;
}

/** Limpa o #import= da URL (sem recarregar). */
export function clearImportFromUrl(): void {
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch { /* noop */ }
}

// ─── Modal com o link gerado ──────────────────────────────────────────

export function showShareResultModal(url: string, title: string, typeLabel: string): void {
  const esc = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(2,2,12,0.85);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);z-index:100000;display:flex;align-items:center;justify-content:center;padding:1rem;';
  const tooLong = url.length > 8000;
  overlay.innerHTML = `
    <div style="background:rgba(10,10,26,0.97);border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:1.5rem;max-width:440px;width:100%;">
      <h2 style="font-size:1.15rem;font-weight:700;color:#fff;margin:0 0 0.3rem;text-align:center;">Compartilhar</h2>
      <p style="font-size:0.78rem;color:rgba(255,255,255,0.4);text-align:center;margin:0 0 1.1rem;">${esc(typeLabel)}: <span style="color:rgba(0,212,255,0.85);font-weight:600;">${esc(title)}</span></p>
      <div style="background:rgba(0,212,255,0.05);border:1px solid rgba(0,212,255,0.2);border-radius:12px;padding:0.75rem;margin-bottom:0.9rem;">
        <div style="font-size:0.7rem;color:rgba(255,255,255,0.65);word-break:break-all;line-height:1.5;max-height:120px;overflow-y:auto;">${esc(url)}</div>
      </div>
      ${tooLong ? `<p style="font-size:0.72rem;color:rgba(249,160,60,0.9);text-align:center;margin:0 0 0.9rem;">⚠️ Link grande (repertório extenso). Funciona, mas o link curto (com servidor) vem na próxima etapa.</p>` : ''}
      <button id="shareCopyBtn" style="width:100%;padding:0.75rem;border:none;border-radius:12px;background:linear-gradient(160deg,rgba(0,150,255,0.95),rgba(0,90,200,0.95));color:#fff;font-size:0.9rem;font-weight:700;font-family:inherit;cursor:pointer;margin-bottom:0.6rem;">Copiar link</button>
      <button id="shareCloseBtn" style="width:100%;padding:0.65rem;border:none;border-radius:12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.6);font-size:0.85rem;font-weight:600;font-family:inherit;cursor:pointer;">Fechar</button>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = (): void => { overlay.remove(); (window as any).__refocusPedal?.(); };
  const copyBtn = overlay.querySelector('#shareCopyBtn') as HTMLButtonElement;
  copyBtn.addEventListener('click', async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch { /* fallback abaixo */ }
    if (!ok) {
      // fallback: seleciona um textarea temporário
      try {
        const ta = document.createElement('textarea');
        ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch { /* noop */ }
    }
    copyBtn.textContent = ok ? 'Copiado! ✓' : 'Copie manualmente acima';
    copyBtn.style.background = ok ? 'linear-gradient(160deg,rgba(22,163,74,0.95),rgba(21,128,61,0.95))' : copyBtn.style.background;
  });
  overlay.querySelector('#shareCloseBtn')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}
