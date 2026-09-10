// PERDA DE DADO POR COTA + SYNC EM DOIS APARELHOS.
//
// Reproduz a queixa real: "repertório grande, sincronizar em dois celulares
// está com bug, não sobe e não puxa sempre, some ritmo dos caras".
//
// Roda: npx tsx test/storage-quota-multidevice-test.ts

import './_browser-polyfill';
import { SetlistManager } from '../src/core/SetlistManager';
import { UserRhythmService } from '../src/core/UserRhythmService';

declare const __setQuota: (b: number) => void;
declare const __usedBytes: () => number;
declare const __clearIDB: () => void;
declare const __breakIDB: (v?: boolean) => void;
declare const __clearListeners: () => void;
declare const __setOnline: () => void;

let passed = 0, failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✅ ${m}`); } else { failed++; console.log(`  ❌ FALHOU: ${m}`); }
}
const section = (t: string) => console.log(`\n═══ ${t} ═══`);
const tick = (ms = 50) => new Promise(r => setTimeout(r, ms));
const clone = (x: any) => JSON.parse(JSON.stringify(x));

/** Ritmo realista de ~20KB (média medida no catálogo de 180 ritmos). */
function bigRhythmData(seed: string): any {
  const grid = <T,>(f: () => T) => Array.from({ length: 12 }, () => Array.from({ length: 16 }, f));
  const v = () => ({
    pattern: grid(() => seed.length % 2 === 0),
    volumes: grid(() => 0.8125),
    audioFiles: Array.from({ length: 12 }, (_, c) => ({ fileName: `s-${c}-${seed}.wav`, midiPath: `/midi/s${c}.wav`, audioData: '' })),
    steps: 16, speed: 1,
  });
  return { version: '1.5', tempo: 120, beatsPerBar: 4,
    patternSteps: { main: 16, fill: 16, end: 16, intro: 8 },
    variations: { main: [v(), v(), v()], fill: [v(), v(), v()], end: [v()], intro: [v()] } };
}

interface Store { fav: Map<string, any>; rhy: Map<string, any>; }
const newStore = (): Store => ({ fav: new Map(), rhy: new Map() });

function fakeSupabase(store: Store): any {
  class B {
    table: string; f: Record<string, any> = {}; action: string | null = null; payload: any = null;
    constructor(t: string) { this.table = t; }
    select() { this.action = 'select'; return this; }
    eq(c: string, v: any) { this.f[c] = v; return this; }
    order() { return this; }
    maybeSingle() { return this; }
    upsert(p: any) { this.action = 'upsert'; this.payload = p; return this.run(); }
    insert(p: any) { this.action = 'insert'; this.payload = p; return this.run(); }
    delete() { this.action = 'delete'; return this; }
    then(r: any, j: any) { return this.run().then(r, j); }
    run(): Promise<any> {
      if (!(globalThis as any).navigator.onLine) return Promise.reject(new Error('offline'));
      if (this.action === 'select') {
        if (this.table === 'gdrums_favorites') {
          const row = store.fav.get(this.f.user_id) || null;
          return Promise.resolve({ data: row ? clone(row) : null, error: null });
        }
        return Promise.resolve({ data: clone([...store.rhy.values()].filter(r => r.user_id === this.f.user_id)), error: null });
      }
      if (this.action === 'upsert' || this.action === 'insert') {
        if (this.table === 'gdrums_favorites') store.fav.set(this.payload.user_id, clone(this.payload));
        else store.rhy.set(this.payload.id, clone(this.payload));
        return Promise.resolve({ error: null });
      }
      if (this.action === 'delete') { store.rhy.delete(this.f.id); return Promise.resolve({ error: null }); }
      return Promise.resolve({ data: null, error: null });
    }
  }
  return { from: (t: string) => new B(t) };
}

/** Aparelho novo: storage local zerado, servidor preservado. */
function newDevice(): void {
  (globalThis as any).localStorage.clear();
  __clearIDB(); __clearListeners(); __setOnline(); __setQuota(0); __breakIDB(false);
}
const UID = 'user-1';
const setlistItems = (sm: SetlistManager, id: string) => sm.getItemsOf(id).length;

async function main(): Promise<void> {
  section('A) Cota estourada: ritmos pessoais sobrevivem ao reload');
  {
    newDevice();
    const svc = new UserRhythmService();
    await tick();
    __setQuota(140 * 1024); // cabem uns poucos ritmos de ~20KB
    for (let i = 1; i <= 12; i++) svc.save(`Ritmo ${i}`, 100 + i, bigRhythmData(`r${i}`));
    await tick();

    assert(svc.getAll().length === 12, 'os 12 ritmos estão em memória');
    assert(svc.isLocalStorageUnreliable(), 'o app DETECTOU que o localStorage recusou (antes era silencioso)');
    let lsN = -1;
    try { lsN = JSON.parse(localStorage.getItem('gdrums-user-rhythms') || '[]').length; } catch { /* noop */ }
    assert(lsN < 12, `localStorage ficou defasado (${lsN} de 12) — é o bug do cliente`);

    __clearListeners();
    const svc2 = new UserRhythmService();
    await tick(120);
    assert(svc2.getAll().length === 12, `após o reload os 12 VOLTARAM via IndexedDB (tinha ${svc2.getAll().length})`);
  }

  section('B) Cota estourada: repertório grande sobrevive ao reload');
  {
    newDevice();
    const sm = new SetlistManager();
    await tick();
    const id = sm.createSetlist('Show de sábado')!;
    sm.switchSetlist(id);
    for (let i = 1; i <= 40; i++) sm.addItem({ name: `Música ${i} com nome comprido pra ocupar espaço`, path: `/rhythm/M${i}.json` });
    await tick();

    __setQuota(Math.floor(__usedBytes() * 0.6)); // aperta DEPOIS
    for (let i = 41; i <= 60; i++) sm.addItem({ name: `Música ${i} com nome comprido pra ocupar espaço`, path: `/rhythm/M${i}.json` });
    await tick();

    assert(sm.getItems().length === 60, 'em memória o repertório tem 60 músicas');
    assert(sm.isLocalStorageUnreliable(), 'o app DETECTOU a cota estourada');

    __clearListeners();
    const sm2 = new SetlistManager();
    await tick(120);
    assert(setlistItems(sm2, id) === 60, `após o reload as 60 músicas VOLTARAM (tinha ${setlistItems(sm2, id)})`);
    assert(sm2.getNameOf(id) === 'Show de sábado', 'nome do repertório preservado');
  }

  section('C) Cota estourada NÃO impede a subida pro servidor');
  {
    newDevice();
    const store = newStore();
    const sm = new SetlistManager();
    await tick();
    await sm.initWithUser(UID, fakeSupabase(store));
    const id = sm.createSetlist('Repertório grande')!;
    sm.switchSetlist(id);
    for (let i = 1; i <= 30; i++) sm.addItem({ name: `Faixa ${i}`, path: `/rhythm/F${i}.json` });
    await tick();
    __setQuota(Math.floor(__usedBytes() * 0.5));
    sm.addItem({ name: 'Faixa 31 depois da cota estourar', path: '/rhythm/F31.json' });
    await tick();
    await (sm as any).mergePush();
    await tick();
    const n = store.fav.get(UID)?.setlists?.setlists?.find((s: any) => s.id === id)?.items?.length ?? 0;
    assert(n === 31, `servidor recebeu as 31 mesmo com localStorage cheio (tinha ${n})`);
  }

  section('D) Dois aparelhos: cada um cria o seu, os dois ficam com tudo');
  {
    const store = newStore();
    newDevice();
    const a = new SetlistManager(); await tick();
    await a.initWithUser(UID, fakeSupabase(store));
    const idA = a.createSetlist('Baile do A')!;
    a.switchSetlist(idA);
    a.addItem({ name: 'Vaneira', path: '/rhythm/Vaneira.json' });
    a.addItem({ name: 'Bugio', path: '/rhythm/Bugio.json' });
    await tick(); await (a as any).mergePush(); await tick();

    newDevice();
    const b = new SetlistManager(); await tick();
    await b.initWithUser(UID, fakeSupabase(store)); await tick();
    assert(b.getSetlists().some(s => s.id === idA), 'B puxou o repertório criado no A');
    const idB = b.createSetlist('Culto do B')!;
    b.switchSetlist(idB);
    b.addItem({ name: 'Gospel 1', path: '/rhythm/G1.json' });
    await tick(); await (b as any).mergePush(); await tick();

    await (a as any).mergePush(); await tick();
    const ids = a.getSetlists().map(s => s.id);
    assert(ids.includes(idA) && ids.includes(idB), 'A ficou com os DOIS repertórios');
    assert(setlistItems(a, idA) === 2, 'o repertório do A manteve as 2 músicas');
    assert(setlistItems(a, idB) === 1, 'A recebeu a música do repertório do B');
  }

  section('E) Dois aparelhos: exclusão propaga e NÃO ressuscita no reload');
  {
    const store = newStore();
    newDevice();
    const a = new SetlistManager(); await tick();
    await a.initWithUser(UID, fakeSupabase(store));
    const alvo = a.createSetlist('Vai ser excluído')!;
    a.switchSetlist(alvo); a.addItem({ name: 'X', path: '/r/X.json' });
    const fica = a.createSetlist('Fica')!;
    a.switchSetlist(fica); a.addItem({ name: 'Y', path: '/r/Y.json' });
    await tick(); await (a as any).mergePush(); await tick();

    newDevice();
    const b = new SetlistManager(); await tick();
    await b.initWithUser(UID, fakeSupabase(store)); await tick();
    b.deleteSetlist(alvo);
    await tick(); await (b as any).mergePush(); await tick();

    await (a as any).mergePush(); await tick();
    assert(!a.getSetlists().some(s => s.id === alvo), 'exclusão feita no B propagou pro A');
    assert(a.getSetlists().some(s => s.id === fica), 'o outro repertório continua vivo');

    __clearListeners();
    const a2 = new SetlistManager(); await tick(120);
    await a2.initWithUser(UID, fakeSupabase(store)); await tick();
    assert(!a2.getSetlists().some(s => s.id === alvo), 'após reload o excluído NÃO ressuscitou (era o zumbi)');
  }

  section('F) Dois aparelhos: edição no B chega no A sem encolher');
  {
    const store = newStore();
    newDevice();
    const a = new SetlistManager(); await tick();
    await a.initWithUser(UID, fakeSupabase(store));
    const id = a.createSetlist('Compartilhado')!;
    a.switchSetlist(id); a.addItem({ name: 'M1', path: '/r/1.json' });
    await tick(); await (a as any).mergePush(); await tick();

    newDevice();
    const b = new SetlistManager(); await tick();
    await b.initWithUser(UID, fakeSupabase(store)); await tick();
    b.switchSetlist(id);
    b.addItem({ name: 'M2', path: '/r/2.json' });
    b.addItem({ name: 'M3', path: '/r/3.json' });
    await tick(); await (b as any).mergePush(); await tick();

    await (a as any).mergePush(); await tick();
    a.switchSetlist(id);
    assert(a.getItems().length === 3, `A recebeu as 3 músicas (tinha ${a.getItems().length})`);
    const nomes = a.getItems().map(i => i.name);
    assert(nomes.includes('M1') && nomes.includes('M3'), 'nenhuma música se perdeu no caminho');
  }

  section('G) Aparelho com cota estourada não empurra versão pobre no outro');
  {
    const store = newStore();
    newDevice();
    const a = new SetlistManager(); await tick();
    await a.initWithUser(UID, fakeSupabase(store));
    const id = a.createSetlist('Show completo')!;
    a.switchSetlist(id);
    for (let i = 1; i <= 25; i++) a.addItem({ name: `T${i}`, path: `/r/${i}.json` });
    await tick(); await (a as any).mergePush(); await tick();

    newDevice();
    __setQuota(2 * 1024); // absurdamente pequeno: nada cabe no localStorage
    const b = new SetlistManager(); await tick();
    await b.initWithUser(UID, fakeSupabase(store)); await tick(120);
    assert(setlistItems(b, id) === 25, `B puxou as 25 mesmo sem conseguir gravar local (tinha ${setlistItems(b, id)})`);
    await (b as any).mergePush(); await tick();

    const n = store.fav.get(UID)?.setlists?.setlists?.find((s: any) => s.id === id)?.items?.length ?? 0;
    assert(n === 25, `servidor continua com 25 (tinha ${n}) — B não sobrescreveu com versão pobre`);
    await (a as any).mergePush(); await tick();
    assert(setlistItems(a, id) === 25, `A continua íntegro com 25 (tinha ${setlistItems(a, id)})`);
  }

  section('H) IndexedDB indisponível (private mode) não quebra nada');
  {
    newDevice();
    __breakIDB(true);
    const sm = new SetlistManager(); await tick();
    const id = sm.createSetlist('Sem IDB')!;
    sm.switchSetlist(id); sm.addItem({ name: 'A', path: '/r/a.json' });
    await tick();
    assert(sm.getItems().length === 1, 'funciona normalmente sem IndexedDB');
    __clearListeners();
    const sm2 = new SetlistManager(); await tick(120);
    assert(setlistItems(sm2, id) === 1, 'reload recupera do localStorage, sem exceção');
    __breakIDB(false);
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`RESULTADO: ${passed} passou, ${failed} falhou, ${passed + failed} total`);
  console.log('══════════════════════════════════════════════════');
  if (failed > 0) { console.log('\n❌ Ainda há perda de dado.'); process.exit(1); }
  console.log('\n🎯 Cota estourada e dois aparelhos: nada some, nada ressuscita.');
  // Os setInterval de SetlistManager/UserRhythmService seguram o event loop
  // vivo; sem sair explicitamente o processo nunca termina.
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
