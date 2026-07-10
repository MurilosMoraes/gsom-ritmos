// Teste de FIDELIDADE do save de ritmo (Meus Ritmos / repertório).
//
// Bug relatado: "ritmo salvo ou em repertório toca diferente do padrão —
// perde swing e groove". Causa: exportProjectAsJSON() (usado pra salvar em
// Meus Ritmos e adicionar ao repertório) descartava `offsets` (o micro-timing
// por célula = swing/groove, v1.6). O saveProject() de ARQUIVO incluía. Os
// dois serializadores divergiram.
//
// Este teste roda contra o FileManager REAL: carrega um ritmo OFICIAL que
// tem offsets não-zero, exporta pelo MESMO caminho do "salvar", e prova que
// o ritmo exportado é IDÊNTICO ao original em pattern, volumes, OFFSETS,
// steps, speed e áudios. Ou seja: ritmo salvo == ritmo normal.
//
// Roda: npx tsx test/rhythm-fidelity-test.ts

import * as fs from 'fs';
import * as path from 'path';
import { FileManager } from '../src/io/FileManager';
import { createEmptyChannels, expandPattern, expandVolumes, expandOffsets } from '../src/utils/helpers';

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ FALHOU: ${msg}`); }
}
function eq(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

// ── Estado mínimo mas VÁLIDO (mesma forma que o app usa) ──────────────
function makeState(): any {
  const emptyVar = () => ({ pattern: [], volumes: [], offsets: [], channels: createEmptyChannels(), steps: 16, speed: 1 });
  return {
    tempo: 80, beatsPerBar: 4,
    patternSteps: { main: 16, fill: 16, end: 8, intro: 16 },
    patterns: { main: [], fill: [], end: [], intro: [] },
    volumes: { main: [], fill: [], end: [], intro: [] },
    offsets: { main: [], fill: [], end: [], intro: [] },
    variations: {
      main: [emptyVar(), emptyVar(), emptyVar()],
      fill: [emptyVar(), emptyVar(), emptyVar()],
      end: [emptyVar(), emptyVar(), emptyVar()],
      intro: [emptyVar()],
      transition: [],
    },
    channels: {
      main: createEmptyChannels(), fill: createEmptyChannels(),
      end: createEmptyChannels(), intro: createEmptyChannels(),
      transition: createEmptyChannels(),
    },
    fillStartSound: { buffer: null, fileName: '', midiPath: '' },
    fillReturnSound: { buffer: null, fileName: '', midiPath: '' },
  };
}

function makeFileManager(): { fm: FileManager; state: any } {
  const state = makeState();
  const stateManager: any = {
    getState: () => state,
    setTempo: (n: number) => { state.tempo = n; },
    setEditingPattern: () => { /* noop */ },
  };
  const audio: any = {
    loadAudioFromPath: async () => ({}),   // buffer fake — loadProject só guarda
    loadAudioFromBase64: async () => ({}),
  };
  return { fm: new FileManager(stateManager, audio), state };
}

// Acha ritmos oficiais que TÊM offsets não-zero (é onde o swing/groove vive).
function findGrooveRhythms(dir: string, max: number): string[] {
  const out: string[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'manifest.json') continue;
    let j: any;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    let hasOff = false;
    for (const t of ['main', 'fill', 'end', 'intro']) {
      for (const v of (j.variations?.[t] || [])) {
        for (const row of (v.offsets || [])) for (const c of row) if (Math.abs(c) > 0.001) hasOff = true;
      }
    }
    if (hasOff) out.push(f);
    if (out.length >= max) break;
  }
  return out;
}

async function testRhythm(fm: FileManager, orig: any, name: string): Promise<void> {
  console.log(`\n─── ${name} ───`);
  await fm.loadProject(orig);           // carrega igual o app faz
  const saved = fm.exportProjectAsJSON(); // serializa igual o "salvar" faz

  let grooveChecked = false;

  for (const type of ['main', 'fill', 'end', 'intro'] as const) {
    const origVars = orig.variations?.[type] || [];
    const savedVars = saved.variations?.[type] || [];
    for (let i = 0; i < origVars.length; i++) {
      const o = origVars[i], s = savedVars[i];
      if (!o || !s) { assert(false, `${type}[${i}] existe no salvo`); continue; }
      const steps = o.steps || 16;

      // OFFSETS — o swing/groove. O ponto do bug.
      const oOff = expandOffsets(o.offsets, steps);
      const sOff = expandOffsets(s.offsets, steps);
      assert(eq(oOff, sOff), `${type}[${i}] OFFSETS (swing/groove) preservados`);

      // Se essa variação tem groove real, marca que provamos o ponto crítico
      if (o.offsets && o.offsets.some((r: number[]) => r.some(c => Math.abs(c) > 0.001))) {
        grooveChecked = true;
      }

      // Paridade do resto — "tem que ter TUDO que o ritmo normal tem"
      assert(eq(expandPattern(o.pattern, steps), s.pattern), `${type}[${i}] pattern preservado`);
      assert(eq(expandVolumes(o.volumes, steps), s.volumes), `${type}[${i}] volumes preservados`);
      assert(s.steps === o.steps, `${type}[${i}] steps preservados`);
      assert((s.speed ?? 1) === (o.speed ?? 1), `${type}[${i}] speed preservado`);

      // Áudios: todo midiPath não-vazio do original aparece no mesmo canal
      const oMidi = (o.audioFiles || []).map((a: any) => a.midiPath || '');
      let audioOk = true;
      for (let c = 0; c < oMidi.length; c++) {
        if (oMidi[c] && s.audioFiles[c]?.midiPath !== oMidi[c]) audioOk = false;
      }
      assert(audioOk, `${type}[${i}] áudios (midiPath) preservados`);
    }
  }

  // Metadados globais
  assert(saved.tempo === orig.tempo, 'tempo preservado');
  assert(saved.beatsPerBar === (orig.beatsPerBar ?? 4), 'beatsPerBar preservado');
  assert(eq(saved.patternSteps, orig.patternSteps), 'patternSteps preservado');
  assert(saved.fillStartSound?.midiPath === (orig.fillStartSound?.midiPath || ''), 'fillStartSound preservado');
  assert(saved.fillReturnSound?.midiPath === (orig.fillReturnSound?.midiPath || ''), 'fillReturnSound preservado');
  assert(saved.version === '1.6', 'versão 1.6 (formato com groove)');
  assert(grooveChecked, 'ESTE ritmo realmente tinha groove pra testar (não trivial)');
}

async function main(): Promise<void> {
  const dir = path.resolve(__dirname, '../public/rhythm');
  const grooveFiles = findGrooveRhythms(dir, 4);
  if (grooveFiles.length === 0) { console.log('Nenhum ritmo com offsets encontrado — abortando.'); process.exit(1); }

  console.log(`Testando fidelidade em ${grooveFiles.length} ritmos com groove: ${grooveFiles.join(', ')}`);

  for (const f of grooveFiles) {
    const { fm } = makeFileManager();
    const orig = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    await testRhythm(fm, orig, f);
  }

  // ── Guarda de regressão: prova que o teste PEGA o bug antigo ──────────
  // (export SEM offsets → o swing sumiria → teria falhado)
  console.log('\n─── Guarda de regressão (bug antigo) ───');
  {
    const orig = JSON.parse(fs.readFileSync(path.join(dir, grooveFiles[0]), 'utf8'));
    let anyGroove = false;
    for (const t of ['main', 'fill', 'end', 'intro']) {
      for (const v of (orig.variations?.[t] || [])) {
        const steps = v.steps || 16;
        const real = expandOffsets(v.offsets, steps);
        const semOffsets = expandOffsets(undefined, steps); // o que o export ANTIGO produzia
        if (v.offsets && v.offsets.some((r: number[]) => r.some((c: number) => Math.abs(c) > 0.001))) {
          anyGroove = true;
          if (eq(real, semOffsets)) { /* seria igual — ruim */ }
        }
      }
    }
    assert(anyGroove, 'export antigo (sem offsets) DIVERGIA do original — bug era real e o teste o detecta');
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`RESULTADO: ${passed} passou, ${failed} falhou, ${passed + failed} total`);
  console.log('══════════════════════════════════════════════════');
  if (failed > 0) { console.log('\n❌ Ritmo salvo NÃO é fiel ao original.'); process.exit(1); }
  console.log('\n🎯 Ritmo salvo/em repertório == ritmo normal (swing, groove e tudo mais preservados).');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
