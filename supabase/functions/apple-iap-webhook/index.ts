// apple-iap-webhook
// =================================================================
// Recebe App Store Server Notifications V2 (assíncronas) da Apple.
// Eventos: renovação, refund, cancelamento, upgrade/downgrade, expiração.
//
// Apple manda POST aqui sempre que algo muda na assinatura. Sem
// isso, o status no Supabase fica desatualizado: user cancela na
// Apple, app continua liberando até a expiresDate antiga.
//
// Configurar URL na ASC: App → App Information → App Store Server
// Notifications → "Production Server URL V2":
//   https://qsfziivubwdgtmwyztfw.supabase.co/functions/v1/apple-iap-webhook
//
// Doc V2: https://developer.apple.com/documentation/appstoreservernotifications
//
// Notas:
// - V2 é JWS-signed pelo Apple. Body é {signedPayload: "<jws>"}.
// - Aqui fazemos decode + ações mínimas. Validação de assinatura
//   completa exige App Store Server Library (ainda não setada).
//   Mitigação: confiamos no transactionId+bundleId pra correlação,
//   e nunca CRIAMOS perfil novo daqui — só atualizamos existing.
//   Logs ficam no Discord pra qualquer ação suspeita ser revisada.
// =================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://qsfziivubwdgtmwyztfw.supabase.co";
// Service role injetada pelo Supabase Functions runtime via env var
// SUPABASE_SERVICE_ROLE_KEY. Nunca commitar valor real no repo.
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const EXPECTED_BUNDLE_ID = "com.gdrums.app";
const DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1491970416720478297/dzQS-EFHsMrEFsWilzwe__kWbPHLfCFnKD_dLFqdP0oa83HiDspGERRLEDpEjmjSj0pQ";

const PRODUCT_TO_PLAN: Record<string, string> = {
  "com.gdrums.app.mensal": "mensal",
  "com.gdrums.app.trimestral": "trimestral",
  "com.gdrums.app.semestral": "semestral",
  "com.gdrums.app.anual": "anual",
  "com.gdrums.app.reidospalcos": "rei-dos-palcos",
};

// Notification types V2 — só os que realmente nos interessam.
// Lista completa: https://developer.apple.com/documentation/appstoreservernotifications/notificationtype
type NotificationType =
  | "DID_RENEW"               // renovação automática deu certo
  | "DID_FAIL_TO_RENEW"       // renovação falhou (cartão recusado etc.)
  | "EXPIRED"                 // assinatura terminou
  | "REFUND"                  // user pediu refund e Apple aprovou
  | "REVOKE"                  // family sharing revogado
  | "DID_CHANGE_RENEWAL_STATUS" // user cancelou auto-renew (continua ativo até expiresDate)
  | "GRACE_PERIOD_EXPIRED"    // billing retry falhou de vez
  | "SUBSCRIBED"              // primeira compra (também vamos receber, mas iap-verify cuida)
  | "DID_CHANGE_RENEWAL_PREF" // upgrade/downgrade
  | "PRICE_INCREASE"          // notificação de aumento de preço
  | string;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function base64UrlDecode(str: string): string {
  const pad = str.length % 4;
  const padded = pad ? str + "=".repeat(4 - pad) : str;
  const b64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  return atob(b64);
}

function decodeJwsPayload<T>(jws: string): T | null {
  try {
    const parts = jws.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(base64UrlDecode(parts[1])) as T;
  } catch {
    return null;
  }
}

interface ResponseBodyV2DecodedPayload {
  notificationType: NotificationType;
  subtype?: string;
  notificationUUID: string;
  data?: {
    bundleId?: string;
    environment?: "Production" | "Sandbox";
    signedTransactionInfo?: string;  // JWS
    signedRenewalInfo?: string;      // JWS
  };
  version?: string;
  signedDate?: number;
}

interface JWSTransactionDecoded {
  bundleId?: string;
  productId?: string;
  transactionId?: string;
  originalTransactionId?: string;
  expiresDate?: number;
  appAccountToken?: string;
  environment?: "Production" | "Sandbox";
  type?: string;
  revocationDate?: number;
  revocationReason?: number;
}

async function notifyDiscord(title: string, fields: Record<string, string>) {
  try {
    await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title,
          color: 0xff9500,
          fields: Object.entries(fields).map(([name, value]) => ({
            name, value: value || "—", inline: true,
          })),
          timestamp: new Date().toISOString(),
        }],
      }),
    });
  } catch { /* best-effort */ }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body = await req.json() as { signedPayload?: string };
    if (!body.signedPayload) {
      return new Response(JSON.stringify({ error: "signedPayload ausente" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const notification = decodeJwsPayload<ResponseBodyV2DecodedPayload>(body.signedPayload);
    if (!notification) {
      return new Response(JSON.stringify({ error: "JWS não decodificável" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { notificationType, subtype, notificationUUID, data } = notification;

    // Defesa: bundleId tem que bater (caso alguém mande payload pro nosso endpoint)
    if (data?.bundleId && data.bundleId !== EXPECTED_BUNDLE_ID) {
      return new Response(JSON.stringify({ error: "bundleId não bate" }), {
        status: 200, // 200 pra Apple não retentar — payload não é nosso
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const transaction = data?.signedTransactionInfo
      ? decodeJwsPayload<JWSTransactionDecoded>(data.signedTransactionInfo)
      : null;

    if (!transaction) {
      // Sem transaction info, não dá pra agir — só logar
      await notifyDiscord("⚠️ IAP Notification sem transaction info", {
        notificationType: String(notificationType),
        subtype: subtype || "—",
        uuid: notificationUUID || "—",
      });
      return jsonOk();
    }

    const { productId, originalTransactionId, transactionId, expiresDate, appAccountToken, environment } = transaction;
    const planId = productId ? PRODUCT_TO_PLAN[productId] : undefined;

    if (!planId) {
      await notifyDiscord("⚠️ IAP webhook: productId desconhecido", {
        productId: productId || "—",
        type: String(notificationType),
      });
      return jsonOk();
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Localizar user. Preferência: appAccountToken (se app gravou ao
    // comprar). Fallback: pela order_nsu/transaction_nsu existente.
    let userId: string | null = appAccountToken || null;

    if (!userId && originalTransactionId) {
      const { data: existingTx } = await supabase
        .from("gdrums_transactions")
        .select("user_id")
        .or(`transaction_nsu.eq.${originalTransactionId},order_nsu.like.%${originalTransactionId}%`)
        .maybeSingle();
      if (existingTx?.user_id) userId = existingTx.user_id;
    }

    if (!userId) {
      // Não conseguimos correlacionar — log pra investigação manual.
      await notifyDiscord("⚠️ IAP webhook: user não encontrado", {
        type: String(notificationType),
        productId: productId || "—",
        originalTransactionId: originalTransactionId || "—",
      });
      return jsonOk();
    }

    // ─── Roteamento por tipo de notificação ───────────────────────────

    switch (notificationType) {
      case "DID_RENEW":
      case "SUBSCRIBED": {
        // Renovação automática deu certo — estende expiresDate.
        if (expiresDate) {
          await supabase.from("gdrums_profiles").update({
            subscription_status: "active",
            subscription_plan: planId,
            subscription_expires_at: new Date(expiresDate).toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("id", userId);

          // Insere registro de renovação se for novo transactionId
          const renewOrderNsu = `apple_iap_${userId}_${planId}_${transactionId || originalTransactionId}`;
          const { data: existingRenew } = await supabase
            .from("gdrums_transactions")
            .select("id")
            .eq("order_nsu", renewOrderNsu)
            .maybeSingle();
          if (!existingRenew) {
            await supabase.from("gdrums_transactions").insert({
              user_id: userId,
              order_nsu: renewOrderNsu,
              transaction_nsu: transactionId || originalTransactionId,
              plan: planId,
              amount_cents: 0,
              status: "confirmed",
              payment_method: environment === "Sandbox" ? "apple_iap_sandbox" : "apple_iap",
            });
          }

          await notifyDiscord("🔄 IAP renovação confirmada", {
            user: userId.slice(0, 8),
            plan: planId,
            expires: new Date(expiresDate).toISOString().split("T")[0],
            env: environment || "—",
          });
        }
        break;
      }

      case "EXPIRED":
      case "GRACE_PERIOD_EXPIRED": {
        // Apple confirmou que assinatura expirou de fato.
        await supabase.from("gdrums_profiles").update({
          subscription_status: "expired",
          updated_at: new Date().toISOString(),
        }).eq("id", userId);

        await notifyDiscord("⌛ IAP assinatura expirou", {
          user: userId.slice(0, 8), plan: planId,
        });
        break;
      }

      case "REFUND":
      case "REVOKE": {
        // User pediu reembolso e Apple aprovou, ou family sharing revogou.
        // Cortar acesso imediatamente.
        await supabase.from("gdrums_profiles").update({
          subscription_status: "canceled",
          subscription_expires_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", userId);

        await notifyDiscord("🚨 IAP REFUND/REVOKE — acesso cortado", {
          user: userId.slice(0, 8),
          plan: planId,
          type: String(notificationType),
          subtype: subtype || "—",
        });
        break;
      }

      case "DID_CHANGE_RENEWAL_STATUS": {
        // User cancelou auto-renew (mas continua ativo até expiresDate).
        // subtype: AUTO_RENEW_DISABLED | AUTO_RENEW_ENABLED
        await notifyDiscord("ℹ️ IAP auto-renew alterado", {
          user: userId.slice(0, 8),
          plan: planId,
          subtype: subtype || "—",
        });
        break;
      }

      case "DID_FAIL_TO_RENEW": {
        // Cartão recusado etc. Apple vai retentar antes de expirar.
        // Não cortar acesso ainda — só logar.
        await notifyDiscord("⚠️ IAP renovação falhou (em retry)", {
          user: userId.slice(0, 8),
          plan: planId,
          subtype: subtype || "—",
        });
        break;
      }

      default: {
        // Notification que não tratamos explicitamente — só logar
        await notifyDiscord("📬 IAP notification recebida", {
          type: String(notificationType),
          subtype: subtype || "—",
          plan: planId,
        });
      }
    }

    return jsonOk();
  } catch (e) {
    console.error("[apple-iap-webhook] error:", e);
    // 200 mesmo em erro pra Apple não martelar com retry infinito —
    // já logamos.
    await notifyDiscord("🔴 IAP webhook erro", {
      error: String(e).slice(0, 200),
    });
    return jsonOk();
  }
});

function jsonOk(): Response {
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
