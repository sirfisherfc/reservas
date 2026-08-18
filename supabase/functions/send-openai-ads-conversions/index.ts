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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!(await isAuthorized(req))) return json({ error: "unauthorized" }, 401);

  if (!PIXEL_ID || !CONVERSIONS_API_KEY) {
    return json({ configured: false, processed: 0, sent: 0, failed: 0 });
  }

  const { data: claimed, error: claimError } = await admin.rpc("fn_claim_pending_openai_ads_conversions", {
    p_limit: 25,
  });
  if (claimError) return json({ error: `claim: ${claimError.message}` }, 500);

  let sent = 0;
  let failed = 0;
  for (const row of (claimed ?? []) as Array<{ queue_id: string; event_id: string; oppref: string; occurred_at: string }>) {
    try {
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

  return json({ configured: true, processed: (claimed ?? []).length, sent, failed });
});
