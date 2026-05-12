// OneSignal Web SDK wrapper — push notifications.
//
// Inicializa o SDK no primeiro load logado, registra o device como
// subscriber e linka o user.id do Supabase via External ID — assim o
// admin pode segmentar pushes por user específico ou status do banco.
//
// Estratégia de permissão (importante pra não queimar bullets):
// - NUNCA pede permissão automaticamente no load (user ainda não confia)
// - Mostra prompt SOFT (banner discreto no app) só pra users autenticados
// - Hard prompt do browser só após user clicar "Permitir" no banner soft
// - Lembra dismissal — não martelar se user falou "agora não"
//
// iOS Safari: precisa do Safari Web ID (já configurado), mas só funciona
// em iOS 16.4+ e SE o user instalou o site como PWA. Browser comum no
// iOS não suporta web push (Apple bloqueia).

const ONESIGNAL_APP_ID = '30db2eda-9227-48ef-ab48-5b3eb26465e8';
const ONESIGNAL_SAFARI_WEB_ID = 'web.onesignal.auto.1150f274-be67-4412-813c-e6f1ba6adf3e';
const SDK_URL = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';

// Flags localStorage
const DISMISSED_KEY = 'gdrums-push-banner-dismissed';
const DISMISSED_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

declare global {
  interface Window {
    OneSignal?: any;
    OneSignalDeferred?: any[];
  }
}

let sdkLoaded = false;
let initPromise: Promise<void> | null = null;

/**
 * Injeta SDK script tag + roda OneSignal.init.
 * Idempotente: pode chamar várias vezes sem efeito colateral.
 */
export function initOneSignal(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = new Promise<void>((resolve) => {
    try {
      if (typeof window === 'undefined') {
        resolve();
        return;
      }
      // Capacitor nativo: o SDK web não roda no APK/IPA. Usar plugin nativo
      // separado quando vier. Por enquanto: só web.
      if ((window as any).Capacitor?.isNativePlatform?.()) {
        resolve();
        return;
      }

      // Fila Deferred do OneSignal — chamadas antes do SDK carregar entram aqui
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      window.OneSignalDeferred.push(async (OneSignal: any) => {
        try {
          await OneSignal.init({
            appId: ONESIGNAL_APP_ID,
            safari_web_id: ONESIGNAL_SAFARI_WEB_ID,
            // UI default do OneSignal é horrível (popup gigante "Thanks for
            // subscribing"). Desativamos tudo e controlamos pela nossa UI
            // (banner soft em main.ts).
            notifyButton: { enable: false },
            // Bloqueia a "Welcome Notification" automática que aparecia
            // como spam quando o user inscrevia
            welcomeNotification: {
              disable: true,
            },
            // Bloqueia o slidedown nativo (prompt feio)
            promptOptions: {
              slidedown: {
                prompts: [],
              },
              autoPrompt: false,
            },
            allowLocalhostAsSecureOrigin: true,
          });
          sdkLoaded = true;
          resolve();
        } catch (e) {
          console.warn('[OneSignal] init falhou:', e);
          resolve(); // não bloqueia o app por falha de push
        }
      });

      // Injeta script tag (defer pra não bloquear render)
      if (!document.querySelector(`script[src="${SDK_URL}"]`)) {
        const s = document.createElement('script');
        s.src = SDK_URL;
        s.defer = true;
        document.head.appendChild(s);
      }
    } catch (e) {
      console.warn('[OneSignal] init exception:', e);
      resolve();
    }
  });
  return initPromise;
}

/**
 * Linka o user do Supabase ao subscriber do OneSignal via External ID.
 * Chamado após login. Mesmo subscriber pode ter External ID atualizado
 * (ex: user trocou de conta no mesmo browser).
 *
 * Se o user já tem permissão concedida mas não tem subscription ativa
 * (caso quando admin deletou o user no servidor mas o token local
 * ainda existe), força optIn pra recriar a subscription.
 */
export async function linkUserToPush(userId: string): Promise<void> {
  try {
    await initOneSignal();
    if (!sdkLoaded || !window.OneSignal) return;
    await window.OneSignal.login(userId);

    // Defesa contra estado fantasma: se browser tem permissão mas o
    // OneSignal não tem subscription ativa, força criar de novo.
    try {
      const hasPerm = !!window.OneSignal.Notifications?.permission;
      if (hasPerm && window.OneSignal.User?.PushSubscription) {
        const isOpted = window.OneSignal.User.PushSubscription.optedIn;
        if (isOpted === false) {
          await window.OneSignal.User.PushSubscription.optIn();
        }
      }
    } catch { /* noop */ }
  } catch (e) {
    console.warn('[OneSignal] linkUserToPush falhou:', e);
  }
}

/** Desvincula o user no logout. */
export async function unlinkUserFromPush(): Promise<void> {
  try {
    if (!window.OneSignal) return;
    await window.OneSignal.logout();
  } catch { /* noop */ }
}

/**
 * Pega o OneSignal USER ID (não o subscription) e grava em
 * gdrums_profiles.onesignal_id.
 *
 * Importante: User ID agrupa TODOS os devices do user (Chrome no PC +
 * Chrome no celular + Safari etc são subscriptions diferentes mas mesmo
 * user). Salvar user ID permite que o admin mande push pra um user
 * específico atingindo TODOS os devices dele via include_aliases.
 *
 * Antes salvava o subscription ID, que limitava ao último device.
 *
 * Idempotente — só grava se mudou.
 */
export async function syncSubscriptionId(userId: string, supabase: any): Promise<void> {
  try {
    await initOneSignal();
    if (!window.OneSignal?.User) return;

    // Espera o user ID ficar disponível (pode levar 1-2s após init).
    // V16 API: window.OneSignal.User.onesignalId
    let onesignalId: string | null = null;
    for (let i = 0; i < 10; i++) {
      onesignalId = window.OneSignal.User.onesignalId || null;
      if (onesignalId) break;
      await new Promise(r => setTimeout(r, 500));
    }

    if (!onesignalId) return;

    // Confere se já tá gravado pra não martelar o banco
    const cacheKey = 'gdrums-onesignal-id';
    if (localStorage.getItem(cacheKey) === onesignalId) return;

    const { error } = await supabase
      .from('gdrums_profiles')
      .update({ onesignal_id: onesignalId })
      .eq('id', userId);

    if (!error) {
      localStorage.setItem(cacheKey, onesignalId);
    }
  } catch (e) {
    console.warn('[OneSignal] syncSubscriptionId falhou:', e);
  }
}

/**
 * Pede permissão de notificação ao browser. SÓ chamar após gesture do
 * user (click). Retorna true se aceitou.
 */
export async function requestPushPermission(): Promise<boolean> {
  try {
    await initOneSignal();
    if (!window.OneSignal) return false;
    // V16 API: usa Notifications namespace.
    // Pode lançar "Permission dismissed" se o user fechar o popup do browser
    // sem clicar nada — isso NÃO é erro fatal: a subscription já foi criada,
    // só falta o user aceitar de novo. Engolimos o erro silenciosamente.
    try {
      await window.OneSignal.Notifications.requestPermission();
    } catch {
      // Permission dismissed / blocked — segue pra checar estado real
    }
    // Verifica o estado REAL da permissão após o popup
    return !!window.OneSignal.Notifications?.permission;
  } catch (e) {
    console.warn('[OneSignal] requestPermission falhou:', e);
    return false;
  }
}

/** Já tem permissão concedida? */
export async function hasPushPermission(): Promise<boolean> {
  try {
    await initOneSignal();
    if (!window.OneSignal) return false;
    return !!window.OneSignal.Notifications?.permission;
  } catch { return false; }
}

/** O browser suporta web push? (Safari iOS comum não suporta) */
export function isPushSupported(): boolean {
  try {
    return 'Notification' in window && 'serviceWorker' in navigator;
  } catch { return false; }
}

/** User dismissed o banner soft? (não martelar) */
export function isBannerDismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return false;
    const ts = parseInt(raw);
    return Date.now() - ts < DISMISSED_TTL_MS;
  } catch { return false; }
}

export function markBannerDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  } catch { /* noop */ }
}
