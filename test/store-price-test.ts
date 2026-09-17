// npx tsx test/store-price-test.ts
import { storeSavingsPercent } from '../src/auth/storePrice';

let fails = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'ok ' : 'FALHOU'} ${name} (veio ${got}, esperado ${want})`);
}

eq('semestral BR 144 vs 6x29', storeSavingsPercent(144, 6, 29), 17);
eq('anual BR 228 vs 12x29', storeSavingsPercent(228, 12, 29), 34);
eq('trimestral BR 81 vs 3x29', storeSavingsPercent(81, 3, 29), 6);
eq('anual US 49.99 vs 12x5.99', storeSavingsPercent(49.99, 12, 5.99), 30);
eq('mensal não tem economia', storeSavingsPercent(29, 1, 29), 0);
eq('plano longo mais caro que o mensal', storeSavingsPercent(200, 6, 29), 0);
eq('sem preço do plano', storeSavingsPercent(undefined, 6, 29), 0);
eq('sem preço do mensal', storeSavingsPercent(144, 6, undefined), 0);
eq('preço zero', storeSavingsPercent(0, 6, 29), 0);
eq('economia menor que 1%', storeSavingsPercent(173.5, 6, 29), 0);

console.log(fails ? `\n${fails} falha(s)` : '\ntodos ok');
process.exit(fails ? 1 : 0);
