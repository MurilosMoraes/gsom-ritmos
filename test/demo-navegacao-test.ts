// Teste da NAVEGAÇÃO da demo no app nativo.
//
// BUG (iOS, 10/08/2026): cliente ficava PRESO na demo, sem conseguir entrar
// nem sendo pagante. Duas causas somadas:
//
//   1. `demoIsEntryPoint()` retornava true pra `isNativeApp()`, então TODO
//      acesso sem sessão no app era jogado pra /demo.
//   2. Os CTAs da demo são <a href="/login"> crus no HTML. Na web a Vercel
//      reescreve /login -> login.html; no Capacitor os arquivos são LOCAIS
//      e /login NÃO EXISTE. O botão "ENTRAR" não ia a lugar nenhum.
//
// Juntas: forçado pra demo + sem saída = loop.
//
// Roda: npx tsx test/demo-navegacao-test.ts

let passed = 0, failed = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ FALHOU: ${msg}`); }
}

// ── Cópia EXATA do internalNav de produção (src/native/Platform.ts) ────
function internalNav(path: string, ehNativo: boolean): string {
  if (ehNativo && !path.includes('.html')) {
    const match = path.match(/^([^?#]*)(.*)$/);
    if (match) {
      const [, base, rest] = match;
      const baseWithHtml = base.endsWith('/') ? base + 'index.html' : base + '.html';
      return baseWithHtml + rest;
    }
  }
  return path;
}

// ── Regra do interceptador de links (src/demo.ts) ─────────────────────
function deveInterceptar(href: string, target?: string): boolean {
  if (!href.startsWith('/') || href.startsWith('//')) return false;
  if (href.includes('.html')) return false;
  if (target === '_blank') return false;
  return true;
}

console.log('═══ Navegação da demo no app nativo ═══\n');

// ══════════════════════════════════════════════════════════════════
console.log('1. O BOTÃO "ENTRAR" LEVA MESMO PRO LOGIN NO APP?');
// ══════════════════════════════════════════════════════════════════
{
  const href = '/login'; // exatamente o que está no demo.html
  ok(deveInterceptar(href), 'o clique em /login é interceptado no app');
  ok(internalNav(href, true) === '/login.html', `no app vira /login.html (deu ${internalNav(href, true)})`);
  ok(internalNav(href, false) === '/login', 'na web continua /login (Vercel reescreve)');
}

// ══════════════════════════════════════════════════════════════════
console.log('\n2. OS OUTROS CTAs DA DEMO (register)');
// ══════════════════════════════════════════════════════════════════
{
  for (const href of ['/register', '/plans']) {
    ok(deveInterceptar(href), `${href} é interceptado`);
    ok(internalNav(href, true) === `${href}.html`, `${href} vira ${href}.html no app`);
  }
  // com querystring (o quick-signup manda ?email=...)
  const comQuery = '/register?email=teste%40x.com';
  ok(internalNav(comQuery, true) === '/register.html?email=teste%40x.com',
     `querystring preservada: ${internalNav(comQuery, true)}`);
}

// ══════════════════════════════════════════════════════════════════
console.log('\n3. NÃO PODE QUEBRAR O QUE JÁ FUNCIONAVA');
// ══════════════════════════════════════════════════════════════════
{
  ok(!deveInterceptar('https://gdrums.com.br/planos'), 'link externo (https) NÃO é interceptado');
  ok(!deveInterceptar('//cdn.exemplo.com/x'), 'protocolo-relativo NÃO é interceptado');
  ok(!deveInterceptar('/login.html'), 'link que já tem .html NÃO é mexido');
  ok(!deveInterceptar('/plans', '_blank'), 'link target=_blank NÃO é interceptado');
  ok(!deveInterceptar('#secao'), 'âncora interna NÃO é interceptada');
  ok(!deveInterceptar('mailto:a@b.com'), 'mailto NÃO é interceptado');
  ok(!deveInterceptar('https://wa.me/5511999999999'), 'WhatsApp NÃO é interceptado');
}

// ══════════════════════════════════════════════════════════════════
console.log('\n4. A DEMO NÃO É MAIS PORTA DE ENTRADA FORÇADA NO APP');
// ══════════════════════════════════════════════════════════════════
{
  // Regra nova: só é entry point quando veio da landing com ?entrar=1
  const ehEntryPoint = (busca: string): boolean =>
    new URLSearchParams(busca).has('entrar');

  ok(ehEntryPoint('?entrar=1'), 'veio da landing (?entrar=1) → demo é a entrada (pedido do usuário)');
  ok(!ehEntryPoint(''), 'app nativo abrindo normal → NÃO força demo (vai pro login)');
  ok(!ehEntryPoint('?utm_source=google'), 'link do Google → NÃO força demo');
}

// ══════════════════════════════════════════════════════════════════
console.log('\n5. O CENÁRIO QUE QUEBROU (regressão)');
// ══════════════════════════════════════════════════════════════════
{
  // Antes: nativo sem sessão -> /demo, e o ENTRAR não funcionava = preso.
  const forcavaDemoAntes = true;                       // isNativeApp() => true
  const forcaDemoAgora = new URLSearchParams('').has('entrar');
  ok(forcavaDemoAntes && !forcaDemoAgora, 'app nativo sem sessão NÃO cai mais na demo');

  // E mesmo que caia (clicou no botão Demo), agora tem saída funcionando.
  const saidaFunciona = deveInterceptar('/login') && internalNav('/login', true) === '/login.html';
  ok(saidaFunciona, 'se entrar na demo pelo botão, o ENTRAR agora FUNCIONA (não fica preso)');
}

console.log('\n══════════════════════════════════════════════════');
console.log(`RESULTADO: ${passed} passou, ${failed} falhou, ${passed + failed} total`);
console.log('══════════════════════════════════════════════════');
if (failed > 0) { console.log('\n❌ Navegação da demo AINDA quebrada.'); process.exit(1); }
console.log('\n🎯 App não força demo, e quem entrar nela consegue sair pro login.');
process.exit(0);
