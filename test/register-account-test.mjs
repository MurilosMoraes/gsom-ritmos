// Teste de COMPORTAMENTO da edge function register-account.
//
// Executa o código REAL da função (transpilado, com emailGuard.ts embutido)
// contra um Supabase simulado em memória, e compara:
//   - BRASIL: a função nova (v12) tem que responder e gravar EXATAMENTE igual
//     à anterior (v11/v9, lida do git) em todos os cenários, inclusive app
//     antigo que não manda `country`.
//   - INTERNACIONAL: sem CPF, signUp (confirmação de e-mail), guardas de
//     e-mail, rate limit, duplicidade, rollback.
//
// Roda: node test/register-account-test.mjs
// (usa `git show <ref>:...` pra versão anterior; padrão 6014704, troque com BASE_REF=)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(path.join(root, 'package.json'));
const esbuild = require('esbuild');
const FN = 'supabase/functions/register-account';
// 6014704 = main antes do cadastro internacional (função igual à v11 de produção).
const BASE_REF = process.env.BASE_REF || '6014704';

function compile(indexSrc, guardSrc, tag) {
  const guard = guardSrc.replace(/^export /gm, '');
  const src = indexSrc
    .replace(/^import \{ serve \}.*$/m, `const serve = (h) => { globalThis.__handlers[${JSON.stringify(tag)}] = h; };`)
    .replace(/^import \{ createClient \}.*$/m, 'const createClient = (...a) => globalThis.__createClient(...a);')
    .replace(/^import \{[^}]*\} from "\.\/emailGuard\.ts";$/m, guard);
  return esbuild.transformSync(src, { loader: 'ts', format: 'esm' }).code;
}

// Relógio congelado: as duas versões rodam em milissegundos diferentes e
// gravam datas (trial, updated_at). Com o relógio fixo, a comparação é exata.
const FIXED_NOW = Date.parse('2026-09-17T12:00:00.000Z');
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [FIXED_NOW])); }
  static now() { return FIXED_NOW; }
};

globalThis.__handlers = {};
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'SERVICE', SUPABASE_ANON_KEY: 'ANON' })[k] } };

const newCode = compile(fs.readFileSync(path.join(root, FN, 'index.ts'), 'utf8'), fs.readFileSync(path.join(root, FN, 'emailGuard.ts'), 'utf8'), 'new');
const oldCode = compile(
  execSync(`git show ${BASE_REF}:${FN}/index.ts`, { cwd: root }).toString(),
  execSync(`git show ${BASE_REF}:${FN}/emailGuard.ts`, { cwd: root }).toString(),
  'old',
);
const load = async (code) => import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
await load(newCode);
await load(oldCode);

// ─── Supabase em memória ──────────────────────────────────────────────
let db;
function freshDb(seed = {}) {
  db = {
    users: [], profiles: [], attempts: [], log: [], confirmEmail: true, failProfileUpdate: false,
    ...seed,
  };
}
let idSeq = 0;
globalThis.crypto.randomUUID = () => `uuid-${++idSeq}`;

globalThis.__createClient = (_url, key) => ({
  from(table) {
    const st = { op: 'select', filters: [], payload: null, head: false };
    const rows = () => {
      const src = table === 'gdrums_profiles' ? db.profiles : table === 'gdrums_signup_attempts' ? db.attempts : [];
      return src.filter(r => st.filters.every(([k, op, v]) => op === 'eq' ? r[k] === v : r[k] >= v));
    };
    const run = () => {
      if (st.op === 'update') {
        db.log.push(['update', table, st.payload]);
        if (db.failProfileUpdate) return { data: null, error: { message: 'no row' } };
        const rs = rows();
        rs.forEach(r => Object.assign(r, st.payload));
        return { data: null, error: rs.length ? null : { message: 'no row' } };
      }
      if (st.op === 'delete') {
        db.log.push(['delete', table, st.filters]);
        if (table === 'gdrums_profiles') db.profiles = db.profiles.filter(r => !rows().includes(r));
        return { data: null, error: null };
      }
      const rs = rows();
      if (st.head) return { data: null, count: rs.length, error: null };
      return { data: rs, error: null };
    };
    const api = {
      select(_c, opts) { if (opts?.head) st.head = true; return api; },
      eq(k, v) { st.filters.push([k, 'eq', v]); return api; },
      gte(k, v) { st.filters.push([k, 'gte', v]); return api; },
      update(p) { st.op = 'update'; st.payload = p; return api; },
      delete() { st.op = 'delete'; return api; },
      async insert(p) {
        db.log.push(['insert', table, p]);
        if (table === 'gdrums_signup_attempts') db.attempts.push({ ...p, created_at: new Date().toISOString() });
        return { data: null, error: null };
      },
      async upsert(p) {
        db.log.push(['upsert', table, p]);
        const dup = db.profiles.find(r => r.id !== p.id && ((p.cpf_hash && r.cpf_hash === p.cpf_hash) || (p.phone && r.phone === p.phone)));
        if (dup) return { error: { code: '23505', message: p.phone && dup.phone === p.phone ? 'dup phone' : 'dup cpf' } };
        const ex = db.profiles.find(r => r.id === p.id);
        if (ex) Object.assign(ex, p); else db.profiles.push({ country: 'BR', ...p });
        return { error: null };
      },
      async maybeSingle() { const r = run(); return { data: r.data?.[0] ?? null, error: null }; },
      async single() { const r = run(); return { data: r.data?.[0] ?? null, error: r.data?.[0] ? null : { message: 'none' } }; },
      then(ok, ko) { return Promise.resolve(run()).then(ok, ko); },
    };
    return api;
  },
  auth: {
    admin: {
      async createUser({ email, email_confirm }) {
        if (key !== 'SERVICE') throw new Error('admin API com chave errada');
        db.log.push(['admin.createUser', email, email_confirm]);
        if (db.users.some(u => u.email === email)) return { data: null, error: { message: 'User already registered' } };
        const u = { id: `user-${db.users.length + 1}`, email, email_confirmed_at: email_confirm ? 'now' : null };
        db.users.push(u);
        db.profiles.push({ id: u.id, country: 'BR', cpf_hash: null, phone: null }); // trigger do banco
        return { data: { user: u }, error: null };
      },
      async deleteUser(id) { db.log.push(['admin.deleteUser', id]); db.users = db.users.filter(u => u.id !== id); return {}; },
    },
    async signUp({ email, options }) {
      if (key !== 'ANON') throw new Error('signUp deveria usar a chave pública');
      db.log.push(['signUp', email, options?.emailRedirectTo]);
      if (db.users.some(u => u.email === email)) {
        return { data: { user: { id: 'fake', identities: [] }, session: null }, error: null }; // anti-enumeração
      }
      const u = { id: `user-${db.users.length + 1}`, email, identities: [{}], email_confirmed_at: db.confirmEmail ? null : 'now' };
      db.users.push(u);
      db.profiles.push({ id: u.id, country: 'BR', cpf_hash: null, phone: null });
      return { data: { user: u, session: db.confirmEmail ? null : {} }, error: null };
    },
  },
});

// setTimeout do "aguarda trigger" sem esperar de verdade
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, _ms, ...a) => realSetTimeout(fn, 0, ...a);

async function call(tag, body, { ip = '1.1.1.1', raw } = {}) {
  const req = new Request('https://x/functions/v1/register-account', {
    method: 'POST',
    body: raw ?? JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
  });
  const res = await globalThis.__handlers[tag](req);
  const json = await res.json();
  // normaliza ids aleatórios pra comparação
  return { status: res.status, json };
}

let passed = 0, failed = 0;
function ok(cond, msg, extra) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ FALHOU: ${msg}`); if (extra) console.log('     ', JSON.stringify(extra).slice(0, 600)); }
}

// CPFs válidos (dígito verificador correto)
const CPF1 = '529.982.247-25';
const CPF2 = '111.444.777-35';
const base = { name: 'João da Silva', email: 'joao@gmail.com', password: 'segredo1', cpf: CPF1, phone: '(51) 99999-8888' };

// ─── 1. BRASIL: nova == antiga ────────────────────────────────────────
console.log('═══ Brasil: versão nova responde e grava IGUAL à atual ═══\n');

const brCases = [
  ['cadastro completo (app antigo, sem country)', [base]],
  ['cadastro com country BR', [{ ...base, country: 'BR' }]],
  ['country "br" minúsculo', [{ ...base, country: 'br' }]],
  ['country vazio', [{ ...base, country: '' }]],
  ['sem telefone', [{ ...base, phone: '' }]],
  ['CPF inválido', [{ ...base, cpf: '123.456.789-00' }]],
  ['sem CPF', [{ ...base, cpf: '' }]],
  ['telefone curto', [{ ...base, phone: '1234' }]],
  ['nome curto', [{ ...base, name: 'Jo' }]],
  ['senha curta', [{ ...base, password: '123' }]],
  ['e-mail sem @', [{ ...base, email: 'joao.gmail.com' }]],
  ['e-mail descartável', [{ ...base, email: 'x@mailinator.com' }]],
  ['e-mail com domínio errado', [{ ...base, email: 'joao@gmail.come' }]],
  ['CPF duplicado', [base, { ...base, email: 'outro@gmail.com', phone: '' }]],
  ['telefone duplicado', [base, { ...base, email: 'outro@gmail.com', cpf: CPF2 }]],
  ['e-mail duplicado', [base, { ...base, cpf: CPF2, phone: '' }]],
  ['UTM de origem gravada', [{ ...base, signup_source: 'instagram', signup_campaign: 'x' }]],
];
const strip = (x) => JSON.parse(JSON.stringify(x));
for (const [name, bodies] of brCases) {
  const snapshots = {};
  for (const tag of ['old', 'new']) {
    freshDb(); idSeq = 0;
    const responses = [];
    for (const b of bodies) responses.push(await call(tag, b));
    snapshots[tag] = strip({ responses, profiles: db.profiles, users: db.users, log: db.log, attempts: db.attempts });
  }
  const same = JSON.stringify(snapshots.old) === JSON.stringify(snapshots.new);
  ok(same, `${name}: resposta + banco idênticos (${snapshots.new.responses.map(r => r.status).join(',')})`, same ? null : snapshots);
}

// Falha na gravação do perfil: rollback igual nas duas
for (const tag of ['old', 'new']) {
  freshDb({ failProfileUpdate: true }); idSeq = 0;
  // perfil da trigger não existe → update falha → upsert cria
  const r = await call(tag, base);
  ok(r.status === 200 && db.profiles.length === 1 && db.profiles[0].cpf_hash, `[${tag}] update falhou → upsert salva o perfil`, r);
}
{
  freshDb(); idSeq = 0;
  const r = await call('new', null, { raw: '{quebrado' });
  ok(r.status === 400 && db.users.length === 0, 'JSON inválido → 400 sem criar nada (antes era 500)', r);
}
{
  freshDb(); idSeq = 0;
  await call('new', base);
  ok(db.log.some(l => l[0] === 'admin.createUser' && l[2] === true) && !db.log.some(l => l[0] === 'signUp'), 'BR usa admin.createUser (já confirmado), nunca signUp');
  ok(db.attempts.length === 0, 'BR não grava tentativa (sem rate limit, grupo de igreja no mesmo Wi-Fi)');
  ok(db.profiles[0].country === 'BR', 'perfil BR fica com country BR');
}

// ─── 2. INTERNACIONAL ─────────────────────────────────────────────────
console.log('\n═══ Internacional ═══\n');
const intl = { name: 'John Smith', email: 'john@gmail.com', password: 'secret12', country: 'US' };
{
  freshDb(); idSeq = 0;
  const r = await call('new', intl);
  ok(r.status === 200 && r.json.success, 'cadastro sem CPF funciona', r);
  ok(r.json.confirmation_required === true, 'pede confirmação de e-mail', r.json);
  ok(db.log.some(l => l[0] === 'signUp' && l[2] === 'https://gdrums.com.br/login.html'), 'usa signUp com a chave pública (Supabase envia o e-mail)');
  ok(!db.log.some(l => l[0] === 'admin.createUser'), 'não usa admin.createUser');
  const p = db.profiles[0];
  ok(p.country === 'US' && p.cpf_hash === null && p.subscription_status === 'trial', 'perfil: country US, sem CPF, trial', p);
  ok(db.attempts.map(a => a.outcome).join(',') === 'attempt,created', 'registra tentativa e criação');
}
{
  freshDb({ confirmEmail: false }); idSeq = 0;
  const r = await call('new', intl);
  ok(r.status === 200 && r.json.confirmation_required === false, 'toggle "Confirm email" desligado: não mente, loga direto', r.json);
}
{
  freshDb(); idSeq = 0;
  const r = await call('new', { ...intl, cpf: 'qualquer', country: 'PT' });
  ok(r.status === 200 && db.profiles[0].cpf_hash === null, 'CPF enviado por estrangeiro é ignorado');
}
for (const [label, body, code, status] of [
  ['e-mail descartável', { ...intl, email: 'a@mailinator.com' }, 'disposable_email', 400],
  ['e-mail fmail.com (farming visto em produção)', { ...intl, email: 'a@fmail.com' }, 'disposable_email', 400],
  ['domínio digitado errado', { ...intl, email: 'john@gmail.come' }, 'email_typo', 400],
  ['final inexistente (.con)', { ...intl, email: 'john@empresa.con' }, 'email_typo', 400],
  // Todo erro do caminho internacional tem CÓDIGO: é por ele que o app
  // mostra a mensagem no idioma do cliente (o servidor responde em inglês).
  ['e-mail sem domínio', { ...intl, email: 'john@gmail' }, 'invalid_email', 400],
  ['nome curto', { ...intl, name: 'Jo' }, 'invalid_name', 400],
  ['senha curta', { ...intl, password: '123' }, 'weak_password', 400],
  ['telefone absurdo', { ...intl, phone: '12' }, 'invalid_phone', 400],
]) {
  freshDb(); idSeq = 0;
  const r = await call('new', body);
  ok(r.status === status && r.json.code === code && db.users.length === 0, `${label} → ${status}${code ? ' ' + code : ''}, nada criado`, r);
}
{
  freshDb(); idSeq = 0;
  const r = await call('new', { ...intl, email: 'john@gmail.come' });
  ok(/john@gmail\.com\?/.test(r.json.error), 'erro de digitação sugere o e-mail certo, em inglês', r.json);
}
{
  freshDb(); idSeq = 0;
  await call('new', intl);
  const r = await call('new', { ...intl, name: 'Other' }, { ip: '2.2.2.2' });
  ok(r.status === 409 && r.json.code === 'email_duplicate' && db.users.length === 1, 'e-mail já cadastrado → 409 sem criar outro', r);
}
{
  freshDb(); idSeq = 0;
  // 20 por hora por IP (era 5, que barrava banda/igreja no mesmo Wi-Fi).
  const codes = [];
  for (let i = 0; i < 22; i++) codes.push((await call('new', { ...intl, email: `u${i}@gmail.com` }, { ip: '9.9.9.9' })).status);
  ok(codes.slice(0, 20).every(s => s === 200) && codes[20] === 429 && codes[21] === 429, `rate limit por IP: 20 passam, 21ª bloqueada (${codes.slice(18).join(',')})`);
  const other = await call('new', { ...intl, email: 'z@gmail.com' }, { ip: '8.8.8.8' });
  ok(other.status === 200, 'outro IP não é afetado');
  // BR no mesmo IP bloqueado continua livre
  const br = await call('new', { ...base, email: 'br@gmail.com' }, { ip: '9.9.9.9' });
  ok(br.status === 200, 'brasileiro no IP bloqueado continua cadastrando (rate limit só no internacional)', br);
}
{
  freshDb(); idSeq = 0;
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await call('new', { ...intl, email: 'same@gmail.com' }, { ip: `7.7.7.${i}` })).status);
  ok(codes.join(',') === '200,409,409,429', `rate limit por e-mail (IPs diferentes): 1ª cria, 2ª e 3ª duplicado, 4ª bloqueada (${codes.join(',')})`);
}
{
  freshDb({ failProfileUpdate: true }); idSeq = 0;
  db.profiles.push({ id: 'other', phone: '5551999', cpf_hash: null }); // força 23505 no upsert
  const r = await call('new', { ...intl, phone: '5551999' });
  ok(r.status === 500 && db.users.length === 0 && !db.profiles.some(p => p.id === 'user-1'), 'falha ao gravar perfil → rollback (usuário apagado)', { r, users: db.users });
}
{
  freshDb(); idSeq = 0;
  const r = await call('new', { ...intl, country: 'X'.repeat(200) });
  ok(r.status === 200 && db.profiles[0].country.length <= 16, 'country gigante é cortado');
}

console.log(`\n${passed} ok, ${failed} falharam`);
process.exit(failed ? 1 : 0);
