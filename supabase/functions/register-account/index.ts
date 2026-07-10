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
// ─────────────────────────────────────────────────────────────────────────
// v8 (2026-07): CADASTRO INTERNACIONAL.
//
// GARANTIA DE OURO — O BRASIL NÃO MUDA. O caminho BR abaixo é o MESMO
// código do v7, linha por linha: exige CPF, checa duplicidade de CPF/phone,
// cria o user com `email_confirm: true` (nasce confirmado, NENHUM e-mail é
// enviado, ZERO fricção), devolve session_id e o cliente loga na hora.
// Nenhum rate limit, nenhum bloqueio de domínio, nenhuma confirmação.
//
// COMPATIBILIDADE COM OS APPS JÁ INSTALADOS: os binários em produção NÃO
// mandam `country`. Ausência/vazio de `country` é tratado como 'BR' — ou
// seja, todo cliente antigo continua caindo no caminho de sempre.
//
// FORA DO BRASIL (country != 'BR'): não há CPF (documento brasileiro), então
// o anti-trial-farming vira:
//   1. RATE LIMIT por IP e por e-mail (tabela gdrums_signup_attempts, RLS
//      fechada — só a service_role escreve/lê).
//   2. BLOQUEIO de e-mail descartável (mailinator, temp-mail e cia).
//   3. CONFIRMAÇÃO DE E-MAIL: a conta é criada via `signUp()` (não pelo
//      admin API), então o Supabase Auth manda o e-mail de confirmação
//      usando a MESMA infra que já entrega o recovery hoje. O usuário só
//      consegue logar depois de clicar no link.
//
// O e-mail de confirmação deve usar o template com {{ .TokenHash }}:
//   {{ .SiteURL }}/login.html?token_hash={{ .TokenHash }}&type=signup
// (mesmo padrão robusto do recovery: o token_hash valida em QUALQUER
// contexto, então o link abre certo no app nativo via App Links e na web).
//
// TOLERANTE AO TOGGLE: se "Confirm email" estiver DESLIGADO no dashboard, o
// signUp já devolve o usuário confirmado — a função detecta isso e responde
// sem `confirmation_required` (o cliente loga direto). Quando o toggle for
// ligado, o portão de confirmação passa a valer sozinho. Nos dois estados a
// função se comporta corretamente e o BR nunca é afetado.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://qsfziivubwdgtmwyztfw.supabase.co";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

// ─── Rate limit (SÓ o caminho internacional) ──────────────────────────
// Generoso pra não barrar gente legítima (igreja/estúdio dividindo o mesmo
// IP), apertado o bastante pra matar script de cadastro em massa.
const RL_IP_HOUR = 5;
const RL_IP_DAY = 15;
const RL_EMAIL_HOUR = 3;

// Domínios de e-mail descartável — confirmar um temp-mail é trivial, então
// bloquear a fonte é o que dá dente à confirmação de e-mail.
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.info", "sharklasers.com",
  "10minutemail.com", "temp-mail.org", "tempmail.com", "throwawaymail.com",
  "yopmail.com", "getnada.com", "dispostable.com", "trashmail.com",
  "maildrop.cc", "fakeinbox.com", "mailnesia.com", "tempinbox.com",
  "mohmal.com", "emailondeck.com", "spamgourmet.com", "grr.la",
  "spam4.me", "mytemp.email", "burnermail.io", "tmpmail.org",
  "moakt.com", "inboxkitten.com", "harakirimail.com", "mailcatch.com",
]);

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

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  return fwd.split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "unknown";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError("Corpo inválido", 400);
  }

  // País: ausente/vazio = BR (apps antigos em produção não mandam o campo).
  const country = String(body.country || "BR").trim().toUpperCase() || "BR";

  if (country === "BR") {
    return await handleBrazil(admin, body);
  }
  return await handleInternational(admin, body, req, country);
});

// ═══════════════════════════════════════════════════════════════════════
// BRASIL — código IDÊNTICO ao v7. Não alterar sem necessidade real.
// Única adição: grava country:'BR' no perfil (mesmo valor do DEFAULT).
// ═══════════════════════════════════════════════════════════════════════
async function handleBrazil(
  admin: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
): Promise<Response> {
  let createdUserId: string | null = null;

  try {
    const {
      name, email, password, cpf, phone,
      signup_source, signup_medium, signup_campaign, signup_referrer,
    } = body as Record<string, string>;

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

    // Phone é OPCIONAL. Se vier preenchido, valida formato. Se vazio, NULL.
    const phoneClean = String(phone || "").replace(/\D/g, "");
    const phoneProvided = phoneClean.length > 0;
    if (phoneProvided && (phoneClean.length < 10 || phoneClean.length > 11)) {
      return jsonError("WhatsApp inválido (10 ou 11 dígitos com DDD)", 400);
    }

    const cpfHash = await hashCPF(cpf);
    const emailNorm = email.trim().toLowerCase();

    // ── Pré-checagens (antes de criar nada no auth) ───────────────────
    {
      const { data: dup } = await admin
        .from("gdrums_profiles")
        .select("id")
        .eq("cpf_hash", cpfHash)
        .maybeSingle();
      if (dup) return jsonError("Este CPF já possui uma conta cadastrada. Se não consegue acessar, fale com o suporte.", 409, "cpf_duplicate");
    }

    if (phoneProvided) {
      const { data: dup } = await admin
        .from("gdrums_profiles")
        .select("id")
        .eq("phone", phoneClean)
        .maybeSingle();
      if (dup) return jsonError("Este WhatsApp já possui uma conta cadastrada. Se não consegue acessar, fale com o suporte.", 409, "phone_duplicate");
    }

    // ── Criar user no auth (admin API — pula confirmação de email) ────
    // email_confirm:true é o que mantém o BR SEM fricção mesmo se o
    // "Confirm email" global estiver ligado pro caminho internacional.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: emailNorm,
      password,
      email_confirm: true,
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

    const trial = trialExpiry();
    const sessionId = crypto.randomUUID();

    const profilePayload: Record<string, unknown> = {
      id: createdUserId,
      name: name.trim(),
      cpf_hash: cpfHash,
      phone: phoneProvided ? phoneClean : null,
      country: "BR",
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

    let saved = !upErr1;

    if (!saved) {
      const { error: upErr2 } = await admin
        .from("gdrums_profiles")
        .upsert(profilePayload);
      saved = !upErr2;
      if (upErr2) {
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
    if (createdUserId) await rollback(admin, createdUserId);
    return jsonError("Erro interno: " + String(e), 500);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// INTERNACIONAL — sem CPF. Defesas: rate limit + descartável + confirmação.
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

    // ── Defesa 1: e-mail descartável ──────────────────────────────────
    if (DISPOSABLE_DOMAINS.has(domain)) {
      await logAttempt(admin, ip, emailNorm, country, ua, "blocked");
      return jsonError("Please use a permanent email address.", 400, "disposable_email");
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

  try {
    const [{ count: ipHour }, { count: ipDay }, { count: emailHour }] = await Promise.all([
      admin.from("gdrums_signup_attempts").select("id", { count: "exact", head: true })
        .eq("ip", ip).gte("created_at", hourAgo),
      admin.from("gdrums_signup_attempts").select("id", { count: "exact", head: true })
        .eq("ip", ip).gte("created_at", dayAgo),
      admin.from("gdrums_signup_attempts").select("id", { count: "exact", head: true })
        .eq("email", email).gte("created_at", hourAgo),
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
