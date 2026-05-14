// NativePushService — push nativo Android/iOS via @capacitor/push-notifications.
//
// Por que NÃO usar onesignal-cordova-plugin: bug conhecido no Capacitor 8
// SPM (Issue #1069) + method swizzling no iOS quebrava o áudio (AVAudioSession
// + WKWebView). Foi removido em 2026-05.
//
// Solução atual:
// 1. Plugin oficial @capacitor/push-notifications pede permissão + registra
//    o device no FCM (Android) ou APNs (iOS). Retorna um token nativo.
// 2. Chamamos a edge function `register-device-token` que cadastra esse
//    token como subscription do OneSignal sob external_id = supabase user.id.
// 3. OneSignal envia push como antes (admin panel, cron, segmentação) —
//    a subscription criada manualmente é alcançada pelos pushes.
//
// Web push continua via OneSignalService.ts (web SDK + service worker).
// Esse arquivo é SÓ pro app nativo (iOS/Android Capacitor).

import { Capacitor } from '@capacitor/core';
import { supabase } from '../auth/supabase';

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

  // Se já registramos esse user nesse device, não pede permissão de novo
  const cachedKey = localStorage.getItem(REGISTERED_KEY);
  if (cachedKey === userId) {
    // Mesmo user: pula tudo. Token FCM/APNs pode ter mudado, mas o
    // plugin reentrega via listener se renovar.
    setupListeners(userId);
    return;
  }

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    // 1. Verifica permissão atual
    const perm = await PushNotifications.checkPermissions();

    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      // 2. Pede permissão (prompt nativo iOS/Android)
      const req = await PushNotifications.requestPermissions();
      if (req.receive !== 'granted') {
        console.log('[NativePush] permissão negada');
        return;
      }
    } else if (perm.receive !== 'granted') {
      console.log('[NativePush] sem permissão:', perm.receive);
      return;
    }

    // 3. Registra no FCM/APNs (token vem assíncrono via listener)
    await PushNotifications.register();
    setupListeners(userId);
  } catch (e) {
    console.warn('[NativePush] init falhou:', e);
    initStarted = false; // permite tentar de novo depois
  }
}

/**
 * Configura os listeners do plugin pra receber tokens e notificações.
 */
async function setupListeners(userId: string): Promise<void> {
  const { PushNotifications } = await import('@capacitor/push-notifications');

  // Token registrado — manda pra nossa edge function que cria a
  // subscription no OneSignal sob external_id = user.id
  PushNotifications.addListener('registration', async (token) => {
    try {
      const platform = Capacitor.getPlatform(); // 'ios' | 'android' | 'web'
      if (platform !== 'ios' && platform !== 'android') return;

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
        body: JSON.stringify({ token: token.value, platform }),
      });

      if (res.ok) {
        localStorage.setItem(REGISTERED_KEY, userId);
        console.log('[NativePush] device registrado no OneSignal');
      } else {
        const err = await res.json().catch(() => ({}));
        console.warn('[NativePush] registro falhou:', res.status, err);
      }
    } catch (e) {
      console.warn('[NativePush] erro ao registrar token:', e);
    }
  });

  // Erro de registro (sem internet, FCM offline, etc) — silencioso
  PushNotifications.addListener('registrationError', (err) => {
    console.warn('[NativePush] registrationError:', err);
  });

  // Notificação recebida com app aberto — deixa o sistema mostrar.
  // (Se quiser interceptar e mostrar dentro do app, é aqui.)
  PushNotifications.addListener('pushNotificationReceived', (_notif) => {
    // No-op por enquanto. Notificações chegam normal no system tray.
  });

  // User clicou na notificação — pode navegar pra URL embutida
  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const data = action.notification.data as { url?: string } | undefined;
    if (data?.url && typeof data.url === 'string') {
      // OneSignal manda URL pra abrir — se for nosso domínio, navega interno
      try {
        const u = new URL(data.url);
        if (u.hostname === 'gdrums.com.br') {
          window.location.href = u.pathname + u.search;
        }
      } catch { /* ignore */ }
    }
  });
}

/**
 * Limpa o flag de "já registrado" — útil no logout pra forçar o próximo
 * user a registrar de novo (com seu próprio external_id).
 */
export function resetNativePushRegistration(): void {
  localStorage.removeItem(REGISTERED_KEY);
  initStarted = false;
}
