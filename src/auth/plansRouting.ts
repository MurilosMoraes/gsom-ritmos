// Regras de rota da COMPRA: tela de planos, renovação, upgrade e volta do login.
//
// POR QUE EXISTE: a tela de planos devolvia pra HOME todo assinante pago
// ativo que chegasse sem ?renew=true / ?upgrade=true. O push de renovação
// do admin, o botão de upgrade do app nativo e o login no Chrome (Android)
// chegavam SEM essas flags, então o cliente que queria pagar via a tela
// de planos piscar e caía na home. Venda perdida.
//
// Toda decisão de rota da compra mora aqui, em funções PURAS (sem DOM,
// sem Supabase), cobertas por test/plans-routing-test.ts.
//
// REGRAS:
//  1. Assinante pago ativo NUNCA é expulso da tela de planos. Sem intenção
//     explícita de upgrade, a tela abre em modo renovação.
//  2. O login nunca perde o destino: quem cai no login vindo dos planos (ou
//     do retorno do pagamento) volta pra lá via ?next=, com a query intacta.
//  3. ?next= só aceita páginas de compra do próprio site (sem open redirect).
//  4. Cupom aceita ?coupon= e ?cupom= (o push de renovação usava cupom).
//  5. O crédito de upgrade exibido é o MESMO que o create-checkout cobra
//     (mesma hierarquia, mesma fórmula). Mudou lá, muda aqui.

export interface ProfileLike {
  subscription_status?: string | null;
  subscription_plan?: string | null;
  subscription_expires_at?: string | null;
}

export interface PlansIntent {
  upgrade: boolean;
  renew: boolean;
  coupon: string | null;
  ref: string | null;
  plan: string | null;
}

/** subscribe = sem assinatura paga válida; renew = assinante pago; upgrade = assinante pago subindo de plano. */
export type PlansMode = 'subscribe' | 'renew' | 'upgrade';

export interface PlanPrice {
  priceCents: number;
  durationMonths: number;
}

/** Hierarquia de upgrade. Espelho de PLAN_ORDER em supabase/functions/create-checkout. */
export const UPGRADE_ORDER = ['mensal', 'trimestral', 'semestral', 'anual', 'rei-dos-palcos'];

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PARAM_LEN = 64;

function flag(value: string | null): boolean {
  return value === 'true' || value === '1';
}

function cleanParam(value: string | null): string | null {
  const v = (value || '').trim();
  return v && v.length <= MAX_PARAM_LEN ? v : null;
}

/** Lê a intenção de compra da query string da tela de planos. */
export function readPlansIntent(search: string): PlansIntent {
  const qs = new URLSearchParams(search);
  const coupon = cleanParam(qs.get('coupon') || qs.get('cupom'));
  return {
    upgrade: flag(qs.get('upgrade')),
    // utm_campaign=renovacao: pushes de renovação já disparados saíram sem
    // ?renew=true. Continua reconhecendo pra esses links não ficarem órfãos.
    renew: flag(qs.get('renew')) || qs.get('utm_campaign') === 'renovacao',
    coupon: coupon ? coupon.toUpperCase() : null,
    ref: cleanParam(qs.get('ref')),
    plan: cleanParam(qs.get('plan')),
  };
}

/**
 * Pode usar o app agora (pago ou trial, dentro da validade). Mesma regra do
 * checkAccess do main.ts: é o que decide se "voltar pro app" funciona ou se
 * o app devolveria o cliente pros planos.
 */
export function hasAppAccess(profile: ProfileLike | null | undefined, now: Date): boolean {
  if (!profile || !profile.subscription_expires_at) return false;
  const status = profile.subscription_status;
  if (status !== 'active' && status !== 'trial') return false;
  return new Date(profile.subscription_expires_at).getTime() > now.getTime();
}

/** Assinatura paga, ativa e dentro da validade. Trial e free não contam. */
export function isPaidActive(profile: ProfileLike | null | undefined, now: Date): boolean {
  if (!profile || profile.subscription_status !== 'active') return false;
  const plan = profile.subscription_plan;
  if (!plan || plan === 'trial' || plan === 'free') return false;
  if (!profile.subscription_expires_at) return false;
  return new Date(profile.subscription_expires_at).getTime() > now.getTime();
}

/**
 * Modo da tela de planos. Nunca devolve "sair da tela": quem chegou nos
 * planos fica nos planos (regra 1).
 */
export function resolvePlansMode(profile: ProfileLike | null | undefined, intent: PlansIntent, now: Date): PlansMode {
  if (!isPaidActive(profile, now)) return 'subscribe';
  return intent.upgrade ? 'upgrade' : 'renew';
}

/**
 * Crédito proporcional (centavos) ao trocar pro plano `targetPlanId`.
 * Espelha o create-checkout: só em upgrade real (sobe na hierarquia),
 * dias restantes arredondados pra cima, mês = 30 dias.
 */
export function computeUpgradeCredit(
  profile: ProfileLike | null | undefined,
  targetPlanId: string,
  catalog: Record<string, PlanPrice>,
  now: Date,
): number {
  if (!profile || profile.subscription_status !== 'active') return 0;
  const currentId = profile.subscription_plan || '';
  if (!currentId || !profile.subscription_expires_at) return 0;

  const currentIdx = UPGRADE_ORDER.indexOf(currentId);
  const targetIdx = UPGRADE_ORDER.indexOf(targetPlanId);
  if (currentIdx === -1 || targetIdx === -1 || targetIdx <= currentIdx) return 0;

  const current = catalog[currentId];
  if (!current || !current.priceCents || !current.durationMonths) return 0;

  const expiresMs = new Date(profile.subscription_expires_at).getTime();
  const daysLeft = Math.max(0, Math.ceil((expiresMs - now.getTime()) / DAY_MS));
  const totalDays = current.durationMonths * 30;
  if (daysLeft <= 0 || totalDays <= 0) return 0;

  return Math.round(current.priceCents * (daysLeft / totalDays));
}

/**
 * Preço final (centavos). Ordem igual ao create-checkout: primeiro o
 * crédito, depois o cupom sobre o que sobrou. Cupom antes do crédito
 * deixava upgrade sair de graça.
 */
export function computeFinalPrice(priceCents: number, creditCents: number, discountPercent: number): number {
  const afterCredit = Math.max(0, priceCents - Math.max(0, creditCents));
  if (discountPercent <= 0) return afterCredit;
  return Math.round(afterCredit * (1 - discountPercent / 100));
}

// ─── Volta do login (?next=) ─────────────────────────────────────────

/**
 * Páginas pra onde o login pode devolver. Só fluxo de compra.
 * /assinar: é por onde o Android chega no Chrome (rewrite pro plans.html,
 * a barra de endereço continua /assinar). Voltar por ela mantém o cliente
 * no Chrome, fora dos App Links que interceptam /plans.
 */
const NEXT_ALLOWED = /^\/(plans|assinar|payment-success)(\.html)?$/;

/**
 * Valida o ?next= do login. Aceita só caminho relativo do próprio site,
 * numa página de compra. Qualquer outra coisa (http://, //host, \, /admin,
 * javascript:) vira null.
 */
export function sanitizeNext(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 1024) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  let u: URL;
  try {
    u = new URL(raw, 'https://gdrums.com.br');
  } catch {
    return null;
  }
  if (u.origin !== 'https://gdrums.com.br') return null;
  if (!NEXT_ALLOWED.test(u.pathname)) return null;
  // Sem .html: internalNav acrescenta no nativo, e na web o Vercel reescreve.
  return u.pathname.replace(/\.html$/, '') + u.search;
}

/**
 * Destino do ?next= pronto pra navegar. /assinar só existe no site (é
 * rewrite do Vercel); dentro do app nativo vira /plans.
 */
export function nextForPlatform(next: string, native: boolean): string {
  return native && /^\/assinar(?=\?|$)/.test(next) ? '/plans' + next.slice('/assinar'.length) : next;
}

/** Caminho do login que devolve o cliente pra `returnTo` depois de entrar. */
export function loginPathWithNext(returnTo: string): string {
  const next = sanitizeNext(returnTo);
  return next ? `/login?next=${encodeURIComponent(next)}` : '/login';
}

// ─── Intenção guardada (sobrevive a recovery de senha e cadastro) ────
//
// O ?next= da URL cobre o login direto. Mas "esqueci a senha" (o e-mail
// abre o login SEM o next) e "completar cadastro" perdiam o destino. Por
// isso o login também guarda o next no aparelho, com ciclo de vida rígido
// pra NUNCA virar loop nem sequestrar um login futuro:
//
//  - GUARDA: só o login, quando recebe ?next= válido.
//  - VALE: 15 minutos. Passou disso, é descartado na leitura.
//  - USO ÚNICO: a página de destino (planos / retorno do pagamento) apaga
//    ao abrir com sessão válida. Chegou = consumiu.
//  - LIMPA na saída intencional: "Voltar pro app" e "Sair" nos planos,
//    logout, e entrar no app normalmente (home com acesso válido).
//  - Conteúdo sempre revalidado por sanitizeNext (storage adulterado não
//    vira open redirect).

export const PENDING_NEXT_KEY = 'gdrums-pending-next';
export const PENDING_NEXT_TTL_MS = 15 * 60 * 1000;

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** localStorage, ou null se indisponível (modo privado, WebView travada). */
export function deviceStore(): KeyValueStore | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** sessionStorage, ou null se indisponível. Usado pela trava anti-loop. */
export function tabStore(): KeyValueStore | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

export function savePendingNext(store: KeyValueStore | null, raw: string | null, now: number = Date.now()): void {
  const next = sanitizeNext(raw);
  if (!store || !next) return;
  try {
    store.setItem(PENDING_NEXT_KEY, JSON.stringify({ next, savedAt: now }));
  } catch { /* storage cheio/bloqueado: fica só o ?next= da URL */ }
}

/** Lê sem apagar. Expirado ou inválido é removido e volta null. */
export function peekPendingNext(store: KeyValueStore | null, now: number = Date.now()): string | null {
  if (!store) return null;
  try {
    const raw = store.getItem(PENDING_NEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { next?: unknown; savedAt?: unknown };
    const savedAt = typeof parsed.savedAt === 'number' ? parsed.savedAt : NaN;
    const next = typeof parsed.next === 'string' ? sanitizeNext(parsed.next) : null;
    // savedAt no futuro (relógio mexido/adulterado) também não vale.
    const fresh = savedAt <= now && now - savedAt <= PENDING_NEXT_TTL_MS;
    if (next && fresh) return next;
  } catch { /* JSON quebrado: cai no remove */ }
  clearPendingNext(store);
  return null;
}

export function clearPendingNext(store: KeyValueStore | null): void {
  try { store?.removeItem(PENDING_NEXT_KEY); } catch { /* noop */ }
}

// ─── Trava anti-loop login ⇄ destino ─────────────────────────────────
//
// Se o login acha que tem sessão e a página de destino acha que não (rede
// oscilando, token no limite), um mandaria pro outro pra sempre. O login
// só pula sozinho pro destino UMA vez a cada 30s; na segunda, mostra o
// formulário e descarta a intenção.

export const NEXT_BOUNCE_KEY = 'gdrums-next-bounce';
export const NEXT_BOUNCE_WINDOW_MS = 30 * 1000;

export function canAutoBounce(store: KeyValueStore | null, now: number = Date.now()): boolean {
  if (!store) return true;
  try {
    const last = Number(store.getItem(NEXT_BOUNCE_KEY) || 0);
    return !(last > 0 && last <= now && now - last < NEXT_BOUNCE_WINDOW_MS);
  } catch {
    return true;
  }
}

export function markAutoBounce(store: KeyValueStore | null, now: number = Date.now()): void {
  try { store?.setItem(NEXT_BOUNCE_KEY, String(now)); } catch { /* noop */ }
}
