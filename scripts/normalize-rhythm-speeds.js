// Normaliza as VELOCIDADES de fills/ends do catálogo pra razões INTEIRAS
// com os padrões com que interagem (main e, no caso do end, também fill).
//
// POR QUÊ: o timing de entrada de virada/finalização (PatternEngine) faz
// Math.round(restante × razão). Com razão fracionária (ex: end 1x sob
// main 2x = 0.5), metade das pisadas arredonda meio step PRA CIMA e o
// padrão termina DEPOIS do downbeat ("sobrando um pouco" — bug relatado
// no Calypso/Baladas, auditoria achou 79 ritmos afetados). Com razão
// inteira a conta é exata por construção — o defeito deixa de existir
// sem tocar na lógica do motor.
//
// COMO: expansão 2x preservando o som — cada step antigo vira dois
// novos: batida no par, silêncio no ímpar; volumes acompanham;
// micro-OFFSETS são dobrados (offset é fração da duração do step, e o
// step novo dura metade) e, quando o dobro estoura ±0.5, a batida move
// pro step ímpar adjacente carregando o resto — SEMPRE exato.
// Verificação de equivalência: scripts/verify-rhythm-equivalence.js.
//
// LIMITE: 32 steps por padrão (formato). Combinações que precisariam de
// 64 (end 1x sob main 4x: Frevo/Frevo 2/Marcha de Carnaval/Reggae 2 e o
// end×fill do Reggae) ficam com razão 0.5 residual (desvio máx ~±1 step
// curto, ~40-60ms) — zeráveis só via motor (quantização de entrada).
//
// Uso: node scripts/normalize-rhythm-speeds.js [--dry]

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public', 'rhythm');
const DRY = process.argv.includes('--dry');
const MAX_STEPS = 32;

const hasContent = (v) => v?.pattern?.some((r) => r.some((s) => s === true));

/** Expande uma variação 2x (steps e speed dobram) preservando o som EXATO. */
function expand2x(v, label) {
  const oldSteps = v.steps || 16;
  const newSteps = oldSteps * 2;
  const channels = v.pattern.length;

  const newPattern = [];
  const newVolumes = [];
  const newOffsets = v.offsets ? [] : undefined;

  for (let ch = 0; ch < channels; ch++) {
    const pRow = new Array(newSteps).fill(false);
    const vRow = new Array(newSteps).fill(0.8);
    const oRow = newOffsets ? new Array(newSteps).fill(0) : undefined;

    for (let i = 0; i < oldSteps; i++) {
      const vol = v.volumes?.[ch]?.[i] ?? 0.8;
      // volume padrão preenchido nos dois novos steps (só importa onde há batida)
      vRow[2 * i] = vol;
      vRow[2 * i + 1] = vol;
      if (!v.pattern[ch]?.[i]) continue;

      // offset antigo era fração do step ANTIGO; no novo (metade da
      // duração) o mesmo instante = 2×offset. Se estourar ±0.5, a
      // batida anda pro step ímpar vizinho carregando o resto.
      const t = (v.offsets?.[ch]?.[i] ?? 0) * 2;
      let step = 2 * i;
      let off = t;
      if (t > 0.5) { step = 2 * i + 1; off = t - 1; }
      else if (t < -0.5) { step = 2 * i - 1; off = t + 1; }
      if (step < 0 || step >= newSteps) {
        throw new Error(`${label}: offset move batida pra fora do padrão (step ${step})`);
      }
      pRow[step] = true;
      vRow[step] = vol;
      if (oRow) oRow[step] = off;
    }
    newPattern.push(pRow);
    newVolumes.push(vRow);
    if (newOffsets) newOffsets.push(oRow);
  }

  v.pattern = newPattern;
  v.volumes = newVolumes;
  if (newOffsets) v.offsets = newOffsets;
  v.steps = newSteps;
  v.speed = (v.speed || 1) * 2;
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'manifest.json');
let changedFiles = 0;
let expandedPatterns = 0;
const report = [];

for (const f of files) {
  const filePath = path.join(DIR, f);
  const j = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const mains = (j.variations?.main || []).filter(hasContent);
  const fills = (j.variations?.fill || []).filter(hasContent);
  if (!mains.length) continue;

  const maxMainSpeed = Math.max(...mains.map((m) => m.speed || 1));
  const maxFillSpeed = fills.length ? Math.max(...fills.map((x) => x.speed || 1)) : maxMainSpeed;
  const touched = [];

  // FILLS: alvo = velocidade do main (razão inteira virada→main)
  (j.variations?.fill || []).forEach((v, i) => {
    if (!hasContent(v)) return;
    while ((v.speed || 1) < maxMainSpeed && (v.steps || 16) * 2 <= MAX_STEPS) {
      expand2x(v, `${f} fill#${i}`);
      touched.push(`fill#${i}→${v.steps}@${v.speed}x`);
      expandedPatterns++;
    }
  });

  // ENDS: alvo = max(main, fill) — razão inteira final→main E final→virada
  const endTarget = Math.max(maxMainSpeed, maxFillSpeed);
  (j.variations?.end || []).forEach((v, i) => {
    if (!hasContent(v)) return;
    while ((v.speed || 1) < endTarget && (v.steps || 16) * 2 <= MAX_STEPS) {
      expand2x(v, `${f} end#${i}`);
      touched.push(`end→${v.steps}@${v.speed}x`);
      expandedPatterns++;
    }
  });

  if (touched.length) {
    if (j.patternSteps) {
      if (j.variations.end?.[0]?.steps) j.patternSteps.end = j.variations.end[0].steps;
      if (j.variations.fill?.[0]?.steps) j.patternSteps.fill = j.variations.fill[0].steps;
    }
    if (!DRY) fs.writeFileSync(filePath, JSON.stringify(j, null, 2) + '\n');
    changedFiles++;
    report.push(`${f.replace('.json', '')}: ${touched.join(', ')}`);
  }
}

console.log(`${DRY ? '[DRY-RUN] ' : ''}Ritmos alterados: ${changedFiles} | padrões expandidos: ${expandedPatterns}`);
report.forEach((l) => console.log('  ' + l));
