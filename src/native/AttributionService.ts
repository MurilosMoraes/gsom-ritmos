// AttributionService — rastreamento first-touch da origem do user.
//
// Captura UTM params + document.referrer NA PRIMEIRA VISITA ao domínio
// e persiste em localStorage. Assim quando o user se cadastra (mesmo
// dias depois, após navegar entre várias páginas), a gente sabe onde
// ele entrou pela primeira vez.
//
// Referência: https://dev.to/bensabic/stop-losing-marketing-attribution-data-in-your-forms
//             https://docs.mixpanel.com/docs/tracking-best-practices/traffic-attribution
//
// Fluxo:
// 1. Toda página importa esse módulo e chama `AttributionService.init()` no carregamento.
// 2. Se é a primeira visita (sem localStorage), captura UTM + referrer + source inferida.
// 3. Se já tem dado salvo, mantém (first-touch).
// 4. No cadastro, `register.ts` chama `AttributionService.getAttribution()` e envia no INSERT.

export type SignupSource =
  | 'demo'              // entrou pela /demo
  | 'landing'           // entrou pela /landing
  | 'register_direct'   // entrou direto pela /register
  | 'register_referral' // via link de afiliado (ref=XXX na URL)
  | 'unknown';          // outras origens (login, /, etc.)

export type SignupMedium =
  | 'organic'       // sem utm_medium, referrer de buscadores
  | 'paid_social'   // utm_medium=cpc/paid e source=facebook/instagram/tiktok
  | 'whatsapp'      // referrer de wa.me ou utm_source=whatsapp
  | 'email'         // utm_medium=email
  | 'affiliate'     // ?ref=XXX (afiliado)
  | 'direct'        // sem referrer, sem utm
  | 'unknown';

export interface AttributionData {
  source: SignupSource;
  medium: SignupMedium;
  campaign: string | null;  // utm_campaign OU código de cupom/afiliado
  referrer: string | null;  // document.referrer original (host only, sem path)
}

const STORAGE_KEY = 'gdrums-attr-v1';

// Mapeia referrers conhecidos de buscadores/redes sociais pra medium
const REFERRER_MEDIUM_MAP: Record<string, SignupMedium> = {
  'google.com': 'organic',
  'google.com.br': 'organic',
  'bing.com': 'organic',
  'duckduckgo.com': 'organic',
  'yahoo.com': 'organic',
  'facebook.com': 'paid_social',
  'instagram.com': 'paid_social',
  'l.instagram.com': 'paid_social',
  'lm.facebook.com': 'paid_social',
  'tiktok.com': 'paid_social',
  'youtube.com': 'paid_social',
  'm.youtube.com': 'paid_social',
  'wa.me': 'whatsapp',
  'api.whatsapp.com': 'whatsapp',
  'chat.whatsapp.com': 'whatsapp',
  'web.whatsapp.com': 'whatsapp',
};

function inferSourceFromPath(): SignupSource {
  const path = window.location.pathname;
  if (path.startsWith('/demo')) return 'demo';
  if (path.startsWith('/landing')) return 'landing';
  if (path.startsWith('/register')) return 'register_direct';
  return 'unknown';
}

function inferMediumFromReferrer(host: string): SignupMedium | null {
  if (!host) return null;
  // Normalizar (remover www., m., mobile.)
  const clean = host.replace(/^(www\.|m\.|mobile\.|l\.|lm\.)/, '');
  return REFERRER_MEDIUM_MAP[clean] || REFERRER_MEDIUM_MAP[host] || null;
}

function parseReferrerHost(): string | null {
  if (!document.referrer) return null;
  try {
    const url = new URL(document.referrer);
    // Se referrer é do próprio domínio, ignorar (navegação interna)
    if (url.hostname === window.location.hostname) return null;
    return url.hostname;
  } catch {
    return null;
  }
}

function captureFirstTouch(): AttributionData {
  const params = new URLSearchParams(window.location.search);
  const refCode = params.get('ref'); // ?ref=LUCAS → afiliado
  const utmSource = params.get('utm_source');
  const utmMedium = params.get('utm_medium');
  const utmCampaign = params.get('utm_campaign');
  const refHost = parseReferrerHost();

  // Source: afiliado > UTM source > path > referrer
  let source: SignupSource;
  if (refCode) {
    source = 'register_referral';
  } else if (utmSource === 'demo' || inferSourceFromPath() === 'demo') {
    source = 'demo';
  } else if (utmSource === 'landing' || inferSourceFromPath() === 'landing') {
    source = 'landing';
  } else {
    source = inferSourceFromPath();
  }

  // Medium: UTM medium > referrer > direct
  let medium: SignupMedium;
  if (refCode) {
    medium = 'affiliate';
  } else if (utmMedium) {
    const um = utmMedium.toLowerCase();
    if (um.includes('cpc') || um.includes('paid') || um.includes('social')) medium = 'paid_social';
    else if (um.includes('email')) medium = 'email';
    else if (um.includes('whatsapp')) medium = 'whatsapp';
    else if (um.includes('organic')) medium = 'organic';
    else medium = 'unknown';
  } else {
    const refMedium = refHost ? inferMediumFromReferrer(refHost) : null;
    medium = refMedium || (refHost ? 'unknown' : 'direct');
  }

  // Campaign: utm_campaign OU código de afiliado
  const campaign = utmCampaign || refCode || null;

  return {
    source,
    medium,
    campaign: campaign ? campaign.toLowerCase().slice(0, 80) : null,
    referrer: refHost,
  };
}

export class AttributionService {
  /**
   * Chamar no carregamento de toda página pública (demo, landing, register,
   * login, index). Captura first-touch se for primeira visita, senão mantém
   * o dado existente.
   *
   * Também navega pela URL atual pra detectar mudança de source
   * (ex: cara entrou direto em /register, depois clicou num ref=X —
   * o ref sobrescreve porque é intenção mais forte).
   */
  static init(): void {
    try {
      const params = new URLSearchParams(window.location.search);
      const hasRef = params.has('ref');
      const hasUTM = Array.from(params.keys()).some(k => k.startsWith('utm_'));

      const existing = this.getAttribution();

      // Regra: first-touch, exceto se a URL atual tem ref= (afiliado)
      // nesse caso sobrescrever porque é uma intenção comercial mais específica
      if (existing && !hasRef && !hasUTM) {
        // Manter first-touch, não fazer nada
        return;
      }

      const captured = captureFirstTouch();

      // Se não tem dado algum, salvar
      if (!existing) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(captured));
        return;
      }

      // Se tem UTM/ref na URL atual, sobrescrever (intenção clara do link)
      if (hasRef || hasUTM) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(captured));
      }
    } catch {
      // Se localStorage falhar (private browsing), ignora silenciosamente
    }
  }

  /**
   * Retorna a atribuição gravada OU null se não tem dado ainda.
   * Usado no register.ts pra anexar no insert do profile.
   */
  static getAttribution(): AttributionData | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Força captura agora (usado quando atribuição é null no momento do
   * cadastro — edge case de cara que desabilitou localStorage e só habilitou
   * no momento de se cadastrar).
   */
  static captureNow(): AttributionData {
    return captureFirstTouch();
  }

  /**
   * Limpar depois do cadastro (evita que a mesma atribuição conte pra
   * múltiplos cadastros no mesmo device, ex: família compartilhando celular).
   */
  static clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }
}
