// Verificação de JWS assinado pela Apple (StoreKit 2 e App Store Server
// Notifications V2), sem biblioteca externa: só WebCrypto.
//
// Mesmas regras do SignedDataVerifier da Apple (app-store-server-library):
//  1. cabeçalho ES256 com cadeia x5c de 3 certificados;
//  2. o 3º é EXATAMENTE o Apple Root CA - G3 (byte a byte);
//  3. raiz assinou o intermediário e o intermediário assinou a folha;
//  4. intermediário tem a extensão Apple 1.2.840.113635.100.6.2.1 e a
//     folha a 1.2.840.113635.100.6.11.1;
//  5. os dois dentro da validade na data em que a Apple assinou
//     (signedDate do payload, como a biblioteca faz sem checagem online);
//  6. assinatura do JWS confere com a chave da folha.
// Qualquer falha → ok:false com o motivo. Nunca lança.
//
// Roda igual no Deno (edge function) e no Node (test/apple-jws-test.ts).

// Apple Root CA - G3 (https://www.apple.com/certificateauthority/),
// SHA-256 63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79
export const APPLE_ROOT_CA_G3 =
  "MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtfTjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySrMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM6BgD56KyKA==";

const OID_ECDSA_SHA256 = "2a8648ce3d040302";
const OID_ECDSA_SHA384 = "2a8648ce3d040303";
const OID_P256 = "2a8648ce3d030107";
const OID_P384 = "2b81040022";
const OID_APPLE_INTERMEDIATE = "060a2a864886f76364060201"; // 1.2.840.113635.100.6.2.1
const OID_APPLE_LEAF = "060a2a864886f76364060b01"; // 1.2.840.113635.100.6.11.1

export type AppleJwsResult<T> =
  | { ok: true; payload: T }
  | { ok: false; reason: string; payload?: T };

function b64ToBytes(b64: string): Uint8Array {
  const s = b64.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

interface Tlv { tag: number; start: number; body: number; end: number }

function tlv(buf: Uint8Array, off: number): Tlv {
  if (off + 2 > buf.length) throw new Error("der_eof");
  const tag = buf[off];
  let len = buf[off + 1];
  let body = off + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 3) throw new Error("der_len");
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | buf[body + i];
    body += n;
  }
  const end = body + len;
  if (end > buf.length) throw new Error("der_eof");
  return { tag, start: off, body, end };
}

function children(buf: Uint8Array, parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  let off = parent.body;
  while (off < parent.end) {
    const t = tlv(buf, off);
    out.push(t);
    off = t.end;
  }
  return out;
}

function parseTime(buf: Uint8Array, t: Tlv): number {
  const s = new TextDecoder().decode(buf.subarray(t.body, t.end));
  let y: number, rest: string;
  if (t.tag === 0x17) { const yy = Number(s.slice(0, 2)); y = yy < 50 ? 2000 + yy : 1900 + yy; rest = s.slice(2); }
  else if (t.tag === 0x18) { y = Number(s.slice(0, 4)); rest = s.slice(4); }
  else throw new Error("der_time");
  const n = (i: number) => Number(rest.slice(i, i + 2));
  return Date.UTC(y, n(0) - 1, n(2), n(4), n(6), n(8));
}

interface Cert {
  der: Uint8Array;
  tbs: Uint8Array;
  sigAlg: string;
  sig: Uint8Array; // DER ECDSA-Sig-Value
  spki: Uint8Array;
  curve: "P-256" | "P-384";
  notBefore: number;
  notAfter: number;
  extHex: string;
}

function parseCert(der: Uint8Array): Cert {
  const root = tlv(der, 0);
  const [tbsT, algT, sigT] = children(der, root);
  const tbsParts = children(der, tbsT);
  let i = tbsParts[0].tag === 0xa0 ? 1 : 0; // version
  i += 1; // serial
  i += 1; // signature alg
  i += 1; // issuer
  const validity = children(der, tbsParts[i++]);
  i += 1; // subject
  const spkiT = tbsParts[i++];
  const ext = tbsParts.slice(i).find(t => t.tag === 0xa3);
  const [spkiAlg] = children(der, spkiT);
  const [, curveT] = children(der, spkiAlg);
  const curveHex = hex(der.subarray(curveT.body, curveT.end));
  const curve = curveHex === OID_P256 ? "P-256" : curveHex === OID_P384 ? "P-384" : null;
  if (!curve) throw new Error("curve");
  const [algOid] = children(der, algT);
  return {
    der,
    tbs: der.subarray(tbsT.start, tbsT.end),
    sigAlg: hex(der.subarray(algOid.body, algOid.end)),
    sig: der.subarray(sigT.body + 1, sigT.end), // pula "unused bits"
    spki: der.subarray(spkiT.start, spkiT.end),
    curve,
    notBefore: parseTime(der, validity[0]),
    notAfter: parseTime(der, validity[1]),
    extHex: ext ? hex(der.subarray(ext.body, ext.end)) : "",
  };
}

/** DER ECDSA-Sig-Value → r||s (formato do WebCrypto). */
function derSigToRaw(sig: Uint8Array, size: number): Uint8Array {
  const seq = tlv(sig, 0);
  const [r, s] = children(sig, seq);
  const out = new Uint8Array(size * 2);
  const put = (t: Tlv, at: number) => {
    let v = sig.subarray(t.body, t.end);
    while (v.length > size && v[0] === 0) v = v.subarray(1);
    if (v.length > size) throw new Error("sig_int");
    out.set(v, at + size - v.length);
  };
  put(r, 0);
  put(s, size);
  return out;
}

async function importKey(cert: Cert): Promise<CryptoKey> {
  return await crypto.subtle.importKey("spki", cert.spki, { name: "ECDSA", namedCurve: cert.curve }, false, ["verify"]);
}

async function signedBy(child: Cert, issuer: Cert): Promise<boolean> {
  const hash = child.sigAlg === OID_ECDSA_SHA256 ? "SHA-256" : child.sigAlg === OID_ECDSA_SHA384 ? "SHA-384" : null;
  if (!hash) return false;
  const size = issuer.curve === "P-256" ? 32 : 48;
  return await crypto.subtle.verify(
    { name: "ECDSA", hash },
    await importKey(issuer),
    derSigToRaw(child.sig, size),
    child.tbs,
  );
}

export async function verifyAppleJws<T = Record<string, unknown>>(
  jws: string,
  opts: { rootB64?: string; now?: number } = {},
): Promise<AppleJwsResult<T>> {
  let payload: T | undefined;
  try {
    const parts = typeof jws === "string" ? jws.split(".") : [];
    if (parts.length !== 3) return { ok: false, reason: "formato" };
    const header = JSON.parse(new TextDecoder().decode(b64ToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64ToBytes(parts[1]))) as T;
    if (header?.alg !== "ES256") return { ok: false, reason: "alg", payload };
    const x5c: unknown = header?.x5c;
    if (!Array.isArray(x5c) || x5c.length !== 3) return { ok: false, reason: "x5c", payload };

    const root = b64ToBytes(opts.rootB64 || APPLE_ROOT_CA_G3);
    const ders = x5c.map(c => b64ToBytes(String(c)));
    if (!sameBytes(ders[2], root)) return { ok: false, reason: "raiz_nao_apple", payload };
    const [leaf, inter, rootCert] = ders.map(parseCert);

    if (!inter.extHex.includes(OID_APPLE_INTERMEDIATE)) return { ok: false, reason: "intermediario_sem_oid", payload };
    if (!leaf.extHex.includes(OID_APPLE_LEAF)) return { ok: false, reason: "folha_sem_oid", payload };

    const signedDate = Number((payload as Record<string, unknown>)?.signedDate);
    const at = Number.isFinite(signedDate) && signedDate > 0 ? signedDate : (opts.now ?? Date.now());
    for (const c of [leaf, inter]) {
      if (at < c.notBefore || at > c.notAfter) return { ok: false, reason: "certificado_fora_da_validade", payload };
    }

    if (!(await signedBy(inter, rootCert))) return { ok: false, reason: "intermediario_nao_assinado_pela_raiz", payload };
    if (!(await signedBy(leaf, inter))) return { ok: false, reason: "folha_nao_assinada_pelo_intermediario", payload };

    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      await importKey(leaf),
      b64ToBytes(parts[2]),
      new TextEncoder().encode(parts[0] + "." + parts[1]),
    );
    if (!valid) return { ok: false, reason: "assinatura", payload };
    return { ok: true, payload };
  } catch (e) {
    // Sem payload = nem o cabeçalho/corpo em base64 abriu: é lixo, não é
    // token da Apple mal-assinado. Vale como "formato" (motivo que o
    // apple-iap-verify recusa na hora).
    if (payload === undefined) return { ok: false, reason: "formato" };
    return { ok: false, reason: "erro:" + String((e as Error)?.message || e).slice(0, 60), payload };
  }
}
