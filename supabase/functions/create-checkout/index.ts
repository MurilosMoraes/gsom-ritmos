import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const INFINITEPAY_HANDLE = "checkout-gdrums";
// Migrado em 2026-06-02: URL antiga (api.infinitepay.io/invoices/public/
// checkout) foi desativada em 01/06. Payload e webhooks continuam iguais.
const INFINITEPAY_API = "https://api.checkout.infinitepay.io";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://qsfziivubwdgtmwyztfw.supabase.co";
// v17: saiu do código. A service_role é acesso total ao banco e estava em
// texto puro aqui. O Supabase injeta essa variável sozinho nas edge functions.
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const PLAN_PRICES: Record<string, number> = {
  "passe-3-dias": 990,
  mensal: 2900,
  trimestral: 8100,
  semestral: 14400,
  anual: 22800,
  "rei-dos-palcos": 52200,
};

const PLAN_MONTHS: Record<string, number> = {
  mensal: 1,
  trimestral: 3,
  semestral: 6,
  anual: 12,
  "rei-dos-palcos": 36,
};

// Hierarquia de planos: índice maior = plano "superior".
// Crédito proporcional só vale quando o NOVO plano é mais alto que o atual
// (upgrade real). Renovação do mesmo plano ou downgrade = preço cheio.
// passe-3-dias NÃO entra: é plano avulso curto, nunca é destino de upgrade.
const PLAN_ORDER = ["mensal", "trimestral", "semestral", "anual", "rei-dos-palcos"];

// Planos de COMPRA ÚNICA por pessoa (1x por CPF, pra sempre).
// Passe 3 Dias virou assinatura barata infinita: 18 contas recompraram
// (uma delas 5 vezes), trocando o mensal de R$29 por R$9,90 repetidos.
// Isso corroía a conversão pro mensal, que é o plano que sustenta o negócio.
const PLANOS_COMPRA_UNICA = new Set(["passe-3-dias"]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

/**
 * Já usou um plano de compra única?
 *
 * Checa por CPF, não só por conta: o CPF é o que identifica a PESSOA. Se
 * alguém criar outra conta (mesmo CPF), continua bloqueado. Cai pra conta
 * quando o perfil não tem cpf_hash (contas antigas, pré-obrigatoriedade).
 *
 * Em caso de erro de leitura retorna `true` (bloqueia). É de propósito:
 * preferimos recusar uma venda de R$9,90 a liberar recompra indevida por
 * causa de um glitch de banco.
 */
async function jaUsouPlanoUnico(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  planId: string,
): Promise<{ usou: boolean; motivo: string }> {
  try {
    // 1) Descobre o CPF da conta que está comprando
    const { data: perfil } = await supabase
      .from("gdrums_profiles")
      .select("cpf_hash")
      .eq("id", userId)
      .single();

    // 2) Todas as contas dessa MESMA pessoa (mesmo cpf_hash)
    let idsDaPessoa: string[] = [userId];
    if (perfil?.cpf_hash) {
      const { data: irmas } = await supabase
        .from("gdrums_profiles")
        .select("id")
        .eq("cpf_hash", perfil.cpf_hash);
      if (irmas && irmas.length > 0) {
        idsDaPessoa = irmas.map((p: { id: string }) => p.id);
      }
    }

    // 3) Alguma delas já pagou esse plano?
    const { data: compras, error } = await supabase
      .from("gdrums_transactions")
      .select("id")
      .in("user_id", idsDaPessoa)
      .eq("plan", planId)
      .eq("status", "confirmed")
      .limit(1);

    if (error) return { usou: true, motivo: "erro ao verificar histórico" };
    return {
      usou: !!(compras && compras.length > 0),
      motivo: perfil?.cpf_hash ? "por CPF" : "por conta (perfil sem CPF)",
    };
  } catch (_e) {
    return { usou: true, motivo: "exceção ao verificar histórico" };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { items, order_nsu, redirect_url, customer } = await req.json();

    if (!items || !order_nsu || !redirect_url) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parts = order_nsu.split("_");
    let couponCode: string | null = null;
    let planId: string;
    let userId: string;
    const lastPart = parts[parts.length - 1];

    if (lastPart && !/^\d+$/.test(lastPart)) {
      couponCode = lastPart;
      planId = parts[parts.length - 3];
      userId = parts.slice(0, parts.length - 3).join("_");
    } else {
      planId = parts[parts.length - 2];
      userId = parts.slice(0, parts.length - 2).join("_");
    }

    const officialPrice = PLAN_PRICES[planId];
    if (!officialPrice) {
      return new Response(JSON.stringify({ error: "Invalid plan" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // ─── Plano de compra única (Passe 3 Dias) ─────────────────────
    // Barra ANTES de gerar o link de pagamento: o cara nem chega a pagar,
    // então não existe cobrança pra estornar depois. O front já esconde o
    // plano de quem usou, mas esta é a trava que vale — front dá pra burlar.
    if (PLANOS_COMPRA_UNICA.has(planId) && userId) {
      const { usou, motivo } = await jaUsouPlanoUnico(supabase, userId, planId);
      if (usou) {
        console.warn(`[create-checkout] passe único recusado (${motivo}) user=${userId} plano=${planId}`);
        return new Response(JSON.stringify({
          error: "plan_already_used",
          message: "O Modo Show 3 Dias é uma experiência única, e você já aproveitou a sua. Escolha um dos planos mensais ou maiores para continuar tocando com o GDrums.",
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Se não tem cupom no order_nsu, verificar na transação pendente
    if (!couponCode) {
      const { data: pendingTx } = await supabase
        .from("gdrums_transactions")
        .select("coupon_code, discount_percent")
        .eq("order_nsu", order_nsu)
        .single();

      if (pendingTx?.coupon_code) {
        couponCode = pendingTx.coupon_code;
      }
    }

    // Calcular preço com desconto do cupom
    let finalPrice = officialPrice;
    if (couponCode) {
      const { data: coupon } = await supabase
        .from("gdrums_coupons")
        .select("discount_percent, active, max_uses, current_uses, valid_from, valid_until, planos, uma_por_conta")
        .eq("code", couponCode)
        .eq("active", true)
        .single();

      if (coupon) {
        const now = new Date();
        const validFrom = new Date(coupon.valid_from);
        const validUntil = new Date(coupon.valid_until);
        const notExpired = now >= validFrom && now <= validUntil;
        const hasUses = coupon.current_uses < coupon.max_uses;

        // --- Regras por cupom (v18) -------------------------------
        // Restricao de plano: lista vazia = vale em todos (como sempre foi).
        const planos: string[] = Array.isArray(coupon.planos) ? coupon.planos : [];
        const planoOk = planos.length === 0 || planos.includes(planId);
        if (!planoOk) {
          return new Response(JSON.stringify({
            error: "coupon_wrong_plan",
            message: `O cupom ${couponCode} não vale para este plano. Escolha outro plano ou remova o cupom.`,
          }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // Uso unico por conta: checado pela transacao CONFIRMADA, nao pelo
        // contador global (que e por cupom, nao por pessoa).
        if (coupon.uma_por_conta && userId) {
          const { data: jaUsou } = await supabase
            .from("gdrums_transactions")
            .select("id")
            .eq("user_id", userId)
            .eq("coupon_code", couponCode)
            .eq("status", "confirmed")
            .limit(1);
          if (jaUsou && jaUsou.length > 0) {
            return new Response(JSON.stringify({
              error: "coupon_already_used",
              message: `Você já usou o cupom ${couponCode}. Ele vale uma vez por conta.`,
            }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
        }

        if (notExpired && hasUses) {
          finalPrice = Math.round(officialPrice * (1 - coupon.discount_percent / 100));
        }
      }
    }

    // ─── Crédito proporcional — SOMENTE em UPGRADE real ──────────
    let upgradeCredit = 0;
    if (userId) {
      const { data: profile } = await supabase
        .from("gdrums_profiles")
        .select("subscription_status, subscription_plan, subscription_expires_at")
        .eq("id", userId)
        .single();

      if (
        profile?.subscription_status === "active" &&
        profile?.subscription_plan &&
        profile?.subscription_expires_at
      ) {
        const currentIdx = PLAN_ORDER.indexOf(profile.subscription_plan);
        const newIdx = PLAN_ORDER.indexOf(planId);
        const isRealUpgrade = currentIdx !== -1 && newIdx !== -1 && newIdx > currentIdx;

        if (isRealUpgrade) {
          const currentPlanPrice = PLAN_PRICES[profile.subscription_plan];
          const currentPlanMonths = PLAN_MONTHS[profile.subscription_plan];

          if (currentPlanPrice && currentPlanMonths) {
            const expiresAt = new Date(profile.subscription_expires_at);
            const now = new Date();
            const daysLeft = Math.max(
              0,
              Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
            );
            const totalDays = currentPlanMonths * 30;

            if (daysLeft > 0 && totalDays > 0) {
              upgradeCredit = Math.round(currentPlanPrice * (daysLeft / totalDays));
            }
          }
        }
      }
    }

    // Aplicar crédito (só será > 0 em upgrade real)
    finalPrice = Math.max(0, finalPrice - upgradeCredit);

    // Validar preço (com margem de 1 real pra arredondamento)
    const requestedPrice = items[0]?.price || 0;
    if (requestedPrice < finalPrice - 100) {
      return new Response(JSON.stringify({ error: "Invalid price" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Usar o preço calculado pelo backend
    const validatedItems = [{ quantity: 1, price: finalPrice, description: items[0]?.description || planId }];

    const webhookUrl = `${SUPABASE_URL}/functions/v1/payment-webhook`;

    const body: Record<string, any> = {
      handle: INFINITEPAY_HANDLE,
      order_nsu,
      items: validatedItems,
      redirect_url,
      webhook_url: webhookUrl,
    };

    if (customer) body.customer = customer;

    const response = await fetch(`${INFINITEPAY_API}/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return new Response(JSON.stringify({ error: "InfinitePay error", detail: data }), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ url: data.url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
