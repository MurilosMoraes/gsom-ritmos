// send-push-fcm — manda push direto via FCM HTTPv1 (sem OneSignal).
//
// Por quê: OneSignal embrulha payload em formato proprietário (`custom.i`)
// que só renderiza no Android se o SDK nativo do OneSignal estiver no app.
// Como removemos o SDK por causa do bug iOS de AVAudioSession, Android
// recebe via FCM padrão mas não consegue renderizar → received=0.
//
// Solução: mandar com payload `notification: {title, body}` que FCM padrão
// renderiza automaticamente no system tray, sem precisar de SDK do OneSignal.
//
// SÓ é usado pra Android. iOS continua via OneSignal (que funciona perfeito
// com APNS bypass nativo).
//
// Auth: Bearer <user JWT> + role=admin
// Secrets necessários: FIREBASE_SERVICE_ACCOUNT_JSON (JSON inteiro como string)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://qsfziivubwdgtmwyztfw.supabase.co";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SERVICE_ACCOUNT_RAW = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

interface ServiceAccount {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
}

interface SendPayload {
  title: string;
  body: string;
  url?: string;
  target_user_id?: string;
  segment?: "user" | "all_android";
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  // Cache 50min (token vale 1h)
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  // Importa private key PEM como CryptoKey
  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  const pemBody = sa.private_key
    .replace(pemHeader, "")
    .replace(pemFooter, "")
    .replace(/\s/g, "");
  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const jwt = await create(
    { alg: "RS256", typ: "JWT" },
    {
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: getNumericDate(0),
      exp: getNumericDate(3600),
    },
    privateKey,
  );

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error("OAuth falhou: " + JSON.stringify(data));
  }

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.token;
}

async function sendToToken(
  accessToken: string,
  projectId: string,
  token: string,
  title: string,
  body: string,
  url: string | undefined,
): Promise<{ ok: boolean; error?: string }> {
  const message: Record<string, unknown> = {
    token,
    notification: { title, body },
    android: {
      priority: "HIGH",
      notification: {
        channel_id: "gdrums-default",
        click_action: url ? undefined : undefined,
      },
    },
  };
  if (url) {
    (message as { data?: Record<string, string> }).data = { url };
  }

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message }),
    },
  );

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    return { ok: false, error: JSON.stringify(errData).slice(0, 300) };
  }
  return { ok: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    if (!SERVICE_ACCOUNT_RAW) {
      return jsonError("FIREBASE_SERVICE_ACCOUNT_JSON não configurado", 500);
    }
    const sa = JSON.parse(SERVICE_ACCOUNT_RAW) as ServiceAccount;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError("Unauthorized", 401);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const userToken = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(userToken);
    if (authError || !user) return jsonError("Invalid token", 401);

    const { data: profile } = await supabase
      .from("gdrums_profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (!profile || profile.role !== "admin") return jsonError("Forbidden", 403);

    const payload = (await req.json()) as SendPayload;
    if (!payload.title || !payload.body) {
      return jsonError("title e body obrigatórios", 400);
    }

    // Busca tokens FCM no DB
    let tokens: string[] = [];
    if (payload.segment === "user" && payload.target_user_id) {
      const { data } = await supabase
        .from("gdrums_profiles")
        .select("fcm_token")
        .eq("id", payload.target_user_id)
        .not("fcm_token", "is", null)
        .single();
      if (data?.fcm_token) tokens = [data.fcm_token];
    } else if (payload.segment === "all_android") {
      const { data } = await supabase
        .from("gdrums_profiles")
        .select("fcm_token")
        .not("fcm_token", "is", null);
      tokens = (data || []).map((r: { fcm_token: string }) => r.fcm_token);
    } else {
      return jsonError("segment inválido (use 'user' + target_user_id ou 'all_android')", 400);
    }

    if (tokens.length === 0) {
      return jsonError("Nenhum fcm_token encontrado", 400);
    }

    const accessToken = await getAccessToken(sa);
    const results = await Promise.all(
      tokens.map((t) =>
        sendToToken(accessToken, sa.project_id, t, payload.title, payload.body, payload.url),
      ),
    );

    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);

    return new Response(JSON.stringify({
      success: true,
      sent: succeeded,
      failed: failed.length,
      errors: failed.map((f) => f.error).slice(0, 3),
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return jsonError("Erro: " + String(e), 500);
  }
});

function jsonError(message: string, status = 400): Response {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
