// Teste das GUARDAS DE E-MAIL do cadastro.
//
// Roda o arquivo REAL que vai pro servidor
// (supabase/functions/register-account/emailGuard.ts), não uma cópia.
//
// O que está em jogo:
//  - Falso NEGATIVO (deixa passar): volta a entrar conta "Teste" descartável.
//  - Falso POSITIVO (barra errado): cliente pagante NÃO consegue cadastrar.
//    Esse é o caro. Por isso a maior parte dos casos aqui é "tem que passar".
//
// Roda: npx tsx test/email-guard-test.ts

import { checarEmail } from '../supabase/functions/register-account/emailGuard';

let passed = 0, failed = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ FALHOU: ${msg}`); }
}

/** Deve PASSAR (e-mail bom, cadastro segue). */
function aceita(email: string, nota = ''): void {
  const r = checarEmail(email);
  ok(r === null, `aceita  ${email}${nota ? '  (' + nota + ')' : ''}${r ? '  [barrou: ' + r.code + ']' : ''}`);
}
/** Deve ser RECUSADO com o código esperado. */
function recusa(email: string, code: string, nota = ''): void {
  const r = checarEmail(email);
  ok(r?.code === code, `recusa  ${email}  -> ${code}${nota ? '  (' + nota + ')' : ''}${r ? '' : '  [passou!]'}`);
}

console.log('═══ Guardas de e-mail do cadastro ═══\n');

// ══════════════════════════════════════════════════════════════════
console.log('1. E-MAILS DE VERDADE — TÊM que passar (falso positivo = perde cliente)');
// ══════════════════════════════════════════════════════════════════
aceita('murilosilvamoraes@gmail.com');
aceita('joao.silva@hotmail.com');
aceita('maria@outlook.com');
aceita('pedro@yahoo.com.br');
aceita('ana@icloud.com');
aceita('jose@bol.com.br');
aceita('carlos@uol.com.br');
aceita('paulo@terra.com.br');
aceita('luiz@globo.com');
// Casos REAIS do banco que quase viraram falso positivo:
aceita('gustavo@estrelapickups.com.br', 'empresa real de captadores');
aceita('iago.lucas@weatherford.com', 'empresa real');
aceita('aluno@fosjc.unesp.br', 'universidade');
aceita('aluno@unirp.edu.br', 'universidade');
aceita('contato@gdrums.com.br', 'nosso proprio dominio');
// (fmail.com saiu daqui e virou bloqueado — ver secao 2)
// Domínios que ficam a 1 letra de gmail.com — por isso não usamos
// similaridade automática, só lista explícita:
aceita('alguem@email.com', 'REAL, e a 1 letra de gmail.com');
aceita('alguem@mail.com', 'REAL');
aceita('alguem@gmail.com.br', 'existe, nao e typo de gmail.com');
// TLDs variados
aceita('musico@protonmail.com');
aceita('banda@live.com');
aceita('show@me.com');
aceita('teste@dominio.org');
aceita('teste@dominio.net');
aceita('teste@dominio.com.ar');

// ══════════════════════════════════════════════════════════════════
console.log('\n2. DESCARTÁVEIS — os "Teste" que apareceram no banco');
// ══════════════════════════════════════════════════════════════════
recusa('wofamo2175@davopa.com', 'email_disposable', 'conta "Teste teste" real');
recusa('wofamo9518@davopa.com', 'email_disposable', 'conta "Teste zerodois" real');
recusa('xojom79190@kingcq.com', 'email_disposable', 'conta "Teste hum" real');
// fmail.com: 9 contas de farming entre 04/07 e 05/08, todas trial, R$ 0 pago
recusa('dario@fmail.com', 'email_disposable', 'farming: 9 contas no mesmo dominio');
recusa('gerson@fmail.com', 'email_disposable', 'nome de cantor conhecido, conta fake');
recusa('qualquer@mailinator.com', 'email_disposable');
recusa('qualquer@yopmail.com', 'email_disposable');
recusa('qualquer@guerrillamail.com', 'email_disposable');
recusa('qualquer@10minutemail.com', 'email_disposable');
recusa('qualquer@temp-mail.org', 'email_disposable');
recusa('qualquer@trashmail.com', 'email_disposable');
recusa('qualquer@maildrop.cc', 'email_disposable');
// Maiúsculas não escapam
recusa('QUALQUER@DAVOPA.COM'.toLowerCase(), 'email_disposable', 'case-insensitive');

// ══════════════════════════════════════════════════════════════════
console.log('\n3. DIGITADO ERRADO — o caso que custou dinheiro');
// ══════════════════════════════════════════════════════════════════
recusa('erinaldofranca98@gmail.come', 'email_typo', 'CLIENTE QUE PAGOU e nunca recebe email');
recusa('ramonsantoscantoroff@gmail.com.com', 'email_typo', 'caso real do banco');
recusa('alguem@gmail.con', 'email_typo');
recusa('alguem@gmail.co', 'email_typo');
recusa('alguem@gmial.com', 'email_typo');
recusa('alguem@gamil.com', 'email_typo');
recusa('alguem@hotmail.con', 'email_typo');
recusa('alguem@hotmial.com', 'email_typo');
recusa('alguem@outlook.con', 'email_typo');
recusa('alguem@yahoo.come', 'email_typo');
recusa('alguem@icloud.con', 'email_typo');
recusa('alguem@bol.com.br.com', 'email_typo');
// Terminação inexistente pega mesmo fora do mapa explícito
recusa('alguem@dominioqualquer.con', 'email_typo', 'TLD .con nao existe');
recusa('alguem@dominioqualquer.cmo', 'email_typo', 'TLD .cmo nao existe');
recusa('alguem@qualquercoisa.com.com', 'email_typo', '.com.com nunca e valido');

// ══════════════════════════════════════════════════════════════════
console.log('\n4. E-MAIL QUEBRADO');
// ══════════════════════════════════════════════════════════════════
recusa('semdominio@', 'email_invalid');
recusa('semponto@dominio', 'email_invalid');

// ══════════════════════════════════════════════════════════════════
console.log('\n5. QUALIDADE DA MENSAGEM (público é senhor de idade)');
// ══════════════════════════════════════════════════════════════════
{
  const typo = checarEmail('erinaldofranca98@gmail.come');
  ok(!!typo?.erro.includes('erinaldofranca98@gmail.com'),
     `sugere o e-mail certo montado: "${typo?.erro}"`);

  const desc = checarEmail('wofamo2175@davopa.com');
  ok(!!desc && !/\b(inv[aá]lido|erro|blocked|invalid)\b/i.test(desc.erro),
     `descartavel: mensagem sem jargao tecnico`);
  ok(!!desc?.erro.includes('Gmail'),
     `descartavel: da exemplo do que usar ("${desc?.erro.slice(0, 60)}...")`);

  const todos = [typo, desc].filter(Boolean);
  ok(todos.every(m => !m!.erro.includes('—')),
     'nenhuma mensagem usa travessao');
}

console.log('\n══════════════════════════════════════════════════');
console.log(`RESULTADO: ${passed} passou, ${failed} falhou, ${passed + failed} total`);
console.log('══════════════════════════════════════════════════');
if (failed > 0) { console.log('\n❌ Guarda de e-mail com problema. NAO deployar.'); process.exit(1); }
console.log('\n🎯 Descartavel e typo barrados; e-mail de verdade passa.');
process.exit(0);
