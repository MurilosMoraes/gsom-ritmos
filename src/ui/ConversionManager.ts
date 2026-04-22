// ConversionManager — modais de upsell durante o trial de 48h.
//
// Design editorial/profissional (inspiração Linear, Vercel). SEM EMOJI.
// REGRAS DURAS:
//   1. Só dispara pra user em trial ativo (setTrialActive(true))
//   2. NUNCA interrompe playback — se tocando, fica na fila
//      (campo pendingTrigger); dispara quando parar
//   3. NUNCA dispara pra user que veio de afiliado com cupom agressivo
//      (protege a rede — só manda cupom de afiliado OU modal sem cupom)
//   4. Cooldown global entre qualquer modal: 20min (antes era 3h —
//      cupons NÃO são prêmio raro, são driver de conversão)
//   5. Cooldown por gatilho: 24h (um mesmo gatilho não martela)
//
// Ordem de persuasão durante as 48h (SEMPRE 10% OFF — consistência):
//   - firstRhythmTouch (30s): "isso é real"
//   - firstPlayComplete (60s, 1ª vez): "apresentação"
//   - thirdRhythmExplored: "sua banda tá montada"
//   - tenMinutesIn: "um tempo aqui"
//   - saveRhythmAttempt: "já tá investido"
//   - setlistAddAttempt: "uso profissional"
//   - savedFirstRhythm: "garanta o acesso"
//   - returningAfterAbsence: "que bom te ver"
//   - trialHalfway (24h restando): "metade já foi"
//   - trialEndingSoon (12h restando): "termina em breve"
//   - trialLastHour (1h restando): "última chance"
//
// REGRA DE OURO: nunca aparece enquanto a música está tocando.
// Sempre espera o user parar OU trocar de ritmo OU ficar idle.

import { isNativeApp, openExternal } from '../native/Platform';

const PLANS_URL_EXTERNAL = 'https://gdrums.com.br/plans';
const PLANS_URL_WEB = '/plans';

// Mínimo entre dois modais quaisquer (20min). Suficiente pra não
// sobrepor com a experiência, mas permite múltiplas ofertas no trial.
const SAME_TRIGGER_COOLDOWN_MS = 24 * 60 * 60 * 1000;     // 24h por gatilho
const ANY_TRIGGER_COOLDOWN_MS = 20 * 60 * 1000;           // 20min global

type TriggerKey =
  | 'firstRhythmTouch'
  | 'firstPlayComplete'
  | 'thirdRhythmExplored'
  | 'tenMinutesIn'
  | 'saveRhythmAttempt'
  | 'setlistAddAttempt'
  | 'savedFirstRhythm'
  | 'returningAfterAbsence'
  | 'trialHalfway'
  | 'trialEndingSoon'
  | 'trialLastHour';

interface TriggerCopy {
  overline: string;
  title: string;
  body: string;
  ctaPrimary: string;
  ctaSecondary: string;
  coupon?: string;        // cupom pré-aplicado no /plans
  skipAfterAffiliate?: boolean; // não dispara se user é de afiliado
}

/**
 * Todos os gatilhos usam TRIAL10 (10% OFF) — consistência > escassez.
 * User em trial vê o MESMO cupom em todo modal; o que muda é o
 * contexto/copy. Evita o cara "caçar" o cupom maior e ficar esperando.
 *
 * Afiliado usa cupom próprio (LUCAS10 etc), nunca é sobrescrito
 * (skipAfterAffiliate=true em todos os gatilhos).
 */
const TRIGGERS: Record<TriggerKey, TriggerCopy> = {
  firstRhythmTouch: {
    overline: 'Acompanhamento real',
    title: 'Isso é uma banda de verdade.',
    body: 'Você acabou de tocar com viradas, intros e finais profissionais. Garanta o acesso enquanto está testando — 10% OFF pra assinantes novos.',
    ctaPrimary: 'Ver planos com 10% OFF',
    ctaSecondary: 'Continuar testando',
    coupon: 'TRIAL10',
    skipAfterAffiliate: true,
  },
  firstPlayComplete: {
    overline: 'Período de teste',
    title: 'Seu acompanhamento está pronto.',
    body: 'Você tem 48 horas pra conhecer os ritmos, conectar o pedal e montar o show. Cupom de 10% OFF esperando na tela de planos.',
    ctaPrimary: 'Ver planos',
    ctaSecondary: 'Continuar testando',
    coupon: 'TRIAL10',
    skipAfterAffiliate: true,
  },
  thirdRhythmExplored: {
    overline: 'Sua banda está montada',
    title: 'Três ritmos diferentes. Já tá fluindo.',
    body: 'Quando você assina, tudo fica na sua conta: personalizações, setlist e pedal configurado. Use 10% OFF agora.',
    ctaPrimary: 'Garantir 10% OFF',
    ctaSecondary: 'Continuar testando',
    coupon: 'TRIAL10',
    skipAfterAffiliate: true,
  },
  tenMinutesIn: {
    overline: 'Você tá aqui há 10 minutos',
    title: 'Que tal transformar isso em palco?',
    body: 'Setlist, pedal Bluetooth e modo offline entram no plano. Enquanto você tá testando, 10% OFF no primeiro mês.',
    ctaPrimary: 'Assinar com 10% OFF',
    ctaSecondary: 'Continuar',
    coupon: 'TRIAL10',
    skipAfterAffiliate: true,
  },
  saveRhythmAttempt: {
    overline: 'Ritmos personalizados',
    title: 'Você está montando seu próprio ritmo.',
    body: 'Ritmos salvos continuam na conta depois do teste — desde que o plano esteja ativo. 10% OFF se assinar agora.',
    ctaPrimary: 'Assinar com 10% OFF',
    ctaSecondary: 'Voltar pro ritmo',
    coupon: 'TRIAL10',
    skipAfterAffiliate: true,
  },
  setlistAddAttempt: {
    overline: 'Repertório do show',
    title: 'Você está montando um repertório.',
    body: 'Setlist funciona no palco, offline, desde que o plano esteja ativo. Garanta com 10% OFF.',
    ctaPrimary: 'Assinar com 10% OFF',
    ctaSecondary: 'Voltar',
    coupon: 'TRIAL10',
    skipAfterAffiliate: true,
  },
  savedFirstRhythm: {
    overline: 'Ritmo salvo',
    title: 'Agora você tem um ritmo próprio.',
    body: 'Ele fica na sua conta se você assinar antes do teste acabar. 10% OFF enquanto está quente.',
    ctaPrimary: 'Manter com 10% OFF',
    ctaSecondary: 'Depois',
    coupon: 'TRIAL10',
    skipAfterAffiliate: true,
  },
  returningAfterAbsence: {
    overline: 'Que bom te ver de volta',
    title: 'Seu teste ainda está rolando.',
    body: 'Aproveita que você voltou — 10% OFF pra fechar o plano antes do teste acabar.',
    ctaPrimary: 'Aproveitar 10% OFF',
    ctaSecondary: 'Agora não',
    coupon: 'TRIAL10',
    skipAfterAffiliate: true,
  },
  trialHalfway: {
    overline: 'Metade do teste já foi',
    title: 'Você tem mais 24 horas.',
    body: 'Muita gente decide nesse ponto — já testou o que precisava. Se for assinar, 10% OFF só no primeiro mês.',
    ctaPrimary: 'Assinar com 10% OFF',
    ctaSecondary: 'Continuar testando',
    coupon: 'TRIAL10',
    skipAfterAffiliate: true,
  },
  trialEndingSoon: {
    overline: 'Últimas 12 horas',
    title: 'Seu teste termina em breve.',
    body: 'Depois que o período acaba, o acesso é pelo plano. Use 10% OFF pra não perder o momento.',
    ctaPrimary: 'Assinar com 10% OFF',
    ctaSecondary: 'Lembrar depois',
    coupon: 'TRIAL10',
    skipAfterAffiliate: true,
  },
  trialLastHour: {
    overline: 'Última hora do teste',
    title: 'Essa é a última janela.',
    body: 'Última hora antes do acesso ser bloqueado. Pra não perder o que você configurou: 10% OFF só agora.',
    ctaPrimary: 'Garantir com 10% OFF',
    ctaSecondary: 'Tudo bem',
    coupon: 'TRIAL10',
    skipAfterAffiliate: true,
  },
};

export class ConversionManager {
  private trialActive = false;
  private isPlayingNow = false;

  // Tracking de uso
  private appOpenedAt = Date.now();
  private playStartedAt: number | null = null;
  private firstPlayFired = false;
  private rhythmsExplored = new Set<string>();
  private tenMinutesFired = false;
  private rhythmsSaved = 0;

  // Fila: se user tá tocando quando gatilho dispararia, guardamos aqui
  // e mostramos quando ele parar (onPlayStop ou gap de 8s sem clicar)
  private pendingTrigger: TriggerKey | null = null;

  private static readonly STORAGE_PREFIX = 'gdrums-cv-';
  private static readonly LAST_ANY_KEY = 'gdrums-cv-last-any';
  private static readonly LAST_SEEN_KEY = 'gdrums-cv-last-seen';
  private static readonly RHYTHMS_SAVED_KEY = 'gdrums-cv-rhythms-saved';

  setTrialActive(active: boolean): void {
    this.trialActive = active;
    if (active) {
      this.checkReturningAfterAbsence();
      this.startTenMinuteTimer();
    }
    // Atualiza last-seen a cada sessão (pro gatilho returningAfterAbsence)
    try {
      localStorage.setItem(ConversionManager.LAST_SEEN_KEY, Date.now().toString());
    } catch {}
  }

  /** Chamado pelo main.ts com informação de horas restantes do trial. */
  tick(hoursLeft: number): void {
    if (!this.trialActive) return;
    // Janela de 1h: última hora
    if (hoursLeft > 0 && hoursLeft <= 1) {
      this.queueOrFire('trialLastHour');
      return;
    }
    if (hoursLeft <= 12) {
      this.queueOrFire('trialEndingSoon');
      return;
    }
    if (hoursLeft <= 24 && hoursLeft > 12) {
      this.queueOrFire('trialHalfway');
    }
  }

  // ─── Gatilhos de playback ──────────────────────────────────────────

  onPlayStart(): void {
    this.isPlayingNow = true;
    if (!this.trialActive) return;

    // Primeiro play em geral: programa gatilhos "firstRhythmTouch" (30s)
    // e "firstPlayComplete" (60s) — só na 1ª sessão de play.
    if (this.playStartedAt === null && !this.firstPlayFired) {
      this.playStartedAt = Date.now();

      // 30s: primeiro toque real
      setTimeout(() => {
        if (!this.trialActive) return;
        // Mesmo que ele tenha parado agora, já tocou → vale
        this.queueOrFire('firstRhythmTouch');
      }, 30_000);

      // 60s: primeira sessão completa
      setTimeout(() => {
        if (!this.trialActive) return;
        this.firstPlayFired = true;
        this.queueOrFire('firstPlayComplete');
      }, 60_000);
    }
  }

  onPlayStop(): void {
    this.isPlayingNow = false;
    // Ao parar, tenta disparar o que tava na fila (se houver)
    setTimeout(() => this.flushPendingIfIdle(), 1500);
  }

  /** Chamado quando o user troca de ritmo principal. */
  onRhythmChange(rhythmName: string): void {
    if (!this.trialActive) return;
    if (!rhythmName) return;
    this.rhythmsExplored.add(rhythmName);
    if (this.rhythmsExplored.size === 3) {
      this.queueOrFire('thirdRhythmExplored');
    }
  }

  /** Após 10 min no app — timer contínuo, não baseado em play. */
  private startTenMinuteTimer(): void {
    if (this.tenMinutesFired) return;
    setTimeout(() => {
      if (!this.trialActive) return;
      this.tenMinutesFired = true;
      this.queueOrFire('tenMinutesIn');
    }, 10 * 60 * 1000);
  }

  // ─── Gatilhos contextuais ──────────────────────────────────────────

  tryFireSaveRhythm(): boolean {
    if (!this.trialActive) return false;
    // Conta ritmos salvos — se for o 1º, dispara "savedFirstRhythm"
    // em vez de "saveRhythmAttempt" (mais forte, user já comprometeu)
    this.rhythmsSaved += 1;
    try {
      localStorage.setItem(ConversionManager.RHYTHMS_SAVED_KEY, String(this.rhythmsSaved));
    } catch {}
    setTimeout(() => {
      this.queueOrFire(this.rhythmsSaved === 1 ? 'savedFirstRhythm' : 'saveRhythmAttempt');
    }, 300);
    return false;
  }

  tryFireSetlistAdd(): boolean {
    if (!this.trialActive) return false;
    setTimeout(() => this.queueOrFire('setlistAddAttempt'), 0);
    return false;
  }

  /** Legacy: kept for banner integration. Internally chama tick(). */
  tryFireTrialEndingSoon(hoursLeft: number): void {
    this.tick(hoursLeft);
  }

  // ─── Fila + controle de playback ───────────────────────────────────

  /**
   * Se o user não tá tocando, dispara na hora.
   * Se tá tocando, guarda na fila (pendingTrigger) pra disparar quando parar.
   * Um único slot de fila: gatilho mais novo ganha (útil pra trial timer).
   */
  private queueOrFire(key: TriggerKey): void {
    if (!this.canFire(key)) return;
    if (this.isPlayingNow) {
      this.pendingTrigger = key;
      return;
    }
    this.fire(key);
  }

  private flushPendingIfIdle(): void {
    if (this.isPlayingNow) return;
    if (!this.pendingTrigger) return;
    const key = this.pendingTrigger;
    this.pendingTrigger = null;
    this.fire(key);
  }

  /** Detecta se user voltou após ausência longa. Usa last-seen do localStorage. */
  private checkReturningAfterAbsence(): void {
    try {
      const lastSeenStr = localStorage.getItem(ConversionManager.LAST_SEEN_KEY);
      if (!lastSeenStr) return;
      const lastSeen = parseInt(lastSeenStr);
      const hoursSince = (Date.now() - lastSeen) / (1000 * 60 * 60);
      if (hoursSince >= 6 && hoursSince < 48) {
        // Espera 8s pra dar tempo da UI carregar antes de aparecer
        setTimeout(() => this.queueOrFire('returningAfterAbsence'), 8000);
      }
    } catch {}
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
    // ═══ REGRA DE OURO: NUNCA DURANTE PLAYBACK ═══
    // Dupla verificação (queueOrFire já checa, mas se alguém chamar
    // fire() direto, não deixa passar)
    if (this.isPlayingNow) {
      this.pendingTrigger = key;
      return;
    }
    if (!this.canFire(key)) return;

    const trigger = TRIGGERS[key];
    if (!trigger) return;

    // Se user veio de afiliado, não sobrescrever cupom dele
    const fromAffiliate = this.cameFromAffiliate();
    let coupon = trigger.coupon;
    if (trigger.skipAfterAffiliate && fromAffiliate) {
      coupon = undefined; // modal aparece mas sem forçar outro cupom
    }

    this.markFired(key);
    this.showModal(trigger, coupon);
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
