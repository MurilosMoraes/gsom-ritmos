// OneSignal wrapper — push notifications (web + Capacitor nativo).
//
// Dois modos de operação:
//
// 1) Web (browser + PWA): OneSignal Web SDK v16 via <script> CDN.
//    SW unificado em /sw.js (Workbox + OneSignal). Permissão via prompt
//    do browser, External ID via OneSignal.login(userId).
//
// 2) Capacitor nativo (iOS/Android APK): usa onesignal-cordova-plugin
//    (SDK nativo). Mesmo App ID, mesmo External ID — push pelo admin
//    atinge todos os devices do user (web + Android APK + iOS) sob o
//    mesmo external_id = supabase user.id.
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

/** True quando rodando dentro do app Capacitor (iOS/Android APK). */
function isNative(): boolean {
  try {
    return !!(window as any).Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

/**
 * Inicializa o SDK NATIVO do OneSignal via onesignal-cordova-plugin.
 * Só chamado quando rodando em Capacitor (iOS/Android APK).
 *
 * O plugin nativo registra automaticamente o device no FCM (Android)
 * ou APNs (iOS) e expõe a mesma noção de User/External ID que o SDK web —
 * por isso, do ponto de vista do admin, é o mesmo user em qualquer device.
 */
async function initNativeOneSignal(): Promise<void> {
  // Import dinâmico pra não quebrar o build web (módulo CommonJS).
  // O plugin define `window.cordova.plugins.OneSignal` mas também exporta
  // como default no índice — usamos o import dinâmico que funciona pros 2.
  const mod = await import('onesignal-cordova-plugin');
  const OneSignal: any = (mod as any).default || mod;

  // initialize é sync — só registra o appId no SDK nativo.
  OneSignal.initialize(ONESIGNAL_APP_ID);
}

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
      // Capacitor nativo (iOS/Android APK): plugin OneSignal Cordova
      // estava causando regressão grave no iOS (Issue OneSignal #1104 +
      // conflito conhecido WKWebView + AudioContext fica suspenso após
      // init do plugin). Sintoma: app não toca nada, ritmos ficam queued
      // mas áudio nunca dispara.
      //
      // Solução temporária: PULAR init em Capacitor. Push iOS volta quando
      // tivermos plugin que funciona bem (ou implementar via @capacitor/
      // push-notifications nativo + servidor proxy pro OneSignal).
      //
      // Android: o plugin Cordova Android é separado (Java/Kotlin), não
      // tem o mesmo bug. Mas por simplicidade, mantém o mesmo skip por
      // enquanto. Push Android via OneSignal volta junto com iOS.
      if ((window as any).Capacitor?.isNativePlatform?.()) {
        resolve();
        return;
      }

      // Migração: usuários antigos têm SW separado em /OneSignalSDKWorker.js
      // que conflitava com nosso Workbox SW. Agora o SW unificado em /sw.js
      // importa o OneSignal SDK. Desregistra o velho pra evitar 2 SWs
      // disputando scope "/" (problema antigo: push entrava pelo SW errado
      // e Chrome Android mostrava successful=1 mas received=0).
      if (navigator.serviceWorker?.getRegistrations) {
        navigator.serviceWorker.getRegistrations().then(regs => {
          for (const reg of regs) {
            const url = reg.active?.scriptURL || reg.installing?.scriptURL || reg.waiting?.scriptURL || '';
            if (url.endsWith('/OneSignalSDKWorker.js')) {
              reg.unregister().catch(() => { /* noop */ });
            }
          }
        }).catch(() => { /* noop */ });
      }

      // Fila Deferred do OneSignal — chamadas antes do SDK carregar entram aqui
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      window.OneSignalDeferred.push(async (OneSignal: any) => {
        try {
          await OneSignal.init({
            appId: ONESIGNAL_APP_ID,
            safari_web_id: ONESIGNAL_SAFARI_WEB_ID,
            // O OneSignal SDK é importado pelo nosso SW unificado em /sw.js
            // (via importScripts). Tem que apontar pro mesmo SW pra evitar
            // conflito de scope — antes havia 2 SWs disputando "/" e o
            // OneSignal perdia, fazendo push não chegar no Chrome Android.
            serviceWorkerParam: { scope: '/' },
            serviceWorkerPath: 'sw.js',
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
    if (!sdkLoaded) return;

    if (isNative()) {
      // SDK nativo (Capacitor): mesma API conceitual, mas síncrono.
      const mod = await import('onesignal-cordova-plugin');
      const OneSignal: any = (mod as any).default || mod;
      OneSignal.login(userId);
      // optIn defensivo: se permissão concedida mas subscription opted-out
      // por algum motivo, força entrar de novo. SDK nativo expõe isso
      // em OneSignal.User.pushSubscription.optIn().
      try {
        const isOpted = OneSignal.User?.pushSubscription?.getOptedIn?.();
        if (isOpted === false) {
          OneSignal.User?.pushSubscription?.optIn?.();
        }
      } catch { /* noop */ }
      return;
    }

    if (!window.OneSignal) return;

    // OneSignal.login pode retornar antes do servidor processar.
    // Aguarda o externalId ficar refletido em User pra ter certeza.
    await window.OneSignal.login(userId);

    // Confirma que ligou — espera até 5s pelo external_id sincronizar
    for (let i = 0; i < 10; i++) {
      const ext = window.OneSignal.User?.externalId;
      if (ext === userId) break;
      await new Promise(r => setTimeout(r, 500));
    }

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

/**
 * Desvincula o user no logout.
 *
 * IMPORTANTE: ver comentário em AuthService.logout — NUNCA chamar esta
 * função no logout do Supabase! OneSignal.logout() apaga o external_id no
 * servidor, desligando push de TODOS os devices (Mac + Android + iOS).
 *
 * Esta função existe apenas pra uso explícito quando o user pediu
 * "não me mande mais push" (UI dedicada, ainda não implementada).
 */
export async function unlinkUserFromPush(): Promise<void> {
  try {
    if (isNative()) {
      const mod = await import('onesignal-cordova-plugin');
      const OneSignal: any = (mod as any).default || mod;
      OneSignal.logout();
      return;
    }
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

    let onesignalId: string | null = null;

    if (isNative()) {
      // SDK nativo: User.onesignalId é um getter síncrono. Pode levar 1-2s
      // após init pra ficar disponível, então faz polling igual à web.
      const mod = await import('onesignal-cordova-plugin');
      const OneSignal: any = (mod as any).default || mod;
      for (let i = 0; i < 10; i++) {
        onesignalId = OneSignal.User?.getOnesignalId?.() || null;
        if (onesignalId) break;
        await new Promise(r => setTimeout(r, 500));
      }
    } else {
      if (!window.OneSignal?.User) return;
      // Espera o user ID ficar disponível (pode levar 1-2s após init).
      // V16 API: window.OneSignal.User.onesignalId
      for (let i = 0; i < 10; i++) {
        onesignalId = window.OneSignal.User.onesignalId || null;
        if (onesignalId) break;
        await new Promise(r => setTimeout(r, 500));
      }
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

    if (isNative()) {
      const mod = await import('onesignal-cordova-plugin');
      const OneSignal: any = (mod as any).default || mod;
      // fallbackToSettings=true: se user já tinha negado uma vez, abre
      // a tela de Settings do OS (no Android e iOS user precisa entrar
      // nas configs do app pra liberar — não dá pra perguntar de novo).
      try {
        const granted = await OneSignal.Notifications.requestPermission(true);
        return !!granted;
      } catch {
        return false;
      }
    }

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
    if (isNative()) {
      const mod = await import('onesignal-cordova-plugin');
      const OneSignal: any = (mod as any).default || mod;
      try {
        return !!(await OneSignal.Notifications.getPermissionAsync?.()
          ?? OneSignal.Notifications.hasPermission?.());
      } catch {
        return false;
      }
    }
    if (!window.OneSignal) return false;
    return !!window.OneSignal.Notifications?.permission;
  } catch { return false; }
}

/**
 * Push é suportado neste device/browser?
 *
 * Capacitor nativo (iOS/Android APK): sempre true (FCM/APNs disponíveis).
 * Web: depende de Notification API + Service Worker (Safari iOS comum não
 * suporta — só PWA instalado em iOS 16.4+).
 */
export function isPushSupported(): boolean {
  try {
    if (isNative()) return true;
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
