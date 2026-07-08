// Auditoria PERMANENTE do catálogo de ritmos — roda com:
//   npx tsx test/rhythm-audit.ts
//
// Falha (exit 1) se qualquer ritmo NOVO entrar no catálogo com:
//  1. Razão de velocidade FRACIONÁRIA entre padrões que interagem
//     (virada×main, final×main, final×virada). Razão fracionária faz o
//     Math.round do timing de entrada (PatternEngine) furar o downbeat
//     — a virada/finalização termina até 1 step DEPOIS do 1 ("sobrando
//     um pouco", bug do Calypso/Baladas corrigido em 2026-07 via
//     normalização de dados: scripts/normalize-rhythm-speeds.js).
//  2. Estrutura quebrada (arrays com tamanho errado, steps fora de
//     4-32, canais != 12).
//
// WHITELIST: 5 ritmos com residual CONHECIDO e aceito — a frase de
// finalização deles tem 2 compassos sob main 4x e precisaria de 64
// steps pra fechar razão inteira (formato permite 32). Desvio máximo
// ~±1 step curto (~40-60ms). Zerável só via motor (quantização de
// entrada exata — planejada). NÃO adicionar ritmos novos aqui sem
// decisão consciente.

import * as fs from 'fs';
import * as path from 'path';

const DIR = path.join(__dirname, '..', 'public', 'rhythm');
const MAX_CHANNELS = 12;

const WHITELIST_FRACTIONAL: Record<string, string[]> = {
  'Frevo': ['FINALxMAIN', 'FINALxVIRADA'],
  'Frevo 2': ['FINALxMAIN', 'FINALxVIRADA'],
  'Marcha de Carnaval': ['FINALxMAIN', 'FINALxVIRADA'],
  'Reggae 2': ['FINALxMAIN', 'FINALxVIRADA'],
  'Reggae': ['FINALxVIRADA'],
};

interface Variation {
  pattern?: boolean[][];
  volumes?: number[][];
  offsets?: number[][];
  steps?: number;
  speed?: number;
}

const hasContent = (v: Variation | undefined): boolean =>
  !!v?.pattern?.some((r) => r.some((s) => s === true));

let passed = 0;
let failed = 0;
const errors: string[] = [];

function check(cond: boolean, msg: string): void {
  if (cond) { passed++; } else { failed++; errors.push(msg); }
}

const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'manifest.json');

// Manifest consistente com o diretório
for (const r of manifest.rhythms as string[]) {
  check(files.includes(r), `manifest lista "${r}" mas o arquivo não existe`);
}

for (const f of files) {
  const name = f.replace('.json', '');
  let j: any;
  try {
    j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  } catch {
    check(false, `${name}: JSON inválido`);
    continue;
  }

  const mains: Variation[] = (j.variations?.main || []).filter(hasContent);
  const fills: Variation[] = (j.variations?.fill || []).filter(hasContent);
  const ends: Variation[] = (j.variations?.end || []).filter(hasContent);
  check(mains.length > 0, `${name}: nenhuma variação main com conteúdo`);

  // ── Estrutura ──
  for (const type of ['main', 'fill', 'end', 'intro'] as const) {
    (j.variations?.[type] || []).forEach((v: Variation, i: number) => {
      if (!v?.pattern) return;
      const steps = v.steps || 16;
      const label = `${name} ${type}#${i}`;
      check(steps >= 4 && steps <= 32, `${label}: steps ${steps} fora de 4-32`);
      check(v.pattern.length === MAX_CHANNELS, `${label}: ${v.pattern.length} canais (esperado ${MAX_CHANNELS})`);
      check(v.pattern.every((r) => r.length === steps), `${label}: linha do pattern com tamanho != steps`);
      if (v.volumes) check(v.volumes.every((r) => r.length === steps), `${label}: linha de volumes com tamanho != steps`);
      if (v.offsets) {
        check(v.offsets.every((r) => r.length === steps), `${label}: linha de offsets com tamanho != steps`);
        check(v.offsets.every((r) => r.every((o) => o >= -0.5 && o <= 0.5)), `${label}: offset fora de ±0.5`);
      }
      const speed = v.speed || 1;
      check(speed >= 0.25 && speed <= 4, `${label}: speed ${speed} fora de 0.25-4`);
    });
  }

  // ── Razões de velocidade inteiras entre padrões que interagem ──
  const allowed = WHITELIST_FRACTIONAL[name] || [];
  const fractional = (a: Variation, b: Variation): boolean =>
    !Number.isInteger(((a.speed || 1) / (b.speed || 1)));

  for (const m of mains) {
    for (const fl of fills) {
      check(!fractional(fl, m) || allowed.includes('VIRADAxMAIN'),
        `${name}: VIRADA ${fl.steps}@${fl.speed}x sob MAIN ${m.steps}@${m.speed}x — razão fracionária (virada vai furar o downbeat). Rode scripts/normalize-rhythm-speeds.js`);
    }
    for (const e of ends) {
      check(!fractional(e, m) || allowed.includes('FINALxMAIN'),
        `${name}: FINAL ${e.steps}@${e.speed}x sob MAIN ${m.steps}@${m.speed}x — razão fracionária (finalização vai furar o downbeat). Rode scripts/normalize-rhythm-speeds.js`);
    }
  }
  for (const fl of fills) {
    for (const e of ends) {
      check(!fractional(e, fl) || allowed.includes('FINALxVIRADA'),
        `${name}: FINAL ${e.steps}@${e.speed}x sob VIRADA ${fl.steps}@${fl.speed}x — razão fracionária (finalização pisada durante a virada vai furar o downbeat). Rode scripts/normalize-rhythm-speeds.js`);
    }
  }
}

console.log('══════════════════════════════════════════════════');
console.log(`AUDITORIA DO CATÁLOGO: ${passed} ok, ${failed} problema(s), ${files.length} ritmos`);
console.log('══════════════════════════════════════════════════');
if (failed > 0) {
  errors.slice(0, 30).forEach((e) => console.log('  ❌ ' + e));
  process.exit(1);
} else {
  console.log('🎯 Catálogo íntegro: estruturas válidas e todas as razões de velocidade inteiras (exceto whitelist documentada).');
}
