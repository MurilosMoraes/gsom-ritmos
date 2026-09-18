// Confere os limites de caracteres do STORE-LISTING.md (Play Store e App Store).
// Roda: node scripts/check-store-listing.mjs
import fs from 'node:fs';

const md = fs.readFileSync(new URL('../STORE-LISTING.md', import.meta.url), 'utf8');

const RULES = [
  { re: /^(Nome|Nombre|App name)\b/, max: 30, label: 'nome' },
  { re: /^(Subtítulo|Subtitle)\b/, max: 30, label: 'subtítulo' },
  { re: /^(Descrição curta|Descripción corta|Short description)\b/, max: 80, label: 'descrição curta' },
  { re: /^(Palavras-chave|Palabras clave|Keywords)\b/, max: 100, label: 'palavras-chave', bytes: true },
  { re: /^(Texto promocional|Promotional text)\b/, max: 170, label: 'texto promocional' },
  { re: /^(Descrição completa|Descripción completa|Full description)\b/, max: 4000, label: 'descrição completa' },
];
const FORBIDDEN = [/\bpix\b/i, /boleto/i, /R\$/, /infinitepay/i, /assine no site/i, /\/plans\b/];

let lang = '?';
let fails = 0;
const byLang = {};
const lines = md.split('\n');
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (/^# (🇧🇷|🇲🇽|🇺🇸|🇪🇸|🇬🇧|🇵🇹)/.test(l)) lang = l.replace(/^# /, '').split(' ')[1];
  const h = l.match(/^### (.+)$/);
  if (!h) continue;
  const rule = RULES.find(r => r.re.test(h[1]));
  if (!rule) continue;
  const start = lines.indexOf('```', i + 1);
  const end = lines.indexOf('```', start + 1);
  const value = lines.slice(start + 1, end).join('\n');
  const chars = [...value].length;
  const bytes = Buffer.byteLength(value, 'utf8');
  const size = rule.bytes ? bytes : chars;
  const ok = size <= rule.max;
  if (!ok) fails++;
  (byLang[lang] ||= {})[rule.label] = value;
  console.log(`${ok ? '✅' : '❌'} ${lang.padEnd(10)} ${rule.label.padEnd(20)} ${String(size).padStart(4)}/${rule.max}${rule.bytes ? ' bytes' : ''}`);

  if (rule.label === 'palavras-chave' && /,\s/.test(value)) { fails++; console.log('   ❌ espaço depois da vírgula desperdiça caractere'); }
  if (['descrição completa', 'descrição curta', 'texto promocional'].includes(rule.label)) {
    for (const f of FORBIDDEN) if (f.test(value)) { fails++; console.log(`   ❌ termo proibido: ${f}`); }
  }
}

// Palavra-chave que já está no nome/subtítulo é desperdício na Apple.
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
for (const [lg, f] of Object.entries(byLang)) {
  const title = norm(`${f['nome'] || ''} ${f['subtítulo'] || ''}`);
  const words = new Set(title.split(/[^a-z0-9]+/).filter(Boolean));
  for (const kw of (f['palavras-chave'] || '').split(',')) {
    const dup = norm(kw).split(/\s+/).filter(w => words.has(w));
    if (dup.length) console.log(`   ⚠️  ${lg}: "${kw}" repete "${dup.join(' ')}" do nome/subtítulo`);
  }
}

console.log(fails ? `\n${fails} problema(s)` : '\nTudo dentro dos limites.');
process.exit(fails ? 1 : 0);
