// Verificador de EQUIVALÊNCIA SONORA pós-normalização de velocidades.
//
// Pra cada ritmo, reconstrói a linha do tempo de eventos de áudio de
// CADA variação (main/fill/end/intro): tuplas (canal, instante em
// segundos, volume), onde instante = (step + offset) × duraçãoDoStep e
// duraçãoDoStep = (60/tempo/2)/speed. Se a conversão preservou o som,
// as linhas do tempo do arquivo atual e do original (git ref) são
// IDÊNTICAS — igualdade matemática de eventos, não opinião.
//
// Uso: node scripts/verify-rhythm-equivalence.js <git-ref>
//   ex: node scripts/verify-rhythm-equivalence.js 431f3c7

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REF = process.argv[2];
if (!REF) { console.error('Uso: node scripts/verify-rhythm-equivalence.js <git-ref>'); process.exit(1); }

const DIR = path.join(__dirname, '..', 'public', 'rhythm');
const EPS = 1e-9;

/** Timeline de eventos de uma variação: [{ch, t, vol}] ordenada. */
function timeline(v, tempo) {
  if (!v?.pattern) return [];
  const steps = v.steps || 16;
  const speed = v.speed || 1;
  const stepDur = (60 / tempo / 2) / speed;
  const events = [];
  for (let ch = 0; ch < v.pattern.length; ch++) {
    for (let s = 0; s < steps; s++) {
      if (!v.pattern[ch]?.[s]) continue;
      const off = v.offsets?.[ch]?.[s] ?? 0;
      events.push({
        ch,
        t: (s + off) * stepDur,
        vol: v.volumes?.[ch]?.[s] ?? 0.8,
      });
    }
  }
  events.sort((a, b) => a.ch - b.ch || a.t - b.t);
  return events;
}

function compare(oldV, newV, tempo, label, problems) {
  const a = timeline(oldV, tempo);
  const b = timeline(newV, tempo);
  // Duração total da variação também precisa bater (afeta o ciclo)
  const durA = (oldV?.steps || 16) * ((60 / tempo / 2) / (oldV?.speed || 1));
  const durB = (newV?.steps || 16) * ((60 / tempo / 2) / (newV?.speed || 1));
  if (Math.abs(durA - durB) > EPS) {
    problems.push(`${label}: DURAÇÃO mudou (${durA.toFixed(6)}s -> ${durB.toFixed(6)}s)`);
    return;
  }
  if (a.length !== b.length) {
    problems.push(`${label}: nº de eventos mudou (${a.length} -> ${b.length})`);
    return;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i].ch !== b[i].ch || Math.abs(a[i].t - b[i].t) > EPS || Math.abs(a[i].vol - b[i].vol) > EPS) {
      problems.push(`${label}: evento #${i} divergiu (ch ${a[i].ch}@${a[i].t.toFixed(6)}s v${a[i].vol} -> ch ${b[i].ch}@${b[i].t.toFixed(6)}s v${b[i].vol})`);
      return;
    }
  }
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'manifest.json');
let checked = 0, identical = 0, changedFiles = 0, newFiles = 0;
const problems = [];

for (const f of files) {
  const cur = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  let oldRaw;
  try {
    oldRaw = execSync(`git show ${REF}:"public/rhythm/${f}"`, { maxBuffer: 100e6, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
  } catch {
    newFiles++; // arquivo não existia no ref (ritmo novo) — nada a comparar
    continue;
  }
  const old = JSON.parse(oldRaw);
  checked++;
  const tempo = cur.tempo || 120;
  if (old.tempo !== cur.tempo) problems.push(`${f}: TEMPO mudou`);

  let fileIdentical = true;
  for (const type of ['main', 'fill', 'end', 'intro']) {
    const oldVars = old.variations?.[type] || [];
    const curVars = cur.variations?.[type] || [];
    if (oldVars.length !== curVars.length) {
      problems.push(`${f} ${type}: nº de variações mudou`);
      fileIdentical = false;
      continue;
    }
    for (let i = 0; i < oldVars.length; i++) {
      const before = problems.length;
      compare(oldVars[i], curVars[i], tempo, `${f} ${type}#${i}`, problems);
      if (problems.length > before) fileIdentical = false;
      // marca se o arquivo foi alterado estruturalmente (steps/speed)
      if ((oldVars[i]?.steps || 16) !== (curVars[i]?.steps || 16)) changedFiles += (i === 0 && type === 'end') ? 1 : 0;
    }
  }
  if (fileIdentical) identical++;
}

console.log(`Comparados contra ${REF}: ${checked} ritmos (${newFiles} novos sem baseline)`);
console.log(`Timelines IDÊNTICAS: ${identical}/${checked}`);
if (problems.length) {
  console.log(`\n❌ ${problems.length} DIVERGÊNCIA(S):`);
  problems.slice(0, 40).forEach((p) => console.log('  ' + p));
  process.exit(1);
} else {
  console.log('\n✅ EQUIVALÊNCIA SONORA PROVADA: todo evento de áudio de todo ritmo toca no MESMO instante, MESMO canal, MESMO volume que no original.');
}
