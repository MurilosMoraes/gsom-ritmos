// Testes da intenção de abertura do app (deep link, push, campanha).
//
// Rodar: npx tsx test/deep-link-test.ts
//
// Cobre os casos que quebravam em produção: app fechado, app aberto em
// página que não escutava, redirect de boot engolindo o destino, link
// velho, e o loop do getLaunchUrl devolvendo sempre a mesma URL.

import {
  guardarIntencao, lerIntencao, limparIntencao, decidir, contarTentativa,
  lancamentoJaUsado, marcarLancamentoUsado, TTL_MS,
  type KeyValueStore,
} from '../src/native/deepLinkIntent';
import { routeFromUrl } from '../src/native/DeepLinks';

let ok = 0, falhou = 0;
function t(nome: string, fn: () => void): void {
  try { fn(); ok++; console.log('  ✅', nome); }
  catch (e) { falhou++; console.log('  ❌', nome, '\n     ', (e as Error).message); }
}
function eq<T>(a: T, b: T, msg = ''): void {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg}\n      esperado: ${y}\n      recebido: ${x}`);
}

function memoria(): KeyValueStore & { dados: Record<string, string> } {
  const dados: Record<string, string> = {};
  return {
    dados,
    getItem: (k) => (k in dados ? dados[k] : null),
    setItem: (k, v) => { dados[k] = v; },
    removeItem: (k) => { delete dados[k]; },
  };
}

console.log('\n── Rotas: o link vira caminho interno ──');

t('recuperar senha com token_hash', () => {
  eq(routeFromUrl('https://gdrums.com.br/login.html?token_hash=abc&type=recovery'),
     '/login.html?token_hash=abc&type=recovery');
});

t('recuperar senha no formato antigo (hash)', () => {
  eq(routeFromUrl('https://gdrums.com.br/login#access_token=xyz&type=recovery'),
     '/login.html#access_token=xyz&type=recovery');
});

t('renovacao com cupom', () => {
  eq(routeFromUrl('https://gdrums.com.br/plans?renew=true&coupon=VOLTA10'),
     '/plans.html?renew=true&coupon=VOLTA10');
});

t('retorno do pagamento', () => {
  eq(routeFromUrl('https://gdrums.com.br/payment-success?order_nsu=123'),
     '/payment-success.html?order_nsu=123');
});

t('cadastro', () => {
  eq(routeFromUrl('https://gdrums.com.br/register'), '/register.html');
});

t('link de compartilhar repertorio', () => {
  eq(routeFromUrl('https://gdrums.com.br/app?s=ABC123'), '/index.html?s=ABC123');
});

t('dominio de fora e recusado', () => {
  eq(routeFromUrl('https://malicioso.com/login?token_hash=roubado'), null);
});

t('caminho desconhecido e recusado', () => {
  eq(routeFromUrl('https://gdrums.com.br/qualquer-coisa'), null);
});

t('url quebrada nao explode', () => {
  eq(routeFromUrl('nao e uma url'), null);
});

console.log('\n── A intenção sobrevive ──');

t('guarda e le', () => {
  const s = memoria();
  guardarIntencao(s, '/login.html?token_hash=abc', 'link', 1000);
  eq(lerIntencao(s, 1000)?.destino, '/login.html?token_hash=abc');
});

t('link velho (passou do prazo) e descartado', () => {
  const s = memoria();
  guardarIntencao(s, '/plans.html', 'push', 1000);
  eq(lerIntencao(s, 1000 + TTL_MS + 1), null);
});

t('no limite do prazo ainda vale', () => {
  const s = memoria();
  guardarIntencao(s, '/plans.html', 'push', 1000);
  eq(lerIntencao(s, 1000 + TTL_MS)?.destino, '/plans.html');
});

t('lixo no storage nao derruba o app', () => {
  const s = memoria();
  s.setItem('gdrums-deeplink-intent', '{quebrado');
  eq(lerIntencao(s, 1000), null);
});

t('storage indisponivel nao derruba o app', () => {
  eq(lerIntencao(null, 1000), null);
  guardarIntencao(null, '/x', 'link');   // nao pode lancar
  limparIntencao(null);
});

t('uso unico: depois de limpar, some', () => {
  const s = memoria();
  guardarIntencao(s, '/plans.html', 'link', 1000);
  limparIntencao(s);
  eq(lerIntencao(s, 1000), null);
});

console.log('\n── A decisão em cada situação real ──');

t('app fechado, abriu na home, intencao e o login: navega', () => {
  const i = { destino: '/login.html?token_hash=abc', em: 1000, origem: 'lancamento' as const };
  eq(decidir('/index.html', i), { acao: 'navegar', destino: '/login.html?token_hash=abc' });
});

t('chegou no destino: atende', () => {
  const i = { destino: '/login.html?token_hash=abc', em: 1000, origem: 'link' as const };
  eq(decidir('/login.html?token_hash=abc', i), { acao: 'atender', destino: '/login.html?token_hash=abc' });
});

t('/login e /login.html sao a mesma pagina', () => {
  const i = { destino: '/login.html?token_hash=abc', em: 1000, origem: 'link' as const };
  eq(decidir('/login?token_hash=abc', i).acao, 'atender');
});

t('o Supabase apaga o hash da url e mesmo assim atende', () => {
  // login.ts processa o token e reescreve a URL com replaceState.
  const i = { destino: '/login.html#access_token=xyz&type=recovery', em: 1000, origem: 'link' as const };
  eq(decidir('/login.html', i).acao, 'atender', 'sem isso o app navegaria em circulo');
});

t('sem intencao, nao faz nada', () => {
  eq(decidir('/index.html', null), { acao: 'nada' });
});

t('boot deslogado mandou pro login, mas a intencao era planos: navega', () => {
  // Este era o furo: o redirect do boot comia o destino do cliente.
  const i = { destino: '/plans.html?renew=true', em: 1000, origem: 'push' as const };
  eq(decidir('/login.html', i), { acao: 'navegar', destino: '/plans.html?renew=true' });
});

console.log('\n── Trava anti pingue-pongue entre telas ──');

t('desiste depois de MAX_TENTATIVAS navegacoes', () => {
  const s = memoria();
  guardarIntencao(s, '/plans.html?renew=true', 'push', 1000);
  // 1a: home manda pro /plans
  contarTentativa(s, 1000);
  eq(lerIntencao(s, 1000)?.tentativas, 1);
  // 2a: /plans sem sessao jogou pro /login, que tenta de novo
  contarTentativa(s, 1000);
  // agora chega: senao o app fica piscando entre login e plans pra sempre
  eq(lerIntencao(s, 1000), null, 'deveria ter desistido');
});

t('o caminho feliz cabe dentro do limite', () => {
  const s = memoria();
  guardarIntencao(s, '/login.html?token_hash=abc', 'lancamento', 1000);
  contarTentativa(s, 1000);                       // home -> login
  eq(lerIntencao(s, 1000)?.destino, '/login.html?token_hash=abc');
  eq(decidir('/login.html?token_hash=abc', lerIntencao(s, 1000)).acao, 'atender');
});

console.log('\n── Trava anti-loop do getLaunchUrl ──');

t('a mesma url de lancamento nao e usada duas vezes', () => {
  const s = memoria();
  const url = 'https://gdrums.com.br/login?token_hash=abc';
  eq(lancamentoJaUsado(s, url), false);
  marcarLancamentoUsado(s, url);
  eq(lancamentoJaUsado(s, url), true, 'index -> login -> index seria loop infinito');
});

t('url de lancamento diferente e aceita', () => {
  const s = memoria();
  marcarLancamentoUsado(s, 'https://gdrums.com.br/a');
  eq(lancamentoJaUsado(s, 'https://gdrums.com.br/b'), false);
});

console.log('\n── Ponta a ponta: recuperar senha com o app FECHADO ──');

t('o fluxo inteiro, do toque no email ate o formulario', () => {
  const local = memoria(), sessao = memoria();
  const url = 'https://gdrums.com.br/login.html?token_hash=abc&type=recovery';

  // 1. app abre frio. getLaunchUrl devolve a url.
  eq(lancamentoJaUsado(sessao, url), false);
  const destino = routeFromUrl(url)!;
  guardarIntencao(local, destino, 'lancamento', 1000);
  marcarLancamentoUsado(sessao, url);

  // 2. a home decide: nao e comigo, navega.
  eq(decidir('/index.html', lerIntencao(local, 1100)), { acao: 'navegar', destino });

  // 3. login.html carrega. getLaunchUrl devolveria a mesma url de novo,
  //    e a trava impede o loop.
  eq(lancamentoJaUsado(sessao, url), true);

  // 4. o login ve que e com ele, atende e limpa.
  eq(decidir('/login.html?token_hash=abc&type=recovery', lerIntencao(local, 1200)).acao, 'atender');
  limparIntencao(local);

  // 5. token processado, url reescrita: nao sobra nada pra reabrir.
  eq(lerIntencao(local, 1300), null);
});

t('push de renovacao com o app FECHADO e deslogado', () => {
  const local = memoria();
  const destino = routeFromUrl('https://gdrums.com.br/plans?renew=true&coupon=X')!;
  guardarIntencao(local, destino, 'push', 1000);

  // boot deslogado joga pro login: a intencao continua de pe.
  eq(decidir('/login.html', lerIntencao(local, 1100)).acao, 'navegar');
  // cliente loga, app manda pro destino guardado.
  eq(decidir('/plans.html?renew=true&coupon=X', lerIntencao(local, 5000)).acao, 'atender');
});

console.log('\n── Nenhuma página do app pode ficar surda ──');

t('toda pagina do app liga o bootIntencao', () => {
  // Esta era a causa de "as vezes nao redireciona": o listener existia so
  // em index, login e plans. Quem estivesse em register, payment-success,
  // completar-cadastro ou demo nao recebia nada.
  //
  // Se este teste quebrar porque voce criou uma pagina nova: chame
  // bootIntencao() no boot dela. Nao apague o teste.
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const raiz = path.join(__dirname, '..');

  // Paginas que NAO fazem parte do app do cliente.
  const foraDoApp = new Set([
    'admin.html', 'affiliate.html', 'landing.html', 'landing-es.html',
    'landing-en.html', 'terms.html', 'privacy.html', 'excluir-conta.html',
    'links.html', 'download.html',
  ]);

  const surdas: string[] = [];
  for (const arquivo of fs.readdirSync(raiz).filter(f => f.endsWith('.html'))) {
    if (foraDoApp.has(arquivo)) continue;
    const html = fs.readFileSync(path.join(raiz, arquivo), 'utf8');
    const src = html.match(/src="(\/src\/[^"]+)"/)?.[1];
    if (!src) continue;
    const ts = path.join(raiz, src);
    if (!fs.existsSync(ts)) continue;
    if (!fs.readFileSync(ts, 'utf8').includes('bootIntencao')) surdas.push(`${arquivo} (${src})`);
  }
  eq(surdas, [], 'estas paginas nao respondem a deep link nem a push');
});

console.log(`\n${ok} ok, ${falhou} falharam\n`);
process.exit(falhou ? 1 : 0);
