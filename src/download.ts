// /download — smart redirector por device.
// URL: gdrums.com.br/download → detecta UA → redireciona pro destino certo.
// URL: gdrums.com.br/download/<slug> → smart link customizado pelo admin.

import { supabase } from './auth/supabase';

type Platform = 'android' | 'ios' | 'other';

function detectPlatform(): Platform {
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'android';
  // iPadOS 13+ se reporta como Mac. Pra fazer right: checa também
  // touch points com platform Mac (heurística usada pelo Apple)
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1) return 'ios';
  return 'other';
}

function getSlugFromPath(): string {
  // Caminhos suportados:
  //   /download          → slug 'download'
  //   /download/          → slug 'download'
  //   /download/promo    → slug 'promo'
  //   /download/qualquer → slug 'qualquer'
  const path = window.location.pathname.replace(/\.html$/i, '');
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return 'download';
  // parts[0] sempre será 'download'
  if (parts.length === 1) return 'download';
  return decodeURIComponent(parts[1]);
}

function showFallback(targetUrl: string, msg: string): void {
  const title = document.getElementById('dlTitle');
  const sub = document.getElementById('dlSub');
  const spinner = document.getElementById('dlSpinner');
  const fallback = document.getElementById('dlFallback');
  const link = document.getElementById('dlFallbackLink') as HTMLAnchorElement | null;

  if (title) title.textContent = 'Tudo pronto!';
  if (sub) sub.textContent = msg;
  if (spinner) spinner.style.display = 'none';
  if (fallback) fallback.style.display = 'block';
  if (link) {
    link.href = targetUrl;
    link.textContent = 'Continuar';
  }
}

function showError(): void {
  const title = document.getElementById('dlTitle');
  const sub = document.getElementById('dlSub');
  const spinner = document.getElementById('dlSpinner');
  const fallback = document.getElementById('dlFallback');
  const link = document.getElementById('dlFallbackLink') as HTMLAnchorElement | null;

  if (title) title.textContent = 'Link não encontrado';
  if (sub) sub.textContent = 'Esse link não existe ou foi desativado.';
  if (spinner) spinner.style.display = 'none';
  if (fallback) fallback.style.display = 'block';
  if (link) {
    link.href = '/';
    link.textContent = 'Ir pro site';
  }
}

async function init(): Promise<void> {
  const slug = getSlugFromPath();
  const platform = detectPlatform();

  // Busca o smart link no banco
  const { data, error } = await supabase
    .from('gdrums_smart_links')
    .select('android_url, ios_url, default_url')
    .eq('slug', slug)
    .eq('active', true)
    .maybeSingle();

  if (error || !data) {
    showError();
    return;
  }

  // Resolve destino baseado na plataforma. Se url específica for null,
  // cai pro default_url.
  let target = data.default_url;
  if (platform === 'android' && data.android_url) target = data.android_url;
  else if (platform === 'ios' && data.ios_url) target = data.ios_url;

  // Tracking fire-and-forget (não bloqueia redirect)
  try {
    supabase.rpc('increment_smart_link_click', {
      p_slug: slug,
      p_platform: platform,
    }).then(() => { /* ok */ });
  } catch { /* noop */ }

  // Android + URL da Play Store: usa market:// pra abrir direto no app
  // da loja, sem prompt do Chrome "Abrir no Play Store?". Fallback pro
  // HTTPS em 800ms se o esquema falhar (raro — só se user não tem Play
  // Store instalada). Banco continua armazenando o HTTPS como fonte de
  // verdade, intercepta só na renderização.
  if (platform === 'android' && /play\.google\.com\/store\/apps\/details\?id=/i.test(target)) {
    const idMatch = target.match(/[?&]id=([^&]+)/);
    if (idMatch) {
      const marketUrl = 'market://details?id=' + idMatch[1];
      window.location.href = marketUrl;
      setTimeout(() => {
        if (!document.hidden) window.location.replace(target);
      }, 800);
      return;
    }
  }

  // Redirect imediato — replace pra não voltar na pilha do navegador
  // (botão "voltar" não retorna pra /download)
  window.location.replace(target);

  // Fallback de segurança: se replace falhar por algum motivo, mostra
  // o link manual em 1.5s
  setTimeout(() => {
    showFallback(target, 'Se nada acontecer, toque no botão abaixo.');
  }, 1500);
}

window.addEventListener('DOMContentLoaded', () => {
  init();
});
