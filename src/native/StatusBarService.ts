// StatusBarService — Controle nativo da barra de status (iOS/Android)

import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';

const isNative = Capacitor.isNativePlatform();

export const StatusBarService = {
  /** Configura a status bar para o tema escuro do GDrums */
  async init(): Promise<void> {
    if (!isNative) return;
    try {
      await StatusBar.setStyle({ style: Style.Dark });
      await StatusBar.setBackgroundColor({ color: '#030014' });
    } catch { /* plugin não disponível */ }
  },

  /** Esconde a status bar (modo performance fullscreen) */
  async hide(): Promise<void> {
    if (!isNative) return;
    try {
      await StatusBar.hide();
    } catch {}
  },

  /** Mostra a status bar */
  async show(): Promise<void> {
    if (!isNative) return;
    try {
      await StatusBar.show();
    } catch {}
  },
};
