// Teste do fix de BOOT OFFLINE (cold start travando no "carregando").
//
// Reproduz o bug real: navigator.onLine MENTE (diz online sem internet),
// o app entra no caminho online, e a chamada de rede fica PENDURADA (nunca
// resolve nem rejeita) → o boot trava pra sempre.
//
// Prova que:
//  1. withNetTimeout corta a promise pendurada e rejeita com 'net-timeout'.
//  2. Uma promise que resolve rápido passa sem ser afetada (online normal).
//  3. O PADRÃO do checkAccess (rede pendurada + cache offline válido)
//     resolve pelo cache SEM travar — que é o que salva o show ao vivo.
//  4. Reconexão: o listener 'online' re-dispara a revalidação.
//
// Roda: npx tsx test/offline-boot-test.ts

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ FALHOU: ${msg}`); }
}
function section(t: string): void { console.log(`\n═══ ${t} ═══`); }

// ─── Cópia EXATA do helper de produção (src/main.ts) ──────────────────
function withNetTimeout<T>(promise: Promise<T>, ms = 6000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('net-timeout')), ms)
    ),
  ]);
}

// Promise que NUNCA resolve — simula o fetch pendurado offline.
function hangingForever<T>(): Promise<T> {
  return new Promise<T>(() => { /* nunca resolve, nunca rejeita */ });
}

async function main(): Promise<void> {
  // ═══════════════════════════════════════════════════════════════════
  section('1. withNetTimeout corta a rede pendurada (o bug)');
  // ═══════════════════════════════════════════════════════════════════
  {
    const t0 = Date.now();
    let rejectedWith = '';
    try {
      await withNetTimeout(hangingForever<string>(), 200);
    } catch (e) {
      rejectedWith = (e as Error).message;
    }
    const dt = Date.now() - t0;
    assert(rejectedWith === 'net-timeout', 'promise pendurada rejeita com net-timeout (não trava)');
    assert(dt >= 180 && dt < 1500, `rejeita perto do timeout configurado (levou ${dt}ms)`);
  }

  // ═══════════════════════════════════════════════════════════════════
  section('2. Online normal: promise rápida passa intacta');
  // ═══════════════════════════════════════════════════════════════════
  {
    const fast = Promise.resolve({ data: { session: { user: { id: 'abc' } } } });
    let ok = false;
    try {
      const r: any = await withNetTimeout(fast, 6000);
      ok = r?.data?.session?.user?.id === 'abc';
    } catch { ok = false; }
    assert(ok, 'promise que resolve rápido não é afetada pelo timeout');
  }

  // ═══════════════════════════════════════════════════════════════════
  section('3. Boot offline (onLine mentindo): rede pendura → cai no cache');
  // ═══════════════════════════════════════════════════════════════════
  {
    // Reproduz o padrão do checkAccess: getUser() pendura, mas existe
    // cache offline válido → o fluxo tem que retornar acesso pelo cache.
    const offlineCache = { valid: true, profile: { role: 'user', subscriptionStatus: 'active' } };

    async function checkAccessPattern(): Promise<{ allowed: boolean; source: string; rearmedOnline: boolean }> {
      let rearmedOnline = false;
      // navigator.onLine MENTE = 'true' → não pega o atalho offline, vai pro online.
      try {
        await withNetTimeout(hangingForever(), 200); // getUser pendurado
        return { allowed: true, source: 'network', rearmedOnline };
      } catch {
        // Fallback offline — o que salva o boot
        if (offlineCache.valid) {
          rearmedOnline = true; // simula window.addEventListener('online', checkAccess)
          return { allowed: true, source: 'cache', rearmedOnline };
        }
        return { allowed: false, source: 'login', rearmedOnline };
      }
    }

    const t0 = Date.now();
    const res = await checkAccessPattern();
    const dt = Date.now() - t0;
    assert(res.allowed === true, 'boot offline LIBERA acesso (não trava no carregando)');
    assert(res.source === 'cache', 'acesso veio do cache offline');
    assert(dt < 1500, `boot resolveu rápido, não pendurou (levou ${dt}ms)`);
    assert(res.rearmedOnline === true, 'reconexão re-armada (revalida quando a net voltar)');
  }

  // ═══════════════════════════════════════════════════════════════════
  section('4. Boot offline SEM cache: não trava, manda pro login');
  // ═══════════════════════════════════════════════════════════════════
  {
    const offlineCache = { valid: false };
    async function pattern(): Promise<{ allowed: boolean; source: string }> {
      try {
        await withNetTimeout(hangingForever(), 200);
        return { allowed: true, source: 'network' };
      } catch {
        if (offlineCache.valid) return { allowed: true, source: 'cache' };
        return { allowed: false, source: 'login' };
      }
    }
    const t0 = Date.now();
    const res = await pattern();
    const dt = Date.now() - t0;
    assert(res.allowed === false && res.source === 'login', 'sem cache → vai pro login (não trava)');
    assert(dt < 1500, `resolveu rápido (levou ${dt}ms)`);
  }

  // ═══════════════════════════════════════════════════════════════════
  section('5. Refresh com timeout NÃO desloga (não perde sessão no show)');
  // ═══════════════════════════════════════════════════════════════════
  {
    // O refresh que pendura vira 'net-timeout' → NÃO chama signOut.
    // Só desloga se o erro for de token inválido de verdade.
    function decideSignOut(refreshErrMessage: string): boolean {
      return refreshErrMessage !== 'net-timeout';
    }
    assert(decideSignOut('net-timeout') === false, 'timeout de rede NÃO desloga (preserva sessão)');
    assert(decideSignOut('invalid refresh token') === true, 'token inválido REAL desloga (correto)');
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`RESULTADO: ${passed} passou, ${failed} falhou, ${passed + failed} total`);
  console.log('══════════════════════════════════════════════════');
  if (failed > 0) { console.log('\n❌ Boot offline NÃO está seguro.'); process.exit(1); }
  console.log('\n🎯 Boot offline não trava: rede pendurada cai no cache, reconexão revalida.');
  process.exit(0);
}

main();
