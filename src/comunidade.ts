// ─────────────────────────────────────────────────────────────────────
// COMUNIDADE GDrums — site separado (comunidade.gdrums.com.br)
//
// Vitrine pública com abas (Ritmos / Repertórios), pesquisa por nome,
// filtro por ritmo, ordenação e curtidas. Publicar = colar o link de
// compartilhar do app (modal com passo a passo). O conteúdo publicado é a
// RECEITA LEVE (ritmo-base + BPM + nome) — a reconstrução acontece no app
// ao baixar (link /?c=CÓDIGO). Backend: 20260730_community.sql.
// ─────────────────────────────────────────────────────────────────────

import { supabase } from './auth/supabase';
import { fetchShare } from './core/ShareService';
import type { SharePayload } from './core/ShareLink';

// Em produção o site mora em comunidade.gdrums.com.br e o app em gdrums.com.br.
// Em túnel/local, os dois saem da MESMA origem — aí o "Baixar" tem que apontar
// pra origem atual, senão cairia no app publicado (sem as mudanças em teste).
const APP_ORIGIN = location.hostname.startsWith('comunidade.')
  ? 'https://gdrums.com.br'
  : location.origin;
const ID_KEY = 'gdrums-community-identity';
const LIKED_KEY = 'gdrums-community-liked';
const TOKENS_KEY = 'gdrums-community-tokens';   // code -> manage_token (dono)
const ADMIN_KEY = 'gdrums-community-admin';     // senha de admin conferida
const ADMIN_EMAILS = ['staner_bass7@hotmail.com'];

type Tab = 'rhythm' | 'setlist' | 'mine';
type Sort = 'recent' | 'likes';

let tab: Tab = 'rhythm';
let sort: Sort = 'recent';
let search = '';
let rhythmFilter = '';
let searchTimer = 0;
let loadSeq = 0; // ignora respostas atrasadas de buscas antigas
let page = 1;
const PER_PAGE = 10;

// ─── Helpers ───────────────────────────────────────────────────────────

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Extrai o código curto de um link colado: ?s=CÓDIGO, /r/CÓDIGO ou o código cru. */
function extractCode(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const q = s.match(/[?&]s=(\d{4,8})\b/);
  if (q) return q[1];
  const p = s.match(/\/(?:r\/)?(\d{4,8})\/?(?:[?#]|$)/);
  if (p) return p[1];
  if (/^\d{4,8}$/.test(s)) return s;
  return null;
}

interface Recipe {
  type: Tab;
  title: string;
  bpm: number | null;
  song_count: number | null;
  rhythms: string[];
  payload: any; // receita leve (sem o `data` pesado)
}

/** Nome do ritmo a partir do path da biblioteca ("/rhythm/Vaneira.json" -> "Vaneira"). */
function rhythmFromPath(path?: string): string | undefined {
  if (!path) return undefined;
  const file = path.split('/').pop() || '';
  const name = decodeURIComponent(file).replace(/\.json$/i, '').trim();
  return name || undefined;
}

/** Reduz o payload do app à receita leve + metadados pro card. */
function payloadToRecipe(p: SharePayload): Recipe | null {
  const title = (p.title || '').trim();
  if (!title) return null;

  if (p.t === 'r') {
    const base = p.base || '';
    return {
      type: 'rhythm',
      title,
      bpm: typeof p.bpm === 'number' ? p.bpm : null,
      song_count: null,
      rhythms: base ? [base] : [],
      payload: { t: 'r', title, base: base || undefined, bpm: p.bpm },
    };
  }

  if (p.t === 's') {
    const items = (p.items || []).map((it) => ({
      name: it.name,
      path: it.path || '',
      base: it.base || undefined,
      bpm: it.bpm,
    }));
    // Ritmo de cada item: o `base` (item pessoal, salvo em cima de um da
    // biblioteca) ou o nome do arquivo (item que veio direto da biblioteca).
    const rhythms = [...new Set(
      items.map((i) => i.base || rhythmFromPath(i.path)).filter(Boolean) as string[],
    )];
    return {
      type: 'setlist',
      title,
      bpm: null,
      song_count: items.length,
      rhythms,
      payload: { t: 's', title, items },
    };
  }

  return null;
}

// ─── Identidade (nome + e-mail, salvo pra sempre no aparelho) ──────────
// Não é autenticação: serve pra atribuir os posts e reconhecer quem é você.
// O selo de ADM é só visual — qualquer poder real de moderação tem que ser
// validado no servidor (ver nota no README da migration).

interface Identity { name: string; email: string; token?: string }

let me: Identity | null = null;
let idMode: 'signup' | 'login' = 'signup';

function loadIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(ID_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (v && typeof v.name === 'string' && typeof v.email === 'string' && v.name && v.email) {
      return { name: v.name, email: v.email, token: typeof v.token === 'string' ? v.token : undefined };
    }
  } catch { /* corrompido */ }
  return null;
}

function saveIdentity(id: Identity): void {
  try { localStorage.setItem(ID_KEY, JSON.stringify(id)); } catch { /* cheio */ }
}

/** Só é admin de verdade quando a senha foi conferida no servidor. O e-mail
 *  sozinho não vale nada (qualquer um digitaria). */
function adminSecret(): string | null {
  try { return localStorage.getItem(ADMIN_KEY); } catch { return null; }
}
function isAdmin(): boolean {
  return !!adminSecret();
}
function looksAdminEmail(email: string): boolean {
  return ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

/** Tokens de gerenciamento dos posts publicados NESTE navegador. */
function tokens(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(TOKENS_KEY) || '{}'); } catch { return {}; }
}
function saveToken(code: string, token: string): void {
  const t = tokens(); t[code] = token;
  try { localStorage.setItem(TOKENS_KEY, JSON.stringify(t)); } catch { /* cheio */ }
}
function tokenFor(code: string): string | undefined {
  return tokens()[code];
}

function renderIdentity(): void {
  const chip = $('meChip');
  $('usersBtn').style.display = isAdmin() ? 'inline-flex' : 'none';
  if (!me) { chip.style.display = 'none'; return; }
  $('meAvatar').textContent = me.name.trim().charAt(0) || '?';
  $('meName').textContent = me.name;
  $('meAdmin').style.display = isAdmin() ? 'inline-flex' : 'none';
  chip.style.display = 'inline-flex';
}

/** O campo de senha de admin só aparece quando o e-mail é o da equipe. */
function syncAdminField(): void {
  const email = $<HTMLInputElement>('idEmail').value;
  $('idAdminFld').style.display = looksAdminEmail(email) ? 'flex' : 'none';
}

function setIdMode(mode: 'signup' | 'login'): void {
  idMode = mode;
  const isSignup = mode === 'signup';
  $('idTabSignup').classList.toggle('on', isSignup);
  $('idTabLogin').classList.toggle('on', !isSignup);
  $('idNameFld').style.display = isSignup ? 'flex' : 'none';
  $('idBtn').textContent = isSignup ? 'Criar conta' : 'Entrar';
  $('idSub').textContent = isSignup
    ? 'Crie sua conta pra compartilhar e gerenciar seus posts.'
    : 'Entre com o e-mail e a senha que você cadastrou.';
  $<HTMLInputElement>('idPass').setAttribute('autocomplete', isSignup ? 'new-password' : 'current-password');
}

function openIdentity(editing = false): void {
  $('idMsg').textContent = '';
  $('idMsg').className = 'modal-msg';
  $<HTMLInputElement>('idName').value = me?.name || '';
  $<HTMLInputElement>('idEmail').value = me?.email || '';
  $<HTMLInputElement>('idPass').value = '';
  $<HTMLInputElement>('idSecret').value = adminSecret() || '';
  syncAdminField();
  setIdMode(me ? 'login' : 'signup');
  $('idTitle').textContent = editing ? 'Sua conta' : 'Bem-vindo à Comunidade';
  $('idCancel').style.display = editing && me ? 'block' : 'none';
  $('idModal').classList.add('open');
  window.setTimeout(() => $<HTMLInputElement>(idMode === 'signup' ? 'idName' : 'idEmail').focus(), 60);
}

const SIGNUP_ERRORS: Record<string, string> = {
  bad_email: 'Esse e-mail não parece válido.',
  bad_name: 'Escreve teu nome (pelo menos 2 letras).',
  weak_password: 'A senha precisa ter pelo menos 4 caracteres.',
  email_taken: 'Já existe conta com esse e-mail. Use "Já tenho conta".',
  bad_credentials: 'E-mail ou senha incorretos.',
};

async function submitIdentity(): Promise<void> {
  const name = $<HTMLInputElement>('idName').value.trim();
  const email = $<HTMLInputElement>('idEmail').value.trim().toLowerCase();
  const pass = $<HTMLInputElement>('idPass').value;
  const secret = $<HTMLInputElement>('idSecret').value;
  const btn = $<HTMLButtonElement>('idBtn');
  const msg = $('idMsg');
  const setErr = (t: string): void => { msg.textContent = t; msg.className = 'modal-msg err'; };

  if (idMode === 'signup' && name.length < 2) { setErr('Escreve teu nome (pelo menos 2 letras).'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { setErr('Esse e-mail não parece válido.'); return; }
  if (pass.length < 4) { setErr('A senha precisa ter pelo menos 4 caracteres.'); return; }

  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = idMode === 'signup' ? 'Criando...' : 'Entrando...';
  msg.textContent = ''; msg.className = 'modal-msg';

  try {
    const res = idMode === 'signup'
      ? await supabase.rpc('community_signup', { p_email: email, p_name: name, p_password: pass })
      : await supabase.rpc('community_login', { p_email: email, p_password: pass });

    const out = res.data as { ok?: boolean; token?: string; name?: string; error?: string } | null;
    if (res.error || !out?.ok) {
      setErr(SIGNUP_ERRORS[out?.error || ''] || 'Não consegui agora. Tenta de novo em instantes.');
      return;
    }

    // Senha de admin (opcional): confere no servidor antes de guardar.
    if (looksAdminEmail(email) && secret) {
      const chk = await supabase.rpc('community_admin_check', { p_secret: secret });
      if (chk.error || chk.data !== true) { setErr('Conta ok, mas a senha de admin está incorreta.'); }
      else { try { localStorage.setItem(ADMIN_KEY, secret); } catch { /* noop */ } }
    } else if (!looksAdminEmail(email)) {
      try { localStorage.removeItem(ADMIN_KEY); } catch { /* noop */ }
    }

    me = { name: out.name || name, email, token: out.token };
    saveIdentity(me);
    renderIdentity();
    $('idModal').classList.remove('open');
    if (tab === 'mine') void loadVitrine();
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// ─── Painel de usuários (admin) ────────────────────────────────────────

interface AdminUser {
  email: string; name: string; created_at: string;
  posts: number; downloads: number; likes_received: number;
}

async function openUsers(): Promise<void> {
  const secret = adminSecret();
  if (!secret) return;
  const list = $('uList');
  const msg = $('uMsg');
  msg.textContent = ''; msg.className = 'modal-msg';
  list.innerHTML = '<div class="empty" style="padding:1.5rem;">Carregando...</div>';
  $('usersModal').classList.add('open');

  const { data, error } = await supabase.rpc('community_admin_users', { p_secret: secret });
  const rows = (Array.isArray(data) ? data : []) as AdminUser[];
  if (error) {
    list.innerHTML = '<div class="empty" style="padding:1.5rem;">Não consegui carregar.</div>';
    return;
  }
  if (rows.length === 0) {
    list.innerHTML = '<div class="empty" style="padding:1.5rem;">Ninguém se cadastrou ainda.</div>';
    $('uTitle').textContent = 'Usuários da comunidade';
    return;
  }

  const totalPosts = rows.reduce((s, r) => s + Number(r.posts || 0), 0);
  const totalDl = rows.reduce((s, r) => s + Number(r.downloads || 0), 0);
  $('uTitle').textContent = `${rows.length} ${rows.length === 1 ? 'cadastro' : 'cadastros'} · ${totalPosts} compartilhados · ${totalDl} baixados`;

  list.innerHTML = '';
  for (const u of rows) {
    const row = document.createElement('div');
    row.className = 'u-row';
    row.innerHTML = `
      <div class="u-info">
        <div class="u-name">${esc(u.name)}</div>
        <div class="u-mail">${esc(u.email)}</div>
        <div class="u-mail">${u.posts} compartilhado${Number(u.posts) === 1 ? '' : 's'} &middot; ${u.downloads} baixado${Number(u.downloads) === 1 ? '' : 's'} &middot; ${u.likes_received} curtida${Number(u.likes_received) === 1 ? '' : 's'}</div>
      </div>
      <button class="u-reset" type="button">Nova senha</button>
    `;
    row.querySelector('.u-reset')!.addEventListener('click', () => { void resetPassword(u.email); });
    list.appendChild(row);
  }
}

/** Redefine a senha de alguém que esqueceu (a antiga é ilegível, por design). */
async function resetPassword(email: string): Promise<void> {
  const secret = adminSecret();
  if (!secret) return;
  const nova = window.prompt(`Nova senha para ${email}:`, '');
  if (nova === null) return;
  const msg = $('uMsg');
  if (nova.trim().length < 4) {
    msg.textContent = 'A senha precisa ter pelo menos 4 caracteres.';
    msg.className = 'modal-msg err';
    return;
  }
  const { data, error } = await supabase.rpc('community_admin_set_password', {
    p_secret: secret, p_email: email, p_new_password: nova,
  });
  if (error || data !== true) {
    msg.textContent = 'Não consegui redefinir. Tenta de novo.';
    msg.className = 'modal-msg err';
    return;
  }
  msg.textContent = `Senha de ${email} redefinida. Passe a nova senha pra pessoa.`;
  msg.className = 'modal-msg';
}

// ─── Curtidas (1x por navegador, localStorage) ─────────────────────────

function likedSet(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(LIKED_KEY) || '[]')); }
  catch { return new Set(); }
}
function markLiked(code: string): void {
  const s = likedSet(); s.add(code);
  try { localStorage.setItem(LIKED_KEY, JSON.stringify([...s])); } catch { /* cheio */ }
}

/** Conta o download na conta de quem está logado (silencioso se não estiver). */
function trackDownload(): void {
  if (!me?.token) return;
  void supabase.rpc('community_track_download', { p_token: me.token });
}

async function like(code: string, btn: HTMLButtonElement, countEl: HTMLElement): Promise<void> {
  if (likedSet().has(code)) return;
  btn.disabled = true;
  const { data, error } = await supabase.rpc('community_like', { p_code: code });
  if (!error) {
    markLiked(code);
    btn.classList.add('liked');
    if (typeof data === 'number') countEl.textContent = String(data);
  } else {
    btn.disabled = false;
  }
}

// ─── Stats do hero ─────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.', ',') + ' mil';
  return String(n);
}

async function loadStats(): Promise<void> {
  const { data, error } = await supabase.rpc('community_stats');
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return; // sem stats, o hero fica sem os chips (sem erro visível)
  $('stRhythms').textContent = fmt(Number(row.rhythm_count) || 0);
  $('stSetlists').textContent = fmt(Number(row.setlist_count) || 0);
  $('stDownloads').textContent = fmt(Number(row.downloads) || 0);
  $('stats').style.display = 'flex';
}

// ─── Filtro de ritmos (por aba) ────────────────────────────────────────

async function loadRhythmOptions(): Promise<void> {
  const sel = $<HTMLSelectElement>('fRhythm');
  const { data } = await supabase.rpc('community_rhythms', { p_type: tab });
  const rows = (Array.isArray(data) ? data : []) as Array<{ rhythm: string; n: number }>;
  const keep = rhythmFilter;
  sel.innerHTML = '<option value="">Todos os ritmos</option>' +
    rows.map((r) => `<option value="${esc(r.rhythm)}">${esc(r.rhythm)} (${r.n})</option>`).join('');
  sel.value = rows.some((r) => r.rhythm === keep) ? keep : '';
  rhythmFilter = sel.value;
}

// ─── Vitrine ───────────────────────────────────────────────────────────

interface CommunityRow {
  code: string; type: Tab; title: string;
  bpm: number | null; song_count: number | null; rhythms: string[];
  poster_name: string; likes: number; downloads: number; created_at: string;
  official?: boolean;
}

const SEAL_HTML = '<span class="seal" title="Equipe GDrums"><img src="/img/logo.png" alt="" /><span>GDrums</span></span>';

const HEART_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
const DL_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

function renderCard(r: CommunityRow): HTMLElement {
  const el = document.createElement('div');
  el.className = 'card';
  const isSet = r.type === 'setlist';
  const already = likedSet().has(r.code);
  const rhythmLabel = r.rhythms.length
    ? (r.rhythms.length === 1 ? r.rhythms[0] : `${r.rhythms[0]} +${r.rhythms.length - 1}`)
    : '';
  // Tudo que é curto vai pra MESMA linha do topo (tipo, ritmo, bpm/músicas,
  // downloads) — o card fica mais baixo e aproveita a largura que sobrava.
  const meta = isSet
    ? `${r.song_count ?? 0} ${r.song_count === 1 ? 'música' : 'músicas'}`
    : (r.bpm ? `${r.bpm} BPM` : '');

  el.innerHTML = `
    <div class="card-top">
      <span class="pill ${isSet ? 'setlist' : 'rhythm'}">${isSet ? 'Repertório' : 'Ritmo'}</span>
      ${rhythmLabel ? `<span class="chip">${esc(rhythmLabel)}</span>` : ''}
      ${meta ? `<span class="card-meta">${esc(meta)}</span>` : ''}
      ${r.downloads > 0 ? `<span class="card-meta">${r.downloads} ${r.downloads === 1 ? 'download' : 'downloads'}</span>` : ''}
    </div>
    <div class="card-title">${esc(r.title)}</div>
    <div class="card-foot">
      <span class="card-poster">por <b>${esc(r.poster_name)}</b>${r.official ? ` ${SEAL_HTML}` : ''}</span>
      <span class="card-btns">
        <button class="like ${already ? 'liked' : ''}" type="button" ${already ? 'disabled' : ''} aria-label="Curtir">
          ${HEART_SVG} <span class="like-n">${r.likes}</span>
        </button>
        <a class="dl-btn" href="${APP_ORIGIN}/?c=${encodeURIComponent(r.code)}">${DL_SVG} Baixar</a>
      </span>
    </div>
  `;

  const likeBtn = el.querySelector('.like') as HTMLButtonElement;
  const countEl = el.querySelector('.like-n') as HTMLElement;
  likeBtn.addEventListener('click', (e) => { e.stopPropagation(); void like(r.code, likeBtn, countEl); });
  el.querySelector('.dl-btn')!.addEventListener('click', (e) => { e.stopPropagation(); trackDownload(); });
  // Clique no card (fora dos botões) abre os detalhes
  el.addEventListener('click', () => { void openDetail(r.code); });
  return el;
}

function renderSkeleton(grid: HTMLElement): void {
  grid.innerHTML = '';
  for (let i = 0; i < 8; i++) {
    const sk = document.createElement('div');
    sk.className = 'sk';
    sk.innerHTML = '<div class="l1"></div><div class="l2"></div><div class="l3"></div><div class="l4"></div>';
    grid.appendChild(sk);
  }
}


/** Desenha o seletor de páginas (nos dois lugares: topo e rodapé). */
function renderPager(total: number): void {
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const alvos = [$('pagerTop'), $('pagerBottom')];

  if (pages <= 1) {
    alvos.forEach((el) => { el.classList.remove('on'); el.innerHTML = ''; });
    return;
  }

  // Janela de páginas: com muitas, mostra as vizinhas + primeira/última
  // com reticências, senão a barra estoura a largura da tela no celular.
  const nums: (number | '...')[] = [];
  const push = (n: number | '...'): void => { if (nums[nums.length - 1] !== n) nums.push(n); };
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) push(i);
    else push('...');
  }

  const html = [
    `<button type="button" data-go="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="Página anterior">‹</button>`,
    ...nums.map((n) => n === '...'
      ? '<span class="pager-gap">…</span>'
      : `<button type="button" data-go="${n}" class="${n === page ? 'on' : ''}" aria-label="Página ${n}"${n === page ? ' aria-current="page"' : ''}>${n}</button>`),
    `<button type="button" data-go="${page + 1}" ${page === pages ? 'disabled' : ''} aria-label="Próxima página">›</button>`,
    `<span class="pager-info">${total} ${total === 1 ? 'item' : 'itens'}</span>`,
  ].join('');

  alvos.forEach((el) => {
    el.classList.add('on');
    el.innerHTML = html;
    el.querySelectorAll<HTMLButtonElement>('button[data-go]').forEach((b) => {
      b.addEventListener('click', () => {
        const alvo = parseInt(b.dataset.go || '1', 10);
        if (alvo < 1 || alvo > pages || alvo === page) return;
        page = alvo;
        void loadVitrine();
        // Volta pro topo da lista: sem isso, clicar no seletor de baixo
        // deixa a pessoa olhando o rodapé da página nova.
        $('grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  });
}

async function loadVitrine(withSkeleton = true): Promise<void> {
  const seq = ++loadSeq;
  const grid = $('grid');
  if (withSkeleton) renderSkeleton(grid);

  let rows: CommunityRow[] = [];
  let total = 0;
  let error: unknown = null;

  if (tab === 'mine') {
    // "Meus posts" vem inteiro (a RPC já limita a 60) e pagina no cliente.
    const res = await supabase.rpc('community_mine', { p_email: me?.email || '' });
    if (seq !== loadSeq) return;
    error = res.error;
    let todos = (Array.isArray(res.data) ? res.data : []) as CommunityRow[];
    if (search) {
      const q = search.toLowerCase();
      todos = todos.filter((r) => r.title.toLowerCase().includes(q));
    }
    total = todos.length;
    rows = todos.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  } else {
    // Vitrine: pagina no SERVIDOR (só os 10 da página vêm pela rede).
    // A contagem usa os MESMOS filtros, senão o seletor ofereceria páginas
    // que não existem no resultado filtrado.
    const filtros = { p_rhythm: rhythmFilter || null, p_type: tab, p_search: search || null };
    const [lista, cont] = await Promise.all([
      supabase.rpc('community_list', {
        ...filtros, p_limit: PER_PAGE, p_offset: (page - 1) * PER_PAGE, p_sort: sort,
      }),
      supabase.rpc('community_count', filtros),
    ]);
    if (seq !== loadSeq) return; // busca mais nova já assumiu
    error = lista.error;
    rows = (Array.isArray(lista.data) ? lista.data : []) as CommunityRow[];
    total = cont.error ? rows.length : Number(cont.data) || 0;
  }

  grid.innerHTML = '';
  renderPager(error ? 0 : total);

  if (error || rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    if (error) {
      empty.innerHTML = '<b>Não consegui carregar a vitrine</b>Tenta recarregar a página em instantes.';
    } else if (tab === 'mine') {
      empty.innerHTML = search
        ? '<b>Nada por aqui</b>Nenhum post seu bate com essa busca.'
        : '<b>Você ainda não postou nada</b>Compartilhe um ritmo ou repertório e ele aparece aqui.';
    } else {
      const label = tab === 'rhythm' ? 'ritmo' : 'repertório';
      empty.innerHTML = (search || rhythmFilter)
        ? `<b>Nada por aqui</b>Nenhum ${label} bate com essa busca. Tenta outro nome ou limpa o filtro.`
        : `<b>Seja o primeiro!</b>Ainda não tem nenhum ${label} na comunidade. Compartilhe o seu no botão ali em cima.`;
    }
    grid.appendChild(empty);
    return;
  }
  for (const r of rows) grid.appendChild(renderCard(r));
}

// ─── Detalhes do post ──────────────────────────────────────────────────

interface DetailRow extends CommunityRow { payload: any }
let detailCode = '';

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return ''; }
}

function fact(value: string, label: string): string {
  return `<div class="d-fact"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
}

async function openDetail(code: string): Promise<void> {
  detailCode = code;
  const msg = $('dMsg');
  msg.textContent = ''; msg.className = 'modal-msg';
  $('dDelete').style.display = 'none';
  $('dSongsWrap').style.display = 'none';
  $('dTitle').textContent = 'Carregando...';
  $('dPoster').textContent = '';
  $('dFacts').innerHTML = '';
  $('dSeal').innerHTML = '';
  $('detailModal').classList.add('open');

  const { data, error } = await supabase.rpc('community_detail', { p_code: code });
  const r = (Array.isArray(data) ? data[0] : data) as DetailRow | undefined;
  if (error || !r) {
    $('dTitle').textContent = 'Não encontrado';
    $('dPoster').textContent = 'Esse post não está mais disponível.';
    return;
  }

  const isSet = r.type === 'setlist';
  $('dPill').className = `pill ${isSet ? 'setlist' : 'rhythm'}`;
  $('dPill').textContent = isSet ? 'Repertório' : 'Ritmo';
  $('dSeal').innerHTML = r.official ? SEAL_HTML : '';
  $('dTitle').textContent = r.title;
  $('dPoster').innerHTML = `por <b>${esc(r.poster_name)}</b> &middot; ${esc(fmtDate(r.created_at))}`;

  const facts: string[] = [];
  if (isSet) facts.push(fact(String(r.song_count ?? 0), r.song_count === 1 ? 'música' : 'músicas'));
  else if (r.bpm) facts.push(fact(String(r.bpm), 'BPM'));
  if (r.rhythms?.length) {
    facts.push(fact(
      r.rhythms.length === 1 ? r.rhythms[0] : `${r.rhythms.length}`,
      r.rhythms.length === 1 ? 'ritmo' : 'ritmos',
    ));
  }
  facts.push(fact(String(r.likes), r.likes === 1 ? 'curtida' : 'curtidas'));
  facts.push(fact(String(r.downloads), r.downloads === 1 ? 'download' : 'downloads'));
  $('dFacts').innerHTML = facts.join('');

  // Repertório: lista as músicas (vem da receita leve no payload)
  const items = Array.isArray(r.payload?.items) ? r.payload.items : [];
  if (isSet && items.length) {
    $('dSongs').innerHTML = items.map((it: any) => {
      const rhythm = it.base || rhythmFromPath(it.path) || '';
      const bits = [rhythm, it.bpm ? `${it.bpm} BPM` : ''].filter(Boolean).join(' · ');
      return `<li><span class="d-song-name">${esc(it.name || 'Sem nome')}</span>${bits ? `<span class="d-song-meta">${esc(bits)}</span>` : ''}</li>`;
    }).join('');
    $('dSongsWrap').style.display = 'block';
  }

  $<HTMLAnchorElement>('dDownload').href = `${APP_ORIGIN}/?c=${encodeURIComponent(r.code)}`;

  // Excluir: autor logado (sessão), dono do navegador (manage_token) ou admin
  const isMinePost = !!me?.token && r.poster_name === me.name;
  const canDelete = isMinePost || !!tokenFor(r.code) || isAdmin();
  const delBtn = $<HTMLButtonElement>('dDelete');
  delBtn.style.display = canDelete ? 'block' : 'none';
  delBtn.disabled = false;
  delBtn.classList.remove('confirming');
  delBtn.textContent = 'Excluir da comunidade';
  delete delBtn.dataset.confirming;
}

/** Excluir com dupla confirmação (1º clique pergunta, 2º apaga). */
async function deleteDetail(): Promise<void> {
  const btn = $<HTMLButtonElement>('dDelete');
  const msg = $('dMsg');

  if (!btn.dataset.confirming) {
    btn.dataset.confirming = '1';
    btn.classList.add('confirming');
    btn.textContent = 'Tem certeza? Clique de novo';
    window.setTimeout(() => {
      if (!btn.dataset.confirming) return;
      delete btn.dataset.confirming;
      btn.classList.remove('confirming');
      btn.textContent = 'Excluir da comunidade';
    }, 4000);
    return;
  }

  delete btn.dataset.confirming;
  btn.disabled = true;
  btn.textContent = 'Excluindo...';
  msg.textContent = ''; msg.className = 'modal-msg';

  // Tenta na ordem: sessão (funciona em qualquer aparelho) -> chave do post
  // guardada neste navegador -> poder de admin.
  const token = tokenFor(detailCode);
  const secret = adminSecret();
  let res = me?.token
    ? await supabase.rpc('community_delete_session', { p_code: detailCode, p_token: me.token })
    : { data: false, error: null as any };
  if (res.data !== true && token) {
    res = await supabase.rpc('community_delete', { p_code: detailCode, p_token: token });
  }
  if (res.data !== true && secret) {
    res = await supabase.rpc('community_delete_admin', { p_code: detailCode, p_secret: secret });
  }

  if (res.error || res.data !== true) {
    btn.disabled = false;
    btn.classList.remove('confirming');
    btn.textContent = 'Excluir da comunidade';
    msg.textContent = 'Não consegui excluir. Recarrega a página e tenta de novo.';
    msg.className = 'modal-msg err';
    return;
  }

  $('detailModal').classList.remove('open');
  void loadStats();
  void loadRhythmOptions();
  void loadVitrine();
}

// ─── Abas / ordenação / busca ──────────────────────────────────────────

function setTab(next: Tab): void {
  if (tab === next) return;
  if (next === 'mine' && !me) { openIdentity(); return; }
  tab = next;
  page = 1;
  for (const [id, val] of [['tabRhythm', 'rhythm'], ['tabSetlist', 'setlist'], ['tabMine', 'mine']] as const) {
    $(id).classList.toggle('on', tab === val);
    $(id).setAttribute('aria-selected', String(tab === val));
  }
  $<HTMLInputElement>('qSearch').placeholder =
    tab === 'rhythm' ? 'Pesquisar ritmo pelo nome'
      : tab === 'setlist' ? 'Pesquisar repertório pelo nome'
        : 'Pesquisar nos seus posts';
  $('shareCta').lastChild!.textContent = tab === 'setlist' ? ' Compartilhar repertório' : ' Compartilhar ritmo';
  // Em "Meus posts" não faz sentido filtrar por ritmo nem ordenar por curtidas
  const isMine = tab === 'mine';
  $('fRhythm').style.display = isMine ? 'none' : '';
  ($('sRecent').parentElement as HTMLElement).style.display = isMine ? 'none' : '';
  if (isMine) rhythmFilter = '';
  else void loadRhythmOptions();
  void loadVitrine();
}

function setSort(next: Sort): void {
  if (sort === next) return;
  sort = next;
  page = 1;
  $('sRecent').classList.toggle('on', sort === 'recent');
  $('sLikes').classList.toggle('on', sort === 'likes');
  void loadVitrine();
}

// ─── Modal de compartilhar ─────────────────────────────────────────────

function openModal(): void {
  if (!me) { openIdentity(); return; } // sem identidade, pede primeiro
  $('shareForm').style.display = 'block';
  $('shareSuccess').classList.remove('show');
  $('pMsg').textContent = '';
  $('pMsg').className = 'modal-msg';
  $('postAs').textContent = me.name;
  $('shareModal').classList.add('open');
  window.setTimeout(() => $<HTMLInputElement>('pLink').focus(), 60);
}

function closeModal(): void {
  $('shareModal').classList.remove('open');
}

async function publish(): Promise<void> {
  if (!me) { openIdentity(); return; }
  const linkEl = $<HTMLInputElement>('pLink');
  const btn = $<HTMLButtonElement>('pBtn');
  const msg = $('pMsg');

  const code = extractCode(linkEl.value);

  const setErr = (text: string): void => { msg.textContent = text; msg.className = 'modal-msg err'; };

  if (!code) { setErr('Link inválido. Cole o link de compartilhar do app (ex: gdrums.com.br/?s=123456).'); return; }

  btn.disabled = true;
  const oldLabel = btn.textContent;
  btn.textContent = 'Publicando...';
  msg.textContent = ''; msg.className = 'modal-msg';

  try {
    const payload = await fetchShare(code);
    if (!payload) {
      setErr('Não achei esse link. Confere se copiou certo e se compartilhou pela versão nova do app.');
      return;
    }
    const recipe = payloadToRecipe(payload);
    if (!recipe) { setErr('Esse conteúdo não pôde ser lido.'); return; }

    const { data, error } = await supabase.rpc('community_publish', {
      p_type: recipe.type,
      p_title: recipe.title,
      p_bpm: recipe.bpm,
      p_song_count: recipe.song_count,
      p_rhythms: recipe.rhythms,
      p_poster_name: me.name,
      p_poster_email: me.email,
      p_payload: recipe.payload,
    });
    if (error) { setErr('Deu um erro ao publicar. Tenta de novo em instantes.'); return; }

    // Guarda a chave secreta do post: é ela que permite excluir depois.
    const created = (Array.isArray(data) ? data[0] : data) as { code?: string; token?: string } | null;
    if (created?.code && created?.token) saveToken(created.code, created.token);

    linkEl.value = '';

    // sucesso: troca a vista do modal e recarrega a vitrine na aba certa
    $('successText').textContent = recipe.type === 'rhythm'
      ? 'Seu ritmo já está na vitrine da comunidade.'
      : 'Seu repertório já está na vitrine da comunidade.';
    $('shareForm').style.display = 'none';
    $('shareSuccess').classList.add('show');

    if (recipe.type !== tab) setTab(recipe.type);
    else { void loadRhythmOptions(); void loadVitrine(); }
    sort = 'recent';
    $('sRecent').classList.add('on');
    $('sLikes').classList.remove('on');
    void loadStats();
  } catch {
    setErr('Deu um erro inesperado. Tenta de novo.');
  } finally {
    btn.disabled = false;
    btn.textContent = oldLabel;
  }
}

// ─── Init ──────────────────────────────────────────────────────────────

function init(): void {
  $('tabRhythm').addEventListener('click', () => setTab('rhythm'));
  $('tabSetlist').addEventListener('click', () => setTab('setlist'));
  $('tabMine').addEventListener('click', () => setTab('mine'));
  $('sRecent').addEventListener('click', () => setSort('recent'));
  $('sLikes').addEventListener('click', () => setSort('likes'));

  // Busca: nasce readonly (anti-autofill) e destrava no 1º toque do usuário.
  const qEl = $<HTMLInputElement>('qSearch');
  const unlockSearch = (): void => {
    if (!qEl.hasAttribute('readonly')) return;
    qEl.removeAttribute('readonly');
    qEl.value = ''; // limpa qualquer coisa que o navegador tenha enfiado
  };
  for (const ev of ['focus', 'pointerdown', 'touchstart', 'keydown']) {
    qEl.addEventListener(ev, unlockSearch);
  }
  // Enter nos forms não pode recarregar a página
  for (const f of ['idForm']) {
    $(f).addEventListener('submit', (e) => e.preventDefault());
  }
  (qEl.form as HTMLFormElement | null)?.addEventListener('submit', (e) => e.preventDefault());

  qEl.addEventListener('input', (e) => {
    search = (e.target as HTMLInputElement).value.trim();
    page = 1;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => { void loadVitrine(false); }, 300);
  });

  $<HTMLSelectElement>('fRhythm').addEventListener('change', (e) => {
    rhythmFilter = (e.target as HTMLSelectElement).value;
    page = 1;
    void loadVitrine();
  });

  $('shareCta').addEventListener('click', openModal);
  $('pCancel').addEventListener('click', closeModal);
  $('pDone').addEventListener('click', closeModal);
  $('pBtn').addEventListener('click', publish);
  $('shareModal').addEventListener('click', (e) => { if (e.target === $('shareModal')) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeModal();
    $('detailModal').classList.remove('open');
    $('usersModal').classList.remove('open');
    if (me) $('idModal').classList.remove('open'); // sem conta, o modal fica
  });
  $<HTMLInputElement>('pLink').addEventListener('keydown', (e) => { if (e.key === 'Enter') void publish(); });

  // Detalhes do post
  $('dClose').addEventListener('click', () => $('detailModal').classList.remove('open'));
  $('dDelete').addEventListener('click', () => { void deleteDetail(); });
  $('detailModal').addEventListener('click', (e) => {
    if (e.target === $('detailModal')) $('detailModal').classList.remove('open');
  });

  // Identidade: pede no 1º acesso, depois fica salva. O chip abre pra editar.
  $('idBtn').addEventListener('click', () => { void submitIdentity(); });
  $('idCancel').addEventListener('click', () => { if (me) $('idModal').classList.remove('open'); });
  $('meChip').addEventListener('click', () => openIdentity(true));
  $<HTMLInputElement>('idEmail').addEventListener('input', syncAdminField);
  $('idTabSignup').addEventListener('click', () => setIdMode('signup'));
  $('idTabLogin').addEventListener('click', () => setIdMode('login'));
  for (const f of ['idName', 'idEmail', 'idPass', 'idSecret']) {
    $<HTMLInputElement>(f).addEventListener('keydown', (e) => { if (e.key === 'Enter') void submitIdentity(); });
  }

  // Painel de usuários (admin)
  $('usersBtn').addEventListener('click', () => { void openUsers(); });
  $('uClose').addEventListener('click', () => $('usersModal').classList.remove('open'));
  $('usersModal').addEventListener('click', (e) => {
    if (e.target === $('usersModal')) $('usersModal').classList.remove('open');
  });
  me = loadIdentity();
  if (me) renderIdentity();
  else openIdentity();

  void loadStats();
  void loadRhythmOptions();
  void loadVitrine();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
