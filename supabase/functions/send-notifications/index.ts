// Edge Function: send-notifications
// -----------------------------------------------------------------------------
// Lê a fila `notification_queue` (canal 'email', status 'pending'), envia cada
// confirmação de reserva pelo Resend e marca o registro como 'sent' ou 'failed'.
//
// É idempotente e processa em lote: pode ser chamada por um Database Webhook
// (envio imediato ao criar a reserva) e/ou por um cron de backup — as duas coisas
// convivem porque cada linha é "reivindicada" atomicamente (status 'processing')
// antes do envio, via RPC fn_claim_pending_notifications.
//
// Segurança: verify_jwt=false (ver config.toml), então a função exige o header
// `x-notify-secret` igual ao secret NOTIFY_SECRET. Sem isso, responde 401.
//
// Variáveis de ambiente (Supabase secrets):
//   RESEND_API_KEY   — chave do Resend (re_...)                       [obrigatório]
//   NOTIFY_SECRET    — segredo compartilhado com quem dispara a função [obrigatório]
//   RESEND_FROM      — remetente. Padrão: "Sir Fisher Praia <reservas@sirfisher.com.br>"
//   PUBLIC_SITE_URL  — URL pública do site (ex.: https://sirfisherfc.github.io/reservas)
//                      usada para montar o link de cancelamento. Se vazia, o e-mail
//                      sai sem o botão de cancelar.
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — injetados automaticamente.
// -----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const NOTIFY_SECRET = Deno.env.get("NOTIFY_SECRET") ?? "";
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "Sir Fisher Praia <reservas@sirfisher.com.br>";
const SITE_URL = (Deno.env.get("PUBLIC_SITE_URL") ?? "").replace(/\/+$/, "");

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const WEEKDAYS = [
  "domingo", "segunda-feira", "terça-feira", "quarta-feira",
  "quinta-feira", "sexta-feira", "sábado",
];
const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function formatDateBR(iso: string): string {
  // "2026-07-15" -> "quarta-feira, 15 de julho de 2026"
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return String(iso);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd}, ${d} de ${MONTHS[m - 1]} de ${y}`;
}

function formatTimeBR(t: string): string {
  // "19:00:00" -> "19h00"
  const [h, min] = String(t).split(":");
  return `${h}h${min ?? "00"}`;
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

interface Payload {
  type?: string;
  public_code?: string;
  name?: string;
  email?: string;
  date?: string;
  time?: string;
  party_size?: number;
  cancel_token?: string;
}

function buildEmailHtml(p: Payload): string {
  const isReminder = p.type === "reservation_reminder";
  const name = escapeHtml(p.name ?? "");
  const code = escapeHtml(p.public_code ?? "");
  const dateStr = escapeHtml(formatDateBR(p.date ?? ""));
  const timeStr = escapeHtml(formatTimeBR(p.time ?? ""));
  const people = Number(p.party_size ?? 0);

  const cancelUrl = SITE_URL && p.cancel_token
    ? `${SITE_URL}/cancelar.html?t=${encodeURIComponent(p.cancel_token)}`
    : "";

  const cancelBlock = cancelUrl
    ? `
      <tr><td style="padding:8px 32px 24px;">
        <a href="${cancelUrl}" style="display:inline-block;padding:12px 22px;border:1px solid #c0392b;border-radius:6px;color:#c0392b;text-decoration:none;font-size:14px;font-weight:600;">
          Cancelar reserva
        </a>
        <p style="margin:14px 0 0;color:#888;font-size:12px;line-height:1.5;">
          Se precisar cancelar, use o botão acima. A vaga é liberada na hora para outros clientes.
        </p>
      </td></tr>`
    : "";

  const reminderNotice = isReminder
    ? `<tr><td style="padding:28px 32px 0;">
        <p style="margin:0 0 14px;font-size:16px;line-height:1.6;">Lembrete: sua reserva é amanhã. Estamos ansiosos para receber você!</p>
      </td></tr>`
    : "";

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f2ee;font-family:Arial,Helvetica,sans-serif;color:#2b2b2b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06);">
        <tr><td align="center" style="background:#ffffff;padding:22px 32px 18px;">
          <img src="https://sirfisherfc.github.io/reservas/assets/img/logo-horizontal.png" alt="Sir Fisher Praia" width="210" style="display:block;width:210px;max-width:100%;height:auto;margin:0;border:0;outline:none;text-decoration:none;" />
        </td></tr>
        <tr><td style="background:#0f3d3e;padding:20px 32px;">
          <div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:.5px;">Sir Fisher Praia</div>
          <div style="color:#9fc6c2;font-size:13px;margin-top:2px;">Confirmação de reserva</div>
        </td></tr>
        ${reminderNotice}
        <tr><td style="padding:${isReminder ? "14px" : "28px"} 32px 8px;">
          <p style="margin:0 0 14px;font-size:16px;">Olá${name ? ", " + name : ""}! 👋</p>
          <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">
            Sua reserva está <strong style="color:#0f3d3e;">confirmada</strong>. Estamos ansiosos para receber você!
          </p>
        </td></tr>
        <tr><td style="padding:0 32px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f3;border-radius:8px;">
            <tr><td style="padding:16px 20px;font-size:14px;line-height:1.9;">
              <div><span style="color:#888;">Código:</span> <strong>${code}</strong></div>
              <div><span style="color:#888;">Data:</span> <strong>${dateStr}</strong></div>
              <div><span style="color:#888;">Horário:</span> <strong>${timeStr}</strong></div>
              <div><span style="color:#888;">Pessoas:</span> <strong>${people}</strong></div>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:20px 32px 4px;font-size:13px;color:#666;line-height:1.6;">
          Guarde o código da reserva. Em caso de imprevisto, avise-nos com antecedência.
        </td></tr>
        ${cancelBlock}
        <tr><td style="padding:18px 32px 28px;border-top:1px solid #eee;color:#999;font-size:12px;line-height:1.6;">
          Sir Fisher Praia — este é um e-mail automático de confirmação, não é necessário respondê-lo.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

Deno.serve(async (req) => {
  // Autorização por segredo compartilhado (verify_jwt=false no config.toml).
  if (!NOTIFY_SECRET || req.headers.get("x-notify-secret") !== NOTIFY_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }
  if (!RESEND_API_KEY) {
    return json({ error: "RESEND_API_KEY não configurada" }, 500);
  }

  const { data: claimed, error: claimErr } = await admin.rpc(
    "fn_claim_pending_notifications",
    { p_limit: 25 },
  );
  if (claimErr) {
    return json({ error: `claim: ${claimErr.message}` }, 500);
  }

  const rows = (claimed ?? []) as Array<{ id: string; type: string; payload: Payload }>;
  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    const p = { ...(row.payload ?? {}), type: row.type };
    try {
      if (!p.email) throw new Error("payload sem e-mail");
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: [p.email],
          subject: `Reserva confirmada — ${p.public_code ?? "Sir Fisher Praia"}`,
          html: buildEmailHtml(p),
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
      }
      const { error: markSentErr } = await admin.rpc("fn_finalize_notification", {
        p_id: row.id,
        p_status: "sent",
        p_error: null,
      });
      if (markSentErr) throw new Error(`mark sent: ${markSentErr.message}`);
      sent++;
    } catch (e) {
      await admin.rpc("fn_finalize_notification", {
        p_id: row.id,
        p_status: "failed",
        p_error: String(e).slice(0, 500),
      });
      failed++;
    }
  }

  return json({ processed: rows.length, sent, failed });
});
