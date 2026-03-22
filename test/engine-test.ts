/**
 * Testes offline do motor de sequenciador — sem DOM ou Web Audio
 * Valida: timing, transições, math de fill, edge cases
 *
 * Executar: npx tsx test/engine-test.ts
 */

import { StateManager } from '../src/core/StateManager';
import { PatternEngine } from '../src/core/PatternEngine';
import type { PatternType } from '../src/types';

// ─── Helpers de teste ─────────────────────────────────────────────────

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    testsPassed++;
    console.log(`  ✅ ${message}`);
  } else {
    testsFailed++;
    console.error(`  ❌ FALHOU: ${message}`);
  }
}

function assertEqual(actual: any, expected: any, message: string): void {
  if (actual === expected) {
    testsPassed++;
    console.log(`  ✅ ${message} (${actual})`);
  } else {
    testsFailed++;
    console.error(`  ❌ FALHOU: ${message} — esperado ${expected}, recebeu ${actual}`);
  }
}

function section(name: string): void {
  console.log(`\n═══ ${name} ═══`);
}

// ─── Helper para criar padrão com conteúdo ────────────────────────────

function fillPattern(sm: StateManager, type: PatternType, variationIndex: number, steps: number, speed: number): void {
  const state = sm.getState();

  // Criar padrão com conteúdo
  const pattern: boolean[][] = Array(8).fill(null).map(() => Array(steps).fill(false));
  pattern[0][0] = true; // pelo menos 1 step ativo
  pattern[1][Math.floor(steps / 2)] = true;

  const volumes: number[][] = Array(8).fill(null).map(() => Array(steps).fill(1.0));
  const channels = Array(8).fill(null).map(() => ({ buffer: null as any, fileName: '', midiPath: '' }));

  state.variations[type][variationIndex] = { pattern, volumes, channels, steps, speed };

  // Se é main ou fill, garantir patternSteps
  if (type === 'main' || type === 'fill' || type === 'end' || type === 'intro') {
    state.patternSteps[type as 'main' | 'fill' | 'end' | 'intro'] = steps;
  }

  // Carregar no pattern ativo
  state.patterns[type] = pattern.map(row => [...row]);
  state.volumes[type] = volumes.map(row => [...row]);
  state.channels[type] = channels.map(ch => ({ ...ch }));
}

// ─── TESTES ───────────────────────────────────────────────────────────

section('1. StateManager — Estado inicial');
{
  const sm = new StateManager();
  const state = sm.getState();

  assert(!state.isPlaying, 'Não está tocando inicialmente');
  assertEqual(state.currentStep, 0, 'Step inicial é 0');
  assertEqual(state.tempo, 80, 'Tempo padrão é 80');
  assertEqual(state.masterVolume, 2.0, 'Volume master padrão é 2.0');
  assertEqual(state.activePattern, 'main', 'Padrão ativo é main');
  assertEqual(state.variations.main.length, 3, 'Main tem 3 variações');
  assertEqual(state.variations.fill.length, 3, 'Fill tem 3 variações');
  assertEqual(state.variations.end.length, 1, 'End tem 1 variação');
  assert(state.pendingFill === null, 'Sem fill pendente');
  assert(state.pendingEnd === null, 'Sem end pendente');
}

section('2. StateManager — Variações');
{
  const sm = new StateManager();

  fillPattern(sm, 'main', 0, 16, 1);
  fillPattern(sm, 'main', 1, 16, 2);

  sm.setCurrentVariation('main', 0);
  assertEqual(sm.getCurrentVariation('main'), 0, 'Variação main 0 selecionada');
  assertEqual(sm.getVariationSpeed('main', 0), 1, 'Velocidade main var 0 = 1x');
  assertEqual(sm.getVariationSpeed('main', 1), 2, 'Velocidade main var 1 = 2x');

  sm.setVariationSpeed('main', 1, 3);
  assertEqual(sm.getVariationSpeed('main', 1), 3, 'Velocidade alterada para 3x');

  sm.setVariationSpeed('main', 1, 10); // acima do max (4)
  assertEqual(sm.getVariationSpeed('main', 1), 4, 'Velocidade clampada em 4x');

  sm.setVariationSpeed('main', 1, 0.1); // abaixo do min (0.25)
  assertEqual(sm.getVariationSpeed('main', 1), 0.25, 'Velocidade clampada em 0.25x');
}

section('3. StateManager — Observer pattern');
{
  const sm = new StateManager();
  let notifiedCount = 0;
  let lastEvent = '';

  sm.subscribe('playState', () => { notifiedCount++; lastEvent = 'playState'; });
  sm.subscribe('tempo', () => { notifiedCount++; lastEvent = 'tempo'; });

  sm.setPlaying(true);
  assertEqual(notifiedCount, 1, 'Notificou 1x ao mudar playState');
  assertEqual(lastEvent, 'playState', 'Evento correto: playState');

  sm.setTempo(120);
  assertEqual(notifiedCount, 2, 'Notificou 2x total');
  assertEqual(lastEvent, 'tempo', 'Evento correto: tempo');

  // Wildcard
  let wildcardCount = 0;
  sm.subscribe('*', () => { wildcardCount++; });

  sm.setPlaying(false);
  assertEqual(wildcardCount, 1, 'Wildcard recebeu notificação');
}

section('4. PatternEngine — checkPendingPatterns');
{
  const sm = new StateManager();
  const pe = new PatternEngine(sm);

  fillPattern(sm, 'main', 0, 16, 1);
  fillPattern(sm, 'fill', 0, 16, 1);

  sm.setPlaying(true);
  sm.setActivePattern('main');

  // Setar fill pendente para entrar no step 4
  sm.setPendingFill({ variationIndex: 0, entryPoint: 4, startStep: 8 });

  // Step 3 — ainda não é o entryPoint
  sm.setCurrentStep(3);
  let transitioned = pe.checkPendingPatterns();
  assert(!transitioned, 'Não transiciona no step 3');
  assertEqual(sm.getActivePattern(), 'main', 'Ainda no main');

  // Step 4 — é o entryPoint!
  sm.setCurrentStep(4);
  transitioned = pe.checkPendingPatterns();
  assert(transitioned, 'Transiciona no step 4');
  assertEqual(sm.getActivePattern(), 'fill', 'Mudou para fill');
  assertEqual(sm.getCurrentStep(), 8, 'Step mudou para fillStartStep');
  assert(sm.getState().pendingFill === null, 'PendingFill foi limpo');
}

section('5. PatternEngine — Fill timing: main 1x, fill 1x (mesmo speed)');
{
  const sm = new StateManager();
  const pe = new PatternEngine(sm);

  fillPattern(sm, 'main', 0, 16, 1);
  fillPattern(sm, 'fill', 0, 16, 1);
  sm.setCurrentVariation('main', 0);
  sm.loadVariation('main', 0);
  sm.setPlaying(true);
  sm.setActivePattern('main');

  // Step 8 → entryPoint = 9, remaining = 7
  sm.setCurrentStep(8);
  pe.activateFillWithTiming(0);

  const pending = sm.getState().pendingFill;
  assert(pending !== null, 'Fill pendente criado');
  assertEqual(pending!.entryPoint, 9, 'Entry point = 9');
  // remaining = 16-9 = 7, fillStepsPerMainStep = 1/1 = 1, available = 7
  // startStep = 16-7 = 9
  assertEqual(pending!.startStep, 9, 'Fill start step = 9 (toca últimos 7 steps)');
}

section('6. PatternEngine — Fill timing: main 1x, fill 2x, step 8');
{
  const sm = new StateManager();
  const pe = new PatternEngine(sm);

  fillPattern(sm, 'main', 0, 16, 1);
  fillPattern(sm, 'fill', 0, 16, 2);
  sm.setCurrentVariation('main', 0);
  sm.loadVariation('main', 0);
  sm.setPlaying(true);
  sm.setActivePattern('main');

  // Fill 2x 16 steps: idealEntry = 16 - round(16*1/2) = 16-8 = 8
  // currentStep=8, nextStep=9. idealEntry(8) < nextStep(9) → parcial
  // remaining=7, available=round(7*2)=14, startStep=16-14=2
  sm.setCurrentStep(8);
  pe.activateFillWithTiming(0);

  const pending = sm.getState().pendingFill;
  assert(pending !== null, 'Fill pendente criado');
  assertEqual(pending!.entryPoint, 9, 'Entry point = 9 (parcial)');
  assertEqual(pending!.startStep, 2, 'Fill start = 2 (toca 14 steps em 1.75s = 7 main steps)');
}

section('6b. Fill 2x — entry no início (fill espera ponto ideal)');
{
  const sm = new StateManager();
  const pe = new PatternEngine(sm);

  fillPattern(sm, 'main', 0, 16, 1);
  fillPattern(sm, 'fill', 0, 16, 2);
  sm.setCurrentVariation('main', 0);
  sm.loadVariation('main', 0);
  sm.setPlaying(true);
  sm.setActivePattern('main');

  // currentStep=2, nextStep=3. idealEntry = 16-8 = 8.
  // idealEntry(8) >= nextStep(3) → fill completa no step 8!
  sm.setCurrentStep(2);
  pe.activateFillWithTiming(0);

  const pending = sm.getState().pendingFill;
  assert(pending !== null, 'Fill pendente criado');
  assertEqual(pending!.entryPoint, 8, 'Entry point = 8 (espera ponto ideal)');
  assertEqual(pending!.startStep, 0, 'Fill completa (start = 0)');
  // Verificação: 8 remaining main steps * 0.25s = 2.0s = 16 fill steps * 0.125s ✓
}

section('6c. Fill 2x — entry no step 7 (idealEntry=8, nextStep=8 → cabe!)');
{
  const sm = new StateManager();
  const pe = new PatternEngine(sm);

  fillPattern(sm, 'main', 0, 16, 1);
  fillPattern(sm, 'fill', 0, 16, 2);
  sm.setCurrentVariation('main', 0);
  sm.loadVariation('main', 0);
  sm.setPlaying(true);
  sm.setActivePattern('main');

  sm.setCurrentStep(7);
  pe.activateFillWithTiming(0);

  const pending = sm.getState().pendingFill;
  assert(pending !== null, 'Fill pendente criado');
  assertEqual(pending!.entryPoint, 8, 'Entry point = 8 (ideal)');
  assertEqual(pending!.startStep, 0, 'Fill completa');
}

section('7. PatternEngine — Fill timing: main 2x, fill 1x');
{
  const sm = new StateManager();
  const pe = new PatternEngine(sm);

  fillPattern(sm, 'main', 0, 16, 2);
  fillPattern(sm, 'fill', 0, 16, 1);
  sm.setCurrentVariation('main', 0);
  sm.loadVariation('main', 0);
  sm.setPlaying(true);
  sm.setActivePattern('main');

  // Step 8 → entryPoint = 9, remaining = 7
  sm.setCurrentStep(8);
  pe.activateFillWithTiming(0);

  const pending = sm.getState().pendingFill;
  assert(pending !== null, 'Fill pendente criado');
  // remaining = 7, fillStepsPerMainStep = 1/2 = 0.5
  // available = round(7*0.5) = round(3.5) = 4
  // startStep = 16-4 = 12
  assertEqual(pending!.startStep, 12, 'Fill 1x (main 2x) start = 12 (toca 4 steps)');
}

section('8. PatternEngine — Fill timing 1x: step 15 (wrap ao 0)');
{
  const sm = new StateManager();
  const pe = new PatternEngine(sm);

  fillPattern(sm, 'main', 0, 16, 1);
  fillPattern(sm, 'fill', 0, 16, 1);
  sm.setCurrentVariation('main', 0);
  sm.loadVariation('main', 0);
  sm.setPlaying(true);
  sm.setActivePattern('main');

  // Fill 1x 16 steps: idealEntry = 16-round(16*1/1) = 0
  // currentStep=15, nextStep=0. idealEntry(0) >= nextStep(0) → fill completa no step 0
  sm.setCurrentStep(15);
  pe.activateFillWithTiming(0);

  const pending = sm.getState().pendingFill;
  assert(pending !== null, 'Fill pendente criado');
  assertEqual(pending!.entryPoint, 0, 'Entry point = 0 (fill completa)');
  assertEqual(pending!.startStep, 0, 'Fill completa (start = 0)');
}

section('9. PatternEngine — Guards contra double-fill');
{
  const sm = new StateManager();
  const pe = new PatternEngine(sm);

  fillPattern(sm, 'main', 0, 16, 1);
  fillPattern(sm, 'fill', 0, 16, 1);
  sm.setCurrentVariation('main', 0);
  sm.loadVariation('main', 0);
  sm.setPlaying(true);
  sm.setActivePattern('main');
  sm.setCurrentStep(4);

  pe.activateFillWithTiming(0);
  assert(sm.getState().pendingFill !== null, 'Primeiro fill aceito');

  // Tentar segundo fill — deve ser ignorado
  pe.activateFillWithTiming(1);
  assertEqual(sm.getState().pendingFill!.variationIndex, 0, 'Segundo fill ignorado (mantém o primeiro)');
}

section('10. PatternEngine — End cancela fill pendente');
{
  const sm = new StateManager();
  const pe = new PatternEngine(sm);

  fillPattern(sm, 'main', 0, 16, 1);
  fillPattern(sm, 'fill', 0, 16, 1);
  fillPattern(sm, 'end', 0, 8, 1);
  sm.setCurrentVariation('main', 0);
  sm.loadVariation('main', 0);
  sm.setPlaying(true);
  sm.setActivePattern('main');
  sm.setCurrentStep(4);

  pe.activateFillWithTiming(0);
  assert(sm.getState().pendingFill !== null, 'Fill pendente existe');

  pe.activateEndWithTiming(0);
  assert(sm.getState().pendingFill === null, 'Fill cancelado pelo end');
  assert(sm.getState().pendingEnd !== null, 'End pendente criado');
}

section('11. PatternEngine — handleFillCompletion volta ao main');
{
  const sm = new StateManager();
  const pe = new PatternEngine(sm);
  let lastPatternChange: PatternType | null = null;

  pe.setOnPatternChange((p) => { lastPatternChange = p; });

  fillPattern(sm, 'main', 0, 16, 1);
  fillPattern(sm, 'fill', 0, 16, 1);
  sm.setCurrentVariation('main', 0);
  sm.loadVariation('main', 0);
  sm.setPlaying(true);
  sm.setActivePattern('fill');

  // Simular completion (step volta a 0)
  sm.setCurrentStep(0);
  pe.handlePatternCompletion();

  assertEqual(sm.getActivePattern(), 'main', 'Voltou ao main após fill');
  assertEqual(lastPatternChange, 'main', 'Callback notificou main');
  assertEqual(sm.getCurrentStep(), 0, 'Step resetado para 0');
}

section('12. PatternEngine — handleEndCompletion chama onStop');
{
  const sm = new StateManager();
  const pe = new PatternEngine(sm);
  let stopCalled = false;

  pe.setOnStop(() => { stopCalled = true; });

  fillPattern(sm, 'end', 0, 8, 1);
  sm.setPlaying(true);
  sm.setActivePattern('end');
  sm.setCurrentStep(0);

  pe.handlePatternCompletion();
  assert(stopCalled, 'onStop chamado quando end completa');
}

section('13. PatternEngine — activateRhythm com sync de velocidade');
{
  const sm = new StateManager();
  const pe = new PatternEngine(sm);

  fillPattern(sm, 'main', 0, 16, 1);  // Ritmo 1: 16 steps, 1x
  fillPattern(sm, 'main', 1, 16, 2);  // Ritmo 2: 16 steps, 2x
  sm.setCurrentVariation('main', 0);
  sm.loadVariation('main', 0);
  sm.setPlaying(true);
  sm.setActivePattern('main');

  // No step 8 de 16 = posição 0.5 do ciclo
  sm.setCurrentStep(8);
  pe.activateRhythm(1);

  // speedRatio = 2/1 = 2
  // adjustedPosition = (0.5 * 2) % 1 = 0
  // equivalentStep = floor(0 * 16) = 0
  assertEqual(sm.getCurrentStep(), 0, 'Ritmo 2x: step 8@1x → step 0@2x');
  assertEqual(sm.getCurrentVariation('main'), 1, 'Variação 1 ativa');
}

section('14. PatternEngine — activateRhythm 2x→1x');
{
  const sm = new StateManager();
  const pe = new PatternEngine(sm);

  fillPattern(sm, 'main', 0, 16, 2);  // Ritmo A: 2x
  fillPattern(sm, 'main', 1, 16, 1);  // Ritmo B: 1x
  sm.setCurrentVariation('main', 0);
  sm.loadVariation('main', 0);
  sm.setPlaying(true);
  sm.setActivePattern('main');

  // No step 8 de 16 = posição 0.5
  sm.setCurrentStep(8);
  pe.activateRhythm(1);

  // speedRatio = 1/2 = 0.5
  // adjustedPosition = (0.5 * 0.5) % 1 = 0.25
  // equivalentStep = floor(0.25 * 16) = 4
  assertEqual(sm.getCurrentStep(), 4, 'Ritmo 1x: step 8@2x → step 4@1x');
}

section('15. PatternEngine — Test mode não faz transições');
{
  const sm = new StateManager();
  const pe = new PatternEngine(sm);
  let patternChanged = false;

  pe.setOnPatternChange(() => { patternChanged = true; });
  pe.setTestMode(true);

  fillPattern(sm, 'fill', 0, 16, 1);
  sm.setPlaying(true);
  sm.setActivePattern('fill');
  sm.setCurrentStep(0);

  pe.handlePatternCompletion();
  assertEqual(sm.getActivePattern(), 'fill', 'Permanece em fill no test mode');
  assert(!patternChanged, 'Callback não chamado no test mode');
}

section('16. PatternEngine — Fill durante fill é bloqueado');
{
  const sm = new StateManager();
  const pe = new PatternEngine(sm);

  fillPattern(sm, 'main', 0, 16, 1);
  fillPattern(sm, 'fill', 0, 16, 1);
  fillPattern(sm, 'fill', 1, 16, 1);
  sm.setCurrentVariation('main', 0);
  sm.loadVariation('main', 0);
  sm.setPlaying(true);
  sm.setActivePattern('fill'); // Já em fill

  pe.activateFillWithTiming(1);
  assert(sm.getState().pendingFill === null, 'Fill bloqueado durante fill');
}

section('17. PatternEngine — Fill durante end é bloqueado');
{
  const sm = new StateManager();
  const pe = new PatternEngine(sm);

  fillPattern(sm, 'main', 0, 16, 1);
  fillPattern(sm, 'fill', 0, 16, 1);
  sm.setCurrentVariation('main', 0);
  sm.loadVariation('main', 0);
  sm.setPlaying(true);
  sm.setActivePattern('end');

  pe.activateFillWithTiming(0);
  assert(sm.getState().pendingFill === null, 'Fill bloqueado durante end');
}

section('18. PatternEngine — playRotatingFill rotaciona corretamente');
{
  const sm = new StateManager();
  const pe = new PatternEngine(sm);

  fillPattern(sm, 'main', 0, 16, 1);
  fillPattern(sm, 'fill', 0, 16, 1);
  // fill 1 vazio
  fillPattern(sm, 'fill', 2, 16, 1);
  sm.setCurrentVariation('main', 0);
  sm.loadVariation('main', 0);
  sm.setPlaying(true);
  sm.setActivePattern('main');

  sm.setCurrentStep(4);
  pe.playRotatingFill();
  let pending = sm.getState().pendingFill;
  assertEqual(pending!.variationIndex, 0, 'Primeira rotação: fill 0');

  // Limpar e rotar de novo
  sm.setPendingFill(null);
  sm.setCurrentStep(4);
  pe.playRotatingFill();
  pending = sm.getState().pendingFill;
  // Fill 1 não tem conteúdo, pula para fill 2
  assertEqual(pending!.variationIndex, 2, 'Segunda rotação: pula fill 1, usa fill 2');
}

section('19. Timing math — Fill 2x timing alignment');
{
  const sm = new StateManager();
  const pe = new PatternEngine(sm);

  fillPattern(sm, 'main', 0, 16, 1);
  fillPattern(sm, 'fill', 0, 16, 2);
  sm.setCurrentVariation('main', 0);
  sm.loadVariation('main', 0);
  sm.setPlaying(true);
  sm.setActivePattern('main');

  const results: Array<{step: number, entry: number, start: number}> = [];

  for (let step = 0; step < 16; step++) {
    sm.setPendingFill(null);
    sm.setCurrentStep(step);
    pe.activateFillWithTiming(0);
    const pending = sm.getState().pendingFill;
    if (pending) {
      results.push({ step, entry: pending.entryPoint, start: pending.startStep });
    }
  }

  // Verificar range válido
  const allValid = results.every(r => r.start >= 0 && r.start < 16);
  assert(allValid, 'Todos os start steps estão no range [0, 15]');

  // Verificar alinhamento temporal: fill duration == remaining main duration
  const tempo = 120;
  const secondsPerBeat = 60 / tempo;
  const mainStepDur = (secondsPerBeat / 2) / 1; // 0.25s
  const fillStepDur = (secondsPerBeat / 2) / 2; // 0.125s

  console.log('  Tabela: main 1x 16steps, fill 2x 16steps (@120bpm):');
  let allAligned = true;
  results.forEach(r => {
    const fillStepsToPlay = 16 - r.start;
    const fillDur = fillStepsToPlay * fillStepDur;
    const mainRemaining = (16 - r.entry) * mainStepDur;
    const aligned = Math.abs(fillDur - mainRemaining) < 0.01;
    if (!aligned) allAligned = false;
    const mark = aligned ? '✓' : '✗ MISMATCH';
    console.log(`    step ${r.step.toString().padStart(2)} → entry ${r.entry.toString().padStart(2)}, fill start ${r.start.toString().padStart(2)} (${fillStepsToPlay} steps, ${fillDur.toFixed(3)}s = ${mainRemaining.toFixed(3)}s ${mark})`);
  });
  assert(allAligned, 'Fill duração == main restante para TODOS os entry points');
}

section('20. Edge case — Pattern com 0 steps');
{
  const sm = new StateManager();
  // Forçar 0 steps (não deveria acontecer, mas queremos robustez)
  sm.getState().patternSteps.main = 0;

  const steps = sm.getPatternSteps('main');
  // O sistema deveria lidar graciosamente
  assert(typeof steps === 'number', 'getPatternSteps retorna número mesmo com 0');
}

section('21. Timing — Transição fill 2x → main 1x usa speed do step agendado');
{
  // Simular o cálculo que o Scheduler faz
  // Tempo 120 BPM
  const tempo = 120;
  const secondsPerBeat = 60 / tempo;

  // Fill 2x: cada step dura 125ms
  const fillSpeed = 2;
  const secondsPerStepFill = (secondsPerBeat / 2) / fillSpeed;
  assertEqual(secondsPerStepFill, 0.125, 'Fill 2x step = 125ms');

  // Main 1x: cada step dura 250ms
  const mainSpeed = 1;
  const secondsPerStepMain = (secondsPerBeat / 2) / mainSpeed;
  assertEqual(secondsPerStepMain, 0.25, 'Main 1x step = 250ms');

  // No advanceStep quando fill completa:
  // speedBefore = fillSpeed (2), speedAfter = mainSpeed (1)
  // O intervalo deve usar speedBefore (o step que acabou de ser agendado era fill)
  let nextStepTime = 10.0; // tempo arbitrário
  const intervalUsed = secondsPerStepFill; // speedBefore
  nextStepTime += intervalUsed;
  assertEqual(nextStepTime, 10.125, 'Intervalo na transição = 125ms (speed do fill)');

  // O PRÓXIMO step (primeiro do main) avança com speedAfter=mainSpeed
  nextStepTime += secondsPerStepMain;
  assertEqual(nextStepTime, 10.375, 'Segundo intervalo = 250ms (speed do main)');
}

section('22. Timing — Transição main 1x → fill 2x usa speed do step agendado');
{
  const tempo = 120;
  const secondsPerBeat = 60 / tempo;
  const mainSpeed = 1;
  const fillSpeed = 2;
  const secondsPerStepMain = (secondsPerBeat / 2) / mainSpeed;
  const secondsPerStepFill = (secondsPerBeat / 2) / fillSpeed;

  // Quando checkPendingPatterns detecta entryPoint e muda para fill:
  // speedBefore = main (1), speedAfter = fill (2)
  // O step agendado era main → intervalo = secondsPerStepMain
  let nextStepTime = 10.0;
  nextStepTime += secondsPerStepMain; // speedBefore
  assertEqual(nextStepTime, 10.25, 'Intervalo na entrada fill = 250ms (speed do main)');

  // Próximo step é fill → intervalo = secondsPerStepFill
  nextStepTime += secondsPerStepFill;
  assertEqual(nextStepTime, 10.375, 'Segundo intervalo = 125ms (speed do fill)');
}

// ─── Resultado ────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log(`RESULTADO: ${testsPassed} passou, ${testsFailed} falhou, ${testsPassed + testsFailed} total`);
console.log(`${'═'.repeat(50)}`);

if (testsFailed > 0) {
  process.exit(1);
} else {
  console.log('\n🎯 Todos os testes passaram!');
  process.exit(0);
}
