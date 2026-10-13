// Construcao pura do evento: sem rede, credenciais ou alteracoes na fila.
export type OpenAiRow = {
  event_id: string;
  event_name: "schedule" | "visit_realized";
  oppref: string | null;
  email: string | null;
  phone: string | null;
  external_id: string | null;
  landing_url: string | null;
  occurred_at: string;
};

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildOpenAiEvent(row: OpenAiRow, now = Date.now()) {
  const timestampMs = Date.parse(row.occurred_at);
  if (!Number.isFinite(timestampMs) || timestampMs < now - 7 * 24 * 60 * 60 * 1000 || timestampMs > now) {
    throw new Error("event timestamp must be within the Conversions API 7-day window");
  }
  const user: Record<string, string[]> = {};
  const email = (row.email ?? "").trim().toLowerCase();
  const rawPhone = (row.phone ?? "").trim();
  let phone = rawPhone.replace(/\D/g, "");
  if (!rawPhone.startsWith("+") && (phone.length === 10 || phone.length === 11)) phone = "55" + phone;
  if (email.includes("@")) user.emails_sha256 = [await sha256(email)];
  if (phone.length >= 8 && phone.length <= 15) user.phone_numbers_sha256 = [await sha256(phone)];
  if (row.external_id?.trim()) user.external_ids_sha256 = [await sha256(row.external_id.trim())];

  // A cidade da casa nao e a cidade do cliente. Reserva/visita nao e venda.
  const common = { id: row.event_id, timestamp_ms: timestampMs, user,
    ...(row.oppref ? { oppref: row.oppref } : {}) };
  return row.event_name === "schedule"
    ? { ...common, type: "appointment_scheduled", action_source: "web",
      source_url: row.landing_url ?? "https://reservas.sirfisher.com.br/",
      data: { type: "customer_action" } }
    : { ...common, type: "custom", custom_event_name: "visit_realized",
      action_source: "physical_store", data: { type: "custom" } };
}
