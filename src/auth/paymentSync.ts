// Reconhecimento de pagamento DENTRO do app, sem o cliente reabrir nada.
//
// PROBLEMA: o app só conferia pagamento 1x por sessão, no boot. O cliente
// pagava (Android paga no Chrome; web às vezes fecha a aba antes do
// retorno), voltava pro app e continuava vendo "teu plano tá vencendo" ou
// a tela de "assine no site" até matar e reabrir o app. E o aviso de
// renovação aparecia de novo a cada abertura, mesmo com o pagamento feito
// e só aguardando confirmação.
//
// SOLUÇÃO: um vigia (PaymentWatcher) que confere quando FAZ SENTIDO:
//  - no boot e toda vez que o app volta pro primeiro plano;
//  - só se há sinal de pagamento em andamento: o app mandou o cliente pro
//    checkout há pouco (marca local) OU existe pedido pendente recente;
//  - rajada curta com espera crescente (0s, 3s, 8s, 15s, 30s, 60s), e para;
//  - a leitura do perfil é barata (1 select); a confirmação na InfinitePay
//    (payment-webhook) só em algumas tentativas e com teto por sessão;
//  - app em segundo plano pausa a rajada (retoma ao voltar).
//
// "Reconhecido" = perfil pago e válido com validade MAIOR que a de quando o
// vigia começou (renovação), ou virou pago vindo de trial/vencido.
//
// Regras puras aqui; efeitos (Supabase, DOM) entram por injeção. Coberto
// por test/payment-sync-test.ts.

import { isPaidActive, type ProfileLike, type KeyValueStore } from './plansRouting';

// ─── Marca "mandei pro checkout" ─────────────────────────────────────

export const AWAITING_PAYMENT_KEY = 'gdrums-awaiting-payment';
/** Vigia considera a marca por até 2h (Pix/boleto na hora, cartão em minutos). */
export const AWAITING_TTL_MS = 2 * 60 * 60 * 1000;
/** Nos primeiros 30 min o aviso de renovação fica calado: o cliente acabou de ir pagar. */
export const AWAITING_QUIET_MS = 30 * 60 * 1000;

export function markAwaitingPayment(store: KeyValueStore | null, now: number = Date.now()): void {
  try { store?.setItem(AWAITING_PAYMENT_KEY, String(now)); } catch { /* noop */ }
}

/** Idade da marca em ms, ou null se não existe / expirou / é inválida (apaga). */
export function awaitingAge(store: KeyValueStore | null, now: number = Date.now()): number | null {
  if (!store) return null;
  try {
    const raw = store.getItem(AWAITING_PAYMENT_KEY);
    if (!raw) return null;
    const at = Number(raw);
    const age = now - at;
    if (Number.isFinite(at) && at > 0 && age >= 0 && age <= AWAITING_TTL_MS) return age;
  } catch { /* cai no clear */ }
  clearAwaitingPayment(store);
  return null;
}

export function clearAwaitingPayment(store: KeyValueStore | null): void {
  try { store?.removeItem(AWAITING_PAYMENT_KEY); } catch { /* noop */ }
}

// ─── Pedido pendente ─────────────────────────────────────────────────

export interface PendingTx {
  order_nsu: string;
  transaction_nsu?: string | null;
  created_at?: string | null;
}

/** Pedido pendente que ainda vale a pena confirmar (criado nas últimas 24h). */
export const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function isRecentPending(tx: PendingTx | null | undefined, now: number): boolean {
  if (!tx?.order_nsu || !tx.created_at) return false;
  const age = now - new Date(tx.created_at).getTime();
  return Number.isFinite(age) && age >= 0 && age <= PENDING_MAX_AGE_MS;
}

/**
 * Tem prova de que PAGOU e só falta confirmar: a InfinitePay devolveu o
 * cliente com transaction_nsu (salvo pelo payment-success). Pedido sem
 * isso pode ser checkout abandonado, e aí o aviso de renovação é legítimo.
 */
export function isPaidAwaitingConfirmation(tx: PendingTx | null | undefined, now: number): boolean {
  return isRecentPending(tx, now) && !!(tx!.transaction_nsu && tx!.transaction_nsu.trim());
}

/**
 * Aviso "teu plano tá vencendo" deve ficar CALADO? Sim se o cliente acabou
 * de ir pagar (marca < 30 min) ou se já pagou e só falta confirmar. Cobrar
 * renovação de quem acabou de pagar é o que mais irrita.
 */
export function shouldSilenceRenewalNag(store: KeyValueStore | null, pending: PendingTx | null | undefined, now: number): boolean {
  const age = awaitingAge(store, now);
  return (age !== null && age <= AWAITING_QUIET_MS) || isPaidAwaitingConfirmation(pending, now);
}

// ─── Reconhecimento ──────────────────────────────────────────────────

/** Folga pra não confundir arredondamento de data com renovação. */
const EXTENSION_MIN_MS = 60 * 60 * 1000;

export function paymentRecognized(baseline: ProfileLike | null | undefined, fresh: ProfileLike | null | undefined, now: Date): boolean {
  if (!isPaidActive(fresh, now)) return false;
  if (!isPaidActive(baseline, now)) return true; // trial/vencido → pago
  const before = new Date(baseline!.subscription_expires_at!).getTime();
  const after = new Date(fresh!.subscription_expires_at!).getTime();
  return after - before >= EXTENSION_MIN_MS; // renovou/upgrade: validade andou
}

// ─── Vigia ───────────────────────────────────────────────────────────

/** Espera antes de cada tentativa da rajada. */
export const RETRY_DELAYS_MS = [0, 3000, 8000, 15000, 30000, 60000];
/** Tentativas em que também pede confirmação à InfinitePay (payment-webhook). */
export const WEBHOOK_ATTEMPTS = new Set([0, 2, 4]);
/** Teto de chamadas ao payment-webhook por sessão do app. */
export const MAX_WEBHOOK_CALLS_PER_SESSION = 9;
/** Intervalo mínimo entre duas chamadas ao payment-webhook. */
export const WEBHOOK_MIN_GAP_MS = 5 * 1000;
/** Intervalo mínimo entre o fim de uma rajada e o começo de outra. */
export const MIN_GAP_BETWEEN_RUNS_MS = 10 * 1000;

export interface PaymentWatcherDeps {
  fetchProfile(): Promise<ProfileLike | null>;
  fetchLatestPending(): Promise<PendingTx | null>;
  /** Pede confirmação ao backend. true = backend disse que confirmou. */
  confirmPending(tx: PendingTx): Promise<boolean>;
  onRecognized(fresh: ProfileLike): void;
  isVisible(): boolean;
  store: KeyValueStore | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class PaymentWatcher {
  private running = false;
  private lastRunEnd = 0;
  private webhookCalls = 0;
  private done = false;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private baseline: ProfileLike | null, private readonly deps: PaymentWatcherDeps) {
    this.now = deps.now || (() => Date.now());
    this.sleep = deps.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  }

  private lastWebhookAt = 0;

  /** Pagamento já reconhecido nesta sessão (vigia encerrado). */
  get recognized(): boolean { return this.done; }

  /**
   * Alguém de fora (boot do main.ts) acabou de chamar o payment-webhook.
   * Conta no teto e evita repetir a chamada nos próximos segundos.
   */
  noteExternalConfirm(): void {
    this.webhookCalls++;
    this.lastWebhookAt = this.now();
  }

  /**
   * Dispara uma rajada se fizer sentido. Seguro chamar à vontade (boot,
   * voltar pro app): ignora se já está rodando, se acabou de rodar ou se
   * não há nada pra esperar. Resolve quando a rajada termina.
   */
  async kick(): Promise<void> {
    if (this.done || this.running) return;
    if (this.lastRunEnd && this.now() - this.lastRunEnd < MIN_GAP_BETWEEN_RUNS_MS) return;
    this.running = true;
    try {
      await this.run();
    } catch {
      /* rede caiu no meio: tenta de novo no próximo kick */
    } finally {
      this.running = false;
      this.lastRunEnd = this.now();
    }
  }

  private async run(): Promise<void> {
    let sawPending = false;
    for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
      if (RETRY_DELAYS_MS[i] > 0) await this.sleep(RETRY_DELAYS_MS[i]);
      // Em segundo plano não gasta nada; o próximo "voltou pro app" retoma.
      if (!this.deps.isVisible()) return;

      const fresh = await this.deps.fetchProfile();
      if (this.check(fresh)) return;

      const pending = await this.deps.fetchLatestPending();
      const now = this.now();
      const hasPending = isRecentPending(pending, now);
      const awaiting = awaitingAge(this.deps.store, now) !== null;
      sawPending = sawPending || hasPending;

      // Nada em andamento: encerra na 1ª tentativa (custo: 2 selects).
      if (!hasPending && !awaiting) return;

      const webhookFresh = this.lastWebhookAt > 0 && now - this.lastWebhookAt < WEBHOOK_MIN_GAP_MS;
      if (hasPending && WEBHOOK_ATTEMPTS.has(i) && !webhookFresh && this.webhookCalls < MAX_WEBHOOK_CALLS_PER_SESSION) {
        this.webhookCalls++;
        this.lastWebhookAt = now;
        const confirmed = await this.deps.confirmPending(pending!);
        if (confirmed && this.check(await this.deps.fetchProfile())) return;
      }

      // Pedido pendente SEM sinal de pagamento (checkout abandonado?):
      // uma conferência por vez que o app abre/volta, sem rajada.
      if (!awaiting && !isPaidAwaitingConfirmation(pending, now)) return;
    }
    // Rajada inteira e nenhum pedido criado: o cliente não chegou a ir pro
    // checkout. Descarta a marca pra não vigiar à toa por 2h.
    if (!sawPending) clearAwaitingPayment(this.deps.store);
  }

  private check(fresh: ProfileLike | null): boolean {
    if (!paymentRecognized(this.baseline, fresh, new Date(this.now()))) return false;
    this.done = true;
    clearAwaitingPayment(this.deps.store);
    this.baseline = fresh;
    this.deps.onRecognized(fresh!);
    return true;
  }
}
