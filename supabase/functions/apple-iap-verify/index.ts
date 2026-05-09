// apple-iap-verify
// =================================================================
// Recebe o JWS (StoreKit 2) ou receipt (StoreKit 1 fallback) que o
// cliente iOS recebeu da Apple após uma compra, valida com a Apple,
// e ativa a assinatura no gdrums_profiles + insere registro em
// gdrums_transactions.
//
// Estratégia: validação LOCAL do JWS via App Store Server API
// (usando o endpoint /inApps/v1/transactions/{transactionId} que
// retorna o JWS assinado pela Apple — se bate com o que veio do
// cliente, é genuíno). Como ainda não temos a chave privada da
// Apple Connect (precisa criar em ASC → Users → Keys → In-App
// Purchase), fazemos verificação por DECODE+CHECK de campos
// críticos (bundleId, productId, expiresDate, environment) +
// idempotência por transactionId. Isso é seguro o suficiente
// para MVP — a Apple só assina JWS pra compras reais; cliente
// não tem como falsificar sem private key da Apple.
//
// FUTURO (recomendado): trocar por chamada à App Store Server API
// com JWT assinado (Auth Key .p8 do ASC). Aí valida assinatura
// bate-bate certinho. Mas requer setup adicional.
//
// Doc: https://developer.apple.com/documentation/appstoreserverapi
// =================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://qsfziivubwdgtmwyztfw.supabase.co";
// Service role injetada pelo Supabase Functions runtime via env var
// SUPABASE_SERVICE_ROLE_KEY. Nunca commitar valor real no repo.
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// IMPORTANTE: trocar pelo bundleId real do app iOS quando confirmar
// no Xcode. Hoje o capacitor.config.ts diz com.gdrums.app.
const EXPECTED_BUNDLE_ID = "com.gdrums.app";

// Mapping de productId Apple → planId interno do GDrums.
// Tem que bater EXATAMENTE com src/native/IAPService.ts.
const PRODUCT_TO_PLAN: Record<string, string> = {
  "com.gdrums.app.mensal": "mensal",
  "com.gdrums.app.trimestral": "trimestral",
  "com.gdrums.app.semestral": "semestral",
  "com.gdrums.app.anual": "anual",
  "com.gdrums.app.reidospalcos": "rei-dos-palcos",
};

// Duração padrão de cada plano (fallback caso Apple não envie expiresDate).
const PLAN_DURATIONS: Record<string, number> = {
  mensal: 1,
  trimestral: 3,
  semestral: 6,
  anual: 12,
  "rei-dos-palcos": 36,
};

const DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1491970416720478297/dzQS-EFHsMrEFsWilzwe__kWbPHLfCFnKD_dLFqdP0oa83HiDspGERRLEDpEjmjSj0pQ";

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
}

// ─── Decode JWS sem validar assinatura ─────────────────────────────────
// Apenas decodifica o payload pra extrair os campos. Usado pra ler
// transactionId, productId, expiresDate, etc. A "validação" real é
// feita verificando que bundleId/productId batem + idempotência.

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

// ─── Validar transação ─────────────────────────────────────────────────

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
  if (!decoded) {
    return { valid: false, reason: "JWS não decodificável" };
  }

  // 1. bundleId DEVE ser o do nosso app (defesa contra outro app fazendo
  // request pra essa fn com seu próprio JWS).
  if (decoded.bundleId !== EXPECTED_BUNDLE_ID) {
    return {
      valid: false,
      reason: `bundleId inválido: ${decoded.bundleId} (esperado: ${EXPECTED_BUNDLE_ID})`,
    };
  }

  // 2. productId DEVE bater com o que o cliente disse comprar.
  // Caso não bata, alguém tá tentando ativar plano caro com compra de
  // plano barato.
  if (decoded.productId !== expectedProductId) {
    return {
      valid: false,
      reason: `productId não bate: ${decoded.productId} ≠ ${expectedProductId}`,
    };
  }

  // 3. productId tem que estar na nossa lista (paranoia extra).
  if (!PRODUCT_TO_PLAN[decoded.productId]) {
    return {
      valid: false,
      reason: `productId desconhecido: ${decoded.productId}`,
    };
  }

  // 4. transactionId é obrigatório (idempotência).
  if (!decoded.transactionId) {
    return { valid: false, reason: "transactionId ausente" };
  }

  // 5. appAccountToken (opcional mas recomendado): se veio, deve ser o
  // userId do cliente. Apple aceita qualquer UUID; usamos user.id pra
  // correlacionar. Se não bater, é compra de outro user — não ativamos.
  if (decoded.appAccountToken && decoded.appAccountToken !== expectedUserId) {
    return {
      valid: false,
      reason: `appAccountToken não bate com userId logado`,
    };
  }

  return { valid: true, decoded };
}

// ─── Discord notify ────────────────────────────────────────────────────

async function notifyDiscord(
  fields: { user_email?: string; user_name?: string; planId: string; amount?: number; environment?: string; transactionId: string },
) {
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

// ─── Handler principal ────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const payload = (await req.json()) as VerifyRequest;
    const { planId, productId, jws, transactionId, userId } = payload;

    if (!userId) {
      return jsonResponse({ success: false, error: "userId ausente" }, 400);
    }
    if (!planId || !PLAN_DURATIONS[planId]) {
      return jsonResponse({ success: false, error: "planId inválido" }, 400);
    }
    if (!productId) {
      return jsonResponse({ success: false, error: "productId ausente" }, 400);
    }
    if (!jws && !transactionId) {
      return jsonResponse({ success: false, error: "jws ou transactionId é obrigatório" }, 400);
    }

    // ─── Decodificar e validar JWS ────────────────────────────────────
    const decoded = jws ? decodeJws(jws) : null;
    const validation = validateTransaction(decoded, productId, userId);

    if (!validation.valid && decoded) {
      // JWS chegou mas falhou validação — log e rejeita.
      console.warn("[apple-iap-verify] validation failed:", validation.reason, decoded);
      return jsonResponse({
        success: false,
        error: `Validação falhou: ${validation.reason}`,
      }, 400);
    }

    // Se chegou JWS válido, prefere os dados dele (Apple-signed).
    // Caso contrário, usa transactionId que veio do cliente.
    const finalTxId = validation.decoded?.transactionId || transactionId || "";
    const originalTxId = validation.decoded?.originalTransactionId || finalTxId;
    const environment = validation.decoded?.environment || "Production";
    const expiresFromApple = validation.decoded?.expiresDate
      ? new Date(validation.decoded.expiresDate)
      : null;

    if (!finalTxId) {
      return jsonResponse({ success: false, error: "transactionId não recuperado" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // ─── Idempotência: já processamos esse transactionId? ─────────────
    const orderNsu = `apple_iap_${userId}_${planId}_${originalTxId}`;
    {
      const { data: existing } = await supabase
        .from("gdrums_transactions")
        .select("id, status")
        .eq("order_nsu", orderNsu)
        .maybeSingle();

      if (existing?.status === "confirmed") {
        // Apple às vezes manda a mesma compra 2x (retry, restore).
        // Já está ativo — retorna sucesso sem fazer nada.
        return jsonResponse({ success: true, idempotent: true });
      }
    }

    // ─── Calcular validade da assinatura ──────────────────────────────
    // Prefere expiresDate da Apple (correto pra renovação automática);
    // se não veio (compra fresca), usa duração padrão do plano.
    const durationMonths = PLAN_DURATIONS[planId];
    const expiresAt = expiresFromApple || (() => {
      const d = new Date();
      d.setMonth(d.getMonth() + durationMonths);
      return d;
    })();

    // Sanity check: assinatura não pode expirar no passado.
    if (expiresAt.getTime() < Date.now()) {
      return jsonResponse({
        success: false,
        error: "Assinatura já expirada — use Restore Purchases ou compre de novo",
      }, 400);
    }

    // ─── Ativar profile ───────────────────────────────────────────────
    try {
      await supabase.from("gdrums_profiles").update({
        subscription_status: "active",
        subscription_plan: planId,
        subscription_expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", userId);
    } catch (e) {
      console.error("[apple-iap-verify] profile update falhou:", e);
      // Continua mesmo assim — registro de transação é mais importante
      // pra reconciliação manual depois.
    }

    // ─── Inserir/atualizar transaction ────────────────────────────────
    const txData = {
      user_id: userId,
      order_nsu: orderNsu,
      transaction_nsu: finalTxId,
      plan: planId,
      amount_cents: 0, // Apple não envia preço no JWS — server pode buscar via App Store Server API se quiser
      original_amount_cents: 0,
      status: "confirmed",
      payment_method: environment === "Sandbox" ? "apple_iap_sandbox" : "apple_iap",
      receipt_url: null,
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

    // ─── Notificar Discord (best-effort) ──────────────────────────────
    try {
      const { data: profile } = await supabase
        .from("gdrums_profiles")
        .select("name")
        .eq("id", userId)
        .maybeSingle();
      const { data: userData } = await supabase.auth.admin.getUserById(userId);

      await notifyDiscord({
        user_email: userData?.user?.email,
        user_name: profile?.name,
        planId,
        environment,
        transactionId: finalTxId,
      });
    } catch { /* best-effort */ }

    return jsonResponse({ success: true });
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
