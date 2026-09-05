// send-email — e-mail transacional pro botão "Email" do painel de Leads.
//
// v8 (2026-08-09) — três correções, todas de coisa que estava quebrada:
//
// 1. CONTA ERRADA: usava staner@gdrums.com.br, cuja senha o servidor rejeita
//    (535 authentication failed, verificado em 09/08). Agora usa a conta que
//    de fato autentica, vinda de variável de ambiente.
//
// 2. FALHAVA EM SILÊNCIO: a versão anterior escrevia os comandos SMTP e nunca
//    olhava a resposta do servidor. Com a senha errada o AUTH voltava 535, o
//    código ignorava, seguia até o fim e retornava {success:true}. O admin via
//    "enviado", marcava last_contacted_at no lead, e o músico nunca recebia
//    nada. Agora CADA passo valida o código de resposta e aborta com erro real.
//
// 3. SEGREDOS NO CÓDIGO: service_role key e senha SMTP estavam em texto puro
//    aqui dentro. Agora vêm de Deno.env. A service_role é acesso total ao
//    banco, não pode viver em arquivo versionado.
//
// Variáveis necessárias (Supabase → Edge Functions → Secrets):
//   SMTP_USER  = contato@gdrums.com.br
//   SMTP_PASS  = (senha da conta)
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY o Supabase injeta sozinho.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://qsfziivubwdgtmwyztfw.supabase.co";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const SMTP_HOST = Deno.env.get("SMTP_HOST") || "smtp.hostinger.com";
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") || "465");
const SMTP_USER = Deno.env.get("SMTP_USER") || "";
const SMTP_PASS = Deno.env.get("SMTP_PASS") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function buildEmail(from: string, to: string, subject: string, html: string): string {
  const boundary = "----=_Part_" + Date.now();
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    html,
    ``,
    `--${boundary}--`,
  ].join("\r\n");
}

/**
 * Cliente SMTP que CONFERE a resposta de cada comando.
 *
 * O ponto principal desta função: se qualquer passo não devolver o código
 * esperado, ela LANÇA. Antes o envio falhava calado e o painel dizia que
 * tinha dado certo — pior que não enviar, porque marcava o lead como
 * contatado e ninguém desconfiava.
 */
async function sendSmtp(from: string, to: string, subject: string, html: string): Promise<void> {
  if (!SMTP_USER || !SMTP_PASS) {
    throw new Error("SMTP não configurado: defina SMTP_USER e SMTP_PASS nos secrets da função.");
  }

  const conn = await Deno.connectTls({ hostname: SMTP_HOST, port: SMTP_PORT });
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  try {
    // Lê uma resposta completa. SMTP multilinha usa "250-" nas intermediárias
    // e "250 " (espaço) na última — sem isso o EHLO desalinha o diálogo.
    async function read(): Promise<string> {
      let acc = "";
      while (true) {
        const buf = new Uint8Array(4096);
        const n = await conn.read(buf);
        if (n === null) break;
        acc += decoder.decode(buf.subarray(0, n));
        const linhas = acc.trimEnd().split("\r\n");
        const ultima = linhas[linhas.length - 1];
        if (/^\d{3} /.test(ultima)) break; // codigo + espaco = fim
      }
      return acc;
    }

    /** Envia o comando e exige o código esperado. Erra alto se não vier. */
    async function cmd(linha: string, esperado: string, rotulo: string): Promise<string> {
      await conn.write(encoder.encode(linha + "\r\n"));
      const resp = await read();
      const codigo = resp.trimEnd().split("\r\n").pop()?.slice(0, 3) || "???";
      if (codigo !== esperado) {
        throw new Error(`SMTP ${rotulo} falhou: esperado ${esperado}, veio "${resp.trim().slice(0, 120)}"`);
      }
      return resp;
    }

    const saudacao = await read();
    if (!saudacao.startsWith("220")) {
      throw new Error(`SMTP não saudou: "${saudacao.trim().slice(0, 120)}"`);
    }

    await cmd(`EHLO gdrums.com.br`, "250", "EHLO");
    await cmd(`AUTH LOGIN`, "334", "AUTH LOGIN");
    await cmd(btoa(SMTP_USER), "334", "usuário");
    // 235 = autenticado. Antes era aqui que vinha 535 e ninguém olhava.
    await cmd(btoa(SMTP_PASS), "235", "senha");
    await cmd(`MAIL FROM:<${SMTP_USER}>`, "250", "MAIL FROM");
    await cmd(`RCPT TO:<${to}>`, "250", "RCPT TO");
    await cmd(`DATA`, "354", "DATA");

    // Corpo: precisa terminar em CRLF.CRLF e o servidor confirma com 250
    const raw = buildEmail(from, to, subject, html);
    await conn.write(encoder.encode(raw + "\r\n.\r\n"));
    const fim = await read();
    if (!fim.startsWith("250")) {
      throw new Error(`SMTP recusou a mensagem: "${fim.trim().slice(0, 120)}"`);
    }

    try { await cmd(`QUIT`, "221", "QUIT"); } catch { /* QUIT falhar não invalida o envio */ }
  } finally {
    try { conn.close(); } catch { /* já fechado */ }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Unauthorized" }, 401);
    }

    const token = authHeader.replace("Bearer ", "");
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return json({ error: "Invalid token" }, 401);
    }

    const { data: profile } = await supabase
      .from("gdrums_profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || profile.role !== "admin") {
      return json({ error: "Forbidden" }, 403);
    }

    const { to, name } = await req.json();
    if (!to) {
      return json({ error: "Missing 'to' email" }, 400);
    }

    const firstName = (name || "").split(" ")[0] || "Musico";

    const WHATSAPP_NUMBER = "5547984639792";
    const WHATSAPP_DISPLAY = "(47) 98463-9792";
    const WHATSAPP_MSG = encodeURIComponent(`Oi! Sou ${firstName}, recebi o cupom INSTA2K e quero falar sobre o GDrums.`);
    const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${WHATSAPP_MSG}`;

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#030014;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:2rem 1.5rem;">
<div style="text-align:center;margin-bottom:2rem;">
<h1 style="color:#fff;font-size:1.8rem;margin:0;"><span style="background:linear-gradient(135deg,#00D4FF,#8B5CF6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">GDrums</span></h1>
<p style="color:rgba(255,255,255,0.4);font-size:0.85rem;margin:0.3rem 0 0;">Seu baterista virtual no palco</p>
</div>
<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:2rem 1.5rem;margin-bottom:1.5rem;">
<h2 style="color:#fff;font-size:1.3rem;margin:0 0 1rem;">Fala ${firstName}!</h2>
<p style="color:rgba(255,255,255,0.6);font-size:0.95rem;line-height:1.7;margin:0 0 1rem;">Vi que você testou o GDrums e queria saber como foi a experiência! Desde que você usou, a biblioteca cresceu pra <strong style="color:#fff;">180 ritmos</strong> — Frevo, Hard Rock, Heavy Metal, MPB, Samba Rock, Partido Alto, Roda de Samba, Worship e muito mais.</p>
<p style="color:rgba(255,255,255,0.6);font-size:0.95rem;line-height:1.7;margin:0 0 1.5rem;">E pra você que já conhece o sistema, tenho um <strong style="color:#00E68C;">cupom exclusivo</strong>:</p>
<div style="text-align:center;background:rgba(0,230,140,0.06);border:1px solid rgba(0,230,140,0.2);border-radius:12px;padding:1.25rem;margin-bottom:1.5rem;">
<div style="font-size:0.7rem;color:rgba(0,230,140,0.6);text-transform:uppercase;letter-spacing:2px;margin-bottom:0.5rem;">Cupom exclusivo</div>
<div style="font-size:2rem;font-weight:900;color:#00E68C;letter-spacing:3px;margin-bottom:0.3rem;">INSTA2K</div>
<div style="font-size:1.1rem;color:#fff;font-weight:700;">20% OFF em qualquer plano</div>
</div>
<p style="color:rgba(255,255,255,0.5);font-size:0.85rem;line-height:1.6;margin:0 0 1.5rem;">A partir de <strong style="color:#fff;">R$ 23/mês</strong> você tem acesso a todos os ritmos, suporte a pedal Bluetooth, repertório, modo offline e atualizações semanais.</p>
<div style="text-align:center;margin-bottom:1.25rem;"><a href="https://gdrums.com.br/plans?coupon=INSTA2K" style="display:inline-block;padding:0.9rem 2.5rem;background:linear-gradient(135deg,#00D4FF,#8B5CF6);color:#fff;text-decoration:none;border-radius:12px;font-weight:700;font-size:1rem;">Assinar com 20% OFF</a></div>
<div style="text-align:center;padding:1rem 1rem 0.75rem;border-top:1px solid rgba(255,255,255,0.08);">
<p style="color:rgba(255,255,255,0.55);font-size:0.85rem;line-height:1.55;margin:0 0 0.85rem;">Tem alguma dúvida ou quer ajuda pra começar?<br>Chama no WhatsApp que respondo rápido:</p>
<a href="${WHATSAPP_URL}" style="display:inline-block;padding:0.7rem 1.5rem;background:#25D366;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:0.92rem;">Falar no WhatsApp · ${WHATSAPP_DISPLAY}</a>
</div>
</div>
<p style="color:rgba(255,255,255,0.25);font-size:0.75rem;text-align:center;line-height:1.5;">Qualquer dúvida é só responder esse email.<br>GDrums — Gold Sound on Music</p>
</div>
</body>
</html>`;

    await sendSmtp(
      `GDrums <${SMTP_USER}>`,
      to,
      `${firstName}, seu cupom de 20% OFF no GDrums está esperando!`,
      html
    );

    return json({ success: true }, 200);
  } catch (e) {
    // Erro REAL pro painel. Antes isso nunca acontecia porque nada era checado.
    console.error("[send-email] falhou:", String(e));
    return json({ success: false, error: String(e) }, 500);
  }
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
