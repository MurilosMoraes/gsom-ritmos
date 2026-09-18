// npx tsx test/disparos-idioma-test.mts
//
// Prova que os disparos automáticos saem no idioma do país do perfil SEM
// mexer no que o brasileiro recebe.
//
// Como: carrega o index.ts REAL das edge functions (cron-push-notifications
// e cron-recovery-emails), troca só os imports remotos (deno.land, esm.sh)
// por dublês, dá um Supabase simulado e um servidor SMTP simulado, e roda o
// handler de verdade. Depois roda do MESMO jeito a versão que está no ar
// hoje (test/fixtures/disparos-originais/) e compara caractere a caractere
// o que cada usuário recebeu.
//
// Nada sai daqui: nenhum push, nenhum email, nenhuma escrita no banco.

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateKeyPairSync } from "node:crypto";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");
const SHARED = pathToFileURL(join(RAIZ, "supabase/functions/_shared/")).href;
const TMP = mkdtempSync(join(tmpdir(), "gdrums-disparos-"));

let falhas = 0;
let contador = 0;

function ok(nome: string, condicao: boolean, detalhe = "") {
  if (!condicao) falhas++;
  console.log(`${condicao ? "ok    " : "FALHOU"} ${nome}${condicao || !detalhe ? "" : `\n         ${detalhe}`}`);
}

function igual(nome: string, veio: string, esperado: string) {
  const bate = veio === esperado;
  if (!bate) {
    falhas++;
    console.log(`FALHOU ${nome}`);
    console.log(`         veio....: ${JSON.stringify(veio.slice(0, 160))}`);
    console.log(`         esperado: ${JSON.stringify(esperado.slice(0, 160))}`);
    return;
  }
  console.log(`ok     ${nome}`);
}

// ─────────────────────────────────────────────────────────────────────
// Carregador: pega o index.ts real e o deixa rodável fora do Deno.
// ─────────────────────────────────────────────────────────────────────

type Handler = (req: Request) => Promise<Response>;

async function carregar(arquivo: string): Promise<Handler> {
  let src = readFileSync(arquivo, "utf8");

  src = src
    .replace(
      /import \{ serve \} from "https:\/\/deno\.land\/std@[^"]+";/,
      'const serve = (h: any) => { (globalThis as any).__handler = h; };',
    )
    .replace(
      /import \{ createClient \} from "https:\/\/esm\.sh\/@supabase\/supabase-js@2";/,
      'const createClient: any = (...a: any[]) => (globalThis as any).__createClient(...a);',
    )
    .replace(
      /import \{ create, getNumericDate \} from "https:\/\/deno\.land\/x\/djwt@[^"]+";/,
      'const create: any = async () => "jws.simulado";\n' +
      'const getNumericDate = (s: number) => Math.floor(Date.now() / 1000) + s;',
    )
    .replace(/from "\.\.\/_shared\//g, `from "${SHARED}`);

  if (/https:\/\//.test(src.split("\n").filter((l) => l.startsWith("import ")).join("\n"))) {
    throw new Error(`import remoto não tratado em ${arquivo}`);
  }

  const destino = join(TMP, `fn-${++contador}.mts`);
  writeFileSync(destino, src);
  await import(pathToFileURL(destino).href);
  const h = (globalThis as any).__handler as Handler;
  if (typeof h !== "function") throw new Error(`${arquivo} não registrou handler`);
  (globalThis as any).__handler = undefined;
  return h;
}

// ─────────────────────────────────────────────────────────────────────
// Supabase simulado
// ─────────────────────────────────────────────────────────────────────

interface Consulta {
  tabela: string;
  op: "select" | "insert" | "update";
  payload?: any;
  cols?: string;
  opts?: any;
  filtros: Array<[string, string, any]>;
  unico: boolean;
}

type Resolvedor = (q: Consulta) => any;
type Rpc = (nome: string, args: any) => any;

function supabaseSimulado(resolver: Resolvedor, rpc: Rpc) {
  const consulta = (tabela: string, op: Consulta["op"], payload?: any) => {
    const q: Consulta = { tabela, op, payload, filtros: [], unico: false };
    const b: any = {
      select(cols: string, opts: any) { q.cols = cols; q.opts = opts; return b; },
      eq(k: string, v: any) { q.filtros.push(["eq", k, v]); return b; },
      in(k: string, v: any) { q.filtros.push(["in", k, v]); return b; },
      gte(k: string, v: any) { q.filtros.push(["gte", k, v]); return b; },
      not(k: string, _o: string, v: any) { q.filtros.push(["not", k, v]); return b; },
      or(s: string) { q.filtros.push(["or", s, null]); return b; },
      single() { q.unico = true; return b; },
      maybeSingle() { q.unico = true; return b; },
      then(res: any, rej: any) { return Promise.resolve().then(() => resolver(q)).then(res, rej); },
    };
    return b;
  };
  return () => ({
    from: (t: string) => ({
      select: (cols: string, opts: any) => consulta(t, "select").select(cols, opts),
      insert: (payload: any) => consulta(t, "insert", payload),
      update: (payload: any) => consulta(t, "update", payload),
    }),
    rpc: async (nome: string, args: any) => rpc(nome, args),
    auth: { getUser: async () => ({ data: { user: null } }) },
  });
}

const filtro = (q: Consulta, tipo: string, campo: string) =>
  q.filtros.find(([t, c]) => t === tipo && c === campo)?.[2];

// ─────────────────────────────────────────────────────────────────────
// Ambiente Deno simulado + SMTP simulado
// ─────────────────────────────────────────────────────────────────────

const { privateKey: PEM } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const SERVICE_ACCOUNT = JSON.stringify({
  project_id: "gdrums-simulado",
  client_email: "cron@gdrums-simulado.iam.gserviceaccount.com",
  private_key: PEM,
});

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://simulado.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-simulada",
  ONESIGNAL_API_KEY: "onesignal-simulada",
  CRON_SECRET: "segredo-do-cron",
  SMTP_PASS: "senha-simulada",
  FIREBASE_SERVICE_ACCOUNT_JSON: SERVICE_ACCOUNT,
};

interface EmailCapturado { to: string; subject: string; html: string }

function conexaoSmtpSimulada(caixa: EmailCapturado[]) {
  let pendente = "220 simulado\r\n";
  let passoAuth = 0;
  let emDados = false;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const decodeB64 = (s: string) => Buffer.from(s, "base64").toString("utf8");

  return {
    async read(buf: Uint8Array) {
      const b = enc.encode(pendente);
      buf.set(b.subarray(0, buf.length));
      return b.length;
    },
    async write(bytes: Uint8Array) {
      const s = dec.decode(bytes);
      if (emDados) {
        emDados = false;
        const corpo = s.replace(/\r\n\.\r\n$/, "");
        const corte = corpo.indexOf("\r\n\r\n");
        const cabecalho = corpo.slice(0, corte);
        const b64 = corpo.slice(corte + 4).replace(/\r\n/g, "");
        const to = /^To: (.*)$/m.exec(cabecalho)?.[1] ?? "";
        const subj = /^Subject: =\?UTF-8\?B\?(.*)\?=$/m.exec(cabecalho)?.[1] ?? "";
        caixa.push({ to, subject: decodeB64(subj), html: decodeB64(b64) });
        pendente = "250 aceito\r\n";
        return bytes.length;
      }
      const cmd = s.trim();
      if (/^EHLO/i.test(cmd)) pendente = "250 ok\r\n";
      else if (/^AUTH LOGIN/i.test(cmd)) { pendente = "334 usuario\r\n"; passoAuth = 1; }
      else if (passoAuth === 1) { pendente = "334 senha\r\n"; passoAuth = 2; }
      else if (passoAuth === 2) { pendente = "235 autenticado\r\n"; passoAuth = 0; }
      else if (/^MAIL FROM/i.test(cmd)) pendente = "250 ok\r\n";
      else if (/^RCPT TO/i.test(cmd)) pendente = "250 ok\r\n";
      else if (/^DATA/i.test(cmd)) { pendente = "354 manda\r\n"; emDados = true; }
      else if (/^RSET/i.test(cmd)) pendente = "250 ok\r\n";
      else if (/^QUIT/i.test(cmd)) pendente = "221 tchau\r\n";
      else pendente = "250 ok\r\n";
      return bytes.length;
    },
    close() { /* nada */ },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Dados da simulação
// ─────────────────────────────────────────────────────────────────────

const U_BR = "11111111-1111-1111-1111-111111111111";
const U_US = "22222222-2222-2222-2222-222222222222";
const U_MX = "33333333-3333-3333-3333-333333333333";
const U_NULO = "44444444-4444-4444-4444-444444444444";

const PAIS: Record<string, string | null> = {
  [U_BR]: "BR", [U_US]: "US", [U_MX]: "MX", [U_NULO]: null,
};

const CAMPANHAS = [
  {
    id: "trial_d7",
    subject: "{nome}, separei um cupom pra você",
    heading: "Toma um empurrão",
    paragraphs: [
      "Faz uma semana que seu teste acabou e você não voltou. Se foi o preço que segurou, resolvi isso.",
      "No plano anual, com o cupom, sai por R$ {porMes} por mês. Todos os 166 ritmos, o pedal, o repertório e o modo offline.",
    ],
    cta_label: "Assinar com {desconto}% OFF",
    coupon: "GDRUMS10",
    active: true,
  },
  {
    id: "trial_h0",
    subject: "{nome}, seu teste acabou agora",
    heading: "Fala {nome}!",
    paragraphs: [
      "Seu teste de 48 horas acabou agora. Se o GDrums te ajudou no ensaio, dá pra continuar de onde você parou: o repertório que você montou e os ritmos que salvou continuam guardados.",
      "São 166 ritmos, o pedal Bluetooth funcionando até no iPhone, e modo offline pra tocar naquele lugar que não tem sinal.",
    ],
    cta_label: "Continuar com o GDrums",
    coupon: null,
    active: true,
  },
];

const CUPONS = [{
  code: "GDRUMS10", discount_percent: 10, active: true,
  valid_until: "2099-01-01T00:00:00Z", current_uses: 0, max_uses: 1000,
}];

// ─────────────────────────────────────────────────────────────────────
// Rodada do cron de push
// ─────────────────────────────────────────────────────────────────────

interface PushCapturado { user_id: string; canal: string; title: string; body: string }

async function rodarPush(arquivo: string) {
  const capturados: PushCapturado[] = [];

  const trial = [
    { user_id: U_BR, expires_at: "2026-09-19T12:00:00Z", onesignal_id: "os-br", name: "João Silva" },
    { user_id: U_US, expires_at: "2026-09-19T12:00:00Z", onesignal_id: "os-us", name: "John Doe" },
  ];
  const expirados = [
    { user_id: U_MX, onesignal_id: "os-mx", name: "Juan Perez" },
    { user_id: U_NULO, onesignal_id: "os-nulo", name: "Antigo" },
  ];
  const porUsuario = new Map<string, string>();

  (globalThis as any).__createClient = supabaseSimulado(
    (q) => {
      if (q.tabela === "gdrums_push_sent") return { error: null };
      if (q.tabela === "gdrums_push_log") return { data: { id: "log" }, error: null };
      if (q.tabela === "gdrums_profiles" && q.op === "select") {
        if (q.cols === "id,country") {
          const ids: string[] = filtro(q, "in", "id") ?? [];
          return { data: ids.map((id) => ({ id, country: PAIS[id] ?? null })), error: null };
        }
        if (q.cols === "fcm_token") {
          const id = filtro(q, "eq", "id");
          return { data: { fcm_token: `fcm-${id}` }, error: null };
        }
      }
      return { data: null, error: null };
    },
    (nome) => {
      if (nome === "push_candidates_trial_expiring") return { data: trial, error: null };
      if (nome === "push_candidates_just_expired") return { data: expirados, error: null };
      return { data: null, error: null };
    },
  );

  // Cada push manda 1 request pro OneSignal e 1 pro FCM. O fetch simulado
  // guarda os dois; o alvo sai do próprio corpo do request.
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url);
    if (u.includes("oauth2.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    }
    const corpo = JSON.parse(String(init?.body ?? "{}"));
    if (u.includes("onesignal.com")) {
      const uid = corpo.include_aliases?.external_id?.[0] ?? "?";
      capturados.push({
        user_id: uid, canal: "onesignal",
        title: corpo.headings.pt, body: corpo.contents.pt,
      });
      // headings/contents em en e pt são o mesmo texto: o idioma já foi
      // resolvido pelo país antes de montar o payload.
      if (corpo.headings.en !== corpo.headings.pt) throw new Error("headings divergentes");
      return new Response(JSON.stringify({ id: "notif", recipients: 1 }), { status: 200 });
    }
    if (u.includes("fcm.googleapis.com")) {
      const token = corpo.message.token as string;
      capturados.push({
        user_id: token.replace(/^fcm-/, ""), canal: "fcm",
        title: corpo.message.notification.title, body: corpo.message.notification.body,
      });
      return new Response(JSON.stringify({ name: "ok" }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as any;

  try {
    const handler = await carregar(arquivo);
    const res = await handler(new Request("https://f/?secret=segredo-do-cron", { method: "POST" }));
    const corpo = await res.json();
    if (!corpo.success) throw new Error("cron de push não terminou: " + JSON.stringify(corpo));
  } finally {
    globalThis.fetch = fetchOriginal;
  }

  void porUsuario;
  return capturados;
}

// ─────────────────────────────────────────────────────────────────────
// Rodada do cron de e-mail
// ─────────────────────────────────────────────────────────────────────

async function rodarEmail(arquivo: string) {
  const caixa: EmailCapturado[] = [];

  const fila = [
    { user_id: U_BR, email: "br@exemplo.com", name: "João Silva", campaign_id: "trial_d7", coupon: "GDRUMS10" },
    { user_id: U_US, email: "us@exemplo.com", name: "John Doe", campaign_id: "trial_d7", coupon: "GDRUMS10" },
    { user_id: U_MX, email: "mx@exemplo.com", name: "Juan Perez", campaign_id: "trial_d7", coupon: "GDRUMS10" },
    { user_id: U_NULO, email: "antigo@exemplo.com", name: "Antigo Cliente", campaign_id: "trial_h0", coupon: null },
  ];

  (globalThis as any).__createClient = supabaseSimulado(
    (q) => {
      if (q.tabela === "gdrums_email_campaigns") return { data: CAMPANHAS, error: null };
      if (q.tabela === "gdrums_coupons") return { data: CUPONS, error: null };
      if (q.tabela === "gdrums_contact_log") {
        return q.op === "select" ? { count: 0, error: null } : { error: null };
      }
      if (q.tabela === "gdrums_profiles") {
        if (q.op === "select" && q.cols === "id,country") {
          const ids: string[] = filtro(q, "in", "id") ?? [];
          return { data: ids.map((id) => ({ id, country: PAIS[id] ?? null })), error: null };
        }
        return { data: null, error: null };
      }
      return { data: null, error: null };
    },
    (nome) => {
      if (nome === "automacao_config") {
        return { data: [{ chave: "email_ligado", valor: "true" }], error: null };
      }
      if (nome === "email_queue") return { data: fila, error: null };
      return { data: null, error: null };
    },
  );

  (globalThis as any).Deno = {
    env: { get: (k: string) => ENV[k] },
    connectTls: async () => conexaoSmtpSimulada(caixa),
  };

  const handler = await carregar(arquivo);
  const res = await handler(new Request("https://f/?secret=segredo-do-cron", { method: "POST" }));
  const corpo = await res.json();
  if (!corpo.success) throw new Error("cron de email não terminou: " + JSON.stringify(corpo));
  return { caixa, corpo };
}

// ─────────────────────────────────────────────────────────────────────
// Execução
// ─────────────────────────────────────────────────────────────────────

(globalThis as any).Deno = { env: { get: (k: string) => ENV[k] } };

console.log("── PUSH (cron-push-notifications) ──");

const pushNovo = await rodarPush(join(RAIZ, "supabase/functions/cron-push-notifications/index.ts"));
const pushVelho = await rodarPush(join(AQUI, "fixtures/disparos-originais/cron-push-notifications.ts"));

const acharPush = (lista: PushCapturado[], uid: string, canal: string) =>
  lista.find((p) => p.user_id === uid && p.canal === canal)!;

ok("push: os dois canais dispararam pros 4 usuários", pushNovo.length === 8,
  `vieram ${pushNovo.length} disparos`);

for (const canal of ["onesignal", "fcm"]) {
  for (const [rotulo, uid] of [["BR", U_BR], ["país nulo", U_NULO]] as const) {
    const novo = acharPush(pushNovo, uid, canal);
    const velho = acharPush(pushVelho, uid, canal);
    igual(`push ${canal}: ${rotulo} recebe o título de hoje`, novo.title, velho.title);
    igual(`push ${canal}: ${rotulo} recebe o corpo de hoje`, novo.body, velho.body);
  }
}

const pushUs = acharPush(pushNovo, U_US, "onesignal");
igual("push: US recebe título em inglês", pushUs.title, "Your trial ends tomorrow");
igual("push: US recebe corpo em inglês", pushUs.body,
  "Lock in the 166 grooves and the pedal before rehearsal. Activate your plan now.");

const pushMx = acharPush(pushNovo, U_MX, "onesignal");
igual("push: MX recebe título em espanhol", pushMx.title, "Tu prueba terminó");
igual("push: MX recebe corpo em espanhol", pushMx.body,
  "Vuelve a los 166 ritmos. El plan anual sale 34% más barato por mes que el mensual.");

ok("push: fora do BR não fala em R$",
  ![pushUs, pushMx].some((p) => /R\$/.test(p.title + p.body)));
ok("push: BR continua falando em R$ onde já falava",
  /R\$ 19 por mês/.test(acharPush(pushNovo, U_NULO, "onesignal").body));

console.log("\n── E-MAIL (cron-recovery-emails) ──");

const { caixa: mailNovo, corpo: respNovo } = await rodarEmail(
  join(RAIZ, "supabase/functions/cron-recovery-emails/index.ts"));
const { caixa: mailVelho } = await rodarEmail(
  join(AQUI, "fixtures/disparos-originais/cron-recovery-emails.ts"));

const acharMail = (lista: EmailCapturado[], to: string) => lista.find((m) => m.to === to)!;

ok("email: os 4 da fila saíram", mailNovo.length === 4, `saíram ${mailNovo.length}`);

for (const [rotulo, addr] of [["BR", "br@exemplo.com"], ["país nulo", "antigo@exemplo.com"]] as const) {
  const novo = acharMail(mailNovo, addr);
  const velho = acharMail(mailVelho, addr);
  igual(`email: assunto do ${rotulo} é o de hoje`, novo.subject, velho.subject);
  igual(`email: HTML do ${rotulo} é byte a byte o de hoje`, novo.html, velho.html);
}

const mailUs = acharMail(mailNovo, "us@exemplo.com");
igual("email: assunto do US em inglês", mailUs.subject, "John, your trial ended a week ago");
ok("email: US vem marcado como inglês", mailUs.html.includes('<html lang="en">'));
ok("email: US traz o texto em inglês",
  mailUs.html.includes("Your trial ended a week ago and you have not come back."));
ok("email: US sem WhatsApp", !/wa\.me|WhatsApp/i.test(mailUs.html));
ok("email: US sem preço em R$", !/R\$/.test(mailUs.html));
ok("email: US sem cupom", !/GDRUMS10|OFF/.test(mailUs.html));
ok("email: US aponta pra App Store",
  mailUs.html.includes("https://apps.apple.com/app/gdrums/id6766099516"));
ok("email: US sem link do checkout brasileiro", !/gdrums\.com\.br\/plans/.test(mailUs.html));
ok("email: US tem o suporte por e-mail", mailUs.html.includes("contato@gdrums.com.br"));

const mailMx = acharMail(mailNovo, "mx@exemplo.com");
igual("email: assunto do MX em espanhol", mailMx.subject, "Juan, tu prueba terminó hace una semana");
ok("email: MX vem marcado como espanhol", mailMx.html.includes('<html lang="es">'));
ok("email: MX traz o texto em espanhol",
  mailMx.html.includes("Hace una semana que terminó tu prueba y no volviste."));
ok("email: MX sem WhatsApp, sem R$ e sem cupom",
  !/wa\.me|WhatsApp/i.test(mailMx.html) && !/R\$/.test(mailMx.html) && !/GDRUMS10/.test(mailMx.html));

const mailBr = acharMail(mailNovo, "br@exemplo.com");
ok("email: BR continua com WhatsApp, cupom e preço em R$",
  /wa\.me/.test(mailBr.html) && /GDRUMS10/.test(mailBr.html) && /R\$ 17,10/.test(mailBr.html));

ok("email: a rodada conta por idioma",
  JSON.stringify(respNovo.por_idioma) === JSON.stringify({ pt: 2, es: 1, en: 1 }),
  JSON.stringify(respNovo.por_idioma));
ok("email: nenhuma campanha ficou sem tradução",
  Array.isArray(respNovo.sem_traducao) && respNovo.sem_traducao.length === 0,
  JSON.stringify(respNovo.sem_traducao));

console.log("\n── TRAVESSÃO ──");
const fontes = [
  "supabase/functions/_shared/textos-push.ts",
  "supabase/functions/_shared/textos-email.ts",
];
for (const f of fontes) {
  const linhas = readFileSync(join(RAIZ, f), "utf8").split("\n");
  // O travessão só pode aparecer em comentário, nunca em texto que sai.
  const ruins = linhas
    .map((l, i) => [i + 1, l] as const)
    .filter(([, l]) => l.includes("—") && !l.trimStart().startsWith("//"));
  ok(`sem travessão no texto de ${f}`, ruins.length === 0,
    ruins.map(([n, l]) => `linha ${n}: ${l.trim()}`).join("\n         "));
}

console.log(falhas ? `\n${falhas} falha(s)` : "\ntodos ok");
process.exit(falhas ? 1 : 0);
