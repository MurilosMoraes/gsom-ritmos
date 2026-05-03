#!/usr/bin/env node
/**
 * preconvert-samples.js
 *
 * Pré-converte os 43 samples de /public/midi/ pra WAV 48kHz mono 16-bit
 * (formato ótimo pro AVAudioEngine iOS / AudioTrack Android), salvando em
 * /public/midi-native/ paralelo ao original.
 *
 * Vantagens:
 * - Zero resampling em runtime (latência menor, sem jitter)
 * - Sample rate de 48k é o native rate de 100% iOS + ~95% Android
 * - Mono economiza 50% RAM no nativo (samples de bateria são mono na origem)
 * - PCM 16-bit decoda em <1ms vs ~20ms de MP3
 *
 * USO:
 *   node scripts/preconvert-samples.js
 *
 * Requer ffmpeg instalado (brew install ffmpeg).
 *
 * O webpack/Vite continua usando /public/midi/ pra web (compatibilidade).
 * O NativeAudioEngine.ts pode optar entre /midi/ (default) e /midi-native/
 * via flag — útil pra A/B test antes de virar geral.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SRC_DIR = path.join(__dirname, '..', 'public', 'midi');
const DST_DIR = path.join(__dirname, '..', 'public', 'midi-native');

function checkFfmpeg() {
  try {
    execSync('ffmpeg -version', { stdio: 'pipe' });
  } catch {
    console.error('❌ ffmpeg não encontrado. Instale com: brew install ffmpeg');
    process.exit(1);
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function convertOne(srcPath, dstPath) {
  // -y    sobrescreve sem perguntar
  // -i    input
  // -ar   audio rate (sample rate) 48000
  // -ac   audio channels 1 (mono)
  // -sample_fmt s16  PCM 16-bit
  // -hide_banner -loglevel error  silencioso
  const cmd = [
    'ffmpeg',
    '-y',
    '-i', `"${srcPath}"`,
    '-ar', '48000',
    '-ac', '1',
    '-sample_fmt', 's16',
    '-hide_banner', '-loglevel', 'error',
    `"${dstPath}"`
  ].join(' ');
  execSync(cmd, { stdio: 'inherit' });
}

function main() {
  checkFfmpeg();
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`❌ Diretório fonte não existe: ${SRC_DIR}`);
    process.exit(1);
  }
  ensureDir(DST_DIR);

  const files = fs.readdirSync(SRC_DIR).filter(f =>
    /\.(wav|mp3|m4a|ogg|flac)$/i.test(f) && !f.startsWith('.')
  );

  console.log(`🎵 Pré-convertendo ${files.length} samples pra 48kHz mono 16-bit WAV...\n`);

  let ok = 0, fail = 0, skipped = 0;
  for (const file of files) {
    const srcPath = path.join(SRC_DIR, file);
    const dstName = file.replace(/\.(mp3|m4a|ogg|flac)$/i, '.wav');
    const dstPath = path.join(DST_DIR, dstName);

    // Skip se já existe e fonte não foi modificada depois
    if (fs.existsSync(dstPath)) {
      const srcStat = fs.statSync(srcPath);
      const dstStat = fs.statSync(dstPath);
      if (dstStat.mtimeMs >= srcStat.mtimeMs) {
        skipped++;
        continue;
      }
    }

    try {
      convertOne(srcPath, dstPath);
      ok++;
      console.log(`  ✓ ${file} → ${dstName}`);
    } catch (e) {
      fail++;
      console.error(`  ✗ ${file}: ${e.message}`);
    }
  }

  // Atualiza manifest com lista de arquivos convertidos
  const manifestPath = path.join(DST_DIR, 'manifest.json');
  const converted = fs.readdirSync(DST_DIR)
    .filter(f => f.endsWith('.wav') && !f.startsWith('.'))
    .sort();
  fs.writeFileSync(manifestPath, JSON.stringify({ files: converted }, null, 2));

  console.log(`\n📦 Resultado: ${ok} convertidos, ${skipped} já atualizados, ${fail} falhas`);
  console.log(`📄 Manifest: ${manifestPath}`);
  console.log(`\n💡 Pro NativeAudioEngine usar esses, ative a flag:`);
  console.log(`   localStorage.setItem('gdrums-native-samples', '1')`);
}

main();
