// PushService — Push Notifications nativas (iOS/Android)
// Registra o dispositivo e gerencia permissões

import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';

const isNative = Capacitor.isNativePlatform();

export const PushService = {
  /** Inicializa push notifications — pede permissão e registra */
  async init(): Promise<void> {
    if (!isNative) return;

    try {
      // Verificar permissão atual
      const permStatus = await PushNotifications.checkPermissions();

      if (permStatus.receive === 'prompt') {
        const result = await PushNotifications.requestPermissions();
        if (result.receive !== 'granted') return;
      } else if (permStatus.receive !== 'granted') {
        return;
      }

      // Registrar para receber notificações
      await PushNotifications.register();

      // Listener: token recebido (para enviar ao servidor no futuro)
      PushNotifications.addListener('registration', (token) => {
        try {
          localStorage.setItem('gdrums-push-token', token.value);
        } catch {}
      });

      // Listener: erro no registro
      PushNotifications.addListener('registrationError', () => {
        // Silencioso — push é opcional
      });

      // Listener: notificação recebida com app aberto
      PushNotifications.addListener('pushNotificationReceived', (_notification) => {
        // Futuro: mostrar toast com o conteúdo
      });

      // Listener: usuário clicou na notificação
      PushNotifications.addListener('pushNotificationActionPerformed', (_action) => {
        // Futuro: navegar para conteúdo relevante
      });
    } catch {
      // Push não disponível neste dispositivo
    }
  },

  /** Retorna o token salvo (para enviar ao backend) */
  getToken(): string | null {
    return localStorage.getItem('gdrums-push-token');
  },
};
