// register-account — criação atômica de conta GDrums.
//
// Por que existe: o fluxo antigo (cliente faz signUp → tenta update CPF/phone)
// gerava conta fantasma se o segundo passo falhasse (rede, race, browser fechou).
// Aqui o servidor faz tudo numa única chamada com service role e ROLLBACK real
// (delete do auth.users) se qualquer passo posterior falhar.
//
// Cliente nunca vê conta criada se algo der errado.
//
// v7 (2026-05-26): phone agora é OPCIONAL (Apple 5.1.1 — sequenciador de
// bateria não pode exigir dado pessoal não essencial). Se vier vazio, grava
// NULL e pula checagem de duplicidade + verificação final.
//
// v8 (2026-08-05): duas guardas de e-mail, ANTES de criar qualquer coisa:
//   1. E-mail descartável (temp-mail) bloqueado — estavam entrando contas
//      "Teste" via davopa.com / kingcq.com só pra pegar o trial de 48h. O
//      bloqueio de CPF não pega isso porque cada uma usa um CPF diferente.
//   2. Domínio digitado errado (gmail.come, gmail.com.com, hotmail.con...)
//      barrado com sugestão do certo. Isso é RECEITA, não só higiene: teve
//      cliente que PAGOU com "@gmail.come" e nunca vai receber confirmação
//      nem recuperação de senha, porque o e-mail não existe.
//
// Nada disso mexe em quem JÁ tem conta — a função só roda no cadastro.
// As mensagens são diretas e sem jargão: boa parte do público é senhor de
// idade que se atrapalha com formulário.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checarEmail } from "./emailGuard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://qsfziivubwdgtmwyztfw.supabase.co";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

// Mesma lógica de hashing usada no cliente (utils/cpf.ts): SHA-256(salt + cpf_limpo)
async function hashCPF(cpf: string): Promise<string> {
  const SALT = "gdrums_2026_cpf_salt";
  const clean = cpf.replace(/\D/g, "");
  const enc = new TextEncoder().encode(SALT + clean);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function validateCPF(cpf: string): boolean {
  const c = cpf.replace(/\D/g, "");
  if (c.length !== 11) return false;
  if (/^(\d)\1+$/.test(c)) return false; // todos iguais
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(c[i]) * (10 - i);
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(c[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(c[i]) * (11 - i);
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;
  return d2 === parseInt(c[10]);
}

function trialExpiry(): string {
  const d = new Date();
  d.setHours(d.getHours() + 48);
  return d.toISOString();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  let createdUserId: string | null = null;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const {
      name, email, password, cpf, phone,
      signup_source, signup_medium, signup_campaign, signup_referrer,
    } = body || {};

    // ── Validações de entrada ─────────────────────────────────────────
    if (!name || typeof name !== "string" || name.trim().length < 3) {
      return jsonError("Nome inválido (mínimo 3 caracteres)", 400);
    }
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return jsonError("E-mail inválido", 400);
    }
    if (!password || typeof password !== "string" || password.length < 6) {
      return jsonError("Senha deve ter pelo menos 6 caracteres", 400);
    }
    if (!cpf || !validateCPF(cpf)) {
      return jsonError("CPF inválido", 400);
    }

    // Phone agora é OPCIONAL. Se vier preenchido, valida formato.
    // Se vazio (string vazia ou só símbolos), grava NULL.
    const phoneClean = String(phone || "").replace(/\D/g, "");
    const phoneProvided = phoneClean.length > 0;
    if (phoneProvided && (phoneClean.length < 10 || phoneClean.length > 11)) {
      return jsonError("WhatsApp inválido (10 ou 11 dígitos com DDD)", 400);
    }

    const cpfHash = await hashCPF(cpf);
    const emailNorm = email.trim().toLowerCase();

    // ── Guardas de e-mail (v8) — antes de tocar no banco ──────────────
    // Descartável e domínio digitado errado. Recusa cedo: nada é criado,
    // então não há rollback nem conta fantasma.
    const problemaEmail = checarEmail(emailNorm);
    if (problemaEmail) {
      return jsonError(problemaEmail.erro, 400, problemaEmail.code);
    }

    // ── Pré-checagens (antes de criar nada no auth) ───────────────────
    // CPF duplicado?
    {
      const { data: dup } = await admin
        .from("gdrums_profiles")
        .select("id")
        .eq("cpf_hash", cpfHash)
        .maybeSingle();
      if (dup) return jsonError("Este CPF já possui uma conta cadastrada. Se não consegue acessar, fale com o suporte.", 409, "cpf_duplicate");
    }

    // Phone duplicado? (só checa se informado)
    if (phoneProvided) {
      const { data: dup } = await admin
        .from("gdrums_profiles")
        .select("id")
        .eq("phone", phoneClean)
        .maybeSingle();
      if (dup) return jsonError("Este WhatsApp já possui uma conta cadastrada. Se não consegue acessar, fale com o suporte.", 409, "phone_duplicate");
    }

    // ── Criar user no auth (admin API — pula confirmação de email) ────
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: emailNorm,
      password,
      email_confirm: true, // não exige verificação por email pra fluxo simples
      user_metadata: { name: name.trim() },
    });

    if (createErr || !created?.user) {
      const msg = createErr?.message || "Erro ao criar conta";
      if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("registered")) {
        return jsonError("Este e-mail já está cadastrado. Tente fazer login.", 409, "email_duplicate");
      }
      return jsonError(msg, 400);
    }

    createdUserId = created.user.id;

    // Trigger DB cria gdrums_profiles automaticamente. Vamos garantir UPSERT
    // do estado completo (cobre o caso da trigger demorar ou não rodar).
    const trial = trialExpiry();
    const sessionId = crypto.randomUUID();

    const profilePayload: Record<string, unknown> = {
      id: createdUserId,
      name: name.trim(),
      cpf_hash: cpfHash,
      phone: phoneProvided ? phoneClean : null,
      role: "user",
      subscription_status: "trial",
      subscription_plan: "trial",
      subscription_expires_at: trial,
      active_session_id: sessionId,
      updated_at: new Date().toISOString(),
    };
    if (signup_source) profilePayload.signup_source = signup_source;
    if (signup_medium) profilePayload.signup_medium = signup_medium;
    if (signup_campaign) profilePayload.signup_campaign = signup_campaign;
    if (signup_referrer) profilePayload.signup_referrer = signup_referrer;

    // Tentativa 1: aguarda um momento pra trigger rodar e fazer UPDATE
    await new Promise(r => setTimeout(r, 400));
    const { error: upErr1 } = await admin
      .from("gdrums_profiles")
      .update(profilePayload)
      .eq("id", createdUserId);

    let saved = !upErr1;

    // Se update falhou (perfil não existe ainda), tenta UPSERT direto
    if (!saved) {
      const { error: upErr2 } = await admin
        .from("gdrums_profiles")
        .upsert(profilePayload);
      saved = !upErr2;
      if (upErr2) {
        // Violação UNIQUE = corrida com outra requisição. Aborta.
        const code = (upErr2 as { code?: string }).code;
        const msg = (upErr2 as { message?: string }).message || "";
        if (code === "23505") {
          await rollback(admin, createdUserId);
          if (msg.includes("phone")) return jsonError("WhatsApp já cadastrado.", 409, "phone_duplicate");
          return jsonError("CPF já cadastrado.", 409, "cpf_duplicate");
        }
        throw new Error("Falha ao gravar perfil: " + msg);
      }
    }

    // Verificação final defensiva: lê o perfil pra garantir CPF setado.
    // Phone só é exigido se foi informado (opcional desde v7).
    const { data: check } = await admin
      .from("gdrums_profiles")
      .select("cpf_hash, phone")
      .eq("id", createdUserId)
      .single();

    const cpfOk = !!check?.cpf_hash;
    const phoneOk = phoneProvided ? !!check?.phone : true;
    if (!check || !cpfOk || !phoneOk) {
      await rollback(admin, createdUserId);
      return jsonError("Não foi possível finalizar o cadastro. Tente novamente.", 500);
    }

    return new Response(JSON.stringify({
      success: true,
      user_id: createdUserId,
      session_id: sessionId,
      trial_expires_at: trial,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    // Qualquer exceção: rollback completo
    if (createdUserId) {
      await rollback(admin, createdUserId);
    }
    return jsonError("Erro interno: " + String(e), 500);
  }
});

async function rollback(admin: ReturnType<typeof createClient>, userId: string): Promise<void> {
  try {
    // Ordem: dependências primeiro, depois auth.users
    await admin.from("gdrums_profiles").delete().eq("id", userId);
    await admin.auth.admin.deleteUser(userId);
  } catch (e) {
    console.error("[register-account] rollback failed for user", userId, e);
  }
}

function jsonError(message: string, status = 400, code?: string): Response {
  return new Response(JSON.stringify({ success: false, error: message, code }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
