// cron-recovery-emails: regua de recuperacao por email.
//
// Roda de hora em hora. A fila (RPC email_queue) decide quem recebe o que:
// ela ja para de vender pra quem comprou, nao repete etapa, respeita a
// carencia desde qualquer contato (inclusive WhatsApp da equipe) e coloca
// lead quente na frente.
//
// DUAS PORTAS DE ENTRADA, de proposito:
//   - CRON_SECRET: disparo de verdade. E o cron que usa.
//   - token de admin: SO o ensaio (?teste=). Existe pra o console ter um
//     botao de "me manda pra eu ver" sem precisar guardar o segredo das
//     rotinas. Disparo completo por token de admin nao passa: um clique
//     errado mandaria email pra cliente de verdade.
//
// TETO E INTERRUPTOR VEM DA TELA, nao do codigo (gdrums_automacao_config).
//
// POR QUE TETO: o envio sai de uma caixa postal do Hostinger, nao de um
// servico de disparo. Despejar milhares num dia queima a reputacao do
// dominio, e ai o email de senha e o de boas-vindas tambem caem em spam.
//
// UMA CONEXAO SO, MAS COM RSET: uma entrega que falha no meio deixa a
// transacao SMTP aberta e o MAIL FROM seguinte vira "nested MAIL command".
// Aconteceu aqui: um endereco com erro de digitacao derrubou 27 de 40.
//
// IDIOMA (18/09): o texto sai no idioma do pais do perfil
// (gdrums_profiles.country), trazido em UMA consulta em lote por rodada.
// BR, PT e pais em branco recebem o email EXATO de antes, com cupom,
// WhatsApp e preco em R$. Fora do Brasil o conteudo muda junto com o
// idioma: sem WhatsApp (numero brasileiro), sem cupom nem preco em R$ (o
// cupom vale no checkout brasileiro) e o botao leva pra App Store. O molde
// e o catalogo de textos vivem em _shared/textos-email.ts.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type Idioma, idiomaDoPais } from "../_shared/idioma.ts";
import { type Campanha, montarEmail } from "../_shared/textos-email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://qsfziivubwdgtmwyztfw.supabase.co";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

const SMTP_HOST = Deno.env.get("SMTP_HOST") || "smtp.hostinger.com";
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") || 465);
const SMTP_USER = Deno.env.get("SMTP_USER") || "staner@gdrums.com.br";
const SMTP_PASS = Deno.env.get("SMTP_PASS") || "";
const MAIL_FROM = Deno.env.get("MAIL_FROM") || "contato@gdrums.com.br";

const PAUSA_MS = 250;
const PRECO_ANUAL_CENTAVOS = 22800;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;

/** Quando a fila nao traz o nome. O pt e o de sempre. */
const SEM_NOME: Record<Idioma, string> = {
  pt: "Músico",
  es: "Músico",
  en: "Musician",
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));

class Smtp {
  private conn: Deno.TlsConn | null = null;
  private enc = new TextEncoder();
  private dec = new TextDecoder();

  private async read(): Promise<string> {
    const buf = new Uint8Array(4096);
    const n = await this.conn!.read(buf);
    return this.dec.decode(buf.subarray(0, n || 0));
  }
  private async cmd(c: string): Promise<string> {
    await this.conn!.write(this.enc.encode(c + "\r\n"));
    return await this.read();
  }
  private ok(resp: string, esperado: string, oque: string): void {
    if (!resp.startsWith(esperado)) {
      throw new Error(`${oque}: ${resp.trim().slice(0, 120)}`);
    }
  }

  get viva(): boolean { return this.conn !== null; }

  async abrir(): Promise<void> {
    await this.fechar();
    this.conn = await Deno.connectTls({ hostname: SMTP_HOST, port: SMTP_PORT });
    this.ok(await this.read(), "220", "saudacao");
    await this.cmd("EHLO gdrums.com.br");
    this.ok(await this.cmd("AUTH LOGIN"), "334", "auth");
    this.ok(await this.cmd(b64(SMTP_USER)), "334", "usuario");
    this.ok(await this.cmd(b64(SMTP_PASS)), "235", "senha");
  }

  /** Abandona a transacao pendente, senao a falha derruba o resto da leva. */
  async limpar(): Promise<boolean> {
    if (!this.conn) return false;
    try {
      const r = await this.cmd("RSET");
      return r.startsWith("250");
    } catch {
      await this.fechar();
      return false;
    }
  }

  async enviar(to: string, subject: string, html: string): Promise<void> {
    this.ok(await this.cmd(`MAIL FROM:<${SMTP_USER}>`), "250", "mail from");
    this.ok(await this.cmd(`RCPT TO:<${to}>`), "250", "destinatario");
    this.ok(await this.cmd("DATA"), "354", "data");
    const raw = [
      `From: GDrums <${MAIL_FROM}>`,
      `Reply-To: ${MAIL_FROM}`,
      `To: ${to}`,
      `Subject: =?UTF-8?B?${b64(subject)}?=`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      b64(html).replace(/(.{76})/g, "$1\r\n"),
    ].join("\r\n");
    await this.conn!.write(this.enc.encode(raw + "\r\n.\r\n"));
    this.ok(await this.read(), "250", "entrega");
  }

  async fechar(): Promise<void> {
    if (!this.conn) return;
    try { await this.cmd("QUIT"); } catch { /* ja caiu */ }
    try { this.conn.close(); } catch { /* ja fechada */ }
    this.conn = null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const url = new URL(req.url);
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const teste = url.searchParams.get("teste");
  const etapaTeste = url.searchParams.get("campanha");
  const paisTeste = url.searchParams.get("pais");
  const seco = url.searchParams.get("dry") === "1";
  const limitePedido = Number(url.searchParams.get("limite") || 0);

  const segredo = url.searchParams.get("secret");
  const peloCron = !!CRON_SECRET && segredo === CRON_SECRET;

  // Token de admin abre SO o ensaio. Disparo de verdade exige o segredo.
  let peloAdmin = false;
  if (!peloCron) {
    const auth = req.headers.get("Authorization");
    if (auth) {
      const { data: { user } } = await db.auth.getUser(auth.replace("Bearer ", ""));
      if (user) {
        const { data: perfil } = await db
          .from("gdrums_profiles").select("role").eq("id", user.id).single();
        peloAdmin = perfil?.role === "admin";
      }
    }
  }

  if (!peloCron && !(peloAdmin && teste)) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (!SMTP_PASS) return json({ error: "SMTP_PASS nao configurada" }, 500);

  const { data: cfgRows } = await db.rpc("automacao_config");
  const cfg = new Map<string, string>(
    ((cfgRows ?? []) as Array<{ chave: string; valor: string }>).map((c) => [c.chave, c.valor]),
  );
  const numero = (k: string, padrao: number) => {
    const v = Number(cfg.get(k));
    return Number.isFinite(v) && v > 0 ? v : padrao;
  };
  const TETO_DIA = numero("email_teto_dia", 200);
  const TETO_RODADA = numero("email_teto_rodada", 40);
  const ligado = (cfg.get("email_ligado") ?? "true") === "true";

  const { data: camps } = await db.from("gdrums_email_campaigns").select("*").eq("active", true);
  const porId = new Map<string, Campanha>((camps ?? []).map((c: Campanha) => [c.id, c]));

  const { data: cupons } = await db.from("gdrums_coupons")
    .select("code,discount_percent,active,valid_until,current_uses,max_uses");
  const cupomVivo = (code: string | null): number | null => {
    if (!code) return null;
    const c = (cupons ?? []).find((x: { code: string }) => x.code === code);
    if (!c) return null;
    const vale = c.active && new Date(c.valid_until) > new Date() && c.current_uses < c.max_uses;
    return vale ? (c.discount_percent as number) : null;
  };

  // `desconto` segue sendo o do banco (null = cupom caiu), pra guarda de
  // cupom vencido continuar valendo igual. Quem decide se o cupom ENTRA na
  // mensagem e o montarEmail: so entra no caminho brasileiro.
  const montar = (camp: Campanha, nome: string, pais: string | null) => {
    const desconto = cupomVivo(camp.coupon);
    const porMes = ((PRECO_ANUAL_CENTAVOS * (100 - (desconto ?? 0)) / 100) / 12 / 100)
      .toFixed(2).replace(".", ",");
    return montarEmail(camp, nome, pais, desconto, porMes);
  };

  /** Pais de todo mundo da fila numa consulta so. Quem nao voltar fica nulo
   *  (= portugues), que e o que ja acontecia com conta antiga. */
  const paisesDe = async (ids: string[]): Promise<Map<string, string | null>> => {
    const mapa = new Map<string, string | null>();
    if (ids.length === 0) return mapa;
    const { data } = await db.from("gdrums_profiles").select("id,country").in("id", ids);
    for (const r of ((data || []) as Array<{ id: string; country: string | null }>)) {
      mapa.set(r.id, r.country ?? null);
    }
    return mapa;
  };

  // Ensaio: uma etapa, um endereco, sem tocar na fila nem no historico.
  // Existe pra dar pra ver o email antes de ele sair pra cliente: editar o
  // texto valia direto no disparo seguinte, sem ninguem conferir.
  // ?pais=US mostra como fica pro cliente de fora; sem ?pais e o de sempre.
  if (teste) {
    if (!EMAIL_RE.test(teste)) return json({ error: "Endereco de teste invalido" }, 400);
    const camp = porId.get(etapaTeste ?? "");
    if (!camp) return json({ error: "Etapa desconhecida ou desligada" }, 400);

    const { assunto, html, desconto, idioma, semTraducao } = montar(camp, "Murilo", paisTeste);
    if (camp.coupon && desconto === null) {
      return json({ error: `O cupom ${camp.coupon} nao esta valendo. Corrija antes.` }, 400);
    }

    const smtp = new Smtp();
    try {
      await smtp.abrir();
      await smtp.enviar(teste, `[teste] ${assunto}`, html);
      return json({ success: true, teste: true, para: teste, etapa: camp.id, idioma, sem_traducao: semTraducao });
    } catch (e) {
      return json({ error: String(e).slice(0, 200) }, 500);
    } finally {
      await smtp.fechar();
    }
  }

  if (!ligado) {
    return json({ success: true, enviados: 0, motivo: "regua desligada na tela" });
  }

  const inicioDoDia = new Date();
  inicioDoDia.setUTCHours(0, 0, 0, 0);
  const { count: hoje } = await db
    .from("gdrums_contact_log")
    .select("*", { count: "exact", head: true })
    .eq("channel", "email").eq("kind", "auto").eq("status", "sent")
    .gte("created_at", inicioDoDia.toISOString());

  const restaHoje = Math.max(0, TETO_DIA - (hoje ?? 0));
  let levar = Math.min(TETO_RODADA, restaHoje);
  if (limitePedido > 0) levar = Math.min(levar, limitePedido);
  if (levar === 0) {
    return json({ success: true, enviados: 0, motivo: "teto do dia atingido", hoje, teto: TETO_DIA });
  }

  const { data: fila, error: filaErro } = await db.rpc("email_queue", { p_limit: levar });
  if (filaErro) return json({ error: filaErro.message }, 500);
  const lista = (fila ?? []) as Array<{
    user_id: string; email: string; name: string; campaign_id: string; coupon: string | null;
  }>;
  if (lista.length === 0) return json({ success: true, enviados: 0, motivo: "fila vazia", hoje });

  if (seco) {
    return json({ success: true, ensaio: true, levaria: lista.length, teto_restante: restaHoje,
      por_etapa: lista.reduce((a: Record<string, number>, p) => {
        a[p.campaign_id] = (a[p.campaign_id] ?? 0) + 1; return a; }, {}) });
  }

  const paises = await paisesDe(lista.map((p) => p.user_id).filter(Boolean));

  const smtp = new Smtp();
  let enviados = 0;
  let invalidos = 0;
  const falhas: string[] = [];
  const porIdioma: Record<Idioma, number> = { pt: 0, es: 0, en: 0 };
  const semTraducao = new Set<string>();

  const registrar = async (userId: string, campId: string, status: "sent" | "failed", detail?: string) => {
    await db.from("gdrums_contact_log").insert({
      user_id: userId, channel: "email", kind: "auto",
      campaign: campId, status, detail: detail?.slice(0, 300) ?? null,
    });
  };

  try {
    await smtp.abrir();

    for (const p of lista) {
      const camp = porId.get(p.campaign_id);
      if (!camp) continue;

      if (!EMAIL_RE.test(p.email)) {
        invalidos++;
        await registrar(p.user_id, camp.id, "failed", `endereco invalido: ${p.email}`);
        continue;
      }

      const pais = paises.get(p.user_id) ?? null;
      const nome = (p.name || "").split(" ")[0] || SEM_NOME[idiomaDoPais(pais)];
      const montado = montar(camp, nome, pais);
      const { assunto, html, desconto } = montado;

      if (camp.coupon && desconto === null) {
        falhas.push(`${p.campaign_id}: cupom ${camp.coupon} nao esta valendo`);
        continue;
      }

      try {
        if (!smtp.viva) await smtp.abrir();
        await smtp.enviar(p.email, assunto, html);
        enviados++;
        porIdioma[montado.idioma]++;
        if (montado.semTraducao) semTraducao.add(camp.id);
        await registrar(p.user_id, camp.id, "sent");
        await db.from("gdrums_profiles")
          .update({ last_contacted_at: new Date().toISOString(), contact_method: "email_auto" })
          .eq("id", p.user_id);
      } catch (e) {
        falhas.push(`${p.email}: ${String(e).slice(0, 90)}`);
        await registrar(p.user_id, camp.id, "failed", String(e));
        if (!(await smtp.limpar())) {
          try { await smtp.abrir(); } catch { /* tenta no proximo */ }
        }
      }

      await dormir(PAUSA_MS);
    }
  } catch (e) {
    falhas.push("conexao: " + String(e).slice(0, 150));
  } finally {
    await smtp.fechar();
  }

  return json({
    success: true, enviados, invalidos, falhas: falhas.slice(0, 10), teto_dia: TETO_DIA,
    por_idioma: porIdioma, sem_traducao: [...semTraducao],
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}
