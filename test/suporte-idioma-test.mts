// npx tsx test/suporte-idioma-test.mts
// Canal de suporte por idioma: brasileiro vai pro GRUPO, estrangeiro fala
// DIRETO no WhatsApp do atendimento, com a mensagem já escrita no idioma.
import { setLocale, supportHref, SUPPORT_EMAIL, t } from '../src/i18n/index.ts';

let fails = 0;
const ok = (cond: boolean, nome: string, extra?: unknown) => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok ' : 'FALHOU'} ${nome}${!cond && extra ? ' :: ' + String(extra) : ''}`);
};

setLocale('pt-BR');
const pt = supportHref();
ok(pt.includes('chat.whatsapp.com'), 'pt-BR vai pro grupo da comunidade', pt);
ok(!pt.includes('wa.me'), 'pt-BR NÃO vai pro WhatsApp direto do atendimento', pt);

for (const [locale, trecho] of [['en', 'I use GDrums'], ['es-419', 'Uso GDrums']] as const) {
  setLocale(locale);
  const url = supportHref();
  ok(url.startsWith('https://wa.me/5547984639792?text='), `${locale}: conversa direta com o número do atendimento`, url);
  ok(!url.includes('chat.whatsapp.com'), `${locale}: nunca cai no grupo brasileiro`, url);
  const texto = decodeURIComponent(url.split('text=')[1] || '');
  ok(texto.includes(trecho), `${locale}: primeira mensagem no idioma do cliente ("${texto}")`);
  ok(texto === t('support.firstMessage'), `${locale}: mensagem vem do dicionário`);
}

// O e-mail continua existindo como alternativa (landings, privacidade,
// termos e ficha das lojas apontam pra ele).
ok(SUPPORT_EMAIL === 'contato@gdrums.com.br', 'e-mail de suporte segue publicado', SUPPORT_EMAIL);

setLocale('pt-BR');
console.log(fails ? `\n${fails} falha(s)` : '\ntodos ok');
process.exit(fails ? 1 : 0);
