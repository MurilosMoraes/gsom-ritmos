// Teste do VIGIA DE PAGAMENTO (src/auth/paymentSync.ts).
// "pagou ali, já tem que reconhecer no app e aparecer, mas sem esgotar
//  recursos" + "tem um banner ali que fica enchendo o saco"
// Prova que:
//  - pagamento confirmado no servidor é reconhecido ao voltar pro app
//  - webhook demorado: o vigia insiste em rajada curta e para
//  - sem nada em andamento custa 2 selects e para
//  - checkout abandonado não vira rajada; teto de webhook por sessão
//  - app em segundo plano não gasta nada
//  - aviso de renovação fica calado pra quem acabou de pagar
//
// Roda: npx tsx test/payment-sync-test.ts

import {
  PaymentWatcher, paymentRecognized, shouldSilenceRenewalNag, markAwaitingPayment, awaitingAge,
  isPaidAwaitingConfirmation, AWAITING_PAYMENT_KEY, AWAITING_TTL_MS, AWAITING_QUIET_MS,
  MAX_WEBHOOK_CALLS_PER_SESSION, RETRY_DELAYS_MS, MIN_GAP_BETWEEN_RUNS_MS,
  type PendingTx,
} from '../src/auth/paymentSync';
import type { ProfileLike, KeyValueStore } from '../src/auth/plansRouting';

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ FALHOU: ${msg}`); }
}

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-09-16T12:00:00Z').getTime();
const iso = (ms: number) => new Date(ms).toISOString();
const prof = (status: string, plan: string, expMs: number): ProfileLike =>
  ({ subscription_status: status, subscription_plan: plan, subscription_expires_at: iso(expMs) });

function memStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: k => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); }, removeItem: k => { map.delete(k); } };
}

interface Sim {
  watcher: PaymentWatcher;
  clock: { now: number };
  calls: { profile: number; pending: number; webhook: number; recognized: ProfileLike[] };
  state: { profile: ProfileLike | null; pending: PendingTx | null; visible: boolean; webhookConfirms: boolean; confirmAt: number | null };
  store: ReturnType<typeof memStore>;
}

/** Monta um vigia com servidor simulado. `confirmAt`: instante em que o servidor passa a ter o pagamento. */
function sim(baseline: ProfileLike | null, paid: ProfileLike, opts: Partial<Sim['state']> = {}): Sim {
  const clock = { now: T0 };
  const store = memStore();
  const calls = { profile: 0, pending: 0, webhook: 0, recognized: [] as ProfileLike[] };
  const state: Sim['state'] = { profile: baseline, pending: null, visible: true, webhookConfirms: false, confirmAt: null, ...opts };
  const settle = () => { if (state.confirmAt !== null && clock.now >= state.confirmAt) { state.profile = paid; state.pending = null; } };
  const watcher = new PaymentWatcher(baseline, {
    store,
    now: () => clock.now,
    sleep: async ms => { clock.now += ms; },
    isVisible: () => state.visible,
    fetchProfile: async () => { calls.profile++; settle(); return state.profile; },
    fetchLatestPending: async () => { calls.pending++; settle(); return state.pending; },
    confirmPending: async () => {
      calls.webhook++;
      if (state.webhookConfirms) { state.profile = paid; state.pending = null; return true; }
      return false;
    },
    onRecognized: p => { calls.recognized.push(p); },
  });
  return { watcher, clock, calls, state, store };
}

async function main(): Promise<void> {
  const mensalVencendo = prof('active', 'mensal', T0 + 2 * DAY);
  const mensalRenovado = prof('active', 'mensal', T0 + 32 * DAY);
  const pendingPago: PendingTx = { order_nsu: 'u_mensal_1', transaction_nsu: 'abc', created_at: iso(T0 - 60_000) };
  const pendingAbandonado: PendingTx = { order_nsu: 'u_mensal_2', transaction_nsu: null, created_at: iso(T0 - 60_000) };

  console.log('═══ Reconhecimento ═══\n');

  assert(paymentRecognized(mensalVencendo, mensalRenovado, new Date(T0)), 'renovação: validade andou → reconhece');
  assert(!paymentRecognized(mensalVencendo, mensalVencendo, new Date(T0)), 'mesma validade → não reconhece');
  assert(!paymentRecognized(mensalVencendo, prof('active', 'mensal', T0 + 2 * DAY + 60_000), new Date(T0)), 'diferença de 1 min (arredondamento) → não reconhece');
  assert(paymentRecognized(prof('expired', 'mensal', T0 - DAY), mensalRenovado, new Date(T0)), 'vencido → pago: reconhece');
  assert(paymentRecognized(prof('trial', 'trial', T0 + DAY), mensalRenovado, new Date(T0)), 'trial → pago: reconhece');
  assert(paymentRecognized(null, mensalRenovado, new Date(T0)), 'sem foto inicial → pago: reconhece');
  assert(!paymentRecognized(prof('expired', 'mensal', T0 - DAY), prof('trial', 'trial', T0 + DAY), new Date(T0)), 'virar trial não é pagamento');

  console.log('\n═══ Pagou no Chrome e voltou pro app ═══\n');

  {
    // Servidor já confirmou (webhook da InfinitePay chegou)
    const s = sim(mensalVencendo, mensalRenovado, { confirmAt: T0 });
    markAwaitingPayment(s.store, T0 - 60_000);
    await s.watcher.kick();
    assert(s.calls.recognized.length === 1, 'reconhece na 1ª conferência');
    assert(s.calls.profile === 1 && s.calls.webhook === 0, 'custo: 1 select, zero webhook');
    assert(!s.store.map.has(AWAITING_PAYMENT_KEY), 'marca "foi pagar" limpa');
    await s.watcher.kick();
    s.clock.now += MIN_GAP_BETWEEN_RUNS_MS * 10;
    await s.watcher.kick();
    assert(s.calls.profile === 1, 'depois de reconhecido, o vigia não consulta mais nada');
  }
  {
    // Webhook da InfinitePay atrasado: nosso payment-webhook confirma
    const s = sim(mensalVencendo, mensalRenovado, { pending: pendingPago, webhookConfirms: true });
    await s.watcher.kick();
    assert(s.calls.recognized.length === 1 && s.calls.webhook === 1, 'pedido pago pendente → webhook confirma → reconhece');
  }
  {
    // Servidor só confirma 20s depois: a rajada pega
    const s = sim(mensalVencendo, mensalRenovado, { pending: pendingPago, confirmAt: T0 + 20_000 });
    await s.watcher.kick();
    assert(s.calls.recognized.length === 1, 'confirmação 20s depois: reconhecida na rajada');
    assert(s.clock.now - T0 <= 30_000, 'reconhecida em até ~30s');
  }

  console.log('\n═══ Sem esgotar recursos ═══\n');

  {
    const s = sim(mensalVencendo, mensalRenovado);
    await s.watcher.kick();
    assert(s.calls.profile === 1 && s.calls.pending === 1 && s.calls.webhook === 0, 'nada em andamento: 2 selects e para');
    assert(s.clock.now === T0, 'sem espera nenhuma');
  }
  {
    // Nunca confirma: rajada tem fim
    const s = sim(mensalVencendo, mensalRenovado, { pending: pendingPago });
    await s.watcher.kick();
    const total = RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    assert(s.calls.profile === RETRY_DELAYS_MS.length, `rajada limitada a ${RETRY_DELAYS_MS.length} conferências`);
    assert(s.calls.webhook === 3, 'webhook só em 3 das tentativas');
    assert(s.clock.now - T0 === total, `rajada dura ${total / 1000}s e para`);
  }
  {
    // Teto de webhook na sessão, com o cliente abrindo/fechando o app
    const s = sim(mensalVencendo, mensalRenovado, { pending: pendingPago });
    for (let i = 0; i < 10; i++) {
      await s.watcher.kick();
      s.clock.now += MIN_GAP_BETWEEN_RUNS_MS;
    }
    assert(s.calls.webhook === MAX_WEBHOOK_CALLS_PER_SESSION, `teto de ${MAX_WEBHOOK_CALLS_PER_SESSION} webhooks por sessão`);
  }
  {
    // Checkout abandonado (pendente sem transaction_nsu, sem marca): sem rajada
    const s = sim(mensalVencendo, mensalRenovado, { pending: pendingAbandonado });
    await s.watcher.kick();
    assert(s.calls.profile === 1 && s.calls.webhook === 1, 'abandonado: 1 conferência + 1 webhook, sem rajada');
  }
  {
    // Kicks em sequência (visibilitychange + resume juntos)
    const s = sim(mensalVencendo, mensalRenovado);
    await Promise.all([s.watcher.kick(), s.watcher.kick(), s.watcher.kick()]);
    assert(s.calls.profile === 1, 'gatilhos simultâneos rodam 1 vez só');
    await s.watcher.kick();
    assert(s.calls.profile === 1, 'gatilho logo depois (<10s) é ignorado');
    s.clock.now += MIN_GAP_BETWEEN_RUNS_MS;
    await s.watcher.kick();
    assert(s.calls.profile === 2, 'depois de 10s volta a conferir');
  }
  {
    // Boot já chamou o webhook: o vigia não repete na hora
    const s = sim(prof('expired', 'mensal', T0 - DAY), mensalRenovado, { pending: pendingPago });
    s.watcher.noteExternalConfirm();
    await s.watcher.kick();
    assert(s.calls.webhook === 2, 'webhook do boot conta: vigia pula a 1ª e faz só 2');
  }
  {
    // Segundo plano: não gasta
    const s = sim(mensalVencendo, mensalRenovado, { pending: pendingPago, visible: false });
    await s.watcher.kick();
    assert(s.calls.profile === 0 && s.calls.webhook === 0, 'app em segundo plano: zero consulta');
  }
  {
    // Marca "foi pagar" sem pedido criado: descartada após a rajada
    const s = sim(mensalVencendo, mensalRenovado);
    markAwaitingPayment(s.store, T0);
    await s.watcher.kick();
    assert(s.calls.profile === RETRY_DELAYS_MS.length, 'marca recente: vigia a rajada inteira');
    assert(!s.store.map.has(AWAITING_PAYMENT_KEY), 'nenhum pedido criado: marca descartada (não vigia 2h à toa)');
  }
  {
    // Erro de rede no meio não trava o vigia
    const s = sim(mensalVencendo, mensalRenovado);
    let fail = true;
    const w = new PaymentWatcher(mensalVencendo, {
      store: s.store, now: () => s.clock.now, sleep: async ms => { s.clock.now += ms; }, isVisible: () => true,
      fetchProfile: async () => { if (fail) throw new Error('rede'); return mensalRenovado; },
      fetchLatestPending: async () => null, confirmPending: async () => false, onRecognized: p => { s.calls.recognized.push(p); },
    });
    await w.kick();
    fail = false;
    s.clock.now += MIN_GAP_BETWEEN_RUNS_MS;
    await w.kick();
    assert(s.calls.recognized.length === 1, 'rede caiu: próxima volta pro app reconhece');
  }

  console.log('\n═══ Aviso de renovação calado pra quem pagou ═══\n');

  {
    const st = memStore();
    assert(!shouldSilenceRenewalNag(st, null, T0), 'ninguém pagando: aviso aparece');
    markAwaitingPayment(st, T0);
    assert(shouldSilenceRenewalNag(st, null, T0 + 10 * 60_000), 'foi pagar há 10 min: calado');
    assert(!shouldSilenceRenewalNag(st, null, T0 + AWAITING_QUIET_MS + 1), 'foi pagar há 31 min e nada: aviso volta');
    assert(shouldSilenceRenewalNag(memStore(), pendingPago, T0), 'pagou e falta confirmar: calado');
    assert(!shouldSilenceRenewalNag(memStore(), pendingAbandonado, T0), 'checkout abandonado: aviso aparece');
    assert(!isPaidAwaitingConfirmation({ ...pendingPago, created_at: iso(T0 - 2 * DAY) }, T0), 'pedido pago de 2 dias atrás não cala nada');
    assert(!isPaidAwaitingConfirmation({ ...pendingPago, transaction_nsu: '  ' }, T0), 'transaction_nsu vazio não é prova');

    markAwaitingPayment(st, T0);
    assert(awaitingAge(st, T0 + AWAITING_TTL_MS + 1) === null && !st.map.has(AWAITING_PAYMENT_KEY), 'marca expira em 2h e é apagada');
    st.setItem(AWAITING_PAYMENT_KEY, 'lixo');
    assert(awaitingAge(st, T0) === null && !st.map.has(AWAITING_PAYMENT_KEY), 'marca adulterada é apagada');
    st.setItem(AWAITING_PAYMENT_KEY, String(T0 + DAY));
    assert(awaitingAge(st, T0) === null, 'marca no futuro não vale');
  }

  console.log(`\n${passed} ok, ${failed} falharam`);
  if (failed > 0) process.exit(1);
}

main();
