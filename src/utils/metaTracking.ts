// metaTracking — Meta Pixel + Conversions API (CAPI) helper.
//
// O Pixel base (fbq init + PageView) é injetado no <head> das páginas
// públicas via snippet inline (não dá pra ficar só aqui porque tem que
// carregar antes de tudo). Este módulo cuida do evento de CONVERSÃO
// (Lead), com deduplicação browser↔server via eventID.
//
// Disparar SÓ quando a conta foi realmente criada (sucesso do cadastro),
// não em todo submit — senão infla Lead com tentativa que falhou.

const CAPI_ENDPOINT = 'https://qsfziivubwdgtmwyztfw.supabase.co/functions/v1/capi-lead';

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

function readCookie(name: string): string | undefined {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : undefined;
}

/**
 * Dispara o evento Lead no Pixel (browser) + CAPI (server), com o mesmo
 * eventID pros dois — o Meta deduplica e não conta a conversão 2x.
 *
 * email/phone opcionais: se passados, vão hasheados SHA-256 no server
 * (melhora o match quality do Meta). Nunca mandar em texto puro.
 *
 * Nunca lança — tracking não pode quebrar o cadastro.
 */
export function trackLead(opts?: { email?: string; phone?: string }): void {
  try {
    const eventId =
      (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ||
      String(Date.now()) + Math.random().toString(16).slice(2);

    // 1. Pixel no browser (dedup via eventID)
    if (typeof window.fbq === 'function') {
      window.fbq('track', 'Lead', {}, { eventID: eventId });
    }

    // 2. CAPI server-side (fire-and-forget; não esperar / não quebrar)
    const fbc =
      readCookie('_fbc') ||
      (new URLSearchParams(location.search).get('fbclid')
        ? `fb.1.${Date.now()}.${new URLSearchParams(location.search).get('fbclid')}`
        : undefined);

    fetch(CAPI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: eventId,
        source_url: window.location.href,
        fbp: readCookie('_fbp'),
        fbc,
        email: opts?.email,
        phone: opts?.phone,
      }),
      keepalive: true, // sobrevive ao redirect que vem logo após o cadastro
    }).catch(() => { /* tracking nunca quebra o fluxo */ });
  } catch { /* idem */ }
}
