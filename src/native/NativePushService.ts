// NativePushService — push nativo Android/iOS.
//
// Arquitetura HÍBRIDA (2026-05):
// - iOS: @capacitor/push-notifications (oficial, sem swizzling de audio).
//   Cordova-plugin do OneSignal quebrava AVAudioSession via swizzling.
// - Android: @capacitor-firebase/messaging (Firebase SDK nativo). Plugin
//   oficial não dava token "completo" pro OneSignal — chegava no FCM mas
//   device silenciava (sintoma: successful=1, received=0). Com Firebase SDK
//   nativo, a subscription registrada no OneSignal tem device_model/sdk/etc
//   preenchidos e FCM entrega de verdade.
//
// Em ambos os casos, o token vai pra edge function `register-device-token`
// que cria subscription no OneSignal sob external_id = supabase user.id.
// Manda push pelo painel OneSignal como antes.
//
// Web push continua via OneSignalService.ts (web SDK + service worker).

import { Capacitor } from '@capacitor/core';
import { t } from '../i18n';
import { supabase } from '../auth/supabase';
import { openAppUrl } from './DeepLinks';
import { internalNav, appHome } from './Platform';

const REGISTER_ENDPOINT = 'https://qsfziivubwdgtmwyztfw.supabase.co/functions/v1/register-device-token';
const REGISTERED_KEY = 'gdrums-native-push-registered';

let initStarted = false;

/**
 * Inicializa push nativo. Idempotente: se já rodou nessa sessão, não
 * tenta de novo. Se já registrou esse user antes (localStorage), pula.
 *
 * SÓ chamar quando o user está logado — antes do login não tem como
 * associar o token a um external_id.
 */
export async function initNativePush(userId: string): Promise<void> {
  // Só roda em Capacitor nativo (iOS/Android APK)
  if (!Capacitor.isNativePlatform()) return;
  if (initStarted) return;
  initStarted = true;

  const platform = Capacitor.getPlatform();
  const cachedKey = localStorage.getItem(REGISTERED_KEY);
  const sameUser = cachedKey === userId;

  try {
    if (platform === 'android') {
      // Android: mesmo se cacheado, roda initAndroid (idempotente — só
      // re-anexa listeners e re-pega token se mudou). FirebaseMessaging
      // getToken() é cheap.
      await initAndroid(userId);
    } else if (platform === 'ios') {
      if (sameUser) {
        // iOS cacheado: só re-anexa listeners
        await setupListeners(userId);
      } else {
        await initIos(userId);
      }
    }
  } catch (e) {
    console.warn('[NativePush] init falhou:', e);
    initStarted = false;
  }
}

// ─── Android: @capacitor-firebase/messaging ─────────────────────────
async function initAndroid(userId: string): Promise<void> {
  const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
  const { PushNotifications } = await import('@capacitor/push-notifications');

  // 1. Permissão (FCM usa o mesmo prompt que PushNotifications no Android)
  const perm = await FirebaseMessaging.checkPermissions();
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
    const req = await FirebaseMessaging.requestPermissions();
    if (req.receive !== 'granted') {
      console.log('[NativePush] permissão negada (Android)');
      return;
    }
  } else if (perm.receive !== 'granted') {
    console.log('[NativePush] sem permissão (Android):', perm.receive);
    return;
  }

  // 2. Cria channel explícito (importance HIGH pra pop-up + som)
  try {
    await PushNotifications.createChannel({
      id: 'gdrums-default',
      name: 'GDrums',
      description: t('main.push.channelDescription'),
      importance: 4,
      visibility: 1,
      sound: 'default',
      vibration: true,
      lights: true,
    });
  } catch (e) {
    console.warn('[NativePush] createChannel falhou:', e);
  }

  // 3. Pega o token FCM direto do Firebase SDK e salva em gdrums_profiles.
  // Android NÃO usa OneSignal (que embrulha payload em formato proprietário
  // que precisa do SDK deles pra renderizar). Usa FCM HTTPv1 direto via
  // edge function send-push-fcm, com payload `notification` padrão.
  try {
    const { token } = await FirebaseMessaging.getToken();
    if (token) {
      await saveFcmToken(userId, token);
    } else {
      console.warn('[NativePush] FCM token vazio');
    }
  } catch (e) {
    console.warn('[NativePush] getToken falhou:', e);
  }

  // 4. Listener pra renovação de token (Firebase pode trocar)
  FirebaseMessaging.addListener('tokenReceived', (event) => {
    if (event.token) {
      saveFcmToken(userId, event.token).catch(() => {});
    }
  });

  // 5. Notificação recebida com app aberto — deixa o system tray mostrar
  FirebaseMessaging.addListener('notificationReceived', () => {
    // No-op por enquanto
  });

  // 6. O toque na notificação NÃO é tratado aqui. Ver
  //    escutarToquesDePush(), que roda no boot de toda página, logado ou
  //    não. Registrar nos dois lugares fazia o toque disparar em dobro.
}

// ─── iOS: @capacitor/push-notifications (NÃO MEXER — funciona) ──────
async function initIos(userId: string): Promise<void> {
  const { PushNotifications } = await import('@capacitor/push-notifications');

  const perm = await PushNotifications.checkPermissions();
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
    const req = await PushNotifications.requestPermissions();
    if (req.receive !== 'granted') {
      console.log('[NativePush] permissão negada (iOS)');
      return;
    }
  } else if (perm.receive !== 'granted') {
    console.log('[NativePush] sem permissão (iOS):', perm.receive);
    return;
  }

  await PushNotifications.register();
  setupListeners(userId);
}

// Android: salva token FCM em gdrums_profiles.fcm_token (vai ser usado pela
// edge function send-push-fcm pra mandar push via FCM HTTPv1 direto).
async function saveFcmToken(userId: string, token: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('gdrums_profiles')
      .update({ fcm_token: token })
      .eq('id', userId);
    if (error) {
      console.warn('[NativePush] saveFcmToken erro:', error.message);
    } else {
      localStorage.setItem(REGISTERED_KEY, userId);
      console.log('[NativePush] FCM token salvo (Android)');
    }
  } catch (e) {
    console.warn('[NativePush] saveFcmToken exception:', e);
  }
}

// iOS: manda token pro OneSignal via gateway (que funciona pra iOS)
async function registerTokenWithBackend(
  userId: string,
  token: string,
  platform: 'ios' | 'android',
): Promise<void> {
  try {
    const session = await supabase.auth.getSession();
    const accessToken = session.data.session?.access_token;
    if (!accessToken) {
      console.warn('[NativePush] sem session token, pulando registro');
      return;
    }

    const res = await fetch(REGISTER_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ token, platform }),
    });

    if (res.ok) {
      localStorage.setItem(REGISTERED_KEY, userId);
      console.log(`[NativePush] device registrado no OneSignal (${platform})`);
    } else {
      const err = await res.json().catch(() => ({}));
      console.warn('[NativePush] registro falhou:', res.status, err);
    }
  } catch (e) {
    console.warn('[NativePush] erro ao registrar token:', e);
  }
}

/**
 * Configura os listeners do @capacitor/push-notifications (SÓ iOS).
 * Android usa @capacitor-firebase/messaging — listeners ficam no initAndroid.
 */
async function setupListeners(userId: string): Promise<void> {
  const { PushNotifications } = await import('@capacitor/push-notifications');

  // Token registrado (iOS APNs) — manda pro backend
  PushNotifications.addListener('registration', async (token) => {
    await registerTokenWithBackend(userId, token.value, 'ios');
  });

  // Erro de registro (sem internet, APNs offline, etc) — silencioso
  PushNotifications.addListener('registrationError', (err) => {
    console.warn('[NativePush] registrationError:', err);
  });

  // Notificação recebida com app aberto — deixa o sistema mostrar.
  // (Se quiser interceptar e mostrar dentro do app, é aqui.)
  PushNotifications.addListener('pushNotificationReceived', (_notif) => {
    // No-op por enquanto. Notificações chegam normal no system tray.
  });

  // O toque na notificação NÃO é tratado aqui. Ver escutarToquesDePush(),
  // que roda no boot de toda página, logado ou não. Registrar nos dois
  // lugares fazia o toque disparar em dobro.
}

/**
 * Toque em push com URL nossa. Mesma regra dos links universais
 * (openAppUrl): /plans vira /plans.html no app (sem .html o WebView
 * carregava o index e o push de renovação caía na HOME) e, no Android,
 * vai pro Chrome com a query intacta.
 */
function openPushUrl(url: string): void {
  try {
    const u = new URL(url);
    if (u.hostname !== 'gdrums.com.br') return;
    if (openAppUrl(url, 'push')) return;
    // Caminho sem rota dedicada (ex: a raiz): abre o app normal.
    internalNav(appHome());
  } catch { /* ignore */ }
}

let escutandoToques = false;

/**
 * ESCUTAR O TOQUE NO PUSH ≠ REGISTRAR O APARELHO.
 *
 * Isto aqui só escuta, e roda no boot de toda página, logado ou não.
 * Registrar aparelho (permissão, token, backend) continua sendo do
 * `initNativePush`, que depende de ter usuário.
 *
 * Por que separar: o `initNativePush` só era chamado DEPOIS do login,
 * DENTRO do index.html. Então quem tocasse num push estando deslogado, ou
 * caísse em qualquer outra página, não tinha ninguém escutando e o app
 * abria na home, sem motivo aparente. Era o "clica no push e só abre o
 * app" que o cliente reclamava.
 *
 * Pior no Android: o `initAndroid` faz `return` quando a permissão foi
 * negada, ANTES de anexar os listeners. Aparelho que negou notificação uma
 * vez nunca mais respondia a toque, nem pros pushes que já tinham chegado.
 *
 * Os dois plugins disparam o evento com `retainUntilConsumed`, ou seja, o
 * toque fica guardado esperando alguém escutar. Registrar cedo é o que faz
 * a abertura fria funcionar.
 */
export async function escutarToquesDePush(): Promise<void> {
  if (!Capacitor.isNativePlatform() || escutandoToques) return;
  escutandoToques = true;

  const plataforma = Capacitor.getPlatform();
  try {
    if (plataforma === 'android') {
      const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
      await FirebaseMessaging.addListener('notificationActionPerformed', (event) => {
        const data = event.notification?.data as { url?: string } | undefined;
        if (data?.url && typeof data.url === 'string') openPushUrl(data.url);
      });
    }
    // O plugin @capacitor/push-notifications é usado no iOS e também no
    // Android (OneSignal entrega por ele), então escuta nos dois.
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const data = action.notification.data as { url?: string } | undefined;
      if (data?.url && typeof data.url === 'string') openPushUrl(data.url);
    });
  } catch (e) {
    escutandoToques = false;
    console.warn('[NativePush] nao consegui escutar toques:', e);
  }
}

/**
 * Limpa o flag de "já registrado" — útil no logout pra forçar o próximo
 * user a registrar de novo (com seu próprio external_id).
 */
export function resetNativePushRegistration(): void {
  localStorage.removeItem(REGISTERED_KEY);
  initStarted = false;
}
