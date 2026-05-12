// /links — bio link page (linktree-style) pública.
// Lê gdrums_links via anon (RLS permite SELECT em rows active=true) e
// renderiza a lista. Tracking simples de cliques via RPC increment_link_click.

import { supabase } from './auth/supabase';

interface LinkRow {
  id: string;
  title: string;
  subtitle: string | null;
  url: string;
  icon: string;
  position: number;
}

// SVG icons inline — sem dependência externa, perfeito pra cache.
// Cada ícone é monocromático (currentColor) pra herdar da .link-item.
const ICONS: Record<string, string> = {
  instagram: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="5"/>
    <circle cx="12" cy="12" r="4"/>
    <circle cx="17.5" cy="6.5" r="0.9" fill="currentColor"/>
  </svg>`,
  whatsapp: `<svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413"/>
  </svg>`,
  youtube: `<svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>`,
  tiktok: `<svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.5a8.42 8.42 0 0 0 4.93 1.58V6.7Z"/>
  </svg>`,
  spotify: `<svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.299.421-1.02.599-1.559.3z"/>
  </svg>`,
  applemusic: `<svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M23.997 6.124c0-.738-.065-1.47-.24-2.19-.317-1.31-1.062-2.31-2.18-3.043C21.003.517 20.373.285 19.7.164c-.517-.093-1.038-.135-1.564-.15-.04-.003-.083-.01-.124-.014H5.988c-.152.01-.303.017-.455.026C4.786.07 4.043.15 3.34.428 2.004.958 1.04 1.88.475 3.208c-.192.448-.292.925-.363 1.408-.056.392-.092.785-.115 1.18 0 .032-.01.064-.013.096v12.224c.005.118.01.237.018.353.039.69.103 1.378.3 2.044.5 1.706 1.495 2.97 3.064 3.683.617.275 1.272.42 1.94.514.395.054.788.083 1.184.092.137.003.275 0 .413 0h11.55c.187 0 .375-.013.563-.018.96-.025 1.92-.142 2.832-.494 1.42-.547 2.493-1.531 3.108-2.954.298-.674.45-1.388.524-2.114.04-.39.073-.785.083-1.18.014-.31.014-.616.014-.926v-9.39c0-.103.014-.207-.024-.31zM17.685 18.41c-.84.42-1.736.49-2.643.49-.886 0-1.694-.315-2.392-.875-.547-.439-.99-.984-1.275-1.62-.394-.873-.575-1.798-.566-2.755.013-.957.116-1.91.476-2.81.39-.974 1.045-1.704 1.96-2.187.726-.385 1.5-.523 2.31-.456.27.022.537.083.797.137.06.012.075-.003.075-.062-.003-.96-.003-1.92-.005-2.88 0-.247.092-.337.34-.337h.84c.21 0 .27.062.27.272v9.42c0 .92.005 1.83-.003 2.74-.005.46-.082.91-.255 1.34-.273.673-.74 1.135-1.412 1.42z"/>
  </svg>`,
  applestore: `<svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
  </svg>`,
  playstore: `<svg viewBox="0 0 24 24">
    <defs>
      <linearGradient id="ps-blue" x1="3" y1="2" x2="13" y2="12" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#00A0FF"/>
        <stop offset="1" stop-color="#00DFFF"/>
      </linearGradient>
      <linearGradient id="ps-green" x1="3" y1="2" x2="13" y2="12" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#00F076"/>
        <stop offset="1" stop-color="#32A071"/>
      </linearGradient>
      <linearGradient id="ps-red" x1="13" y1="12" x2="3" y2="22" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#FF3A44"/>
        <stop offset="1" stop-color="#C31162"/>
      </linearGradient>
      <linearGradient id="ps-orange" x1="13" y1="9" x2="13" y2="15" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#FFE000"/>
        <stop offset="1" stop-color="#FF9C00"/>
      </linearGradient>
    </defs>
    <path d="M3.5 2.2c-.3.3-.5.7-.5 1.3v17c0 .6.2 1 .5 1.3l9.4-9.4v-.7L3.5 2.2z" fill="url(#ps-blue)"/>
    <path d="M16 14.4l-3.1-3.1v-.6L16 7.6l3.7 2.1c1 .6 1 1.6 0 2.2L16 14.4z" fill="url(#ps-orange)"/>
    <path d="M16 14.4l-3.1-3.1L3.5 21.8c.4.4.9.4 1.6 0L16 14.4z" fill="url(#ps-red)"/>
    <path d="M16 7.6L5.1 2.2c-.7-.4-1.2-.4-1.6 0l9.4 9.1L16 7.6z" fill="url(#ps-green)"/>
  </svg>`,
  email: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="2"/>
    <polyline points="3,7 12,13 21,7"/>
  </svg>`,
  web: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="9"/>
    <ellipse cx="12" cy="12" rx="4" ry="9"/>
    <line x1="3" y1="12" x2="21" y2="12"/>
  </svg>`,
};

const ARROW_SVG = `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M7 5l5 5-5 5"/>
</svg>`;

function getIconSVG(name: string): string {
  return ICONS[name] || ICONS.web;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  } as Record<string, string>)[ch]!);
}

async function loadAndRender(): Promise<void> {
  const container = document.getElementById('linksList');
  if (!container) return;

  const { data, error } = await supabase
    .from('gdrums_links')
    .select('id, title, subtitle, url, icon, position')
    .eq('active', true)
    .order('position', { ascending: true });

  if (error) {
    container.innerHTML = `<div class="links-empty">Não foi possível carregar os links agora.</div>`;
    return;
  }

  const rows = (data || []) as LinkRow[];
  if (rows.length === 0) {
    container.innerHTML = `<div class="links-empty">Em breve.</div>`;
    return;
  }

  container.innerHTML = rows.map(link => `
    <a class="link-item" href="${escapeHtml(link.url)}" target="_blank" rel="noopener" data-id="${link.id}">
      <div class="link-item-icon">${getIconSVG(link.icon)}</div>
      <div class="link-item-text">
        <span class="link-item-title">${escapeHtml(link.title)}</span>
        ${link.subtitle ? `<span class="link-item-sub">${escapeHtml(link.subtitle)}</span>` : ''}
      </div>
      <div class="link-item-arrow">${ARROW_SVG}</div>
    </a>
  `).join('');

  // No Android web, troca <a href="https://play.google.com/..."> pra usar
  // market:// (abre Play Store direto, sem prompt do Chrome).
  const isAndroidWeb = /Android/i.test(navigator.userAgent || '');

  // Tracking de clique — fire-and-forget, não bloqueia a navegação
  container.querySelectorAll<HTMLAnchorElement>('.link-item').forEach(el => {
    el.addEventListener('click', (e) => {
      const id = el.dataset.id;
      if (id) {
        try {
          supabase.rpc('increment_link_click', { link_id: id }).then(() => { /* ok */ });
        } catch { /* noop */ }
      }

      // Intercepta Play Store no Android pra abrir direto no app da loja
      if (isAndroidWeb) {
        const href = el.getAttribute('href') || '';
        const idMatch = href.match(/play\.google\.com\/store\/apps\/details\?id=([^&]+)/i);
        if (idMatch) {
          e.preventDefault();
          window.location.href = 'market://details?id=' + idMatch[1];
          setTimeout(() => {
            if (!document.hidden) window.open(href, '_blank', 'noopener,noreferrer');
          }, 800);
        }
      }
    });
  });
}

window.addEventListener('DOMContentLoaded', () => {
  loadAndRender();
});
