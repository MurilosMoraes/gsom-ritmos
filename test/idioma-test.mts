// npx tsx test/idioma-test.mts
// Idioma do push e do e-mail pelo país do perfil.
import { idiomaDoPais, textoNoIdioma, preencher } from '../supabase/functions/_shared/idioma.ts';

let fails = 0;
const eq = (nome: string, veio: unknown, esperado: unknown) => {
  const ok = veio === esperado;
  if (!ok) fails++;
  console.log(`${ok ? 'ok ' : 'FALHOU'} ${nome} (veio ${veio}, esperado ${esperado})`);
};

eq('Brasil fala português', idiomaDoPais('BR'), 'pt');
eq('país nulo é conta antiga do Brasil', idiomaDoPais(null), 'pt');
eq('país vazio também', idiomaDoPais(''), 'pt');
eq('Portugal fala português', idiomaDoPais('PT'), 'pt');
eq('Angola fala português', idiomaDoPais('AO'), 'pt');
eq('México fala espanhol', idiomaDoPais('MX'), 'es');
eq('Espanha fala espanhol', idiomaDoPais('ES'), 'es');
eq('Argentina fala espanhol', idiomaDoPais('AR'), 'es');
eq('Estados Unidos fala inglês', idiomaDoPais('US'), 'en');
eq('Japão cai no inglês', idiomaDoPais('JP'), 'en');
eq('minúsculo funciona', idiomaDoPais('mx'), 'es');
eq('com espaço funciona', idiomaDoPais(' br '), 'pt');
eq('lixo cai no inglês', idiomaDoPais('ZZZ'), 'en');

const catalogo = { pt: 'Seu teste acaba amanhã', es: 'Tu prueba termina mañana', en: 'Your trial ends tomorrow' };
eq('texto BR', textoNoIdioma(catalogo, 'BR'), 'Seu teste acaba amanhã');
eq('texto MX', textoNoIdioma(catalogo, 'MX'), 'Tu prueba termina mañana');
eq('texto US', textoNoIdioma(catalogo, 'US'), 'Your trial ends tomorrow');
eq('texto sem país', textoNoIdioma(catalogo, undefined), 'Seu teste acaba amanhã');

eq('preenche uma chave', preencher('Oi {nome}!', { nome: 'João' }), 'Oi João!');
eq('preenche repetida', preencher('{n} de {n}', { n: 3 }), '3 de 3');
eq('sem valores não quebra', preencher('Oi {nome}!'), 'Oi {nome}!');

console.log(fails ? `\n${fails} falha(s)` : '\ntodos ok');
process.exit(fails ? 1 : 0);
