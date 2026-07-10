// Auditoria do i18n — roda com: npx tsx test/i18n-audit.ts
//
// Valida a fase 1 (extração pt-BR):
//  1. Toda chamada t('chave') no src/ tem a chave no dicionário pt-BR
//     (chave órfã renderizaria a própria chave na tela).
//  2. Nenhuma chave do dicionário está vazia.
//  3. Chaves duplicadas entre módulos (um sobrescreveria o outro no merge).
//  4. Relatório de literais com acento RESTANTES por arquivo (heurística de
//     completude — alguns são legítimos: console.warn, comentários, admin).
//
// Admin (admin.ts) fica fora do i18n de propósito (painel interno).

import * as fs from 'fs';
import * as path from 'path';
import { pt } from '../src/i18n/pt';
import { main } from '../src/i18n/pt/main';
import { auth } from '../src/i18n/pt/auth';
import { plans } from '../src/i18n/pt/plans';
import { demo } from '../src/i18n/pt/demo';
import { ui } from '../src/i18n/pt/ui';
import { core } from '../src/i18n/pt/core';
import { dict as es419 } from '../src/i18n/es-419';
import { dict as en } from '../src/i18n/en';

const SRC = path.join(__dirname, '..', 'src');
const SKIP = ['auth/admin.ts', 'i18n']; // admin é PT-only; i18n é o próprio dicionário

let passed = 0;
let failed = 0;
const errors: string[] = [];

function check(cond: boolean, msg: string): void {
  if (cond) { passed++; } else { failed++; errors.push(msg); }
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = path.relative(SRC, p).replace(/\\/g, '/');
    if (SKIP.some((s) => rel.startsWith(s))) continue;
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

// ── 1. Toda chave usada existe no dicionário ──
const usedKeys = new Map<string, string>(); // chave → primeiro arquivo que usa
for (const file of walk(SRC)) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(SRC, file).replace(/\\/g, '/');
  for (const m of src.matchAll(/\bt\(\s*'([^']+)'/g)) {
    if (!usedKeys.has(m[1])) usedKeys.set(m[1], rel);
  }
}
for (const [key, file] of usedKeys) {
  check(key in pt, `chave usada mas AUSENTE no dicionário: '${key}' (${file})`);
}

// ── 2. Nenhuma chave vazia ──
for (const [key, value] of Object.entries(pt)) {
  check(typeof value === 'string' && value.length > 0, `chave com valor vazio: '${key}'`);
}

// ── 3. Duplicatas entre módulos ──
const modules: Array<[string, Record<string, string>]> = [
  ['main', main], ['auth', auth], ['plans', plans], ['demo', demo], ['ui', ui], ['core', core],
];
const seen = new Map<string, string>();
for (const [name, dict] of modules) {
  for (const key of Object.keys(dict)) {
    const prev = seen.get(key);
    check(!prev, `chave DUPLICADA entre módulos: '${key}' (${prev} e ${name})`);
    if (!prev) seen.set(key, name);
  }
}

// ── 3b. PARIDADE entre idiomas: cada locale tem EXATAMENTE as chaves
//        do pt-BR (faltar = usuário vê pt no meio do inglês; sobrar =
//        chave morta). Placeholders {x} também precisam bater. ──
const locales: Array<[string, Record<string, string>]> = [['es-419', es419], ['en', en]];
const placeholdersOf = (s: string) => (s.match(/\{[a-zA-Z0-9_]+\}/g) || []).sort().join(',');
for (const [name, dict] of locales) {
  for (const key of Object.keys(pt)) {
    check(key in dict, `[${name}] tradução FALTANDO pra chave '${key}'`);
    if (key in dict) {
      check(placeholdersOf(dict[key]) === placeholdersOf(pt[key]),
        `[${name}] placeholders divergem em '${key}' (pt: ${placeholdersOf(pt[key]) || 'nenhum'} vs ${name}: ${placeholdersOf(dict[key]) || 'nenhum'})`);
    }
  }
  for (const key of Object.keys(dict)) {
    check(key in pt, `[${name}] chave que NÃO existe no pt-BR: '${key}'`);
  }
}

// ── 4. Completude: literais com acento restantes (informativo) ──
console.log('── Literais com acento RESTANTES por arquivo (informativo) ──');
let remaining = 0;
for (const file of walk(SRC)) {
  const src = fs.readFileSync(file, 'utf8');
  // remove comentários pra não contar documentação
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const hits = noComments.match(/(['"`])(?:(?!\1)[^\\]|\\.)*[áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ](?:(?!\1)[^\\]|\\.)*\1/g) || [];
  if (hits.length > 0) {
    console.log(`  ${path.relative(SRC, file).replace(/\\/g, '/')}: ${hits.length}`);
    remaining += hits.length;
  }
}
console.log(`  TOTAL restante: ${remaining}`);

console.log('══════════════════════════════════════════════════');
console.log(`I18N: ${usedKeys.size} chaves em uso, ${Object.keys(pt).length} no dicionário | ${passed} ok, ${failed} problema(s)`);
console.log('══════════════════════════════════════════════════');
if (failed > 0) {
  errors.slice(0, 30).forEach((e) => console.log('  ❌ ' + e));
  process.exit(1);
} else {
  console.log('🎯 i18n íntegro: toda chave usada existe, sem vazias, sem duplicatas.');
}
