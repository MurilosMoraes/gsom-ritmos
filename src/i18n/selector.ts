// Seletor de idioma COMPARTILHADO (menu do app + páginas de auth).
//
// A escolha é GLOBAL por construção: setLocale persiste em
// localStorage['gdrums-locale'], que TODAS as páginas leem no boot —
// trocar no login vale pro app inteiro e vice-versa.
//
// Bandeiras em SVG inline: emoji de bandeira NÃO renderiza no Windows
// (vira "BR"/"US"); SVG desenhado aparece em qualquer plataforma.
// Nomes de idioma NUNCA traduzem (cada um na própria língua — padrão
// universal de UX).

import { t, getLocale, setLocale } from './index';

export function flagSvg(code: string, size: number = 22): string {
  const h = Math.round(size * 16 / 22);
  const base = `width="${size}" height="${h}" viewBox="0 0 22 16" style="border-radius:2.5px;flex-shrink:0;vertical-align:-2px;"`;
  switch (code) {
    case 'pt-BR': return `<svg ${base}><rect width="22" height="16" fill="#009C3B"/><path d="M11 2 L20 8 L11 14 L2 8 Z" fill="#FFDF00"/><circle cx="11" cy="8" r="3.4" fill="#002776"/><path d="M7.8 7.4 Q11 6.2 14.2 8.2" stroke="#fff" stroke-width="0.9" fill="none"/></svg>`;
    // Bandeira da ESPANHA (pedido do Murilo: mais reconhecível que a do
    // México na versão simplificada) — o idioma segue sendo es-419
    // (espanhol latino neutro), só o ícone é o da Espanha.
    case 'es-419': return `<svg ${base}><rect width="22" height="16" fill="#AA151B"/><rect y="4" width="22" height="8" fill="#F1BF00"/></svg>`;
    case 'en': return `<svg ${base}><rect width="22" height="16" fill="#fff"/><g fill="#B22234"><rect y="0" width="22" height="2.3"/><rect y="4.6" width="22" height="2.3"/><rect y="9.2" width="22" height="2.3"/><rect y="13.8" width="22" height="2.2"/></g><rect width="9.5" height="8" fill="#3C3B6E"/><g fill="#fff"><circle cx="2" cy="2" r="0.55"/><circle cx="4.75" cy="2" r="0.55"/><circle cx="7.5" cy="2" r="0.55"/><circle cx="3.4" cy="4" r="0.55"/><circle cx="6.1" cy="4" r="0.55"/><circle cx="2" cy="6" r="0.55"/><circle cx="4.75" cy="6" r="0.55"/><circle cx="7.5" cy="6" r="0.55"/></g></svg>`;
    default: return `<svg ${base}><rect width="22" height="16" fill="#334"/><circle cx="11" cy="8" r="5" fill="none" stroke="#8cf" stroke-width="1.2"/><path d="M6 8 H16 M11 3 V13" stroke="#8cf" stroke-width="0.8"/></svg>`;
  }
}

const LANGS: Array<{ code: string; name: string }> = [
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'es-419', name: 'Español (Latinoamérica)' },
  { code: 'en', name: 'English' },
];

/** Modal de escolha (bandeira + nome, atual com ✓). Trocar = persiste
 *  global + reload (aplica em todas as strings de uma vez). */
export function showLanguageSelector(): void {
  const current = getLocale();
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(3,0,20,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1.5rem;';
  overlay.innerHTML = `
    <div style="background:#0d0a24;border:1px solid rgba(139,92,246,0.35);border-radius:18px;padding:1.6rem;max-width:340px;width:100%;">
      <h2 style="color:#fff;font-size:1.05rem;margin:0 0 1rem;text-align:center;">${t('main.language.title')}</h2>
      ${LANGS.map(l => `
        <button data-lang="${l.code}" style="
          width:100%;display:flex;align-items:center;gap:0.8rem;padding:0.85rem 1rem;
          margin-bottom:0.5rem;border-radius:12px;cursor:pointer;font-family:inherit;
          font-size:0.95rem;font-weight:600;text-align:left;color:#fff;
          background:${l.code === current ? 'linear-gradient(135deg,rgba(0,212,255,0.18),rgba(139,92,246,0.18))' : 'rgba(255,255,255,0.04)'};
          border:1px solid ${l.code === current ? 'rgba(0,212,255,0.5)' : 'rgba(255,255,255,0.08)'};
        ">
          <span style="display:flex;align-items:center;">${flagSvg(l.code)}</span>
          <span style="flex:1;">${l.name}</span>
          ${l.code === current ? '<span style="color:#00D4FF;">✓</span>' : ''}
        </button>
      `).join('')}
      <button id="langCancel" style="width:100%;padding:0.7rem;border:none;border-radius:12px;background:transparent;color:rgba(255,255,255,0.45);font-size:0.85rem;cursor:pointer;font-family:inherit;">${t('ui.modal.cancel')}</button>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#langCancel')?.addEventListener('click', () => overlay.remove());
  overlay.querySelectorAll<HTMLElement>('[data-lang]').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.lang!;
      if (code === getLocale()) { overlay.remove(); return; }
      setLocale(code);
      window.location.reload();
    });
  });
}

/** Pílula com a bandeira atual pro estrangeiro trocar ANTES de logar.
 *
 *  @param anchorId  se dado e o elemento existe, monta a pílula INLINE
 *  dentro dele (ex: topbar do demo, que já ocupa o topo). Sem anchor,
 *  ou anchor inexistente, cai no modo FLUTUANTE (canto sup. direito).
 */
export function injectLanguagePill(anchorId?: string): void {
  if (document.getElementById('langPill')) return;
  const code = getLocale();
  const short = code === 'pt-BR' ? 'PT' : code === 'es-419' ? 'ES' : 'EN';

  const pill = document.createElement('button');
  pill.id = 'langPill';
  pill.type = 'button'; // não submete formulário se cair dentro de um <form>
  pill.setAttribute('aria-label', t('main.language.title'));
  pill.innerHTML = `${flagSvg(code, 18)} <span>${short}</span>`;

  // Estilo base (comum aos dois modos). setProperty com 'important' pra
  // blindar contra CSS de botão das páginas (ex: .login button width:100%
  // esticava a pílula pra fora da tela).
  const base: Array<[string, string]> = [
    ['display', 'inline-flex'], ['align-items', 'center'], ['gap', '0.4rem'],
    ['width', 'auto'], ['min-width', '0'], ['box-sizing', 'border-box'],
    ['padding', '0.4rem 0.65rem'], ['margin', '0'],
    ['background', 'rgba(13,10,36,0.85)'], ['border', '1px solid rgba(255,255,255,0.16)'],
    ['border-radius', '999px'], ['cursor', 'pointer'], ['font-family', 'inherit'],
    ['color', 'rgba(255,255,255,0.9)'], ['font-size', '0.78rem'], ['font-weight', '700'],
    ['line-height', '1'], ['flex-shrink', '0'], ['-webkit-backdrop-filter', 'blur(8px)'],
    ['backdrop-filter', 'blur(8px)'],
  ];
  for (const [k, v] of base) pill.style.setProperty(k, v, 'important');

  const anchor = anchorId ? document.getElementById(anchorId) : null;
  if (anchor) {
    // INLINE: primeiro filho do anchor (topbar do demo) — fica à
    // esquerda, longe do CTA "Começar grátis" na direita
    anchor.insertBefore(pill, anchor.firstChild);
  } else {
    // FLUTUANTE: canto superior direito, acima de tudo
    pill.style.setProperty('position', 'fixed', 'important');
    pill.style.setProperty('top', 'calc(env(safe-area-inset-top, 0px) + 12px)', 'important');
    pill.style.setProperty('right', '14px', 'important');
    pill.style.setProperty('left', 'auto', 'important');
    pill.style.setProperty('z-index', '99990', 'important');
    document.body.appendChild(pill);
  }

  pill.addEventListener('click', () => showLanguageSelector());
}
