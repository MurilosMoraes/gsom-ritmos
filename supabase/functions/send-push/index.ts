// send-push — admin dispara push pelo console.
//
// DOIS CANAIS, igual ao cron-push-notifications:
//   1. OneSignal via external_id  → iOS + Web
//   2. FCM HTTPv1 direto via fcm_token → Android (Play Store)
//
// Por que dois: o payload do OneSignal NÃO renderiza no Android sem o SDK
// nativo (removido por causa do bug de áudio no iOS). Android só aparece na
// bandeja via FCM padrão. O cron já fazia isso; o envio manual usava só
// OneSignal e por isso mal chegava em ninguém: nos últimos 30 dias o canal
// OneSignal falhou 85% (registro fantasma) contra 3% do FCM.
//
// PLATAFORMA e CANAL andam juntos, e isso importa: quem usou Android e
// migrou pro iPhone mantém os DOIS campos preenchidos, porque o fcm_token
// velho nunca é limpo. Se a escolha de plataforma filtrasse só a audiência,
// um disparo marcado "só Android" ainda sairia pelo OneSignal e cairia no
// iPhone da mesma pessoa — justo com o cupom que na App Store não vale.
// Então marcar Android desliga o OneSignal, e marcar iOS/web desliga o FCM.
//
// SEGMENTO 'teste': vai só pra quem é admin, pro time ver como a mensagem
// chega no aparelho antes de mandar pra base.
//
// Auth: Authorization: Bearer <jwt do admin>

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://qsfziivubwdgtmwyztfw.supabase.co";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID") || "30db2eda-9227-48ef-ab48-5b3eb26465e8";
const ONESIGNAL_API_KEY = Deno.env.get("ONESIGNAL_API_KEY") || "";
const FIREBASE_SA_RAW = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") || "";

const ONESIGNAL_ENDPOINT = "https://onesignal.com/api/v1/notifications";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

type Plataforma = "android" | "ios" | "web";

interface SendPushPayload {
  title: string;
  body: string;
  url?: string;
  segment: string;
  target_user_id?: string;
  status_filter?: string;
  user_ids?: string[];
  /** Vazio ou ausente = todas as plataformas. */
  platforms?: Plataforma[];
}

interface Alvo {
  user_id: string;
  fcm_token: string | null;
  onesignal_id: string | null;
}

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

/** Aplica o recorte de plataforma sobre uma consulta de perfis. */
function filtroPlataforma(q: any, plats: Plataforma[] | undefined) {
  if (!plats || plats.length === 0 || plats.length === 3) return q;
  const ors: string[] = [];
  if (plats.includes("android")) ors.push("fcm_token.not.is.null");
  if (plats.includes("ios")) ors.push("push_platform.eq.ios");
  if (plats.includes("web")) {
    // Sem push_platform gravado, OneSignal sem FCM é iOS antigo ou web.
    ors.push("and(onesignal_id.not.is.null,fcm_token.is.null,push_platform.is.null)");
  }
  return ors.length ? q.or(ors.join(",")) : q;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError("Unauthorized", 401);

    const token = authHeader.replace("Bearer ", "");
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return jsonError("Invalid token", 401);

    const { data: profile } = await supabase
      .from("gdrums_profiles").select("role").eq("id", user.id).single();
    if (!profile || profile.role !== "admin") return jsonError("Forbidden", 403);

    if (!ONESIGNAL_API_KEY) {
      return jsonError("ONESIGNAL_API_KEY env var não configurada no Supabase", 500);
    }

    const payload = (await req.json()) as SendPushPayload;
    if (!payload.title || !payload.body) {
      return jsonError("title e body obrigatórios", 400);
    }

    const plats = payload.platforms;
    const semFiltro = !plats || plats.length === 0 || plats.length === 3;
    // Canal segue a plataforma escolhida (ver cabeçalho).
    const usarFcm = semFiltro || plats!.includes("android");
    const usarOneSignal = semFiltro || plats!.includes("ios") || plats!.includes("web");

    let firebaseSA: ServiceAccount | null = null;
    if (FIREBASE_SA_RAW) {
      try { firebaseSA = JSON.parse(FIREBASE_SA_RAW); } catch { firebaseSA = null; }
    }

    const { data: logEntry } = await supabase
      .from("gdrums_push_log")
      .insert({
        title: payload.title,
        body: payload.body,
        url: payload.url || null,
        segment: payload.segment,
        segment_filter: {
          ...(payload.status_filter ? { status: payload.status_filter } : {}),
          ...(plats && plats.length ? { platforms: plats } : {}),
        },
        target_user_id: payload.target_user_id || null,
        source: "manual",
        sent_by: user.id,
        status: "queued",
      })
      .select().single();
    const logId = logEntry?.id;

    const COLS = "id,fcm_token,onesignal_id";
    const paraAlvos = (rows: any[]): Alvo[] =>
      (rows || []).map((r) => ({
        user_id: r.id, fcm_token: r.fcm_token ?? null, onesignal_id: r.onesignal_id ?? null,
      }));

    let alvos: Alvo[] = [];
    let segmentoAberto = false; // 'all' vai por segmento do OneSignal

    if (payload.segment === "user" && payload.target_user_id) {
      const { data } = await supabase.from("gdrums_profiles")
        .select(COLS).eq("id", payload.target_user_id);
      alvos = paraAlvos(data as any[]);
    } else if (payload.segment === "teste") {
      // Ensaio: vai só pro time, pra ver como a mensagem chega no aparelho
      // antes de mandar pra base. Definir por role='admin' se mantém
      // sozinho: quem entra no time passa a receber os testes.
      const { data } = await supabase.from("gdrums_profiles").select(COLS)
        .eq("role", "admin")
        .or("onesignal_id.not.is.null,fcm_token.not.is.null");
      alvos = paraAlvos(data as any[]);
    } else if (payload.segment === "renewal" && Array.isArray(payload.user_ids)) {
      const ids = payload.user_ids.filter(Boolean).slice(0, 2000);
      if (ids.length === 0) {
        await updateLog(supabase, logId, { status: "failed", error: "Lista de user_ids vazia" });
        return jsonError("Nenhum user_id na lista", 400);
      }
      const { data } = await filtroPlataforma(
        supabase.from("gdrums_profiles").select(COLS).in("id", ids), plats);
      alvos = paraAlvos(data as any[]);
    } else if (payload.segment === "all") {
      segmentoAberto = true;
    } else if (payload.segment === "status" && payload.status_filter) {
      const { data } = await filtroPlataforma(
        supabase.from("gdrums_profiles").select(COLS)
          .eq("subscription_status", payload.status_filter)
          .or("onesignal_id.not.is.null,fcm_token.not.is.null"), plats);
      alvos = paraAlvos(data as any[]);
    } else if (payload.segment === "expiring_24h") {
      // Janela cheia e SEM deduplicação: a do cron marca todo mundo antes de
      // alguém clicar aqui, e era ela que zerava a audiência do botão manual.
      const { data: cand } = await supabase.rpc("push_candidates_trial_expiring", {
        p_hours_window_start: 0, p_hours_window_end: 24,
        p_event_key: "manual", p_ignore_dedupe: true,
        p_platforms: plats && plats.length ? plats : null,
      });
      const ids = ((cand || []) as any[]).map((c) => c.user_id).filter(Boolean);
      if (ids.length) {
        const { data } = await supabase.from("gdrums_profiles").select(COLS).in("id", ids);
        alvos = paraAlvos(data as any[]);
      }
    } else if (payload.segment === "recent_expired") {
      const desde = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const { data } = await filtroPlataforma(
        supabase.from("gdrums_profiles").select(COLS)
          .eq("subscription_status", "expired")
          .gte("subscription_expires_at", desde)
          .or("onesignal_id.not.is.null,fcm_token.not.is.null"), plats);
      alvos = paraAlvos(data as any[]);
    } else {
      return jsonError("segment inválido", 400);
    }

    if (!segmentoAberto && alvos.length === 0) {
      await updateLog(supabase, logId, { status: "failed", error: "Nenhum destinatário nesse recorte" });
      return jsonError("Nenhum destinatário nesse recorte", 400);
    }

    let entreguesOs = 0;
    let entreguesFcm = 0;
    let invalidos = 0;
    let osNotifId: string | null = null;
    const erros: string[] = [];

    // ── Canal 1: OneSignal (iOS + web) ──
    const idsOs = segmentoAberto
      ? []
      : alvos.filter((a) => a.onesignal_id).map((a) => a.user_id);

    if (usarOneSignal && (segmentoAberto || idsOs.length > 0)) {
      const osBody: Record<string, unknown> = {
        app_id: ONESIGNAL_APP_ID,
        headings: { en: payload.title, pt: payload.title },
        contents: { en: payload.body, pt: payload.body },
        target_channel: "push",
      };
      if (payload.url) osBody.url = payload.url;
      if (segmentoAberto) osBody.included_segments = ["Total Subscriptions"];
      else osBody.include_aliases = { external_id: idsOs.slice(0, 2000) };

      try {
        const osRes = await fetch(ONESIGNAL_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": `Basic ${ONESIGNAL_API_KEY}`,
          },
          body: JSON.stringify(osBody),
        });
        const osData = await osRes.json();
        const temId = !!osData.id;
        const soAliasInvalido = osData.errors &&
          Object.keys(osData.errors).length === 1 && osData.errors.invalid_aliases;
        if (osRes.ok && (!osData.errors || (soAliasInvalido && temId))) {
          osNotifId = osData.id || null;
          invalidos = soAliasInvalido
            ? (osData.errors.invalid_aliases.external_id || []).length : 0;
          entreguesOs = osData.recipients ?? Math.max(0, idsOs.length - invalidos);
        } else {
          erros.push("OneSignal: " + JSON.stringify(osData.errors || osData).slice(0, 200));
        }
      } catch (e) {
        erros.push("OneSignal: " + String(e).slice(0, 200));
      }
    }

    // ── Canal 2: FCM direto (Android) ──
    const comFcm = alvos.filter((a) => a.fcm_token);
    if (usarFcm && firebaseSA && comFcm.length > 0) {
      try {
        const accessToken = await getFcmAccessToken(firebaseSA);
        const endpoint = `https://fcm.googleapis.com/v1/projects/${firebaseSA.project_id}/messages:send`;
        // Em blocos, pra não abrir centenas de conexões de uma vez.
        const BLOCO = 20;
        for (let i = 0; i < comFcm.length; i += BLOCO) {
          const parte = comFcm.slice(i, i + BLOCO);
          const r = await Promise.allSettled(parte.map((a) =>
            fetch(endpoint, {
              method: "POST",
              headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                message: {
                  token: a.fcm_token,
                  notification: { title: payload.title, body: payload.body },
                  android: { priority: "HIGH", notification: { channel_id: "gdrums-default" } },
                  ...(payload.url ? { data: { url: payload.url } } : {}),
                },
              }),
            }).then((res) => res.ok)
          ));
          entreguesFcm += r.filter((x) => x.status === "fulfilled" && x.value).length;
        }
      } catch (e) {
        erros.push("FCM: " + String(e).slice(0, 200));
      }
    }

    const entregues = entreguesOs + entreguesFcm;

    if (entregues === 0 && !segmentoAberto) {
      await updateLog(supabase, logId, {
        status: "failed",
        error: (erros.join(" | ") || "Nenhum canal entregou").slice(0, 500),
      });
      return jsonError(erros.join(" | ") || "Nenhum canal entregou", 400);
    }

    await updateLog(supabase, logId, {
      status: "sent",
      onesignal_notification_id: osNotifId,
      recipients: entregues,
      error: erros.length ? erros.join(" | ").slice(0, 500) : null,
    });

    return new Response(JSON.stringify({
      success: true,
      onesignal_id: osNotifId,
      recipients: entregues,
      by_channel: { onesignal: entreguesOs, fcm: entreguesFcm },
      skipped_invalid: invalidos,
      warnings: erros,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return jsonError("Erro: " + String(e), 500);
  }
});

async function updateLog(supabase: any, logId: string | null | undefined, fields: Record<string, unknown>) {
  if (!logId) return;
  try {
    await supabase.from("gdrums_push_log").update(fields).eq("id", logId);
  } catch { /* noop */ }
}

function jsonError(message: string, status = 400): Response {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
