// ConversionManager — modais de upsell no trial.
// Design editorial/profissional (inspiração Linear, Vercel). SEM EMOJI.
// Gatilhos:
//   - firstPlayComplete: após 60s de playback na primeira sessão de play
//   - saveRhythmAttempt: tentativa de salvar ritmo
//   - setlistAddAttempt: tentativa de adicionar à setlist
// Anti-spam: localStorage guarda timestamp do último modal por gatilho.

import { isNativeApp, openExternal } from '../native/Platform';

const PLANS_URL_EXTERNAL = 'https://gdrums.com.br/plans';
const PLANS_URL_WEB = '/plans.html';

// Mínimo entre dois modais de conversão (msec).
// Não spama: 1 dia entre modais do MESMO gatilho, 3h entre modais DE QUALQUER gatilho.
const SAME_TRIGGER_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const ANY_TRIGGER_COOLDOWN_MS = 3 * 60 * 60 * 1000;

type TriggerKey = 'firstPlayComplete' | 'saveRhythmAttempt' | 'setlistAddAttempt' | 'trialEndingSoon';

interface TriggerCopy {
  overline: string;       // texto pequeno no topo
  title: string;          // título principal
  body: string;           // parágrafo explicando
  ctaPrimary: string;     // botão primário
  ctaSecondary: string;   // link secundário ('fechar')
}

const TRIGGERS: Record<TriggerKey, TriggerCopy> = {
  firstPlayComplete: {
    overline: 'Período de teste',
    title: 'Seu acompanhamento está pronto.',
    body: 'Você tem 48 horas para conhecer todos os ritmos, conectar o pedal e montar o show. Depois disso, o acesso passa a ser pelo plano.',
    ctaPrimary: 'Ver planos',
    ctaSecondary: 'Continuar testando',
  },
  saveRhythmAttempt: {
    overline: 'Ritmos personalizados',
    title: 'Você está montando seu próprio ritmo.',
    body: 'Ritmos salvos continuam na sua conta depois do teste, prontos para o próximo show. Assine para manter tudo.',
    ctaPrimary: 'Ver planos',
    ctaSecondary: 'Voltar pro ritmo',
  },
  setlistAddAttempt: {
    overline: 'Repertório do show',
    title: 'Você está montando um repertório.',
    body: 'A setlist fica disponível no palco, offline, depois do teste — desde que o plano esteja ativo. Assine para manter.',
    ctaPrimary: 'Ver planos',
    ctaSecondary: 'Voltar',
  },
  trialEndingSoon: {
    overline: 'Últimas horas do teste',
    title: 'Seu teste termina em breve.',
    body: 'Depois que o período de 48 horas acaba, o acesso é pelo plano. Assine antes de expirar com 10% de desconto no primeiro mês.',
    ctaPrimary: 'Assinar com 10% OFF',
    ctaSecondary: 'Lembrar depois',
  },
};

export class ConversionManager {
  private playStartedAt: number | null = null;
  private firstPlayCompleteArmed = true;
  private trialActive = false;

  private static readonly STORAGE_PREFIX = 'gdrums-cv-';
  private static readonly LAST_ANY_KEY = 'gdrums-cv-last-any';

  setTrialActive(active: boolean): void {
    this.trialActive = active;
  }

  // Chamado quando user dá play. Inicia timer pro firstPlayComplete.
  onPlayStart(): void {
    if (!this.trialActive) return;
    if (!this.firstPlayCompleteArmed) return;
    if (this.playStartedAt !== null) return;

    this.playStartedAt = Date.now();
    // 60s tocando → dispara modal de primeiro uso
    setTimeout(() => {
      if (this.playStartedAt === null) return; // parou antes
      const elapsed = Date.now() - this.playStartedAt;
      if (elapsed >= 55_000) { // margem de 5s
        this.fire('firstPlayComplete');
      }
    }, 60_000);
  }

  onPlayStop(): void {
    // Se parou antes dos 60s, não dispara nada nessa sessão.
    // Se parou depois, firstPlayComplete já disparou ou não é mais relevante hoje.
    this.playStartedAt = null;
  }

  // Gatilhos contextuais — mostram o modal de upsell NO MOMENTO DA INTENÇÃO
  // (user clicou em salvar/setlist), mas NÃO bloqueiam a ação. Trial precisa
  // permitir testar tudo; o modal só aparece 1x por gatilho/dia respeitando
  // o cooldown global. Retornam sempre false pra não interferir no fluxo.
  tryFireSaveRhythm(): boolean {
    if (!this.trialActive) return false;
    // Dispara no próximo tick pra não empilhar visualmente com o modal de save
    setTimeout(() => this.fire('saveRhythmAttempt'), 0);
    return false;
  }

  tryFireSetlistAdd(): boolean {
    if (!this.trialActive) return false;
    setTimeout(() => this.fire('setlistAddAttempt'), 0);
    return false;
  }

  /**
   * Dispara modal de "últimas horas" quando o trial tá acabando.
   * Chamado pelo banner do trial no init (hoursLeft <= 12).
   * Cooldown: 1x por dia (não spama a cada reload).
   */
  tryFireTrialEndingSoon(hoursLeft: number): void {
    if (!this.trialActive) return;
    if (hoursLeft > 12) return;
    setTimeout(() => this.fire('trialEndingSoon'), 1500);
  }

  private canFire(key: TriggerKey): boolean {
    const now = Date.now();
    const lastAny = parseInt(localStorage.getItem(ConversionManager.LAST_ANY_KEY) || '0');
    if (now - lastAny < ANY_TRIGGER_COOLDOWN_MS) return false;
    const lastSame = parseInt(localStorage.getItem(ConversionManager.STORAGE_PREFIX + key) || '0');
    if (now - lastSame < SAME_TRIGGER_COOLDOWN_MS) return false;
    return true;
  }

  private markFired(key: TriggerKey): void {
    const now = Date.now();
    localStorage.setItem(ConversionManager.STORAGE_PREFIX + key, now.toString());
    localStorage.setItem(ConversionManager.LAST_ANY_KEY, now.toString());
  }

  private fire(key: TriggerKey): void {
    if (!this.canFire(key)) return;
    // Desarma firstPlayComplete pra nunca mais disparar nesta sessão do JS
    if (key === 'firstPlayComplete') this.firstPlayCompleteArmed = false;
    this.markFired(key);
    // trialEndingSoon: leva pro /plans com cupom TRIAL10 pré-aplicado
    // MAS não manda TRIAL10 se user veio de afiliado (protege a rede).
    // O /plans nesse caso vai ler ?ref=X do localStorage e aplicar cupom
    // do afiliado, que normalmente também é 10% mas rende comissão.
    let coupon: string | undefined = undefined;
    if (key === 'trialEndingSoon' && !this.cameFromAffiliate()) {
      coupon = 'TRIAL10';
    }
    this.showModal(TRIGGERS[key], coupon);
  }

  /**
   * Detecta se o user veio via afiliado (tem ?ref=X persistido na atribuição).
   * Se veio, gatilho não vai sobrescrever o cupom do afiliado com o genérico.
   */
  private cameFromAffiliate(): boolean {
    try {
      const raw = localStorage.getItem('gdrums-attr-v1');
      if (!raw) return false;
      const attr = JSON.parse(raw);
      return attr.source === 'register_referral' || attr.medium === 'affiliate';
    } catch {
      return false;
    }
  }

  private showModal(copy: TriggerCopy, coupon?: string): void {
    // Se já tem modal aberto, não empilhar
    if (document.querySelector('.cv-modal-overlay')) return;

    const overlay = document.createElement('div');
    overlay.className = 'cv-modal-overlay';
    overlay.innerHTML = `
      <div class="cv-modal">
        <button class="cv-close" aria-label="Fechar">×</button>
        <div class="cv-overline">${copy.overline}</div>
        <h2 class="cv-title">${copy.title}</h2>
        <p class="cv-body">${copy.body}</p>
        <div class="cv-price-block">
          <span class="cv-price-amount">R$ 29</span>
          <span class="cv-price-unit">por mês</span>
        </div>
        <button class="cv-primary">${copy.ctaPrimary}</button>
        <button class="cv-secondary">${copy.ctaSecondary}</button>
      </div>
    `;
    document.body.appendChild(overlay);

    this.injectCSS();

    const close = () => overlay.remove();

    overlay.querySelector('.cv-close')?.addEventListener('click', close);
    overlay.querySelector('.cv-secondary')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    overlay.querySelector('.cv-primary')?.addEventListener('click', () => {
      const q = coupon ? `?coupon=${encodeURIComponent(coupon)}` : '';
      if (isNativeApp()) {
        openExternal(PLANS_URL_EXTERNAL + q);
      } else {
        window.location.href = PLANS_URL_WEB + q;
      }
    });

    // ESC fecha
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    };
    document.addEventListener('keydown', onKey);
  }

  private injectCSS(): void {
    if (document.getElementById('cv-modal-css')) return;
    const style = document.createElement('style');
    style.id = 'cv-modal-css';
    style.textContent = `
      .cv-modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.72);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        /* Scroll dentro do overlay (não no body) — evita que o modal
           fique maior que a tela em mobile low-height (iPhone SE, etc) */
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 1.5rem;
        /* Safe area pra notch/navbar */
        padding-top: calc(1.5rem + env(safe-area-inset-top, 0px));
        padding-bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px));
        z-index: 100000;
        animation: cvOverlayIn 0.28s ease;
      }
      /* Em tela grande, centralizar verticalmente quando o modal cabe */
      @media (min-height: 620px) {
        .cv-modal-overlay { align-items: center; }
      }
      @keyframes cvOverlayIn { from { opacity: 0; } to { opacity: 1; } }

      .cv-modal {
        width: 100%;
        max-width: 420px;
        background: #0a0a1e;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 20px;
        padding: 2rem 1.75rem 1.5rem;
        position: relative;
        color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
        animation: cvModalIn 0.32s cubic-bezier(0.2, 0.8, 0.2, 1);
        /* Nunca maior que o viewport — combinado com overlay scroll
           garante acesso ao conteúdo em qualquer tela */
        margin: auto;
      }
      @keyframes cvModalIn {
        from { transform: translateY(12px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }

      .cv-close {
        position: absolute;
        top: 0.75rem;
        right: 0.75rem;
        width: 32px;
        height: 32px;
        background: transparent;
        border: none;
        color: rgba(255, 255, 255, 0.35);
        font-size: 1.5rem;
        line-height: 1;
        cursor: pointer;
        border-radius: 8px;
        transition: color 0.15s, background 0.15s;
      }
      .cv-close:hover { color: #fff; background: rgba(255,255,255,0.05); }

      .cv-overline {
        font-size: 0.68rem;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.4);
        margin-bottom: 0.85rem;
        font-weight: 500;
      }

      .cv-title {
        font-size: 1.45rem;
        line-height: 1.25;
        font-weight: 600;
        letter-spacing: -0.01em;
        color: #fff;
        margin: 0 0 0.85rem;
      }

      .cv-body {
        font-size: 0.92rem;
        line-height: 1.55;
        color: rgba(255, 255, 255, 0.6);
        margin: 0 0 1.75rem;
      }

      .cv-price-block {
        display: flex;
        align-items: baseline;
        gap: 0.45rem;
        padding: 1rem 0;
        margin: 0 0 1.25rem;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      }
      .cv-price-amount {
        font-size: 2rem;
        font-weight: 600;
        letter-spacing: -0.02em;
        color: #fff;
      }
      .cv-price-unit {
        font-size: 0.85rem;
        color: rgba(255, 255, 255, 0.45);
      }

      .cv-primary {
        width: 100%;
        padding: 0.9rem;
        background: #fff;
        color: #0a0a1e;
        border: none;
        border-radius: 10px;
        font-size: 0.95rem;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
        transition: opacity 0.15s;
        margin-bottom: 0.5rem;
      }
      .cv-primary:hover { opacity: 0.9; }
      .cv-primary:active { transform: scale(0.99); }

      .cv-secondary {
        width: 100%;
        padding: 0.7rem;
        background: transparent;
        color: rgba(255, 255, 255, 0.45);
        border: none;
        font-size: 0.85rem;
        font-family: inherit;
        cursor: pointer;
        transition: color 0.15s;
      }
      .cv-secondary:hover { color: rgba(255, 255, 255, 0.75); }
    `;
    document.head.appendChild(style);
  }
}
