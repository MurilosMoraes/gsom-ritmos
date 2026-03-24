// HapticsService — Feedback tátil nativo (iOS/Android)
// No browser, os métodos são silenciosos (não quebra nada)

import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';

const isNative = Capacitor.isNativePlatform();

export const HapticsService = {
  /** Toque leve — steps do sequenciador, toggles */
  light(): void {
    if (!isNative) return;
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  },

  /** Toque médio — play/stop, cells da performance grid */
  medium(): void {
    if (!isNative) return;
    Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
  },

  /** Toque pesado — virada, final, prato */
  heavy(): void {
    if (!isNative) return;
    Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
  },

  /** Sucesso — ritmo carregado, ação concluída */
  success(): void {
    if (!isNative) return;
    Haptics.notification({ type: NotificationType.Success }).catch(() => {});
  },

  /** Erro — ação inválida */
  error(): void {
    if (!isNative) return;
    Haptics.notification({ type: NotificationType.Error }).catch(() => {});
  },
};
