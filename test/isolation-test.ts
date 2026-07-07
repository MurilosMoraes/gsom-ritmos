// Teste de isolamento de dados entre contas no MESMO device.
//
// Simula o cenário real que causou o bug: localStorage/IndexedDB do
// repertório e dos ritmos personalizados eram chaves GLOBAIS do device,
// não por usuário. Um device que já logou com a conta A, ao logar com a
// conta B, herdava o repertório/ritmos de A antes mesmo de saber quem
// era B — e o merge por timestamp podia até subir esse dado alheio pro
// banco da conta errada.
//
// Roda com: npx tsx test/isolation-test.ts

// ─── Polyfills mínimos de browser pra rodar em Node ──────────────────
class FakeLocalStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string): void { this.store.set(key, String(value)); }
  removeItem(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
  key(i: number): string | null { return Array.from(this.store.keys())[i] ?? null; }
  get length(): number { return this.store.size; }
}

(globalThis as any).localStorage = new FakeLocalStorage();
(globalThis as any).window = { addEventListener: () => {}, removeEventListener: () => {} };
(globalThis as any).navigator = { onLine: false, storage: undefined };

// ─── Assert helpers (mesmo estilo do engine-test.ts) ─────────────────
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.log(`  ❌ ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, `${message} (esperado: ${JSON.stringify(expected)}, veio: ${JSON.stringify(actual)})`);
}

function section(title: string): void {
  console.log(`\n═══ ${title} ═══`);
}

async function main(): Promise<void> {
  if (!(globalThis as any).crypto?.randomUUID) {
    const nodeCrypto = await import('node:crypto');
    (globalThis as any).crypto = { randomUUID: () => nodeCrypto.randomUUID() };
  }

  const { SetlistManager } = await import('../src/core/SetlistManager');
  const { UserRhythmService } = await import('../src/core/UserRhythmService');

  const localStorageRaw = (globalThis as any).localStorage as FakeLocalStorage;
  const fakeSupabase = {}; // nunca deveria ser chamado — testes rodam offline de propósito

  // ════════════════════════════════════════════════════════════════
  section('1. SetlistManager — usuário único, nunca trocou de device (baseline)');
  // ════════════════════════════════════════════════════════════════
  {
    localStorageRaw.clear();
    const mgr = new SetlistManager();
    mgr.addItem({ name: 'Vaneira', path: '/rhythm/Vaneira.json' } as any);
    assertEqual(mgr.getItems().length, 1, 'Item adicionado antes do login');

    await mgr.initWithUser('user-A', fakeSupabase);

    assertEqual(mgr.getItems().length, 1, 'Item continua lá depois do initWithUser (sem tag prévia = migração transparente)');
    assertEqual(localStorageRaw.getItem('gdrums-setlists-v2-owner'), 'user-A', 'Tag de dono setada pro usuário atual');
  }

  // ════════════════════════════════════════════════════════════════
  section('2. SetlistManager — TROCA DE CONTA no mesmo device (o bug relatado)');
  // ════════════════════════════════════════════════════════════════
  {
    // Continua do estado do teste 1: device tem dado da conta A, tag = user-A.
    // Simula reabrir o app (nova instância) e logar com OUTRA conta.
    const mgr2 = new SetlistManager();
    // Antes de initWithUser, a instância nova carrega o que estava no
    // device — ainda é o dado de A (janela de risco já documentada).
    assertEqual(mgr2.getItems().length, 1, 'Pré-condição: nova instância ainda carrega dado de A do localStorage global');

    await mgr2.initWithUser('user-B', fakeSupabase);

    assertEqual(mgr2.getItems().length, 0, 'CRÍTICO: usuário B NÃO vê o repertório de A depois do initWithUser');
    assertEqual(localStorageRaw.getItem('gdrums-setlists-v2-owner'), 'user-B', 'Tag de dono agora é user-B');

    const archived = localStorageRaw.getItem('gdrums-setlists-v2:user-A');
    assert(!!archived && archived.includes('Vaneira'), 'Dado de A foi ARQUIVADO (não apagado) numa chave namespaced');
  }

  // ════════════════════════════════════════════════════════════════
  section('3. SetlistManager — usuário A volta a logar no MESMO device');
  // ════════════════════════════════════════════════════════════════
  {
    // Estado atual do device: tag=user-B, conteúdo ativo vazio (o de B).
    const mgr3 = new SetlistManager();
    await mgr3.initWithUser('user-A', fakeSupabase);

    assertEqual(mgr3.getItems().length, 1, 'Repertório de A foi RESTAURADO do arquivo — nada foi perdido de verdade');
    assertEqual(mgr3.getItems()[0]?.name, 'Vaneira', 'É o item certo (Vaneira) que A tinha antes');
    assertEqual(localStorageRaw.getItem('gdrums-setlists-v2-owner'), 'user-A', 'Tag de dono voltou pra user-A');
  }

  // ════════════════════════════════════════════════════════════════
  section('4. SetlistManager — usuário B loga de novo, confirma que o dele também não sumiu');
  // ════════════════════════════════════════════════════════════════
  {
    const mgr4 = new SetlistManager();
    await mgr4.initWithUser('user-B', fakeSupabase);
    // B nunca teve item nenhum (só trocou de repertório ativo vazio) — o
    // importante aqui é que NÃO reaparece o item da A.
    assertEqual(mgr4.getItems().length, 0, 'B continua com o dele (vazio) — não herdou o de A de novo');
  }

  // ════════════════════════════════════════════════════════════════
  section('5. UserRhythmService — usuário único, baseline');
  // ════════════════════════════════════════════════════════════════
  {
    // NÃO faz localStorageRaw.clear() aqui — chaves de UserRhythmService
    // (gdrums-user-rhythms*) são prefixo diferente das de SetlistManager
    // (gdrums-setlists-v2*), e o teste 8 depende do estado acumulado das
    // seções 1-4 continuar intacto no mesmo localStorage compartilhado.
    const svc = new UserRhythmService();
    await svc.save('Meu Xote', 90, { fake: true });
    assertEqual(svc.getAll().length, 1, 'Ritmo salvo antes do login (offline, fica pendente)');

    await svc.initWithUser('user-A', fakeSupabase);

    assertEqual(svc.getAll().length, 1, 'Ritmo continua lá depois do initWithUser (migração transparente)');
    assertEqual(localStorageRaw.getItem('gdrums-user-rhythms-owner'), 'user-A', 'Tag de dono setada pro usuário atual');
  }

  // ════════════════════════════════════════════════════════════════
  section('6. UserRhythmService — TROCA DE CONTA no mesmo device');
  // ════════════════════════════════════════════════════════════════
  {
    const svc2 = new UserRhythmService();
    assertEqual(svc2.getAll().length, 1, 'Pré-condição: nova instância ainda carrega ritmo de A do localStorage global');

    await svc2.initWithUser('user-B', fakeSupabase);

    assertEqual(svc2.getAll().length, 0, 'CRÍTICO: usuário B NÃO vê os ritmos de A depois do initWithUser');
    assertEqual(localStorageRaw.getItem('gdrums-user-rhythms-owner'), 'user-B', 'Tag de dono agora é user-B');

    const archived = localStorageRaw.getItem('gdrums-user-rhythms:user-A');
    assert(!!archived && archived.includes('Meu Xote'), 'Ritmo de A foi ARQUIVADO (não apagado) numa chave namespaced');
  }

  // ════════════════════════════════════════════════════════════════
  section('7. UserRhythmService — usuário A volta a logar no MESMO device');
  // ════════════════════════════════════════════════════════════════
  {
    const svc3 = new UserRhythmService();
    await svc3.initWithUser('user-A', fakeSupabase);

    assertEqual(svc3.getAll().length, 1, 'Ritmo de A foi RESTAURADO do arquivo — nada foi perdido de verdade');
    assertEqual(svc3.getAll()[0]?.name, 'Meu Xote', 'É o ritmo certo (Meu Xote) que A tinha antes');
  }

  // ════════════════════════════════════════════════════════════════
  section('8. SetlistManager — martela trocas repetidas A↔B várias vezes seguidas');
  // ════════════════════════════════════════════════════════════════
  {
    // Continua de onde o teste 4 parou (device com dado de B, tag=user-B).
    for (let round = 0; round < 4; round++) {
      const mgrA = new SetlistManager();
      await mgrA.initWithUser('user-A', fakeSupabase);
      assertEqual(mgrA.getItems().length, 1, `Rodada ${round}: A vê o dele (1 item) — não contaminado por B`);
      assertEqual(mgrA.getItems()[0]?.name, 'Vaneira', `Rodada ${round}: item de A é o certo`);

      const mgrB = new SetlistManager();
      await mgrB.initWithUser('user-B', fakeSupabase);
      assertEqual(mgrB.getItems().length, 0, `Rodada ${round}: B vê o dele (vazio) — não contaminado por A`);
    }
  }

  // ════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════════════');
  console.log(`RESULTADO: ${passed} passou, ${failed} falhou, ${passed + failed} total`);
  console.log('══════════════════════════════════════════════════');
  if (failed > 0) {
    console.log('\n❌ Tem teste falhando — NÃO subir sem investigar.');
    process.exit(1);
  } else {
    console.log('\n🎯 Isolamento entre contas confirmado por execução real, não só leitura de código.');
  }
  // Cada instância de SetlistManager/UserRhythmService cria um
  // setInterval de retry que nunca é limpo (correto no app real, que só
  // instancia uma vez por carga de página) — aqui, com >10 instâncias
  // criadas ao longo do teste, isso prende o processo pra sempre. Força
  // saída explícita em vez de esperar o event loop esvaziar sozinho.
  process.exit(0);
}

main();
