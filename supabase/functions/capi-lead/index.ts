// capi-lead — Meta Conversions API (server-side) pro evento Lead.
//
// Espelha o pixel do browser (dedup via event_id) pra recuperar
// conversões que o pixel client perde (adblock, ITP, iOS). Disparado
// pelo trackLead() no submit do /register.
//
// Adaptado do snippet Node.js do Adriano pra Deno (Supabase Edge).
//
// Secrets: META_CAPI_TOKEN (token da Conversions API, NÃO commitar).
// PIXEL_ID é público (já vai no <head>), pode ser hardcoded/env.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const PIXEL_ID = Deno.env.get("META_PIXEL_ID") || "796553853446469";
const CAPI_TOKEN = Deno.env.get("META_CAPI_TOKEN") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    if (!CAPI_TOKEN) {
      // Não derrubar o cadastro por causa de tracking — só loga e sai OK.
      console.warn("[capi-lead] META_CAPI_TOKEN não configurado");
      return new Response(JSON.stringify({ ok: false, error: "CAPI not configured" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { event_id, source_url, fbp, fbc, email, phone } = body as {
      event_id?: string;
      source_url?: string;
      fbp?: string;
      fbc?: string;
      email?: string;
      phone?: string;
    };

    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
    const ua = req.headers.get("user-agent") || "";

    const userData: Record<string, string> = {};
    if (ip) userData.client_ip_address = ip;
    if (ua) userData.client_user_agent = ua;
    if (fbp) userData.fbp = fbp;
    if (fbc) userData.fbc = fbc;
    if (email) userData.em = await sha256Hex(email.trim().toLowerCase());
    if (phone) userData.ph = await sha256Hex(phone.replace(/\D/g, ""));

    const payload = {
      data: [{
        event_name: "Lead",
        event_time: Math.floor(Date.now() / 1000),
        event_id: event_id || crypto.randomUUID(),
        event_source_url: source_url || "https://gdrums.com.br/register",
        action_source: "website",
        user_data: userData,
      }],
    };

    const res = await fetch(
      `https://graph.facebook.com/v21.0/${PIXEL_ID}/events?access_token=${CAPI_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const capi = await res.json().catch(() => ({}));

    return new Response(JSON.stringify({ ok: res.ok, event_id: payload.data[0].event_id, capi }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    // Tracking nunca pode quebrar o fluxo de cadastro
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
