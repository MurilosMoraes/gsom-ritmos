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
//
// v12 (2026-09-17): CADASTRO INTERNACIONAL. O corpo pode trazer `country`.
//   - Ausente/vazio/"BR" → handleBrazil: o código de sempre, INTOCADO (os
//     apps já instalados não mandam country e continuam caindo aqui).
//   - Outro país → handleInternational: sem CPF (documento brasileiro). O
//     anti-trial-farming vira rate limit (IP e e-mail, tabela
//     gdrums_signup_attempts), guardas de e-mail (as mesmas do BR) e
//     CONFIRMAÇÃO DE E-MAIL: a conta nasce pelo signUp(), então o Supabase
//     Auth envia o e-mail e o login só funciona depois do clique.
//     Template do e-mail "Confirm signup":
//       {{ .SiteURL }}/login.html?token_hash={{ .TokenHash }}&type=signup
//   Tolerante ao toggle "Confirm email": se estiver desligado, o signUp já
//   devolve confirmado e a resposta vem sem confirmation_required.


import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checarEmail, DOMAIN_TYPOS } from "./emailGuard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://qsfziivubwdgtmwyztfw.supabase.co";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

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

// Rate limit do cadastro INTERNACIONAL (o BR não tem: grupo de igreja no
// mesmo Wi-Fi não pode ser bloqueado; lá a trava é o CPF).
const RL_IP_HOUR = 5;
const RL_IP_DAY = 15;
const RL_EMAIL_HOUR = 3;

function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip")
    || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
    || "unknown";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError("Corpo inválido", 400);
  }

  // País: ausente/vazio = BR (apps antigos não mandam o campo).
  const country = String(body?.country || "BR").trim().toUpperCase() || "BR";
  if (country === "BR") {
    return await handleBrazil(admin, body);
  }
  return await handleInternational(admin, body, req, country.slice(0, 16));
});

// ═══════════════════════════════════════════════════════════════════════
// BRASIL — código de produção (v11), copiado sem alteração de lógica.
// ═══════════════════════════════════════════════════════════════════════
// deno-lint-ignore no-explicit-any
async function handleBrazil(admin: ReturnType<typeof createClient>, body: any): Promise<Response> {
  let createdUserId: string | null = null;

  try {
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
}

// ═══════════════════════════════════════════════════════════════════════
// INTERNACIONAL
// ═══════════════════════════════════════════════════════════════════════
async function handleInternational(
  admin: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  req: Request,
  country: string,
): Promise<Response> {
  let createdUserId: string | null = null;
  const ip = clientIp(req);
  const ua = req.headers.get("user-agent") || "";

  try {
    const {
      name, email, password, phone,
      signup_source, signup_medium, signup_campaign, signup_referrer,
    } = body as Record<string, string>;

    // ── Validações (mesmas regras do BR, menos o CPF) ─────────────────
    if (!name || typeof name !== "string" || name.trim().length < 3) {
      return jsonError("Invalid name (minimum 3 characters)", 400);
    }
    if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return jsonError("Invalid email", 400);
    }
    if (!password || typeof password !== "string" || password.length < 6) {
      return jsonError("Password must be at least 6 characters", 400);
    }

    const emailNorm = email.trim().toLowerCase();
    const domain = emailNorm.split("@")[1] || "";

    // ── Defesa 1: guardas de e-mail (as mesmas do BR) ─────────────────
    const problemaEmail = checarEmail(emailNorm);
    if (problemaEmail) {
      await logAttempt(admin, ip, emailNorm, country, ua, "blocked");
      if (problemaEmail.code === "email_disposable") {
        return jsonError("Please use a permanent email address.", 400, "disposable_email");
      }
      if (problemaEmail.code === "email_typo") {
        const sugestao = DOMAIN_TYPOS[domain];
        return jsonError(
          sugestao
            ? `It looks like there is a typo in your email. Did you mean ${emailNorm.split("@")[0]}@${sugestao}?`
            : "It looks like there is a typo in your email address. Please check it.",
          400,
          "email_typo",
        );
      }
      return jsonError("Invalid email", 400, problemaEmail.code);
    }

    // ── Defesa 2: rate limit por IP e por e-mail ──────────────────────
    const limited = await isRateLimited(admin, ip, emailNorm);
    if (limited) {
      await logAttempt(admin, ip, emailNorm, country, ua, "blocked");
      return jsonError("Too many sign-up attempts. Please try again later.", 429, "rate_limited");
    }
    await logAttempt(admin, ip, emailNorm, country, ua, "attempt");

    // Telefone internacional: opcional, sem regra de DDD brasileiro.
    const phoneClean = String(phone || "").replace(/\D/g, "");
    const phoneProvided = phoneClean.length > 0;
    if (phoneProvided && (phoneClean.length < 6 || phoneClean.length > 20)) {
      return jsonError("Invalid phone number", 400);
    }

    // ── Criar user via signUp (NÃO admin API) ─────────────────────────
    // Assim o Supabase Auth manda o e-mail de confirmação sozinho, usando
    // a mesma infra/SMTP que já entrega o recovery. O usuário não loga
    // enquanto não confirmar.
    if (!ANON_KEY) {
      return jsonError("Signup temporarily unavailable", 503, "anon_key_missing");
    }
    const publicClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: signed, error: signErr } = await publicClient.auth.signUp({
      email: emailNorm,
      password,
      options: {
        data: { name: name.trim() },
        emailRedirectTo: "https://gdrums.com.br/login.html",
      },
    });

    if (signErr || !signed?.user) {
      const msg = signErr?.message || "Could not create account";
      if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("registered")) {
        return jsonError("This email is already registered. Try signing in.", 409, "email_duplicate");
      }
      return jsonError(msg, 400);
    }

    // Supabase devolve user com identities:[] quando o e-mail JÁ existe
    // (anti-enumeração). Trata como duplicado, sem criar nada.
    if (Array.isArray(signed.user.identities) && signed.user.identities.length === 0) {
      return jsonError("This email is already registered. Try signing in.", 409, "email_duplicate");
    }

    createdUserId = signed.user.id;
    // Confirmado já? (só acontece se o "Confirm email" global estiver OFF)
    const alreadyConfirmed = !!signed.user.email_confirmed_at || !!signed.session;

    const trial = trialExpiry();
    const sessionId = crypto.randomUUID();

    const profilePayload: Record<string, unknown> = {
      id: createdUserId,
      name: name.trim(),
      cpf_hash: null,              // não existe CPF fora do Brasil
      phone: phoneProvided ? phoneClean : null,
      country,
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

    await new Promise(r => setTimeout(r, 400));
    const { error: upErr1 } = await admin
      .from("gdrums_profiles")
      .update(profilePayload)
      .eq("id", createdUserId);

    if (upErr1) {
      const { error: upErr2 } = await admin.from("gdrums_profiles").upsert(profilePayload);
      if (upErr2) {
        await rollback(admin, createdUserId);
        throw new Error("Failed to save profile: " + (upErr2 as { message?: string }).message);
      }
    }

    await logAttempt(admin, ip, emailNorm, country, ua, "created");

    return new Response(JSON.stringify({
      success: true,
      user_id: createdUserId,
      session_id: sessionId,
      trial_expires_at: trial,
      // Só pede confirmação se o e-mail realmente não está confirmado.
      // Com o toggle OFF, o cliente loga direto (comportamento degradado
      // mas correto — sem mentir pro usuário).
      confirmation_required: !alreadyConfirmed,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    if (createdUserId) await rollback(admin, createdUserId);
    return jsonError("Internal error: " + String(e), 500);
  }
}

// ─── Rate limit helpers ────────────────────────────────────────────────

async function isRateLimited(
  admin: ReturnType<typeof createClient>,
  ip: string,
  email: string,
): Promise<boolean> {
  const now = Date.now();
  const hourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  // Conta só as TENTATIVAS (outcome=attempt). Cada cadastro também grava
  // "created" (e recusas gravam "blocked"); contar tudo fazia o limite de
  // 5/hora virar 3/hora na prática (bug pego no teste de comportamento).
  try {
    const [{ count: ipHour }, { count: ipDay }, { count: emailHour }] = await Promise.all([
      admin.from("gdrums_signup_attempts").select("id", { count: "exact", head: true })
        .eq("ip", ip).eq("outcome", "attempt").gte("created_at", hourAgo),
      admin.from("gdrums_signup_attempts").select("id", { count: "exact", head: true })
        .eq("ip", ip).eq("outcome", "attempt").gte("created_at", dayAgo),
      admin.from("gdrums_signup_attempts").select("id", { count: "exact", head: true })
        .eq("email", email).eq("outcome", "attempt").gte("created_at", hourAgo),
    ]);

    if ((ipHour ?? 0) >= RL_IP_HOUR) return true;
    if ((ipDay ?? 0) >= RL_IP_DAY) return true;
    if ((emailHour ?? 0) >= RL_EMAIL_HOUR) return true;
    return false;
  } catch (e) {
    // Falha ao consultar o limite NÃO pode derrubar cadastro legítimo.
    console.error("[register-account] rate limit check failed:", e);
    return false;
  }
}

async function logAttempt(
  admin: ReturnType<typeof createClient>,
  ip: string,
  email: string,
  country: string,
  ua: string,
  outcome: string,
): Promise<void> {
  try {
    await admin.from("gdrums_signup_attempts").insert({ ip, email, country, user_agent: ua, outcome });
  } catch (e) {
    console.error("[register-account] logAttempt failed:", e);
  }
}

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
