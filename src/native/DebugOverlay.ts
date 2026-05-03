// ═════════════════════════════════════════════════════════════════════════
// DebugOverlay — painel flutuante dentro do app nativo (NÃO web/PWA) que
// mostra logs do engine ao vivo. Crítico pra debug do NativeAudioEngine
// no TestFlight onde não tem DevTools facilmente acessível.
// ═════════════════════════════════════════════════════════════════════════
//
// Aparece SÓ em Capacitor app (não PWA web). Toggle com toque triplo no
// canto superior esquerdo. Padrão começa OCULTO — usuário precisa ativar.
//
// Uso:
//   import { DebugOverlay } from './native/DebugOverlay';
//   DebugOverlay.log('mensagem qualquer');

import { Capacitor } from '@capacitor/core';

interface LogEntry {
  ts: number;
  msg: string;
  level: 'info' | 'warn' | 'error';
}

class DebugOverlayClass {
  private logs: LogEntry[] = [];
  private maxLogs = 100;
  private overlay: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private visible = false;
  private tripleTapCount = 0;
  private tripleTapTimer: number | null = null;
  private initialized = false;

  /** Só ativa em Capacitor app (não web, não PWA standalone). */
  private isAvailable(): boolean {
    return Capacitor.isNativePlatform();
  }

  init(): void {
    if (this.initialized || !this.isAvailable()) return;
    this.initialized = true;

    // BOTÃO FIXO 🐛 no canto superior direito — só Capacitor app, sempre visível.
    // Tap único abre o painel. Tap segurado (1.5s) esconde o botão.
    const ensureBtn = () => {
      if (document.getElementById('gdrumsDebugBtn')) return;
      const btn = document.createElement('button');
      btn.id = 'gdrumsDebugBtn';
      btn.textContent = '🐛';
      btn.style.cssText = `
        position: fixed; top: env(safe-area-inset-top, 0); right: 8px;
        width: 44px; height: 44px; border-radius: 22px;
        background: rgba(255,0,0,0.85); color: #fff;
        border: 2px solid #fff; font-size: 22px;
        z-index: 999998; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        font-family: inherit; padding: 0;
      `;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggle();
      });
      // Hold 1.5s pra esconder o botão
      let holdTimer: number | null = null;
      btn.addEventListener('touchstart', () => {
        holdTimer = window.setTimeout(() => { btn.style.display = 'none'; }, 1500);
      }, { passive: true });
      btn.addEventListener('touchend', () => {
        if (holdTimer) clearTimeout(holdTimer);
      });
      document.body.appendChild(btn);
    };
    if (document.body) ensureBtn();
    else document.addEventListener('DOMContentLoaded', ensureBtn);

    // Captura erros globais não tratados
    window.addEventListener('error', (e) => {
      this.error(`window.error: ${e.message} @ ${e.filename}:${e.lineno}`);
    });
    window.addEventListener('unhandledrejection', (e) => {
      this.error(`unhandledRejection: ${e.reason?.message || e.reason}`);
    });
  }

  log(msg: string): void {
    if (!this.isAvailable()) return;
    this.push({ ts: Date.now(), msg, level: 'info' });
  }
  warn(msg: string): void {
    if (!this.isAvailable()) return;
    this.push({ ts: Date.now(), msg, level: 'warn' });
  }
  error(msg: string): void {
    if (!this.isAvailable()) return;
    this.push({ ts: Date.now(), msg, level: 'error' });
    // Erros podem aparecer ANTES do init terminar — tenta init agora
    if (!this.initialized) this.init();
    // Mostra automaticamente quando há erro
    if (!this.visible) this.show();
  }

  private push(entry: LogEntry): void {
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) this.logs.shift();
    if (this.visible) this.render();
  }

  private toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  private show(): void {
    if (!this.overlay) this.create();
    if (this.overlay) this.overlay.style.display = 'flex';
    this.visible = true;
    this.render();
  }

  private hide(): void {
    if (this.overlay) this.overlay.style.display = 'none';
    this.visible = false;
  }

  private create(): void {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.92); color: #0f0;
      font-family: 'SF Mono', Menlo, monospace; font-size: 11px;
      z-index: 999999; display: none; flex-direction: column;
      padding: env(safe-area-inset-top, 0) 8px 8px 8px;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      display: flex; gap: 8px; align-items: center; padding: 8px 0;
      border-bottom: 1px solid #333; margin-bottom: 8px;
    `;
    header.innerHTML = `
      <strong style="color:#0ff;">🐛 Debug Overlay</strong>
      <span style="color:#888;flex:1;font-size:10px;">3 taps no canto sup. esq. pra fechar</span>
      <button id="dbgClear" style="background:#222;color:#fff;border:1px solid #444;padding:4px 10px;border-radius:4px;font-size:11px;">Limpar</button>
      <button id="dbgClose" style="background:#a00;color:#fff;border:none;padding:4px 10px;border-radius:4px;font-size:11px;">✕</button>
    `;
    overlay.appendChild(header);

    const body = document.createElement('div');
    body.style.cssText = `
      flex: 1; overflow-y: auto; white-space: pre-wrap; word-break: break-all;
      line-height: 1.4;
    `;
    overlay.appendChild(body);

    document.body.appendChild(overlay);
    this.overlay = overlay;
    this.body = body;

    overlay.querySelector('#dbgClear')?.addEventListener('click', () => {
      this.logs = []; this.render();
    });
    overlay.querySelector('#dbgClose')?.addEventListener('click', () => this.hide());
  }

  private render(): void {
    if (!this.body) return;
    const fmt = (e: LogEntry) => {
      const d = new Date(e.ts);
      const time = `${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}.${d.getMilliseconds().toString().padStart(3,'0')}`;
      const color = e.level === 'error' ? '#f44' : e.level === 'warn' ? '#fa0' : '#0f0';
      return `<div style="color:${color}"><span style="color:#666">${time}</span> ${e.msg}</div>`;
    };
    this.body.innerHTML = this.logs.map(fmt).join('');
    this.body.scrollTop = this.body.scrollHeight;
  }
}

export const DebugOverlay = new DebugOverlayClass();
