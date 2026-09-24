// "SUMIU MEU REPERTÓRIO" — o bug que fez cliente apagar as próprias músicas.
//
// Rodar: npx tsx test/repertorio-vazio-test.ts
//
// O QUE ACONTECIA (medido na base em 24/09/2026):
//   - todo boot com o armazenamento local vazio criava um "Meu repertório"
//     vazio e o deixava ATIVO;
//   - o repertório de verdade continuava lá, escondido atrás do seletor;
//   - 172 contas abriam no vazio TENDO música em outro;
//   - os vazios acumulavam: 1.650 contas com 2 ou mais, uma com 29 (de 30);
//   - o cliente via a bagunça, saía limpando na mão, e em 14 dias 61
//     exclusões foram de repertórios "Meu repertório" QUE TINHAM MÚSICA.
//
// Os testes abaixo são sobre a união (unionSetlists), que é onde isso é
// decidido. Se algum quebrar, o bug voltou. Não conserte o teste.

import { SetlistManager, ehLixoAutomatico, MAX_SETLISTS } from '../src/core/SetlistManager';

let ok = 0, falhou = 0;
const t = (nome: string, fn: () => void) => {
  try { fn(); ok++; console.log('  ✅', nome); }
  catch (e) { falhou++; console.log('  ❌', nome, '\n     ', (e as Error).message); }
};
const eq = <T>(a: T, b: T, msg = '') => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg}\n      esperado: ${JSON.stringify(b)}\n      recebido: ${JSON.stringify(a)}`);
  }
};

type Lista = { id: string; name: string; items: any[]; currentIndex: number; lastModified?: number };
const lista = (id: string, name: string, n: number, lastModified?: number): Lista => ({
  id, name, items: Array.from({ length: n }, (_, i) => ({ name: `m${i}`, path: `/r/${i}.json` })),
  currentIndex: 0, ...(lastModified !== undefined ? { lastModified } : {}),
});
/** O que o app cria sozinho: vazio, nome padrão, sem lastModified. */
const lixo = (id: string, nome = 'Meu repertório'): Lista => ({ id, name: nome, items: [], currentIndex: 0 });

// unionSetlists é privado; o teste exercita pela instância, que é o que roda.
const unir = (local: any, remoto: any): any =>
  (SetlistManager.prototype as any).unionSetlists.call({}, local, remoto);

console.log('\n── Reconhecer o lixo sem confundir com repertório do cliente ──');

t('vazio + nome padrao + nunca tocado = lixo', () => {
  eq(ehLixoAutomatico(lixo('a')), true);
});

t('nome padrao em ingles e espanhol tambem', () => {
  eq(ehLixoAutomatico(lixo('a', 'My setlist')), true);
  eq(ehLixoAutomatico(lixo('a', 'Mi repertorio')), true);
  eq(ehLixoAutomatico(lixo('a', 'MEU REPERTÓRIO')), true, 'caixa alta e o mesmo lixo');
});

t('com musica NUNCA e lixo', () => {
  eq(ehLixoAutomatico(lista('a', 'Meu repertório', 3)), false);
});

t('renomeado pelo cliente NUNCA e lixo, mesmo vazio', () => {
  eq(ehLixoAutomatico({ id: 'a', name: 'Show de sábado', items: [], currentIndex: 0 } as any), false,
     'o nome e dele, perder isso e perder trabalho');
});

t('criado agora pelo cliente NUNCA e lixo (tem lastModified)', () => {
  eq(ehLixoAutomatico({ id: 'a', name: 'Meu repertório', items: [], currentIndex: 0, lastModified: 123 } as any), false,
     'createSetlist carimba lastModified');
});

console.log('\n── O caso do cliente: abrir no repertório certo ──');

t('boot novo + servidor com musica: NAO abre no vazio', () => {
  // Exatamente o que aconteceu com 172 contas.
  const local  = { setlists: [lixo('novo')], activeId: 'novo', lastModified: 0 };
  const remoto = { setlists: [lista('show', 'Sertanejo', 80, 1000)], activeId: 'show', lastModified: 1000 };
  const r = unir(local, remoto);
  eq(r.activeId, 'show', 'abria no vazio e o cliente achava que tinha sumido');
  eq(r.setlists.length, 1, 'o vazio automatico nao fica sujando a lista');
  eq(r.setlists[0].items.length, 80);
});

t('as 80 musicas continuam intactas', () => {
  const local  = { setlists: [lixo('novo')], activeId: 'novo', lastModified: 0 };
  const remoto = { setlists: [lista('show', 'Sertanejo', 80, 1000)], activeId: 'show', lastModified: 1000 };
  eq(unir(local, remoto).setlists[0].items.length, 80);
});

t('varios repertorios: respeita o que ele tinha aberto no outro aparelho', () => {
  // Nao e "o mais recente" nem "o maior": e a ESCOLHA dele. O servidor
  // guarda qual estava ativo, e isso vale mais que qualquer heuristica.
  const local  = { setlists: [lixo('novo')], activeId: 'novo', lastModified: 0 };
  const remoto = { setlists: [lista('a', 'Vaneiras', 17, 1000), lista('b', 'Pop', 48, 5000)],
                   activeId: 'a', lastModified: 5000 };
  eq(unir(local, remoto).activeId, 'a');
});

t('se ate o ativo do servidor for lixo, cai no que tem musica', () => {
  // Conta ja estragada pelo bug: o vazio virou ativo nos dois lados.
  const local  = { setlists: [lixo('v1')], activeId: 'v1', lastModified: 0 };
  const remoto = { setlists: [lixo('v2'), lista('real', 'Sertanejo', 80, 900)],
                   activeId: 'v2', lastModified: 900 };
  eq(unir(local, remoto).activeId, 'real', 'senao a conta estragada nunca se conserta sozinha');
});

console.log('\n── Não acumular lixo (era 1.650 contas) ──');

t('tres vazios automaticos + um cheio: sobra so o cheio', () => {
  // O caso do Carlos: 3 "Meu repertório" vazios e o de verdade escondido.
  const local  = { setlists: [lixo('v1'), lixo('v2'), lixo('v3')], activeId: 'v3', lastModified: 0 };
  const remoto = { setlists: [lista('real', 'Sertanejo', 12, 900)], activeId: 'real', lastModified: 900 };
  const r = unir(local, remoto);
  eq(r.setlists.map((s: Lista) => s.id), ['real']);
  eq(r.activeId, 'real');
});

t('conta so com lixo continua com UM repertorio (invariante)', () => {
  const r = unir({ setlists: [lixo('v1'), lixo('v2')], activeId: 'v1', lastModified: 0 }, null);
  eq(r.setlists.length >= 1, true, 'o app quebra sem nenhum repertorio');
});

console.log('\n── Não tirar nada do cliente ──');

t('vazio que o cliente nomeou sobrevive', () => {
  const local = { setlists: [{ id: 'meu', name: 'Show de sábado', items: [], currentIndex: 0 } as any],
                  activeId: 'meu', lastModified: 0 };
  const remoto = { setlists: [lista('outro', 'Pop', 5, 900)], activeId: 'outro', lastModified: 900 };
  const r = unir(local, remoto);
  eq(r.setlists.map((s: Lista) => s.id).sort(), ['meu', 'outro']);
});

t('vazio criado AGORA pelo cliente continua ativo', () => {
  // Acabou de criar pra encher em seguida: roubar o foco dele seria pior.
  const novo = { id: 'novo', name: 'Meu repertório', items: [], currentIndex: 0, lastModified: 9999 } as any;
  const local  = { setlists: [novo], activeId: 'novo', lastModified: 9999 };
  const remoto = { setlists: [lista('velho', 'Pop', 10, 100)], activeId: 'velho', lastModified: 100 };
  const r = unir(local, remoto);
  eq(r.activeId, 'novo', 'o cliente acabou de criar, deixa ele lá');
  eq(r.setlists.length, 2);
});

t('nenhum repertorio com musica some na uniao', () => {
  const local  = { setlists: [lista('a', 'A', 3, 100), lixo('v')], activeId: 'v', lastModified: 100 };
  const remoto = { setlists: [lista('b', 'B', 7, 200)], activeId: 'b', lastModified: 200 };
  const r = unir(local, remoto);
  eq(r.setlists.map((s: Lista) => s.id).sort(), ['a', 'b']);
  eq(r.setlists.reduce((n: number, s: Lista) => n + s.items.length, 0), 10);
});

console.log('\n── Estourar o limite não pode comer repertório cheio ──');

t('no limite, quem sai e o vazio, nunca o cheio', () => {
  const cheios = Array.from({ length: MAX_SETLISTS }, (_, i) => lista('c' + i, 'Show ' + i, i + 1, 1000 + i));
  const local  = { setlists: [...cheios, lixo('v1'), lixo('v2')], activeId: 'v1', lastModified: 2000 };
  const r = unir(local, null);
  eq(r.setlists.length, MAX_SETLISTS);
  eq(r.setlists.every((s: Lista) => s.items.length > 0), true, 'cortou repertorio cheio e manteve vazio');
});

t('mais repertorios cheios que o limite: fica com os maiores', () => {
  const muitos = Array.from({ length: MAX_SETLISTS + 5 }, (_, i) => lista('c' + i, 'S' + i, i + 1, 1000 + i));
  const r = unir({ setlists: muitos, activeId: 'c0', lastModified: 2000 }, null);
  eq(r.setlists.length, MAX_SETLISTS);
  const menor = Math.min(...r.setlists.map((s: Lista) => s.items.length));
  eq(menor >= 6, true, 'deveria manter os maiores, nao os primeiros da lista');
});

console.log('\n── Tombstone continua mandando (exclusão propaga) ──');

t('o que o cliente apagou nao volta', () => {
  const local  = { setlists: [lista('a', 'A', 3, 100)], activeId: 'a', lastModified: 100, deletedSetlists: ['b'] };
  const remoto = { setlists: [lista('a', 'A', 3, 100), lista('b', 'B', 9, 50)], activeId: 'b', lastModified: 100 };
  const r = unir(local, remoto);
  eq(r.setlists.map((s: Lista) => s.id), ['a'], 'ressuscitou o que ele apagou');
});

console.log(`\n${ok} ok, ${falhou} falharam\n`);
process.exit(falhou ? 1 : 0);
