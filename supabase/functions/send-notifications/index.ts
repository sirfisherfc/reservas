// Edge Function: send-notifications
// -----------------------------------------------------------------------------
// Lê a fila `notification_queue` (canal 'email', status 'pending'), envia cada
// e-mail (reserva comum e réveillon, tipos rv_*) pelo Resend e marca o registro como 'sent' ou 'failed'.
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
//   PUBLIC_SITE_URL  — URL pública do site (ex.: https://reservas.sirfisher.com.br)
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

const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatDateEN(iso: string): string {
  // "2026-07-15" -> "Wednesday, July 15, 2026"
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return String(iso);
  const wd = WEEKDAYS_EN[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd}, ${MONTHS_EN[m - 1]} ${d}, ${y}`;
}

function formatTimeEN(t: string): string {
  // "19:00:00" -> "7:00 pm"
  const [h, min] = String(t).split(":").map(Number);
  if (Number.isNaN(h)) return String(t);
  return `${((h + 11) % 12) + 1}:${String(min || 0).padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
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
  whatsapp?: string;
  tolerance?: number;
  // Idioma em que o cliente reservou (reservations.customer_language). Sem o
  // campo, ou com qualquer valor que nao seja "en", o e-mail sai em portugues.
  lang?: string;
}

// Textos do e-mail de reserva comum. O portugues e o texto de sempre; o ingles
// vale para quem reservou pelo portal em ingles (?lang=en).
const EMAIL_TEXT = {
  pt: {
    htmlLang: "pt-BR",
    brand: "Sir Fisher Praia",
    subtitle: "Confirmação de reserva",
    reminderTitle: "<strong>Sua reserva é amanhã.</strong> Pode confirmar que vem?",
    hello: (name: string) => `Olá${name ? ", " + name : ""}! 👋`,
    reminderIntro: "Estamos guardando sua mesa. Uma confirmação rápida ajuda a gente a organizar o salão.",
    confirmedIntro: `Sua reserva está <strong style="color:#0f3d3e;">confirmada</strong>. Estamos ansiosos para receber você!`,
    code: "Código:", date: "Data:", time: "Horário:", people: "Pessoas:",
    timeNote: "",
    keepCode: "Guarde o código da reserva. Em caso de imprevisto, avise-nos com antecedência.",
    cancel: "Cancelar reserva",
    cancelHint: "Se precisar cancelar, use o botão acima. A vaga é liberada na hora para outros clientes.",
    confirmPresence: "Confirmar presença",
    cantGo: "Não vou poder ir",
    reminderHint: (tol: number) => `Se não puder vir, avisar libera a mesa para outra pessoa — leva 10 segundos e ajuda muito.
          Guardamos a mesa por ${tol} minutos após o horário.`,
    footerReminder: "Sir Fisher Praia — Av. Beira Mar 3421, Meireles. Responder pelo WhatsApp é o caminho mais rápido.",
    footerConfirmation: "Sir Fisher Praia — este é um e-mail automático de confirmação, não é necessário respondê-lo.",
    waConfirm: (code: string, date: string, time: string) => `Ola! Confirmo a reserva ${code} de ${date} as ${time}.`,
    waChange: (code: string, date: string) => `Ola! Preciso alterar ou cancelar a reserva ${code} de ${date}.`,
    subjectReminder: "Sua reserva é amanhã — pode confirmar?",
    subjectConfirmation: "Reserva confirmada",
    formatDate: formatDateBR,
    formatTime: formatTimeBR,
  },
  en: {
    htmlLang: "en",
    brand: "Sir Fisher",
    subtitle: "Booking confirmation",
    reminderTitle: "<strong>Your booking is tomorrow.</strong> Can you confirm you are coming?",
    hello: (name: string) => `Hello${name ? ", " + name : ""}! 👋`,
    reminderIntro: "We are holding your table. A quick confirmation helps us plan the room.",
    confirmedIntro: `Your booking is <strong style="color:#0f3d3e;">confirmed</strong>. We look forward to welcoming you!`,
    code: "Booking code:", date: "Date:", time: "Time:", people: "Guests:",
    timeNote: " (Fortaleza time)",
    keepCode: "Please keep your booking code. If your plans change, let us know in advance.",
    cancel: "Cancel booking",
    cancelHint: "If you need to cancel, use the button above. The table is released straight away for other guests.",
    confirmPresence: "Confirm I'm coming",
    cantGo: "I can't make it",
    reminderHint: (tol: number) => `If you can't come, letting us know frees the table for someone else. It takes ten seconds and helps a lot.
          We hold the table for ${tol} minutes after the booked time.`,
    footerReminder: "Sir Fisher — Av. Beira Mar 3421, Meireles, Fortaleza, Brazil. Replying on WhatsApp is the quickest way to reach us.",
    footerConfirmation: "Sir Fisher — Av. Beira Mar 3421, Meireles, Fortaleza, Brazil. This is an automatic confirmation email; no need to reply.",
    waConfirm: (code: string, date: string, time: string) => `Hello! I confirm booking ${code} on ${date} at ${time}.`,
    waChange: (code: string, date: string) => `Hello! I need to change or cancel booking ${code} on ${date}.`,
    subjectReminder: "Your booking is tomorrow — can you confirm?",
    subjectConfirmation: "Booking confirmed",
    formatDate: formatDateEN,
    formatTime: formatTimeEN,
  },
};

function emailText(p: Payload) {
  return p.lang === "en" ? EMAIL_TEXT.en : EMAIL_TEXT.pt;
}

function buildEmailSubject(p: Payload): string {
  const t = emailText(p);
  const brand = p.lang === "en" ? "Sir Fisher" : "Sir Fisher Praia";
  return `${p.type === "reservation_reminder" ? t.subjectReminder : t.subjectConfirmation} — ${p.public_code ?? brand}`;
}

function buildEmailHtml(p: Payload): string {
  const t = emailText(p);
  const isReminder = p.type === "reservation_reminder";
  const name = escapeHtml(p.name ?? "");
  const code = escapeHtml(p.public_code ?? "");
  const dateStr = escapeHtml(t.formatDate(p.date ?? ""));
  const timeStr = escapeHtml(t.formatTime(p.time ?? "") + t.timeNote);
  const people = Number(p.party_size ?? 0);

  const cancelUrl = SITE_URL && p.cancel_token
    ? `${SITE_URL}/cancelar.html?t=${encodeURIComponent(p.cancel_token)}${p.lang === "en" ? "&lang=en" : ""}`
    : "";

  const cancelBlock = cancelUrl
    ? `
      <tr><td style="padding:8px 32px 24px;">
        <a href="${cancelUrl}" style="display:inline-block;padding:12px 22px;border:1px solid #c0392b;border-radius:6px;color:#c0392b;text-decoration:none;font-size:14px;font-weight:600;">
          ${t.cancel}
        </a>
        <p style="margin:14px 0 0;color:#888;font-size:12px;line-height:1.5;">
          ${t.cancelHint}
        </p>
      </td></tr>`
    : "";

  // O lembrete de vespera precisa PEDIR uma acao. A versao anterior so avisava,
  // e 29 lembretes enviados nao moveram os 43% de no-show. Sem link de
  // cancelamento (a tabela guarda so o hash do token, nunca o token em texto),
  // o WhatsApp e o unico canal de resposta que ja existe e e monitorado.
  const wa = (p.whatsapp ?? "").replace(/\D/g, "");
  const waLink = (msg: string) =>
    wa ? `https://wa.me/${wa}?text=${encodeURIComponent(msg)}` : "";

  const confirmUrl = waLink(
    t.waConfirm(p.public_code ?? "", t.formatDate(p.date ?? ""), t.formatTime(p.time ?? "")),
  );
  const changeUrl = waLink(
    t.waChange(p.public_code ?? "", t.formatDate(p.date ?? "")),
  );

  const reminderNotice = isReminder
    ? `<tr><td style="padding:28px 32px 0;">
        <p style="margin:0 0 14px;font-size:16px;line-height:1.6;">${t.reminderTitle}</p>
      </td></tr>`
    : "";

  const reminderActions = isReminder && wa
    ? `<tr><td style="padding:8px 32px 4px;">
        <a href="${confirmUrl}" style="display:inline-block;padding:12px 22px;background:#0f3d3e;border-radius:6px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;">
          ${t.confirmPresence}
        </a>
        <a href="${changeUrl}" style="display:inline-block;margin-left:10px;padding:12px 20px;border:1px solid #c0392b;border-radius:6px;color:#c0392b;text-decoration:none;font-size:14px;font-weight:600;">
          ${t.cantGo}
        </a>
        <p style="margin:14px 0 0;color:#888;font-size:12px;line-height:1.5;">
          ${t.reminderHint(Number(p.tolerance ?? 15))}
        </p>
      </td></tr>`
    : "";

  return `<!doctype html>
<html lang="${t.htmlLang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f2ee;font-family:Arial,Helvetica,sans-serif;color:#2b2b2b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06);">
        <tr><td align="center" style="background:#ffffff;padding:22px 32px 18px;">
          <img src="https://www.sirfisher.com.br/assets/img/logo-horizontal.png" alt="${t.brand}" width="210" style="display:block;width:210px;max-width:100%;height:auto;margin:0;border:0;outline:none;text-decoration:none;" />
        </td></tr>
        <tr><td style="background:#0f3d3e;padding:20px 32px;">
          <div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:.5px;">${t.brand}</div>
          <div style="color:#9fc6c2;font-size:13px;margin-top:2px;">${t.subtitle}</div>
        </td></tr>
        ${reminderNotice}
        <tr><td style="padding:${isReminder ? "14px" : "28px"} 32px 8px;">
          <p style="margin:0 0 14px;font-size:16px;">${t.hello(name)}</p>
          <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">
            ${isReminder ? t.reminderIntro : t.confirmedIntro}
          </p>
        </td></tr>
        <tr><td style="padding:0 32px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f3;border-radius:8px;">
            <tr><td style="padding:16px 20px;font-size:14px;line-height:1.9;">
              <div><span style="color:#888;">${t.code}</span> <strong>${code}</strong></div>
              <div><span style="color:#888;">${t.date}</span> <strong>${dateStr}</strong></div>
              <div><span style="color:#888;">${t.time}</span> <strong>${timeStr}</strong></div>
              <div><span style="color:#888;">${t.people}</span> <strong>${people}</strong></div>
            </td></tr>
          </table>
        </td></tr>
        ${reminderActions}
        <tr><td style="padding:20px 32px 4px;font-size:13px;color:#666;line-height:1.6;">
          ${t.keepCode}
        </td></tr>
        ${cancelBlock}
        <tr><td style="padding:18px 32px 28px;border-top:1px solid #eee;color:#999;font-size:12px;line-height:1.6;">
          ${isReminder ? t.footerReminder : t.footerConfirmation}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// -----------------------------------------------------------------------------
// Réveillon (tipos rv_*): payload montado por public.rv_booking_payload, com os
// valores já calculados no banco (rv_calc_price). Aqui só formatamos.
// -----------------------------------------------------------------------------
interface RvPrice {
  total?: number; total_pix?: number; consumption_total?: number;
  deposit_min?: number; deposit_min_pix?: number;
  deposit_remaining?: number; deposit_remaining_pix?: number;
  balance?: number; balance_pix?: number; paid_net?: number;
}
interface RvPayload {
  public_code?: string; name?: string; email?: string;
  table_label?: string; table_type?: string; event_name?: string;
  event_starts_at?: string; timezone?: string; address?: string; menu_url?: string;
  balance_due_date?: string; hold_expires_at?: string;
  pix_key?: string; pix_key_type?: string; pix_holder?: string;
  pix_discount_pct?: number; deposit_pct?: number; whatsapp?: string;
  adults?: number; children?: number; infants?: number; party_size?: number;
  price?: RvPrice;
}

const brl = (v: unknown) => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function rvDateTime(ts: string | undefined, tz: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  const date = d.toLocaleDateString("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit" });
  const time = d.toLocaleTimeString("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  return `${date} às ${time}`;
}

function rvDate(iso: string | undefined): string {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function rvPixKey(key: string | undefined, type: string | undefined): string {
  const k = String(key ?? "");
  const d = k.replace(/\D/g, "");
  if (type === "cnpj" && d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  return k;
}

const RV_SUBJECTS: Record<string, (p: RvPayload) => string> = {
  rv_prebooking: (p) => `Pré-reserva ${p.public_code} — envie o sinal para garantir a mesa ${p.table_label}`,
  rv_expiry_warning: (p) => `Sua pré-reserva da mesa ${p.table_label} expira em breve`,
  rv_deposit_received: (p) => `Sinal recebido — mesa ${p.table_label} garantida no ${p.event_name}`,
  rv_paid_in_full: (p) => `Tudo certo! Mesa ${p.table_label} quitada para o ${p.event_name}`,
};

function buildReveillonEmailHtml(type: string, p: RvPayload): string {
  const tz = p.timezone || "America/Fortaleza";
  const pr = p.price ?? {};
  const name = escapeHtml(String(p.name ?? "").split(" ")[0]);
  const people = `${Number(p.party_size ?? 0)}${p.infants ? ` + ${p.infants} de colo` : ""}`;
  const wa = String(p.whatsapp ?? "").replace(/\D/g, "");
  const needsDeposit = type === "rv_prebooking" || type === "rv_expiry_warning";
  const waMsg = needsDeposit
    ? `Olá! Segue o comprovante do sinal da reserva ${p.public_code} (mesa ${p.table_label}) do ${p.event_name}.`
    : `Olá! Tenho uma dúvida sobre a reserva ${p.public_code} (mesa ${p.table_label}) do ${p.event_name}.`;
  const waUrl = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(waMsg)}` : "";

  const intro: Record<string, string> = {
    rv_prebooking: `Recebemos sua pré-reserva! A mesa fica separada até <strong>${escapeHtml(rvDateTime(p.hold_expires_at, tz))}</strong> e só fica garantida depois que recebermos o sinal.`,
    rv_expiry_warning: `Sua pré-reserva vence em <strong>${escapeHtml(rvDateTime(p.hold_expires_at, tz))}</strong>. Se o sinal não chegar até lá, a mesa volta a ficar disponível para outras pessoas.`,
    rv_deposit_received: `Recebemos seu sinal. <strong>Sua mesa está garantida!</strong>`,
    rv_paid_in_full: `Sua reserva está <strong>quitada</strong>. Agora é só aproveitar a virada com a gente!`,
  };

  const row = (k: string, v: string) => `<div><span style="color:#888;">${k}:</span> <strong>${v}</strong></div>`;
  const summary = [
    row("Código", escapeHtml(p.public_code ?? "")),
    row("Mesa", `${escapeHtml(p.table_type ?? "")} ${escapeHtml(p.table_label ?? "")}`),
    row("Pessoas", escapeHtml(people)),
    row("Total", `${brl(pr.total)} <span style="color:#888;font-weight:400;">(${brl(pr.total_pix)} no Pix)</span>`),
    row("Consumação inclusa", brl(pr.consumption_total)),
    type === "rv_deposit_received" ? row("Recebido", brl(pr.paid_net)) : "",
    type === "rv_deposit_received" && Number(pr.balance) > 0
      ? row("Saldo", `${brl(pr.balance_pix)} no Pix ou ${brl(pr.balance)} no cartão, até ${escapeHtml(rvDate(p.balance_due_date))}`)
      : "",
  ].join("");

  const pixBlock = needsDeposit ? `
    <tr><td style="padding:14px 32px 4px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fdf1de;border-radius:8px;">
        <tr><td style="padding:16px 20px;font-size:14px;line-height:1.7;">
          <div style="font-size:15px;"><strong>Sinal: ${brl(pr.deposit_remaining_pix ?? pr.deposit_min_pix)} no Pix</strong></div>
          <div style="color:#666;">ou ${brl(pr.deposit_remaining ?? pr.deposit_min)} no cartão, presencialmente no restaurante</div>
          ${p.pix_key ? `<div style="margin-top:10px;color:#888;">Chave Pix ${escapeHtml(String(p.pix_key_type ?? "").toUpperCase())}</div>
          <div style="font-size:18px;font-weight:800;letter-spacing:.02em;">${escapeHtml(rvPixKey(p.pix_key, p.pix_key_type))}</div>
          ${p.pix_holder ? `<div style="color:#666;">${escapeHtml(p.pix_holder)}</div>` : ""}` : ""}
          <div style="margin-top:10px;">Prazo: <strong>${escapeHtml(rvDateTime(p.hold_expires_at, tz))}</strong></div>
        </td></tr>
      </table>
    </td></tr>` : "";

  const waButton = waUrl ? `
    <tr><td style="padding:16px 32px 4px;">
      <a href="${waUrl}" style="display:inline-block;padding:12px 22px;background:#25d366;border-radius:6px;color:#06301c;text-decoration:none;font-size:15px;font-weight:700;">
        ${needsDeposit ? "Enviar comprovante pelo WhatsApp" : "Falar pelo WhatsApp"}
      </a>
    </td></tr>` : "";

  const eventInfo = type === "rv_paid_in_full" ? `
    <tr><td style="padding:14px 32px 0;font-size:14px;line-height:1.7;">
      <div><strong>${escapeHtml(p.event_name ?? "")}</strong> · ${escapeHtml(rvDateTime(p.event_starts_at, tz))}</div>
      <div>${escapeHtml(p.address ?? "")}</div>
      ${p.menu_url ? `<div><a href="${escapeHtml(p.menu_url)}" style="color:#0f6b6b;">Ver o cardápio</a></div>` : ""}
    </td></tr>` : "";

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f2ee;font-family:Arial,Helvetica,sans-serif;color:#2b2b2b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06);">
        <tr><td align="center" style="background:#ffffff;padding:22px 32px 18px;">
          <img src="https://www.sirfisher.com.br/assets/img/logo-horizontal.png" alt="Sir Fisher Praia" width="210" style="display:block;width:210px;max-width:100%;height:auto;margin:0;border:0;" />
        </td></tr>
        <tr><td style="background:#0f3d3e;padding:20px 32px;">
          <div style="color:#ffffff;font-size:20px;font-weight:700;">${escapeHtml(p.event_name ?? "Réveillon")}</div>
          <div style="color:#9fc6c2;font-size:13px;margin-top:2px;">${escapeHtml(rvDateTime(p.event_starts_at, tz))} · Sir Fisher Praia</div>
        </td></tr>
        <tr><td style="padding:24px 32px 8px;">
          <p style="margin:0 0 12px;font-size:16px;">Olá${name ? ", " + name : ""}!</p>
          <p style="margin:0 0 8px;font-size:15px;line-height:1.6;">${intro[type] ?? ""}</p>
        </td></tr>
        <tr><td style="padding:0 32px 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f3;border-radius:8px;">
            <tr><td style="padding:16px 20px;font-size:14px;line-height:1.9;">${summary}</td></tr>
          </table>
        </td></tr>
        ${pixBlock}
        ${eventInfo}
        ${waButton}
        <tr><td style="padding:20px 32px 28px;border-top:1px solid #eee;color:#999;font-size:12px;line-height:1.6;">
          Sir Fisher Praia — Av. Beira Mar 3421, Meireles. Este é um e-mail automático; para falar com a gente, use o WhatsApp.
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

  const rows = (claimed ?? []) as Array<{ id: string; type: string; payload: Payload & RvPayload }>;
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
          subject: row.type.startsWith("rv_")
            ? (RV_SUBJECTS[row.type]?.(p as RvPayload) ?? "Réveillon — Sir Fisher Praia")
            : buildEmailSubject(p),
          html: row.type.startsWith("rv_") ? buildReveillonEmailHtml(row.type, p as RvPayload) : buildEmailHtml(p),
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
