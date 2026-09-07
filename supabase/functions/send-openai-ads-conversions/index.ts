// Edge Function: send-openai-ads-conversions
// -----------------------------------------------------------------------------
// Sends durable "visit_realized" events after a reservation is marked as
// attended. It accepts an authenticated staff request from the admin panel or
// OPENAI_ADS_TRIGGER_SECRET from a Database Webhook / scheduled retry.
//
// Required Supabase secrets:
//   OPENAI_ADS_PIXEL_ID
//   OPENAI_ADS_CONVERSIONS_API_KEY
//   OPENAI_ADS_TRIGGER_SECRET (for webhook or cron retries)
// -----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PIXEL_ID = Deno.env.get("OPENAI_ADS_PIXEL_ID") ?? "";
const CONVERSIONS_API_KEY = Deno.env.get("OPENAI_ADS_CONVERSIONS_API_KEY") ?? "";
const TRIGGER_SECRET = Deno.env.get("OPENAI_ADS_TRIGGER_SECRET") ?? "";
const GA4_MEASUREMENT_ID = Deno.env.get("GA4_MEASUREMENT_ID") ?? "";
const GA4_API_SECRET = Deno.env.get("GA4_API_SECRET") ?? "";
const META_PIXEL_ID = Deno.env.get("META_PIXEL_ID") ?? "";
const META_CAPI_TOKEN = Deno.env.get("META_CAPI_TOKEN") ?? "";

// Mesma constante do front (assets/js/attribution.js): ticket de R$ 76,00
// dividido por 1,3 pessoas por pagamento. Ordem de grandeza para comparar
// canais por receita, nao faturamento apurado.
const REVENUE_PER_GUEST_BRL = 58;

// A Measurement Protocol descarta eventos com mais de 72h. Quando o
// comparecimento e marcado depois disso, e melhor mandar sem timestamp (o GA4
// usa a hora da ingestao) do que perder o evento.
const MP_MAX_AGE_MS = 72 * 60 * 60 * 1000;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-openai-ads-secret",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function isAuthorized(req: Request): Promise<boolean> {
  if (TRIGGER_SECRET && req.headers.get("x-openai-ads-secret") === TRIGGER_SECRET) {
    return true;
  }

  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return false;

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return false;

  const { data: staff, error: staffError } = await admin
    .from("app_users")
    .select("id")
    .eq("auth_user_id", userData.user.id)
    .eq("active", true)
    .maybeSingle();

  return !staffError && Boolean(staff);
}

async function finalize(id: string, status: "sent" | "failed", error: string | null = null) {
  const { error: finalizeError } = await admin.rpc("fn_finalize_openai_ads_conversion", {
    p_id: id,
    p_status: status,
    p_error: error,
  });
  if (finalizeError) throw new Error(`Could not finalize conversion: ${finalizeError.message}`);
}

type QueueResult = { configured: boolean; processed: number; sent: number; failed: number; error?: string };

const IDLE: QueueResult = { configured: false, processed: 0, sent: 0, failed: 0 };

// Percorre uma fila reivindicada, aplicando `send` a cada linha e marcando o
// resultado. Os dois provedores compartilham este laco; so muda o envio.
async function drain<T extends { queue_id: string }>(
  rows: T[],
  send: (row: T) => Promise<void>,
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await send(row);
      await finalize(row.queue_id, "sent");
      sent++;
    } catch (error) {
      const message = String(error).slice(0, 2000);
      try {
        await finalize(row.queue_id, "failed", message);
      } catch (finalizeError) {
        console.error(finalizeError);
      }
      failed++;
    }
  }
  return { sent, failed };
}

async function processOpenAiQueue(): Promise<QueueResult> {
  if (!PIXEL_ID || !CONVERSIONS_API_KEY) return IDLE;

  const { data, error } = await admin.rpc("fn_claim_pending_openai_ads_conversions", { p_limit: 25 });
  if (error) return { ...IDLE, configured: true, error: `claim: ${error.message}` };

  const rows = (data ?? []) as Array<
    { queue_id: string; event_id: string; oppref: string; occurred_at: string }
  >;

  const { sent, failed } = await drain(rows, async (row) => {
    const timestampMs = Date.parse(row.occurred_at);
    if (!Number.isFinite(timestampMs) || timestampMs < Date.now() - 7 * 24 * 60 * 60 * 1000) {
      throw new Error("event timestamp is older than the Conversions API 7-day limit");
    }

    const response = await fetch(`https://bzr.openai.com/v1/events?pid=${encodeURIComponent(PIXEL_ID)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CONVERSIONS_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        events: [{
          id: row.event_id,
          type: "custom",
          custom_event_name: "visit_realized",
          timestamp_ms: timestampMs,
          oppref: row.oppref,
          action_source: "physical_store",
          data: { type: "custom" },
        }],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI ${response.status}: ${body.slice(0, 1200)}`);
    }
  });

  return { configured: true, processed: rows.length, sent, failed };
}

async function processGa4Queue(): Promise<QueueResult> {
  if (!GA4_MEASUREMENT_ID || !GA4_API_SECRET) return IDLE;

  const { data, error } = await admin.rpc("fn_claim_pending_ga4_conversions", { p_limit: 25 });
  if (error) return { ...IDLE, configured: true, error: `claim: ${error.message}` };

  const rows = (data ?? []) as Array<{
    queue_id: string;
    event_id: string;
    client_id: string;
    session_id: string | null;
    party_size: number | null;
    occurred_at: string;
  }>;

  const endpoint = "https://www.google-analytics.com/mp/collect"
    + `?measurement_id=${encodeURIComponent(GA4_MEASUREMENT_ID)}`
    + `&api_secret=${encodeURIComponent(GA4_API_SECRET)}`;

  const { sent, failed } = await drain(rows, async (row) => {
    if (!row.client_id) throw new Error("reservation has no ga_client_id");

    const guests = Number(row.party_size) || 0;
    const params: Record<string, unknown> = {
      // Sem engagement_time_msec o GA4 aceita o evento mas nao o conta como
      // interacao, e ele nao aparece nos relatorios de conversao.
      engagement_time_msec: 1,
      value: guests * REVENUE_PER_GUEST_BRL,
      currency: "BRL",
      party_size: guests,
    };
    // Amarra o comparecimento a mesma sessao que originou a reserva, para que a
    // conversao seja creditada ao canal certo e nao a "direct".
    if (row.session_id) params.session_id = row.session_id;

    const timestampMs = Date.parse(row.occurred_at);
    const body: Record<string, unknown> = {
      client_id: row.client_id,
      non_personalized_ads: false,
      events: [{ name: "visit_realized", params }],
    };
    if (Number.isFinite(timestampMs) && timestampMs > Date.now() - MP_MAX_AGE_MS) {
      body.timestamp_micros = timestampMs * 1000;
    }

    const response = await fetch(endpoint, { method: "POST", body: JSON.stringify(body) });

    // A Measurement Protocol responde 204 sem corpo e nao valida o payload:
    // um 2xx significa "aceito", nao "correto". A validacao real e feita no
    // endpoint /debug/mp/collect, usado so em teste.
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GA4 ${response.status}: ${text.slice(0, 1200)}`);
    }
  });

  return { configured: true, processed: rows.length, sent, failed };
}

// ---------------------------------------------------------------------------
// Meta Conversions API
// ---------------------------------------------------------------------------
// O Meta exige que identificadores de pessoa cheguem em SHA-256. O dado bruto
// nunca sai deste servidor: e lido do banco, normalizado e transformado em hash
// aqui dentro.
async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normalizeEmail(raw: string | null): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  return v.includes("@") ? v : null;
}

// O Meta espera so digitos, com codigo do pais. Os telefones daqui vem como
// 11 digitos (DDD + numero) ou 10 nos fixos antigos; nesses casos falta o 55.
function normalizePhone(raw: string | null): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return d.length >= 12 && d.length <= 15 ? d : null;
}

async function processMetaQueue(): Promise<QueueResult> {
  if (!META_PIXEL_ID || !META_CAPI_TOKEN) return IDLE;

  const { data, error } = await admin.rpc("fn_claim_pending_meta_conversions", { p_limit: 25 });
  if (error) return { ...IDLE, configured: true, error: `claim: ${error.message}` };

  const rows = (data ?? []) as Array<{
    queue_id: string;
    event_id: string;
    email: string | null;
    phone: string | null;
    fbp: string | null;
    fbc: string | null;
    party_size: number | null;
    landing_url: string | null;
    occurred_at: string;
  }>;

  const endpoint = `https://graph.facebook.com/v21.0/${encodeURIComponent(META_PIXEL_ID)}/events`
    + `?access_token=${encodeURIComponent(META_CAPI_TOKEN)}`;

  const { sent, failed } = await drain(rows, async (row) => {
    const userData: Record<string, unknown> = {};
    const email = normalizeEmail(row.email);
    const phone = normalizePhone(row.phone);
    if (email) userData.em = [await sha256Hex(email)];
    if (phone) userData.ph = [await sha256Hex(phone)];
    if (row.fbp) userData.fbp = row.fbp;
    if (row.fbc) userData.fbc = row.fbc;

    // Sem nenhum identificador o Meta devolve 2804050 e a linha ficaria em
    // retry eterno. Falhar cedo, com mensagem clara, e melhor.
    if (Object.keys(userData).length === 0) {
      throw new Error("reservation has no usable Meta identifier (email, phone, fbp or fbc)");
    }

    // A CAPI descarta eventos com mais de 7 dias.
    const occurredMs = Date.parse(row.occurred_at);
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const eventTimeMs = Number.isFinite(occurredMs) && occurredMs > sevenDaysAgo ? occurredMs : Date.now();

    const guests = Number(row.party_size) || 0;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [{
          event_name: "Schedule",
          event_time: Math.floor(eventTimeMs / 1000),
          // Mesmo id enviado pelo Pixel no navegador. E o que evita contar a
          // reserva duas vezes.
          event_id: row.event_id,
          action_source: "website",
          event_source_url: row.landing_url ?? "https://reservas.sirfisher.com.br/",
          user_data: userData,
          custom_data: { value: guests * REVENUE_PER_GUEST_BRL, currency: "BRL", num_guests: guests },
        }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Meta ${response.status}: ${text.slice(0, 1200)}`);
    }
  });

  return { configured: true, processed: rows.length, sent, failed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!(await isAuthorized(req))) return json({ error: "unauthorized" }, 401);

  const openaiAds = await processOpenAiQueue();
  const ga4 = await processGa4Queue();
  const meta = await processMetaQueue();

  // O painel admin le `configured` e `failed` do nivel raiz, entao eles seguem
  // como totais somados. O detalhe por provedor vai em `providers`.
  return json({
    configured: openaiAds.configured || ga4.configured || meta.configured,
    processed: openaiAds.processed + ga4.processed + meta.processed,
    sent: openaiAds.sent + ga4.sent + meta.sent,
    failed: openaiAds.failed + ga4.failed + meta.failed,
    providers: { openai_ads: openaiAds, ga4, meta },
  });
});
