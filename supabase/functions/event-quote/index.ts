import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildQuote,
  type LiveSignals,
  type PricingOverrides,
  type QuoteInput,
} from "./pricing.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
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
  if (!version) return undefined;
  const foodStyle = input.foodStyle === "recomendacao"
    ? "petiscos_principal"
    : input.foodStyle;
  const beverageMode = input.beverageMode === "recomendacao"
    ? "sem_alcool"
    : input.beverageMode;
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

async function submit(body: Record<string, unknown>) {
  if (body.website) throw new Error("Solicitação inválida.");
  if (body.acceptedPrivacy !== true) {
    throw new Error("Confirme o aviso de privacidade.");
  }
  const input = parseInput(body.configuration);
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
  }).select("id,public_code").single();
  if (error) throw error;
  await admin.from("event_request_audit").insert({
    request_id: data.id,
    action: "submitted",
    actor_type: "customer",
    after_data: {
      risk_level: selected.riskLevel,
      selected_option_id: selected.id,
    },
  });
  return json({
    publicCode: data.public_code,
    message: "Configuração enviada para validação.",
  }, 201);
}

async function adminAction(
  req: Request,
  body: Record<string, unknown>,
  action: string,
) {
  const staff = await staffFrom(req);
  if (!staff) return json({ error: "Não autorizado." }, 401);
  if (action === "admin-list") {
    const { data, error } = await admin.from("event_requests").select(
      "id,public_code,customer_name,event_date,start_time,guests,risk_level,status,public_snapshot,created_at",
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
      return json(await quote(parseInput(body.configuration)));
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
      /^(Data inválida|Horário inválido|Quantidade|Duração|Informe|Confirme|Configuração|Solicitação inválida|Muitas tentativas|Ação inválida|Não autorizado|Caso vermelho|Desconto exige)/
        .test(rawMessage);
    const message = safeClientError
      ? rawMessage
      : "Não foi possível processar a solicitação agora.";
    return json({ error: message.slice(0, 300) }, safeClientError ? 400 : 500);
  }
});
