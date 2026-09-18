// apple-iap-verify
// =================================================================
// Recebe JWS (StoreKit 2) ou receipt (SK1 fallback) do cliente iOS,
// valida campos críticos (bundleId, productId, appAccountToken),
// ativa assinatura no gdrums_profiles + insere tx em gdrums_transactions.
//
// v2 (2026-06-05): dispara Meta CAPI Purchase server-side.
// v6 (2026-09-17):
//  - ASSINATURA da Apple conferida (_shared/appleJws.ts). Até a v4 o JWS
//    só era decodificado: qualquer um montava um JWS falso (ou mandava só
//    transactionId, sem JWS) e ganhava plano pago.
//  - Pedido forjado na cara (sem JWS, sem cadeia x5c, raiz que não é a da
//    Apple) é RECUSADO agora — nenhum cliente legítimo cai nesses casos.
//  - v7 (mesmo dia): trava total ligada (ENFORCE_SIGNATURE=true) depois que
//    uma compra real passou no log com assinatura válida. Cadeia de uma
//    compra verdadeira com conteúdo trocado também é recusada.
//  - SEM Meta CAPI: mandar e-mail/telefone de compra feita no app iOS
//    pra Meta é rastreamento pra Apple (exige ATT). O app também não
//    carrega mais o Pixel no iOS.
// =================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAppleJws } from "../_shared/appleJws.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://qsfziivubwdgtmwyztfw.supabase.co";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const EXPECTED_BUNDLE_ID = "com.gdrums.app";

// Motivos que NUNCA vêm da Apple. Em iOS 15+ (mínimo do app) toda compra
// e todo restore trazem o JWS do StoreKit 2 com a cadeia de 3 certificados
// terminando na raiz da Apple. Cair aqui é pedido forjado: recusa na hora.
const NUNCA_VEM_DA_APPLE = new Set([
  "sem_jws",
  "formato",
  "alg",
  "x5c",
  "raiz_nao_apple",
  "intermediario_sem_oid",
  "folha_sem_oid",
]);

// Ligada em 17/09/2026, depois que uma compra real (mensal, 19:30) passou
// no log iap_check com sig_ok/token_match/product_match. Agora NENHUM
// caminho sem assinatura válida da Apple ativa plano — inclusive o caso
// esperto: pegar a cadeia de uma compra própria e trocar o conteúdo.
// Se alguma compra real aparecer recusada no log, voltar pra false.
const ENFORCE_SIGNATURE = true;

const PRODUCT_TO_PLAN: Record<string, string> = {
  "com.gdrums.app.mensal": "mensal",
  "com.gdrums.app.trimestral": "trimestral",
  "com.gdrums.app.semestral": "semestral",
  "com.gdrums.app.anual": "anual",
  "com.gdrums.app.reidospalcos": "rei-dos-palcos",
};

const PLAN_DURATIONS: Record<string, number> = {
  mensal: 1, trimestral: 3, semestral: 6, anual: 12, "rei-dos-palcos": 36,
};

// Preços em centavos (R$) — mesmos dos planos web.
// Sandbox tem preço $0 no JWS, então usamos o preço oficial pra registrar
// o valor da transação.
const PLAN_PRICES_CENTS: Record<string, number> = {
  mensal: 2900,
  trimestral: 8100,
  semestral: 14400,
  anual: 22800,
  "rei-dos-palcos": 52200,
};

const DISCORD_WEBHOOK = Deno.env.get("DISCORD_WEBHOOK_URL") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

interface VerifyRequest {
  planId: string;
  productId: string;
  jws: string | null;
  receipt: string | null;
  transactionId: string | null;
  userId: string;
}

interface DecodedTransaction {
  bundleId?: string;
  productId?: string;
  transactionId?: string;
  originalTransactionId?: string;
  purchaseDate?: number;
  expiresDate?: number;
  environment?: "Production" | "Sandbox";
  appAccountToken?: string;
  webOrderLineItemId?: string;
  type?: string;
  signedDate?: number;
}

function base64UrlDecode(str: string): string {
  const pad = str.length % 4;
  const padded = pad ? str + "=".repeat(4 - pad) : str;
  const b64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  return atob(b64);
}

function decodeJws(jws: string): DecodedTransaction | null {
  try {
    const parts = jws.split(".");
    if (parts.length !== 3) return null;
    const payload = base64UrlDecode(parts[1]);
    return JSON.parse(payload) as DecodedTransaction;
  } catch {
    return null;
  }
}

interface ValidationResult {
  valid: boolean;
  reason?: string;
  decoded?: DecodedTransaction;
}

function validateTransaction(
  decoded: DecodedTransaction | null,
  expectedProductId: string,
  expectedUserId: string,
): ValidationResult {
  if (!decoded) return { valid: false, reason: "JWS não decodificável" };
  if (decoded.bundleId !== EXPECTED_BUNDLE_ID) {
    return { valid: false, reason: `bundleId inválido: ${decoded.bundleId}` };
  }
  if (decoded.productId !== expectedProductId) {
    return { valid: false, reason: `productId não bate: ${decoded.productId} ≠ ${expectedProductId}` };
  }
  if (!PRODUCT_TO_PLAN[decoded.productId]) {
    return { valid: false, reason: `productId desconhecido: ${decoded.productId}` };
  }
  if (!decoded.transactionId) return { valid: false, reason: "transactionId ausente" };
  if (decoded.appAccountToken && decoded.appAccountToken !== expectedUserId) {
    return { valid: false, reason: "appAccountToken não bate com userId logado" };
  }
  return { valid: true, decoded };
}

async function notifyDiscord(
  fields: { user_email?: string; user_name?: string; planId: string; amount?: number; environment?: string; transactionId: string },
) {
  if (!DISCORD_WEBHOOK) return;
  try {
    const amountRS = fields.amount ? `R$ ${(fields.amount / 100).toFixed(2)}` : "—";
    await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: "🍎 Nova venda iOS (IAP)",
          color: 0x007aff,
          fields: [
            { name: "Cliente", value: fields.user_name || "—", inline: true },
            { name: "Email", value: fields.user_email || "—", inline: true },
            { name: "Plano", value: fields.planId, inline: true },
            { name: "Valor", value: amountRS, inline: true },
            { name: "Ambiente", value: fields.environment || "—", inline: true },
            { name: "Transaction", value: fields.transactionId.slice(0, 18), inline: true },
          ],
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
    const payload = (await req.json()) as VerifyRequest;
    const { planId, productId, jws, transactionId, userId } = payload;

    if (!userId) return jsonResponse({ success: false, error: "userId ausente" }, 400);
    if (!planId || !PLAN_DURATIONS[planId]) return jsonResponse({ success: false, error: "planId inválido" }, 400);
    if (!productId) return jsonResponse({ success: false, error: "productId ausente" }, 400);
    if (!jws && !transactionId) return jsonResponse({ success: false, error: "jws ou transactionId é obrigatório" }, 400);

    // ─── Assinatura da Apple ───────────────────────────────
    const signature = jws
      ? await verifyAppleJws<DecodedTransaction>(jws)
      : { ok: false as const, reason: "sem_jws", payload: undefined };
    // Forjado na cara: recusa sempre. O resto respeita a flag.
    const forjado = !signature.ok && NUNCA_VEM_DA_APPLE.has(signature.reason);
    // Com a trava ligada, só vale o que a Apple assinou.
    const decoded = signature.ok
      ? signature.payload
      : (ENFORCE_SIGNATURE || forjado ? null : (jws ? decodeJws(jws) : null));
    console.log(JSON.stringify({
      tag: "iap_check",
      enforce: ENFORCE_SIGNATURE,
      plan: planId,
      has_jws: !!jws,
      has_receipt: !!payload.receipt,
      sig_ok: signature.ok,
      reason: signature.ok ? undefined : signature.reason,
      // recusa de compra REAL apareceria aqui: motivo sem ser de forjado.
      environment: signature.payload?.environment,
      has_token: !!signature.payload?.appAccountToken,
      token_match: signature.payload?.appAccountToken ? signature.payload.appAccountToken === userId : null,
      product_match: signature.payload ? signature.payload.productId === productId : null,
      forjado,
    }));
    if (forjado || (ENFORCE_SIGNATURE && !signature.ok)) {
      return jsonResponse({ success: false, error: "Compra não confirmada pela Apple" }, 400);
    }

    const validation = validateTransaction(decoded, productId, userId);

    if (!validation.valid && decoded) {
      console.warn("[apple-iap-verify] validation failed:", validation.reason, decoded);
      return jsonResponse({
        success: false,
        error: `Validação falhou: ${validation.reason}`,
      }, 400);
    }

    const finalTxId = validation.decoded?.transactionId || transactionId || "";
    const originalTxId = validation.decoded?.originalTransactionId || finalTxId;
    const environment = validation.decoded?.environment || "Production";
    const expiresFromApple = validation.decoded?.expiresDate
      ? new Date(validation.decoded.expiresDate)
      : null;

    if (!finalTxId) return jsonResponse({ success: false, error: "transactionId não recuperado" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const orderNsu = `apple_iap_${userId}_${planId}_${originalTxId}`;
    {
      const { data: existing } = await supabase
        .from("gdrums_transactions")
        .select("id, status, event_id")
        .eq("order_nsu", orderNsu)
        .maybeSingle();

      if (existing?.status === "confirmed") {
        return jsonResponse({
          success: true,
          idempotent: true,
          event_id: existing.event_id,
        });
      }
    }

    const durationMonths = PLAN_DURATIONS[planId];
    const expiresAt = expiresFromApple || (() => {
      const d = new Date();
      d.setMonth(d.getMonth() + durationMonths);
      return d;
    })();

    if (expiresAt.getTime() < Date.now()) {
      return jsonResponse({
        success: false,
        error: "Assinatura já expirada — use Restore Purchases ou compre de novo",
      }, 400);
    }

    try {
      await supabase.from("gdrums_profiles").update({
        subscription_status: "active",
        subscription_plan: planId,
        subscription_expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", userId);
    } catch (e) {
      console.error("[apple-iap-verify] profile update falhou:", e);
    }

    const planPriceCents = PLAN_PRICES_CENTS[planId] || 0;
    const eventId = crypto.randomUUID();

    const txData = {
      user_id: userId,
      order_nsu: orderNsu,
      transaction_nsu: finalTxId,
      plan: planId,
      amount_cents: planPriceCents,
      original_amount_cents: planPriceCents,
      status: "confirmed",
      payment_method: environment === "Sandbox" ? "apple_iap_sandbox" : "apple_iap",
      receipt_url: null,
      event_id: eventId,
    };

    try {
      const { data: existingTx } = await supabase
        .from("gdrums_transactions")
        .select("id")
        .eq("order_nsu", orderNsu)
        .maybeSingle();

      if (existingTx) {
        await supabase.from("gdrums_transactions")
          .update(txData)
          .eq("order_nsu", orderNsu);
      } else {
        await supabase.from("gdrums_transactions").insert(txData);
      }
    } catch (e) {
      console.error("[apple-iap-verify] transaction insert falhou:", e);
    }

    // Nome e e-mail só pro aviso interno no Discord.
    let userEmail = "";
    let userName = "";
    try {
      const { data: profile } = await supabase
        .from("gdrums_profiles")
        .select("name")
        .eq("id", userId)
        .maybeSingle();
      userName = profile?.name || "";
      const { data: userData } = await supabase.auth.admin.getUserById(userId);
      userEmail = userData?.user?.email || "";
    } catch { /* ok */ }

    try {
      await notifyDiscord({
        user_email: userEmail,
        user_name: userName,
        planId,
        amount: planPriceCents,
        environment,
        transactionId: finalTxId,
      });
    } catch { /* best-effort */ }

    return jsonResponse({ success: true, event_id: eventId });
  } catch (e) {
    console.error("[apple-iap-verify] error:", e);
    return jsonResponse({ success: false, error: String(e) }, 500);
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
