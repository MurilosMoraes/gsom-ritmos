// cron-push-notifications — disparos automáticos de renovação/trial.
//
// DOIS CANAIS por candidato (cada plataforma pelo que RENDERIZA):
//   1. OneSignal via external_id  → iOS + Web
//   2. FCM HTTPv1 direto via fcm_token → Android (Play Store)
//
// Por que dois canais:
//   - external_id (= supabase user.id) é estável; o app faz OneSignal.login.
//   - Mas o payload do OneSignal NÃO renderiza no Android sem o SDK nativo
//     (removido por causa do bug iOS de AVAudioSession). Android só mostra
//     na bandeja via FCM padrão (notification:{title,body}).
//   - Por isso Android vai por FCM direto (mesma técnica da send-push-fcm).
//
// HISTÓRICO:
//   - 16/06: onesignal_id -> external_id (ID antigo virava órfão, 88% falha).
//   - 16/06: + canal FCM pro Android (cron OneSignal nunca alcançava Play).
//   - 01/09: texto sem emoji, e o catálogo passou de "100+" pra 166 ritmos.
//   - 18/09: idioma pelo país do perfil (gdrums_profiles.country). BR, PT e
//     país em branco continuam recebendo o texto EXATO de antes; países
//     hispânicos recebem espanhol e o resto inglês. Uma consulta em lote por
//     leva traz o país de todos os candidatos, sem consulta por usuário.
//
// Chamado por pg_cron a cada hora. Idempotência: gdrums_push_sent.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";
import { type Idioma, idiomaDoPais } from "../_shared/idioma.ts";
import {
  type MensagemPush,
  mensagemPush,
  PUSH_EXPIRED_TODAY,
  PUSH_TRIAL_24H,
} from "../_shared/textos-push.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://qsfziivubwdgtmwyztfw.supabase.co";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID") || "30db2eda-9227-48ef-ab48-5b3eb26465e8";
const ONESIGNAL_API_KEY = Deno.env.get("ONESIGNAL_API_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const FIREBASE_SA_RAW = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") || "";

const ONESIGNAL_ENDPOINT = "https://onesignal.com/api/v1/notifications";
const LINK_PLANOS = "https://gdrums.com.br/plans";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface ServiceAccount {
  project_id: string;
  private_key: string;
  client_email: string;
}

let cachedFcmToken: { token: string; expiresAt: number } | null = null;

async function getFcmAccessToken(sa: ServiceAccount): Promise<string> {
  if (cachedFcmToken && cachedFcmToken.expiresAt > Date.now() + 60_000) {
    return cachedFcmToken.token;
  }
  const pemBody = sa.private_key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const privateKey = await crypto.subtle.importKey(
    "pkcs8", binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
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
  if (!res.ok || !data.access_token) throw new Error("FCM OAuth falhou");
  cachedFcmToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedFcmToken.token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const secret = url.searchParams.get("secret") || req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!ONESIGNAL_API_KEY) {
    return new Response(JSON.stringify({ error: "ONESIGNAL_API_KEY não configurada" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Service account do Firebase é OPCIONAL: se não configurado, o canal FCM
  // é pulado e o OneSignal (iOS/web) segue funcionando. Nunca derruba o cron.
  let firebaseSA: ServiceAccount | null = null;
  if (FIREBASE_SA_RAW) {
    try { firebaseSA = JSON.parse(FIREBASE_SA_RAW); } catch { firebaseSA = null; }
  }

  const results = {
    trial_24h: { candidates: 0, onesignal: 0, fcm: 0, failed: 0, por_idioma: { pt: 0, es: 0, en: 0 } },
    expired_today: { candidates: 0, onesignal: 0, fcm: 0, failed: 0, por_idioma: { pt: 0, es: 0, en: 0 } },
  };

  /** País de todo mundo da leva numa consulta só. Quem não voltar fica nulo
   *  (= português), que é o que já acontecia com conta antiga. */
  const paisesDe = async (ids: string[]): Promise<Map<string, string | null>> => {
    const mapa = new Map<string, string | null>();
    if (ids.length === 0) return mapa;
    const { data } = await supabase
      .from("gdrums_profiles").select("id,country").in("id", ids);
    for (const r of ((data || []) as Array<{ id: string; country: string | null }>)) {
      mapa.set(r.id, r.country ?? null);
    }
    return mapa;
  };

  const runBatch = async (
    list: Array<{ user_id: string; expires_at?: string }>,
    eventKeyOf: (c: { user_id: string; expires_at?: string }) => string,
    catalogo: Record<Idioma, MensagemPush>, source: string,
    bucket: {
      candidates: number; onesignal: number; fcm: number; failed: number;
      por_idioma: Record<Idioma, number>;
    },
  ) => {
    bucket.candidates = list.length;
    const paises = await paisesDe(list.map((c) => c.user_id).filter(Boolean));

    for (const c of list) {
      const eventKey = eventKeyOf(c);
      // Idempotência: marca ANTES de mandar (unique user_id+event_key).
      // Se já marcado (23505), pula — evita duplicar push no mesmo dia.
      const { error: markError } = await supabase
        .from("gdrums_push_sent")
        .insert({ user_id: c.user_id, event_key: eventKey });
      if (markError && (markError as { code?: string }).code === "23505") continue;

      const pais = paises.get(c.user_id) ?? null;
      const { title, body } = mensagemPush(catalogo, pais);
      bucket.por_idioma[idiomaDoPais(pais)]++;

      let anyOk = false;

      // Canal 1: OneSignal (iOS + Web) por external_id
      try {
        const osRes = await fetch(ONESIGNAL_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": `Basic ${ONESIGNAL_API_KEY}`,
          },
          body: JSON.stringify({
            app_id: ONESIGNAL_APP_ID,
            headings: { en: title, pt: title },
            contents: { en: body, pt: body },
            url: LINK_PLANOS,
            target_channel: "push",
            include_aliases: { external_id: [c.user_id] },
          }),
        });
        const osData = await osRes.json();
        const hasId = !!osData.id;
        const onlyInvalidAlias = osData.errors &&
          Object.keys(osData.errors).length === 1 && osData.errors.invalid_aliases;
        const osOk = osRes.ok && (!osData.errors || (onlyInvalidAlias && hasId));
        if (osOk) { anyOk = true; bucket.onesignal++; }
        await supabase.from("gdrums_push_log").insert({
          title, body, url: LINK_PLANOS, segment: "user",
          target_user_id: c.user_id, source: source + "_onesignal",
          onesignal_notification_id: osData.id || null,
          recipients: osData.recipients || 0,
          status: osOk ? "sent" : "failed",
          error: osOk ? null : JSON.stringify(osData.errors || osData).slice(0, 500),
        });
      } catch (e) {
        await supabase.from("gdrums_push_log").insert({
          title, body, segment: "user", target_user_id: c.user_id,
          source: source + "_onesignal", status: "failed", error: String(e).slice(0, 500),
        });
      }

      // Canal 2: FCM direto (Android Play Store) por fcm_token.
      // Isolado: se falhar, não afeta o OneSignal acima. Só roda se o user
      // tem fcm_token (= instalou o app Android nativo) e o SA tá configurado.
      if (firebaseSA) {
        try {
          const { data: prof } = await supabase
            .from("gdrums_profiles").select("fcm_token").eq("id", c.user_id).single();
          const fcmToken = prof?.fcm_token;
          if (fcmToken) {
            const accessToken = await getFcmAccessToken(firebaseSA);
            const fcmRes = await fetch(
              `https://fcm.googleapis.com/v1/projects/${firebaseSA.project_id}/messages:send`,
              {
                method: "POST",
                headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  message: {
                    token: fcmToken,
                    notification: { title, body },
                    android: { priority: "HIGH", notification: { channel_id: "gdrums-default" } },
                    data: { url: LINK_PLANOS },
                  },
                }),
              },
            );
            const fcmOk = fcmRes.ok;
            if (fcmOk) { anyOk = true; bucket.fcm++; }
            const errData = fcmOk ? null : await fcmRes.json().catch(() => ({}));
            await supabase.from("gdrums_push_log").insert({
              title, body, url: LINK_PLANOS, segment: "user",
              target_user_id: c.user_id, source: source + "_fcm",
              recipients: fcmOk ? 1 : 0,
              status: fcmOk ? "sent" : "failed",
              error: fcmOk ? null : JSON.stringify(errData).slice(0, 500),
            });
          }
        } catch (e) {
          await supabase.from("gdrums_push_log").insert({
            title, body, segment: "user", target_user_id: c.user_id,
            source: source + "_fcm", status: "failed", error: String(e).slice(0, 500),
          });
        }
      }

      if (!anyOk) bucket.failed++;
    }
  };

  try {
    const { data: trial24h } = await supabase.rpc("push_candidates_trial_expiring", {
      p_hours_window_start: 22, p_hours_window_end: 26, p_event_key: "trial_24h",
    });
    await runBatch(
      (trial24h || []) as Array<{ user_id: string; expires_at: string }>,
      (c) => `trial_24h_${(c.expires_at || "").slice(0, 10)}`,
      PUSH_TRIAL_24H,
      "cron_trial_24h", results.trial_24h,
    );
  } catch (e) {
    console.error("[cron-push] trial_24h erro:", e);
  }

  try {
    const { data: expiredToday } = await supabase.rpc("push_candidates_just_expired", {
      p_event_key: "expired_today",
    });
    await runBatch(
      (expiredToday || []) as Array<{ user_id: string }>,
      () => `expired_today_${new Date().toISOString().slice(0, 10)}`,
      PUSH_EXPIRED_TODAY,
      "cron_expired", results.expired_today,
    );
  } catch (e) {
    console.error("[cron-push] expired_today erro:", e);
  }

  return new Response(JSON.stringify({ success: true, results }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
