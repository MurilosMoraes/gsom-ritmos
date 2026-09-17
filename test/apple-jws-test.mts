// npx tsx test/apple-jws-test.mts
// Verificador de JWS da Apple (supabase/functions/_shared/appleJws.ts)
// contra uma cadeia de teste no mesmo formato da Apple.
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import { verifyAppleJws, APPLE_ROOT_CA_G3 } from '../supabase/functions/_shared/appleJws.ts';

const dir = new URL('./fixtures/apple-jws/', import.meta.url);
const der = (n: string) => fs.readFileSync(new URL(n, dir));
const b64 = (b: Uint8Array | Buffer) => Buffer.from(b).toString('base64');
const b64url = (b: Uint8Array | Buffer | string) => Buffer.from(b).toString('base64url');
const ROOT = b64(der('root.der'));

const pem = fs.readFileSync(new URL('leaf.p8', dir), 'utf8').replace(/-----[^-]+-----|\s/g, '');
const leafKey = await webcrypto.subtle.importKey('pkcs8', Buffer.from(pem, 'base64'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

async function makeJws(payload: object, opts: { chain?: string[]; alg?: string; tamper?: boolean } = {}) {
  const chain = opts.chain || ['leaf.der', 'inter.der', 'root.der'];
  const header = { alg: opts.alg || 'ES256', x5c: chain.map(n => b64(der(n))) };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const sig = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, leafKey, new TextEncoder().encode(`${h}.${p}`));
  const body = opts.tamper ? b64url(JSON.stringify({ ...payload, productId: 'com.gdrums.app.reidospalcos' })) : p;
  return `${h}.${body}.${b64url(new Uint8Array(sig))}`;
}

let fails = 0;
function check(name: string, got: { ok: boolean; reason?: string }, wantOk: boolean, wantReason?: string) {
  const ok = got.ok === wantOk && (!wantReason || got.reason === wantReason);
  if (!ok) fails++;
  console.log(`${ok ? 'ok ' : 'FALHOU'} ${name} → ${got.ok ? 'válido' : got.reason}`);
}

const tx = { transactionId: '2000000123456789', productId: 'com.gdrums.app.anual', bundleId: 'com.gdrums.app', appAccountToken: 'u-1', signedDate: Date.now() };

check('token legítimo', await verifyAppleJws(await makeJws(tx), { rootB64: ROOT }), true);
const good = await verifyAppleJws<typeof tx>(await makeJws(tx), { rootB64: ROOT });
console.log(good.ok && good.payload.transactionId === tx.transactionId ? 'ok  payload devolvido' : (fails++, 'FALHOU payload'));
check('payload alterado depois de assinado', await verifyAppleJws(await makeJws(tx, { tamper: true }), { rootB64: ROOT }), false, 'assinatura');
check('raiz que não é a da Apple (padrão)', await verifyAppleJws(await makeJws(tx)), false, 'raiz_nao_apple');
check('cadeia com 2 certificados', await verifyAppleJws(await makeJws(tx, { chain: ['leaf.der', 'root.der'] }), { rootB64: ROOT }), false, 'x5c');
check('folha sem a extensão da Apple', await verifyAppleJws(await makeJws(tx, { chain: ['leaf-sem-oid.der', 'inter.der', 'root.der'] }), { rootB64: ROOT }), false, 'folha_sem_oid');
check('folha emitida por outro intermediário', await verifyAppleJws(await makeJws(tx, { chain: ['leaf-outro-inter.der', 'inter.der', 'root.der'] }), { rootB64: ROOT }), false, 'folha_nao_assinada_pelo_intermediario');
check('intermediário no lugar da folha', await verifyAppleJws(await makeJws(tx, { chain: ['inter.der', 'inter.der', 'root.der'] }), { rootB64: ROOT }), false, 'folha_sem_oid');
check('alg diferente de ES256', await verifyAppleJws(await makeJws(tx, { alg: 'none' }), { rootB64: ROOT }), false, 'alg');
check('assinado em 2090 (certificado vencido)', await verifyAppleJws(await makeJws({ ...tx, signedDate: Date.UTC(2090, 0, 1) }), { rootB64: ROOT }), false, 'certificado_fora_da_validade');
check('assinado em 2000 (antes da emissão)', await verifyAppleJws(await makeJws({ ...tx, signedDate: Date.UTC(2000, 0, 1) }), { rootB64: ROOT }), false, 'certificado_fora_da_validade');
check('lixo', await verifyAppleJws('abc', { rootB64: ROOT }), false, 'formato');
check('três partes sem sentido', await verifyAppleJws('a.b.c', { rootB64: ROOT }), false);
check('não é string', await verifyAppleJws(undefined as unknown as string), false, 'formato');
const legacyNone = `${b64url(JSON.stringify({ alg: 'ES256' }))}.${b64url(JSON.stringify(tx))}.`;
check('JWS "decodificável" sem cadeia (o que a v4 aceitava)', await verifyAppleJws(legacyNone), false, 'x5c');

// A raiz embutida é a da Apple de verdade e o parser entende ela.
const appleRoot = Buffer.from(APPLE_ROOT_CA_G3, 'base64');
const onDisk = fs.readFileSync(new URL('../supabase/functions/_shared/apple-certs/AppleRootCA-G3.cer', import.meta.url));
console.log(appleRoot.equals(onDisk) ? 'ok  raiz embutida = AppleRootCA-G3.cer' : (fails++, 'FALHOU raiz embutida'));
const fakeWithAppleRoot = await makeJws(tx, { chain: ['leaf.der', 'inter.der', 'root.der'] }).then(j => {
  const [h, p, s] = j.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  header.x5c[2] = APPLE_ROOT_CA_G3;
  return `${b64url(JSON.stringify(header))}.${p}.${s}`;
});
check('cadeia falsa pendurada na raiz real da Apple', await verifyAppleJws(fakeWithAppleRoot), false, 'intermediario_nao_assinado_pela_raiz');

// Certificados REAIS da Apple: intermediário WWDR G6 (o que assina as
// compras) + raiz G3. A folha é a de teste, então o esperado é passar por
// todas as checagens da cadeia real e parar só na folha.
const realChain = await makeJws(tx).then(j => {
  const [h, p, sg] = j.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  header.x5c[1] = b64(der('AppleWWDRCAG6.cer'));
  header.x5c[2] = APPLE_ROOT_CA_G3;
  return `${b64url(JSON.stringify(header))}.${p}.${sg}`;
});
check('WWDR G6 real assinado pela raiz real; só a folha falsa é barrada', await verifyAppleJws(realChain), false, 'folha_nao_assinada_pelo_intermediario');

console.log(fails ? `\n${fails} falha(s)` : '\ntodos ok');
process.exit(fails ? 1 : 0);
