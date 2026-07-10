// Teste de PERSISTÊNCIA + OFFLINE + SYNC contra as classes REAIS
// (SetlistManager, UserRhythmService). Responde à pergunta direta:
// "ritmos padrão, ritmos salvos, nomes de repertório e músicas do
//  repertório estão salvando certo, disponíveis offline, e sincronizando
//  quando a internet volta?"
//
// Cobre:
//  A) Repertório: nomes + músicas persistem localmente e sobrevivem reload
//  B) Offline: tudo disponível sem rede (lê do localStorage)
//  C) Sync na volta da internet: o que foi feito offline SOBE certo
//  D) DEFESA ANTI-PERDA: banco vazio NUNCA apaga repertório local
//  E) Boot não trava quando navigator.onLine mente (withNetTimeout)
//  F) Ritmos salvos (Meus Ritmos): salvam offline, sincronizam, e o
//     rhythm_data (com groove) chega intato no banco
//  G) Exclusão offline: tombstone + exclui no banco na volta
//
// Roda: npx tsx test/persistence-sync-test.ts

import './_browser-polyfill';
import { SetlistManager } from '../src/core/SetlistManager';
import { UserRhythmService } from '../src/core/UserRhythmService';

declare const __fireOnline: () => void;
declare const __setOffline: () => void;
declare const __setOnline: () => void;
declare const __clearListeners: () => void;

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ FALHOU: ${msg}`); }
}
function section(t: string): void { console.log(`\n═══ ${t} ═══`); }
const tick = (ms = 60) => new Promise(r => setTimeout(r, ms));
const clone = (x: any) => JSON.parse(JSON.stringify(x));

// ── Fake Supabase que respeita navigator.onLine e registra escritas ────
interface Store { fav: Map<string, any>; rhy: Map<string, any>; writes: number; }
function newStore(): Store { return { fav: new Map(), rhy: new Map(), writes: 0 }; }

function fakeSupabase(store: Store, opts: { hang?: boolean; failWrites?: boolean } = {}): any {
  class B {
    table: string; filters: Record<string, any> = {}; action: string | null = null; payload: any = null; single = false;
    constructor(table: string) { this.table = table; }
    select() { this.action = 'select'; return this; }
    eq(c: string, v: any) { this.filters[c] = v; return this; }
    order() { return this; }
    maybeSingle() { this.single = true; return this; }
    upsert(p: any) { this.action = 'upsert'; this.payload = p; return this.run(); }
    insert(p: any) { this.action = 'insert'; this.payload = p; return this.run(); }
    delete() { this.action = 'delete'; return this; }
    then(res: any, rej: any) { return this.run().then(res, rej); }
    run(): Promise<any> {
      if (opts.hang) return new Promise(() => { /* nunca resolve = rede pendurada */ });
      // Offline REAL: fetch estoura → promise rejeita (exercita os catch)
      if (!(globalThis as any).navigator.onLine) return Promise.reject(new Error('offline'));
      const isWrite = this.action === 'upsert' || this.action === 'insert' || this.action === 'delete';
      if (opts.failWrites && isWrite) return Promise.resolve({ error: { message: 'net-fail' } });
      if (this.action === 'select') {
        if (this.table === 'gdrums_favorites') {
          const row = store.fav.get(this.filters.user_id) || null;
          return Promise.resolve({ data: row ? clone(row) : null, error: null });
        }
        const rows = [...store.rhy.values()].filter(r => r.user_id === this.filters.user_id);
        return Promise.resolve({ data: clone(rows), error: null });
      }
      if (this.action === 'upsert' || this.action === 'insert') {
        store.writes++;
        if (this.table === 'gdrums_favorites') store.fav.set(this.payload.user_id, clone(this.payload));
        else store.rhy.set(this.payload.id, clone(this.payload));
        return Promise.resolve({ error: null });
      }
      if (this.action === 'delete') {
        store.writes++;
        store.rhy.delete(this.filters.id);
        return Promise.resolve({ error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }
  }
  return { from: (table: string) => new B(table) };
}

function resetLocal(): void {
  (globalThis as any).localStorage.clear();
  __clearListeners();
  __setOnline();
}

async function main(): Promise<void> {
  const USER = 'user-1';

  // ═══════════════════════════════════════════════════════════════════
  section('A) Repertório: nomes + músicas salvam e sobrevivem reload');
  // ═══════════════════════════════════════════════════════════════════
  resetLocal();
  {
    const m = new SetlistManager();
    const culto = m.createSetlist('Culto Domingo')!;
    m.switchSetlist(culto);
    m.addItem({ name: 'Vaneira', path: '/rhythm/Vaneira.json' });
    m.addItem({ name: 'Xote', path: '/rhythm/Xote.json' });
    const pagode = m.createSetlist('Pagode')!;
    m.switchSetlist(pagode);
    m.addItem({ name: 'Meu Groove', path: '', userRhythmId: 'r1' });

    // Reload: nova instância lê o localStorage
    const m2 = new SetlistManager();
    const lists = m2.getSetlists();
    const byName = (n: string) => lists.find(l => l.name === n);
    assert(!!byName('Culto Domingo'), 'repertório "Culto Domingo" persistiu');
    assert(byName('Culto Domingo')?.count === 2, 'músicas do "Culto Domingo" (2) persistiram');
    assert(!!byName('Pagode'), 'repertório "Pagode" persistiu');
    assert(byName('Pagode')?.count === 1, 'música do "Pagode" (1) persistiu');
    // Conteúdo real das músicas (nome + path/userRhythmId)
    m2.switchSetlist(byName('Culto Domingo')!.id);
    const items = m2.getItems();
    assert(items[0].name === 'Vaneira' && items[0].path === '/rhythm/Vaneira.json', 'música 1 íntegra (nome + path)');
    assert(items[1].name === 'Xote', 'música 2 íntegra');
  }

  // ═══════════════════════════════════════════════════════════════════
  section('B) Offline: repertório disponível SEM rede');
  // ═══════════════════════════════════════════════════════════════════
  {
    __setOffline();
    const m = new SetlistManager(); // lê localStorage mesmo offline
    const lists = m.getSetlists();
    assert(lists.some(l => l.name === 'Culto Domingo'), 'repertório acessível offline');
    assert(lists.find(l => l.name === 'Culto Domingo')?.count === 2, 'músicas acessíveis offline');
    __setOnline();
  }

  // ═══════════════════════════════════════════════════════════════════
  section('C) Sync na volta da internet: edição offline SOBE certa');
  // ═══════════════════════════════════════════════════════════════════
  resetLocal();
  {
    const store = newStore();
    // Offline: cria repertório e adiciona músicas sem rede
    __setOffline();
    const m = new SetlistManager();
    await m.initWithUser(USER, fakeSupabase(store)); // offline → volta cedo, marca dirty
    const show = m.createSetlist('Show Sábado')!;
    m.switchSetlist(show);
    m.addItem({ name: 'Sertanejo', path: '/rhythm/Sertanejo.json' });
    m.addItem({ name: 'Forró', path: '/rhythm/Forro.json' });
    await tick();
    assert(store.fav.size === 0, 'offline: nada subiu pro banco ainda (correto)');

    // Internet volta → listener 'online' dispara saveRemote
    __fireOnline();
    await tick(120);
    const row = store.fav.get(USER);
    assert(!!row, 'reconectou: repertório subiu pro banco');
    const savedNames = (row?.setlists?.setlists || []).map((s: any) => s.name);
    assert(savedNames.includes('Show Sábado'), 'nome do repertório sincronizou');
    const showRemote = (row?.setlists?.setlists || []).find((s: any) => s.name === 'Show Sábado');
    assert(showRemote?.items?.length === 2, 'as 2 músicas sincronizaram (sem truncar)');
    assert(showRemote.items[0].name === 'Sertanejo' && showRemote.items[1].name === 'Forró', 'músicas certas, na ordem');
  }

  // ═══════════════════════════════════════════════════════════════════
  section('D) DEFESA ANTI-PERDA: banco vazio NÃO apaga repertório local');
  // ═══════════════════════════════════════════════════════════════════
  resetLocal();
  {
    const store = newStore();
    // Local tem repertório com músicas
    const m = new SetlistManager();
    const rep = m.createSetlist('Repertório do Zé')!;
    m.switchSetlist(rep);
    m.addItem({ name: 'Musica A', path: '/rhythm/A.json' });
    m.addItem({ name: 'Musica B', path: '/rhythm/B.json' });

    // Banco tem linha VAZIA e mais ANTIGA (cenário do bug: outro device zerou)
    store.fav.set(USER, { items: [], current_index: 0, setlists: { setlists: [], activeId: '' }, updated_at: '2000-01-01T00:00:00Z' });

    __setOnline();
    await m.initWithUser(USER, fakeSupabase(store));
    await tick();
    // Local intacto
    const lists = m.getSetlists();
    assert(lists.find(l => l.name === 'Repertório do Zé')?.count === 2, 'repertório local NÃO foi apagado pelo banco vazio');
    // E re-sincronizou local pro banco (não perde nos dois lados)
    const row = store.fav.get(USER);
    const rep2 = (row?.setlists?.setlists || []).find((s: any) => s.name === 'Repertório do Zé');
    assert(rep2?.items?.length === 2, 'banco foi RE-preenchido com o local (anti-perda dos dois lados)');
  }

  // ═══════════════════════════════════════════════════════════════════
  section('E) Boot NÃO trava quando navigator.onLine mente (withNetTimeout)');
  // ═══════════════════════════════════════════════════════════════════
  resetLocal();
  {
    const store = newStore();
    const m = new SetlistManager();
    const rep = m.createSetlist('Local Show')!;
    m.switchSetlist(rep);
    m.addItem({ name: 'X', path: '/rhythm/X.json' });

    // onLine=true (mentindo) + query que PENDURA pra sempre
    __setOnline();
    const t0 = Date.now();
    let resolved = false;
    const guard = new Promise<'timeout-guard'>(r => setTimeout(() => r('timeout-guard'), 9000));
    const result = await Promise.race([
      m.initWithUser(USER, fakeSupabase(store, { hang: true })).then(() => { resolved = true; return 'resolved'; }),
      guard,
    ]);
    const dt = Date.now() - t0;
    assert(result === 'resolved' && resolved, `initWithUser RESOLVEU apesar da rede pendurada (não travou o boot) — ${dt}ms`);
    assert(dt < 8000, `resolveu perto do withNetTimeout (6s), não no TCP do SO (levou ${dt}ms)`);
    // Local preservado mesmo com timeout
    assert(m.getSetlists().find(l => l.name === 'Local Show')?.count === 1, 'repertório local preservado no timeout');
  }

  // ═══════════════════════════════════════════════════════════════════
  section('F) Meus Ritmos: salva offline, sincroniza, groove chega intato');
  // ═══════════════════════════════════════════════════════════════════
  resetLocal();
  {
    const store = newStore();
    const rhythmData = {
      version: '1.6', tempo: 120,
      variations: { main: [{ pattern: [[true]], volumes: [[0.8]], offsets: [[0.25]], audioFiles: [], steps: 16, speed: 1 }] },
    };
    // Offline: salva ritmo pessoal
    __setOffline();
    const svc = new UserRhythmService();
    const saved = await svc.save('Meu Groove', 120, rhythmData, 'Vaneira');
    assert(svc.getAll().length === 1, 'ritmo salvo localmente offline');
    assert(saved.synced === false, 'ritmo marcado como pendente de sync');

    // Reload offline: ritmo continua lá
    const svc2 = new UserRhythmService();
    assert(svc2.getAll().length === 1, 'ritmo persistiu no reload (offline)');
    assert(svc2.getAll()[0].rhythm_data?.variations?.main?.[0]?.offsets?.[0]?.[0] === 0.25, 'groove (offset) preservado no local');

    // Internet volta → sincroniza
    __setOnline();
    await svc2.initWithUser(USER, fakeSupabase(store));
    await tick();
    assert(store.rhy.size === 1, 'ritmo subiu pro banco na reconexão');
    const remote = [...store.rhy.values()][0];
    assert(remote.name === 'Meu Groove' && remote.bpm === 120, 'nome + BPM sincronizaram');
    assert(remote.rhythm_data?.variations?.main?.[0]?.offsets?.[0]?.[0] === 0.25, 'groove (offset) chegou INTATO no banco');
    assert(remote.base_rhythm_name === 'Vaneira', 'ritmo-base sincronizou');
    assert(svc2.getAll()[0].synced === true, 'ritmo marcado como sincronizado');
  }

  // ═══════════════════════════════════════════════════════════════════
  section('G) Exclusão offline: tombstone + exclui no banco na volta');
  // ═══════════════════════════════════════════════════════════════════
  resetLocal();
  {
    const store = newStore();
    // Prepara: ritmo já sincronizado no banco
    __setOnline();
    const svc = new UserRhythmService();
    const r = await svc.save('Pra Excluir', 100, { version: '1.6', tempo: 100 });
    await svc.initWithUser(USER, fakeSupabase(store));
    await tick();
    assert(store.rhy.size === 1, 'setup: ritmo está no banco');

    // Offline: exclui
    __setOffline();
    await svc.delete(r.id);
    assert(svc.getAll().length === 0, 'ritmo sumiu do local na exclusão offline');
    assert(store.rhy.size === 1, 'offline: banco ainda tem (exclusão remota pendente)');

    // Internet volta → tombstone sincroniza a exclusão
    __setOnline();
    const changed = await svc.syncNow();
    await tick();
    assert(store.rhy.size === 0, 'reconectou: exclusão propagou pro banco');
    void changed;

    // Não ressuscita: novo init com banco vazio não traz de volta
    const svc2 = new UserRhythmService();
    await svc2.initWithUser(USER, fakeSupabase(store));
    await tick();
    assert(svc2.getAll().length === 0, 'ritmo excluído NÃO ressuscitou');
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`RESULTADO: ${passed} passou, ${failed} falhou, ${passed + failed} total`);
  console.log('══════════════════════════════════════════════════');
  if (failed > 0) { console.log('\n❌ Persistência/sync com falha.'); process.exit(1); }
  console.log('\n🎯 Repertórios (nomes+músicas) e ritmos salvos: persistem, offline, e sincronizam certo na volta da net.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
