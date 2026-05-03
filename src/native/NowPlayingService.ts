// ═════════════════════════════════════════════════════════════════════════
// NowPlayingService — wrapper TS pro plugin nativo de lockscreen iOS/Android.
// ═════════════════════════════════════════════════════════════════════════
//
// Faz o GDrums aparecer no lockscreen, Control Center, AirPods, BT car deck
// igual Spotify. No Android usa MediaSession (já configurada no FGS).
// No iOS usa MPNowPlayingInfoCenter via plugin custom.
//
// API:
//  - update(title, subtitle, bpm)   → atualiza card
//  - setPlaybackState(playing)      → muda estado play/pause
//  - clear()                        → limpa card
//  - onRemoteCommand(cb)            → registra handler pros botões do lockscreen
//
// Web/PWA: no-op silencioso.

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

type RemoteCommand = 'play' | 'pause' | 'toggle' | 'next' | 'previous';

interface GDrumsNowPlayingPlugin {
  update(opts: { title: string; subtitle?: string; bpm?: number }): Promise<void>;
  setPlaybackState(opts: { playing: boolean }): Promise<void>;
  clear(): Promise<void>;
  addListener(eventName: string, cb: (data: any) => void): Promise<PluginListenerHandle>;
}

const NowPlayingPlugin = registerPlugin<GDrumsNowPlayingPlugin>('GDrumsNowPlaying');

class NowPlayingServiceClass {
  private listeners: Array<(cmd: RemoteCommand) => void> = [];
  private listenersRegistered = false;
  private active = false;

  constructor() {
    if (this.isAvailable()) {
      this.registerNativeListeners();
    }
  }

  private isAvailable(): boolean {
    // Por enquanto só iOS — Android usa MediaSession do FGS já existente
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
  }

  private async registerNativeListeners(): Promise<void> {
    if (this.listenersRegistered) return;
    this.listenersRegistered = true;
    const events: Array<{ ev: string; cmd: RemoteCommand }> = [
      { ev: 'remotePlay', cmd: 'play' },
      { ev: 'remotePause', cmd: 'pause' },
      { ev: 'remoteToggle', cmd: 'toggle' },
      { ev: 'remoteNext', cmd: 'next' },
      { ev: 'remotePrevious', cmd: 'previous' },
    ];
    for (const { ev, cmd } of events) {
      try {
        await NowPlayingPlugin.addListener(ev, () => {
          this.listeners.forEach(cb => {
            try { cb(cmd); } catch (e) { console.error('[NowPlaying] handler erro:', e); }
          });
        });
      } catch (e) {
        console.warn('[NowPlaying] addListener falhou:', ev, e);
      }
    }
  }

  /** Atualiza card do lockscreen com título do ritmo + BPM. */
  async update(opts: { title: string; subtitle?: string; bpm?: number }): Promise<void> {
    if (!this.isAvailable()) return;
    try {
      await NowPlayingPlugin.update(opts);
      this.active = true;
    } catch (e) {
      console.warn('[NowPlaying] update falhou:', e);
    }
  }

  /** Sinaliza play/pause pro SO mostrar o ícone certo no lockscreen. */
  async setPlaybackState(playing: boolean): Promise<void> {
    if (!this.isAvailable()) return;
    try {
      await NowPlayingPlugin.setPlaybackState({ playing });
    } catch (e) {
      console.warn('[NowPlaying] setPlaybackState falhou:', e);
    }
  }

  /** Limpa o card do lockscreen (raramente usado — geralmente fica). */
  async clear(): Promise<void> {
    if (!this.isAvailable() || !this.active) return;
    try {
      await NowPlayingPlugin.clear();
      this.active = false;
    } catch (e) {
      console.warn('[NowPlaying] clear falhou:', e);
    }
  }

  /** Registra handler pros botões do lockscreen (play/pause/next/previous). */
  onRemoteCommand(cb: (cmd: RemoteCommand) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter(l => l !== cb);
    };
  }
}

export const NowPlayingService = new NowPlayingServiceClass();
export type { RemoteCommand };
