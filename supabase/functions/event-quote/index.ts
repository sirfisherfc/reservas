import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildQuote,
  type LiveSignals,
  PRICING_VERSION,
  type PricingOverrides,
  type QuoteInput,
  validateInput,
} from "./pricing.ts";
import { buildProposalPdf } from "./proposal_pdf.ts";
import { demandWeekday } from "./holidays.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM = Deno.env.get("RESEND_FROM") ??
  "Sir Fisher Praia <reservas@sirfisher.com.br>";
const EVENT_NOTIFICATION_EMAIL = Deno.env.get("EVENT_NOTIFICATION_EMAIL") ?? "";
const EVENT_WHATSAPP_NUMBER = (Deno.env.get("EVENT_WHATSAPP_NUMBER") ??
  Deno.env.get("WHATSAPP_NUMBER") ?? "5585988544274").replace(/\D/g, "");
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char] ?? char);
}

function cleanList(value: unknown, maxItems = 20): string[] {
  const source = Array.isArray(value) ? value : String(value ?? "").split("\n");
  return source.map((item) => cleanText(item, 160)).filter(Boolean).slice(
    0,
    maxItems,
  );
}

function cleanQuantities(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, quantity]) =>
        [
          key.replace(/[^a-z0-9_]/gi, "").slice(0, 60),
          Math.ceil(Number(quantity)),
        ] as const
      )
      .filter(([key, quantity]) =>
        key && Number.isFinite(quantity) && quantity >= 0 && quantity <= 10000
      ),
  );
}

function normalizePhone(value: unknown): string {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length > 11) digits = digits.slice(2);
  if (digits.length < 10 || digits.length > 11) {
    throw new Error("Informe um WhatsApp válido com DDD.");
  }
  return digits;
}

function parseInput(value: unknown): QuoteInput {
  if (!value || typeof value !== "object") {
    throw new Error("Configuração ausente.");
  }
  const raw = value as Record<string, unknown>;
  return {
    date: cleanText(raw.date, 10),
    startTime: cleanText(raw.startTime, 5),
    durationHours: Number(raw.durationHours),
    guests: Number(raw.guests),
    children: raw.children == null ? 0 : Number(raw.children),
    foodStyle: cleanText(raw.foodStyle, 30) as QuoteInput["foodStyle"],
    beverageMode: cleanText(raw.beverageMode, 30) as QuoteInput["beverageMode"],
    profile: cleanText(raw.profile, 20) as QuoteInput["profile"],
    budgetPerPerson: raw.budgetPerPerson == null || raw.budgetPerPerson === ""
      ? null
      : Number(raw.budgetPerPerson),
    dietaryRestriction: Boolean(raw.dietaryRestriction),
    exclusive: Boolean(raw.exclusive),
  };
}

/** Mês (1-12) de uma linha do resumo mensal, aceitando "2026-08", data ou número. */
function monthOf(
  row: Record<string, unknown>,
): { key: string; month: number } | null {
  const text = String(row.ano_mes ?? row.mes ?? "");
  const match = /(\d{4})-(\d{1,2})/.exec(text);
  if (match) {
    return {
      key: `${match[1]}-${match[2].padStart(2, "0")}`,
      month: Number(match[2]),
    };
  }
  const month = Number(row.mes);
  const year = Number(row.ano);
  return month >= 1 && month <= 12 && year
    ? { key: `${year}-${month}`, month }
    : null;
}

/**
 * Faturamento esperado na janela do evento, índice de movimento (0-1),
 * fator do mês e CMV real, a partir das views do painel de gestão.
 */
async function demandSignals(input: QuoteInput): Promise<Partial<LiveSignals>> {
  const [hourly, monthly] = await Promise.all([
    admin.from("escala_demanda_base").select("dia_semana,hora,valor_hora"),
    admin.from("painel_resumo_mensal").select("*").limit(48),
  ]);
  const result: Partial<LiveSignals> = {};

  // Mês: média do mesmo mês do calendário ÷ média de todos os meses fechados.
  const currentKey = new Date().toISOString().slice(0, 7);
  const months = (monthly.data ?? [])
    .map((row) => ({
      row: row as Record<string, unknown>,
      when: monthOf(row as Record<string, unknown>),
    }))
    .filter(({ row, when }) =>
      when && when.key !== currentKey && Number(row.faturamento) > 0
    );
  if (!monthly.error && months.length >= 6) {
    const eventMonth = Number(input.date.slice(5, 7));
    const all = months.map(({ row }) => Number(row.faturamento));
    const same = months.filter(({ when }) => when!.month === eventMonth).map((
      { row },
    ) => Number(row.faturamento));
    const avg = (values: number[]) =>
      values.reduce((a, b) => a + b, 0) / values.length;
    if (same.length) {
      result.monthFactor = Math.min(1.5, Math.max(0.6, avg(same) / avg(all)));
    }
    const cmv = months
      .sort((a, b) => a.when!.key < b.when!.key ? 1 : -1)
      .slice(0, 6)
      .map(({ row }) => Number(row.cmv_perc))
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => value > 1 ? value / 100 : value);
    if (cmv.length >= 3) result.realCmvRate = avg(cmv);
  }

  // Hora: soma do faturamento médio de cada hora coberta pelo evento.
  const rows = hourly.error ? [] : (hourly.data ?? []);
  if (hourly.error) {
    result.demandNote = cleanText(hourly.error.message, 200);
  } else if (rows.length < 24) {
    result.demandNote =
      `Histórico por hora insuficiente (${rows.length} linhas).`;
  }
  if (rows.length >= 24) {
    const isoWeekday = demandWeekday(input.date).weekday;
    const byHour = new Map<string, number>();
    let peak = 0;
    for (const row of rows) {
      const value = Number(row.valor_hora) || 0;
      byHour.set(`${row.dia_semana}-${row.hora}`, value);
      peak = Math.max(peak, value);
    }
    const start = Number(input.startTime.slice(0, 2)) +
      Number(input.startTime.slice(3, 5)) / 60;
    const end = start + input.durationHours;
    let expected = 0;
    for (let hour = Math.floor(start); hour < end; hour++) {
      const covered = Math.min(end, hour + 1) - Math.max(start, hour);
      const day = hour >= 24 ? (isoWeekday % 7) + 1 : isoWeekday;
      expected += (byHour.get(`${day}-${hour % 24}`) ?? 0) * covered;
    }
    const monthFactor = result.monthFactor ?? 1;
    if (peak > 0) {
      result.expectedWindowRevenue = expected * monthFactor;
      result.demandIndex = Math.min(
        1,
        (expected / input.durationHours) * monthFactor / peak,
      );
      result.demandDataAvailable = true;
    }
  }
  return result;
}

async function liveSignals(input: QuoteInput): Promise<LiveSignals> {
  const signals: LiveSignals = { demandDataAvailable: false };
  const weekday = new Date(`${input.date}T12:00:00Z`).getUTCDay();
  const [blockedDate, blockedTime, rule, settings, reservations, demand] =
    await Promise.all([
      admin.from("blocked_dates").select("id").eq("date", input.date).eq(
        "active",
        true,
      ).limit(1),
      admin.from("blocked_time_slots").select("id").eq("date", input.date).eq(
        "time_slot",
        `${input.startTime}:00`,
      ).eq("active", true).limit(1),
      admin.from("availability_rules").select(
        "enabled,max_people,max_reservations",
      ).eq("weekday", weekday).eq("time_slot", `${input.startTime}:00`)
        .maybeSingle(),
      admin.from("restaurant_settings").select("key,value").in("key", [
        "total_capacity",
        "table_duration_minutes",
        "reservation_buffer_minutes",
      ]),
      admin.from("reservations").select("reservation_time,party_size").eq(
        "reservation_date",
        input.date,
      ).eq("status", "confirmada"),
      admin.from("event_demand_baselines").select(
        "median_revenue,low_revenue,high_revenue,opportunity_cost",
      ).eq("month", Number(input.date.slice(5, 7))).eq("weekday", weekday).eq(
        "start_hour",
        Number(input.startTime.slice(0, 2)),
      ).maybeSingle(),
    ]);

  try {
    Object.assign(signals, await demandSignals(input));
  } catch (error) {
    console.error("event demand signals failed", error);
  }
  signals.capacity = null;

  signals.availabilityUnverified = [
    blockedDate,
    blockedTime,
    rule,
    settings,
    reservations,
  ].some((result) => Boolean(result.error));

  signals.blocked = Boolean(
    blockedDate.data?.length || blockedTime.data?.length ||
      (rule.data && !rule.data.enabled),
  );
  const settingMap = Object.fromEntries(
    (settings.data ?? []).map((row) => [row.key, row.value]),
  );
  const totalCapacity = Number(
    settingMap.total_capacity ?? rule.data?.max_people ?? 100,
  );
  const durationMinutes = Number(settingMap.table_duration_minutes ?? 120);
  const bufferMinutes = Number(settingMap.reservation_buffer_minutes ?? 60);
  const start = Number(input.startTime.slice(0, 2)) * 60 +
    Number(input.startTime.slice(3, 5));
  const end = start + input.durationHours * 60;
  const overlappingPeople = (reservations.data ?? []).reduce(
    (sum, reservation) => {
      const value = String(reservation.reservation_time).slice(0, 5);
      const reservationStart = Number(value.slice(0, 2)) * 60 +
        Number(value.slice(3, 5));
      const reservationEnd = reservationStart + durationMinutes;
      return reservationStart < end + bufferMinutes &&
          reservationEnd + bufferMinutes > start
        ? sum + Number(reservation.party_size || 0)
        : sum;
    },
    0,
  );
  signals.capacity = totalCapacity;
  const projected = overlappingPeople + input.guests;
  signals.capacityExceeded = projected > totalCapacity;
  signals.nearCapacity = !signals.capacityExceeded &&
    projected >= totalCapacity * 0.85;
  signals.reservationConflict = Boolean(
    rule.data?.max_people && projected > Number(rule.data.max_people),
  );

  if (demand.data) {
    signals.demandDataAvailable = true;
    signals.comparableRevenueMedian = Number(demand.data.median_revenue);
    signals.comparableRevenueLow = Number(demand.data.low_revenue);
    signals.comparableRevenueHigh = Number(demand.data.high_revenue);
    signals.opportunityCostTotal = Number(demand.data.opportunity_cost);
  }
  return signals;
}

async function pricingOverrides(
  input: QuoteInput,
): Promise<PricingOverrides | undefined> {
  const { data: version } = await admin.from("event_pricing_versions")
    .select(
      "id,code,cmv_rate,service_rate,target_contribution_margin,freelancer_day",
    )
    .eq("status", "active").maybeSingle();
  // Regras do banco só valem quando a versão ativa é a mesma do código.
  // Enquanto isso, as constantes versionadas de pricing.ts são a referência.
  if (!version || version.code !== PRICING_VERSION) return undefined;
  const foodStyle = input.foodStyle === "recomendacao"
    ? "petiscos_principal"
    : input.foodStyle;
  const beverageMode = input.beverageMode;
  const [{ data: packages }, { data: beverages }] = await Promise.all([
    admin.from("event_package_rules").select(
      "food_style,profile,food_units_per_person,retail_per_person,kitchen_labor_per_person,composition",
    )
      .eq("pricing_version_id", version.id).eq("food_style", foodStyle).lte(
        "guest_min",
        input.guests,
      ).gte("guest_max", input.guests).eq("active", true),
    admin.from("event_beverage_rules").select(
      "mode,retail_per_adult,units_per_adult,waste_risk,needs_validation,composition",
    )
      .eq("pricing_version_id", version.id).eq("mode", beverageMode).eq(
        "active",
        true,
      ),
  ]);
  return {
    versionCode: version.code,
    cmvRate: Number(version.cmv_rate),
    serviceRate: Number(version.service_rate),
    targetContributionMargin: Number(version.target_contribution_margin),
    freelancerDay: Number(version.freelancer_day),
    packages: (packages ?? []).map((row) => ({
      foodStyle: row.food_style,
      profile: row.profile,
      foodUnitsPerPerson: Number(row.food_units_per_person),
      retailPerPerson: Number(row.retail_per_person),
      kitchenLaborPerPerson: Number(row.kitchen_labor_per_person),
      composition: row.composition,
    })),
    beverages: (beverages ?? []).map((row) => ({
      mode: row.mode,
      retailPerAdult: Number(row.retail_per_adult),
      unitsPerAdult: Number(row.units_per_adult),
      wasteRisk: Number(row.waste_risk),
      needsValidation: Boolean(row.needs_validation),
      composition: row.composition,
    })),
  } as PricingOverrides;
}

/** Limites do configurador público. O painel pode ajustar fora deles. */
const PUBLIC_MIN_GUESTS = 30;
const PUBLIC_MAX_GUESTS = 100;

function checkPublicLimits(input: QuoteInput): QuoteInput {
  // Exclusividade é negociada à parte; o site nunca cota espaço exclusivo.
  input.exclusive = false;
  if (input.guests < PUBLIC_MIN_GUESTS) {
    throw new Error(
      input.guests <= 10
        ? "Quantidade de convidados: para até 10 pessoas, reserve uma mesa em reservas.sirfisher.com.br e peça pelo cardápio."
        : `Quantidade de convidados: para grupos de 11 a ${
          PUBLIC_MIN_GUESTS - 1
        } pessoas, reserve mesas pelo WhatsApp e peça pelo cardápio, sem pagamento antecipado.`,
    );
  }
  if (input.guests > PUBLIC_MAX_GUESTS) {
    throw new Error(
      `Quantidade de convidados: montamos eventos de até ${PUBLIC_MAX_GUESTS} pessoas sentadas. Para grupos maiores ou eventos em pé, fale com a equipe pelo WhatsApp.`,
    );
  }
  return input;
}

const VERIFY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Código aleatório impresso na proposta oficial (SF-XXXX-XXXX). */
function newVerificationCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map((b) =>
    VERIFY_ALPHABET[b % VERIFY_ALPHABET.length]
  );
  return `SF-${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

async function staffFrom(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data: authData } = await admin.auth.getUser(token);
  if (!authData.user) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const [{ data: role }, { data: permissions }] = await Promise.all([
    userClient.rpc("papel_usuario_atual"),
    userClient.from("pagina_permissao").select("papeis").eq(
      "pagina",
      "eventos.html",
    ).maybeSingle(),
  ]);
  if (!role || !["admin", "socio", "gerente"].includes(role)) return null;
  const allowed = role === "admin" ||
    (permissions?.papeis ?? []).includes(role);
  return allowed ? { id: authData.user.id, role, active: true } : null;
}

async function quote(input: QuoteInput) {
  const [signals, overrides] = await Promise.all([
    liveSignals(input),
    pricingOverrides(input),
  ]);
  const result = buildQuote(input, signals, overrides);
  return {
    quoteId: crypto.randomUUID(),
    options: result.options,
    riskLevel: result.requestRiskLevel,
    availabilityChecked: !signals.availabilityUnverified,
  };
}

async function notifyStaff(request: Record<string, unknown>) {
  try {
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY não configurada");
    const recipients = new Set(
      EVENT_NOTIFICATION_EMAIL.split(",").map((email) =>
        email.trim().toLowerCase()
      ).filter(Boolean),
    );
    const { data: profiles, error: profileError } = await admin.from(
      "perfil_usuario",
    )
      .select("user_id").eq("papel", "admin").eq("ativo", true);
    if (profileError) throw profileError;
    const adminIds = new Set(
      (profiles ?? []).map((profile) => profile.user_id),
    );
    if (adminIds.size) {
      const { data: usersData, error: usersError } = await admin.auth.admin
        .listUsers({ page: 1, perPage: 1000 });
      if (usersError) throw usersError;
      for (const user of usersData.users) {
        if (adminIds.has(user.id) && user.email) {
          recipients.add(user.email.toLowerCase());
        }
      }
    }
    if (!recipients.size) {
      throw new Error("Nenhum administrador ativo com e-mail");
    }
    const pub = (request.public_snapshot ?? {}) as Record<string, unknown>;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [...recipients],
        subject: `Nova estimativa de evento ${request.public_code}`,
        html:
          `<div style="font-family:Arial,sans-serif;color:#12293d;line-height:1.55;max-width:620px">
          <h1 style="font-size:22px">Novo orçamento de evento</h1>
          <p><strong>${
            escapeHtml(request.public_code)
          }</strong> foi enviado por ${escapeHtml(request.customer_name)}.</p>
          <p><strong>Data:</strong> ${escapeHtml(request.event_date)} às ${
            escapeHtml(String(request.start_time).slice(0, 5))
          }<br>
          <strong>Convidados:</strong> ${escapeHtml(request.guests)}<br>
          <strong>Opção:</strong> ${escapeHtml(pub.name)}<br>
          <strong>Total:</strong> ${
            escapeHtml(
              new Intl.NumberFormat("pt-BR", {
                style: "currency",
                currency: "BRL",
              }).format(Number(pub.total) || 0),
            )
          }</p>
          <p><a href="https://admin.sirfisher.com.br/eventos.html" style="display:inline-block;background:#df5b3b;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px">Abrir no painel</a></p>
        </div>`,
      }),
    });
    if (!response.ok) throw new Error(`Resend HTTP ${response.status}`);
    await admin.from("event_requests").update({
      notification_sent_at: new Date().toISOString(),
      notification_error: null,
    }).eq("id", request.id);
  } catch (error) {
    console.error("event notification failed", error);
    await admin.from("event_requests").update({
      notification_error: cleanText(
        error instanceof Error ? error.message : "Falha desconhecida",
        500,
      ),
    }).eq("id", request.id);
  }
}

async function submit(body: Record<string, unknown>) {
  if (body.website) throw new Error("Solicitação inválida.");
  if (body.acceptedEstimate !== true) {
    throw new Error(
      "Confirme que entendeu que os valores são uma estimativa.",
    );
  }
  if (body.acceptedPrivacy !== true) {
    throw new Error("Confirme o aviso de privacidade.");
  }
  const input = checkPublicLimits(parseInput(body.configuration));
  const name = cleanText(body.name, 120);
  const phone = normalizePhone(body.phone);
  const selectedOptionId = cleanText(body.selectedOptionId, 120);
  if (name.length < 2) throw new Error("Informe seu nome.");

  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { count } = await admin.from("event_requests").select("id", {
    count: "exact",
    head: true,
  }).eq("customer_phone", phone).gte("created_at", fifteenMinutesAgo);
  if ((count ?? 0) >= 3) {
    return json({
      error: "Muitas tentativas em pouco tempo. Aguarde alguns minutos.",
    }, 429);
  }

  const [signals, overrides] = await Promise.all([
    liveSignals(input),
    pricingOverrides(input),
  ]);
  const result = buildQuote(input, signals, overrides);
  const selected =
    result.internal.find((option) => option.id === selectedOptionId) ??
      result.internal[0];
  const publicSnapshot =
    result.options.find((option) => option.id === selected.id) ??
      result.options[0];
  const publicCode = `EV-${new Date().getUTCFullYear()}-${
    crypto.randomUUID().slice(0, 8).toUpperCase()
  }`;
  const { data, error } = await admin.from("event_requests").insert({
    public_code: publicCode,
    customer_name: name,
    customer_phone: phone,
    event_date: input.date,
    start_time: input.startTime,
    duration_hours: input.durationHours,
    guests: input.guests,
    children: input.children ?? 0,
    configuration: input,
    selected_option_id: selected.id,
    public_snapshot: publicSnapshot,
    internal_snapshot: { ...selected, signals },
    risk_level: selected.riskLevel,
    pricing_version: selected.pricingVersion,
    menu_version: selected.menuVersion,
    accepted_privacy_at: new Date().toISOString(),
    source: "site",
  }).select(
    "id,public_code,customer_name,event_date,start_time,guests,public_snapshot",
  ).single();
  if (error) throw error;
  await admin.from("event_request_audit").insert({
    request_id: data.id,
    action: "submitted",
    actor_type: "customer",
    after_data: {
      risk_level: selected.riskLevel,
      selected_option_id: selected.id,
      accepted_estimate_terms:
        "Valores estimados; só valem após confirmação da equipe e proposta oficial.",
    },
  });
  await notifyStaff(data);
  const whatsappText = encodeURIComponent(
    `Olá! Acabei de enviar a estimativa ${data.public_code} do meu evento e gostaria de receber a proposta oficial.`,
  );
  return json({
    publicCode: data.public_code,
    message: "Configuração enviada para validação.",
    whatsappUrl:
      `https://api.whatsapp.com/send?phone=${EVENT_WHATSAPP_NUMBER}&text=${whatsappText}`,
  }, 201);
}

async function adminAction(
  req: Request,
  body: Record<string, unknown>,
  action: string,
) {
  const staff = await staffFrom(req);
  if (!staff) return json({ error: "Não autorizado." }, 401);
  if (action === "admin-verify") {
    const code = cleanText(body.code, 20).toUpperCase().replace(/\s+/g, "");
    if (!/^SF-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
      return json({
        valid: false,
        reason: "Formato inválido. Use SF-XXXX-XXXX.",
      });
    }
    const { data: found, error: verifyError } = await admin.from(
      "event_request_audit",
    ).select("request_id,created_at,after_data").eq(
      "action",
      "proposal_generated",
    )
      .eq("after_data->>verification_code", code).limit(1).maybeSingle();
    if (verifyError) throw verifyError;
    if (!found) {
      return json({
        valid: false,
        reason:
          "Código não encontrado: esta proposta não foi emitida pelo Sir Fisher.",
      });
    }
    const { data: request } = await admin.from("event_requests").select(
      "proposal_version,status",
    ).eq("id", found.request_id).maybeSingle();
    const proposal = found.after_data as Record<string, unknown>;
    return json({
      valid: true,
      requestId: found.request_id,
      proposal,
      latestVersion: request?.proposal_version ?? null,
      isLatest: Number(request?.proposal_version) ===
        Number(proposal.proposal_version),
      status: request?.status ?? null,
    });
  }
  if (action === "admin-list") {
    const { data, error } = await admin.from("event_requests").select(
      "id,public_code,customer_name,event_date,start_time,guests,risk_level,status,public_snapshot,notification_sent_at,notification_error,created_at",
    ).order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return json({ requests: data ?? [] });
  }
  const id = cleanText(body.id, 80);
  const { data: current, error: currentError } = await admin.from(
    "event_requests",
  ).select("*").eq("id", id).single();
  if (currentError) throw currentError;
  if (action === "admin-detail") return json({ request: current });

  if (action === "admin-adjust") {
    const raw = body.adjustment && typeof body.adjustment === "object"
      ? body.adjustment as Record<string, unknown>
      : {};
    const configuration = {
      ...(current.configuration as Record<string, unknown>),
      date: cleanText(raw.date ?? current.event_date, 10),
      startTime: cleanText(
        raw.startTime ?? String(current.start_time).slice(0, 5),
        5,
      ),
      durationHours: Number(raw.durationHours ?? current.duration_hours),
      guests: Number(raw.guests ?? current.guests),
      children: Number(raw.children ?? current.children),
    } as QuoteInput;
    const validationErrors = validateInput(configuration);
    if (validationErrors.length) throw new Error(validationErrors.join(" "));
    const pricePerPerson = Number(
      raw.pricePerPerson ?? current.public_snapshot?.pricePerPerson,
    );
    if (
      !Number.isFinite(pricePerPerson) || pricePerPerson <= 0 ||
      pricePerPerson > 10000
    ) {
      throw new Error("Informe um valor por pessoa válido.");
    }
    const note = cleanText(body.note, 1000);
    const lowerPrice =
      pricePerPerson < Number(current.public_snapshot?.pricePerPerson ?? 0);
    if (
      lowerPrice &&
      (staff.role !== "admin" || body.discountApproved !== true || !note)
    ) {
      return json({
        error:
          "Redução de preço exige administrador, aprovação de desconto e justificativa.",
      }, 403);
    }
    const termsRaw = raw.terms && typeof raw.terms === "object"
      ? raw.terms as Record<string, unknown>
      : {};
    const proposalTerms = {
      validityDays: Math.min(
        30,
        Math.max(1, Math.round(Number(termsRaw.validityDays) || 5)),
      ),
      depositPercent: Math.min(
        100,
        Math.max(0, Number(termsRaw.depositPercent) || 20),
      ),
      balanceDaysBefore: Math.min(
        60,
        Math.max(0, Math.round(Number(termsRaw.balanceDaysBefore) || 7)),
      ),
      cardSurchargePercent: Math.min(
        30,
        Math.max(0, Number(termsRaw.cardSurchargePercent ?? 10) || 0),
      ),
      additionalNotes: cleanText(termsRaw.additionalNotes, 1000),
    };
    const publicSnapshot = {
      ...current.public_snapshot,
      name: cleanText(raw.name ?? current.public_snapshot?.name, 140),
      description: cleanText(
        raw.description ?? current.public_snapshot?.description,
        500,
      ),
      beverageLabel: cleanText(
        raw.beverageLabel ?? current.public_snapshot?.beverageLabel,
        180,
      ),
      beverageDetail: cleanText(
        raw.beverageDetail ?? current.public_snapshot?.beverageDetail,
        400,
      ),
      durationHours: configuration.durationHours,
      pricePerPerson: Math.round(pricePerPerson * 100) / 100,
      total: Math.round(pricePerPerson * configuration.guests * 100) / 100,
      additions: raw.additions == null
        ? current.public_snapshot?.additions
        : cleanList(raw.additions),
      notIncluded: raw.notIncluded == null
        ? current.public_snapshot?.notIncluded
        : cleanList(raw.notIncluded),
      exact: false,
      validationMessage:
        "Proposta ajustada manualmente e sujeita ao aceite do cliente.",
    };
    const previousInternal = current.internal_snapshot as Record<
      string,
      unknown
    >;
    const alerts = cleanList(previousInternal.alerts ?? []);
    if (!alerts.includes("Proposta ajustada manualmente.")) {
      alerts.push("Proposta ajustada manualmente.");
    }
    const internalSnapshot = {
      ...previousInternal,
      ...publicSnapshot,
      adults: Math.max(0, configuration.guests - (configuration.children ?? 0)),
      portions: raw.portions == null
        ? previousInternal.portions
        : cleanQuantities(raw.portions),
      drinks: raw.drinks == null
        ? previousInternal.drinks
        : cleanQuantities(raw.drinks),
      alerts,
      manualAdjustment: true,
    };
    const patch: Record<string, unknown> = {
      event_date: configuration.date,
      start_time: configuration.startTime,
      duration_hours: configuration.durationHours,
      guests: configuration.guests,
      children: configuration.children ?? 0,
      configuration,
      public_snapshot: publicSnapshot,
      internal_snapshot: internalSnapshot,
      proposal_terms: proposalTerms,
      status: "pending",
      last_adjusted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      reviewed_by_user_id: staff.id,
    };
    if (lowerPrice) {
      patch.discount_approved = true;
      patch.discount_reason = note;
      patch.discount_approved_by_user_id = staff.id;
    }
    const { data: adjusted, error: adjustmentError } = await admin.from(
      "event_requests",
    )
      .update(patch).eq("id", id).select("*").single();
    if (adjustmentError) throw adjustmentError;
    await admin.from("event_request_audit").insert({
      request_id: id,
      action: "adjusted",
      actor_type: staff.role,
      actor_user_id: staff.id,
      before_data: {
        public_snapshot: current.public_snapshot,
        internal_snapshot: current.internal_snapshot,
      },
      after_data: {
        public_snapshot: publicSnapshot,
        internal_snapshot: internalSnapshot,
        note,
      },
    });
    return json({ request: adjusted });
  }

  if (action === "admin-proposal-pdf") {
    const generatedAt = new Date().toISOString();
    const nextVersion = Number(current.proposal_version ?? 0) + 1;
    const verificationCode = newVerificationCode();
    const pdfBytes = await buildProposalPdf({
      ...current,
      proposal_version: nextVersion,
      proposal_generated_at: generatedAt,
      verification_code: verificationCode,
    });
    const snapshot = (current.public_snapshot ?? {}) as Record<string, unknown>;
    const { error: auditError } = await admin.from("event_request_audit")
      .insert({
        request_id: id,
        action: "proposal_generated",
        actor_type: staff.role,
        actor_user_id: staff.id,
        before_data: {
          status: current.status,
          proposal_version: current.proposal_version,
        },
        after_data: {
          status: "final_proposal_ready",
          proposal_version: nextVersion,
          verification_code: verificationCode,
          generated_at: generatedAt,
          public_code: current.public_code,
          customer_name: current.customer_name,
          event_date: current.event_date,
          start_time: current.start_time,
          duration_hours: current.duration_hours,
          guests: current.guests,
          option_name: snapshot.name,
          price_per_person: snapshot.pricePerPerson,
          total: snapshot.total,
        },
      });
    if (auditError) throw auditError;
    const { data: proposal, error: proposalError } = await admin.from(
      "event_requests",
    ).update({
      status: "final_proposal_ready",
      proposal_version: nextVersion,
      proposal_generated_at: generatedAt,
      updated_at: generatedAt,
      reviewed_by_user_id: staff.id,
    }).eq("id", id).select("*").single();
    if (proposalError) throw proposalError;
    const pdfBuffer = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength,
    ) as ArrayBuffer;
    return new Response(new Blob([pdfBuffer], { type: "application/pdf" }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition":
          `attachment; filename="proposta-${proposal.public_code}-v${nextVersion}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const allowed = [
    "approved",
    "adjustment_requested",
    "rejected",
    "information_requested",
    "alternative_offered",
    "final_proposal_ready",
  ];
  const status = cleanText(body.status, 40);
  if (action !== "admin-update" || !allowed.includes(status)) {
    return json({ error: "Ação inválida." }, 400);
  }
  if (
    status === "approved" && current.risk_level === "vermelho" &&
    staff.role !== "admin"
  ) return json({ error: "Caso vermelho exige administrador." }, 403);
  if (Boolean(body.discountApproved) && staff.role !== "admin") {
    return json({ error: "Desconto exige administrador." }, 403);
  }
  const note = cleanText(body.note, 1000);
  const patch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
    reviewed_by_user_id: staff.id,
  };
  if (body.discountApproved === true) {
    patch.discount_approved = true;
    patch.discount_reason = note;
    patch.discount_approved_by_user_id = staff.id;
  }
  const { data: updated, error } = await admin.from("event_requests").update(
    patch,
  ).eq("id", id).select("*").single();
  if (error) throw error;
  await admin.from("event_request_audit").insert({
    request_id: id,
    action: status,
    actor_type: staff.role,
    actor_user_id: staff.id,
    before_data: { status: current.status },
    after_data: {
      status,
      note,
      discount_approved: Boolean(body.discountApproved),
    },
  });
  return json({ request: updated });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Método não permitido." }, 405);
  }
  try {
    const body = await req.json() as Record<string, unknown>;
    const action = cleanText(body.action, 40);
    if (action === "quote") {
      return json(
        await quote(checkPublicLimits(parseInput(body.configuration))),
      );
    }
    if (action === "submit") return await submit(body);
    if (action.startsWith("admin-")) {
      return await adminAction(req, body, action);
    }
    return json({ error: "Ação inválida." }, 400);
  } catch (error) {
    console.error(error);
    const rawMessage = error instanceof Error ? error.message : "";
    const safeClientError =
      /^(Data inválida|Horário inválido|Quantidade|Duração|Opção|Informe|Confirme|Configuração|Solicitação inválida|Muitas tentativas|Ação inválida|Não autorizado|Caso vermelho|Desconto exige)/
        .test(rawMessage);
    const message = safeClientError
      ? rawMessage
      : "Não foi possível processar a solicitação agora.";
    return json({ error: message.slice(0, 300) }, safeClientError ? 400 : 500);
  }
});
