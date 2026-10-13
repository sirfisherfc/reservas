import { buildOpenAiEvent, type OpenAiRow } from "../supabase/functions/send-openai-ads-conversions/openai-event.ts";

const now = Date.parse("2026-10-13T18:00:00Z");
const row: OpenAiRow = { event_id: "sf-oai-sched-test", event_name: "schedule", oppref: "test-click",
  email: " TEST@example.invalid ", phone: "+12025550123", external_id: "test-id",
  landing_url: "https://www.sirfisher.com.br/conheca/", occurred_at: "2026-10-13T17:00:00Z" };
function assert(condition: unknown, message: string) { if (!condition) throw new Error(message); }

Deno.test("CAPI preserva identificadores reais e deduplicacao sem cidade ou receita presumidas", async () => {
  const event = await buildOpenAiEvent(row, now);
  assert(event.id === row.event_id && event.oppref === row.oppref && event.type === "appointment_scheduled", "Identidade divergente");
  assert(event.user.emails_sha256?.[0].length === 64 && event.user.external_ids_sha256?.[0].length === 64, "Hash ausente");
  const phoneHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("12025550123"));
  const expected = Array.from(new Uint8Array(phoneHash)).map((b) => b.toString(16).padStart(2, "0")).join("");
  assert(event.user.phone_numbers_sha256?.[0] === expected, "Telefone internacional ganhou codigo brasileiro");
  assert(!event.user.cities && !event.user.regions && !event.user.countries, "Inventou localizacao");
  assert(!("amount" in event.data) && !("currency" in event.data), "Declarou venda inexistente");
});

Deno.test("comparecimento preserva nome customizado e nao inventa valor ou oppref", async () => {
  const event = await buildOpenAiEvent({ ...row, event_id: "sf-vr-test", event_name: "visit_realized", oppref: null }, now);
  assert(event.type === "custom" && "custom_event_name" in event && event.custom_event_name === "visit_realized", "Meta divergente");
  assert(event.action_source === "physical_store" && !("oppref" in event), "Origem inventada");
  assert(!("amount" in event.data), "Visita virou venda");
});

Deno.test("CAPI rejeita timestamp vencido, invalido ou futuro sem fabricar nova data", async () => {
  for (const occurred_at of ["2026-10-01T00:00:00Z", "invalid", "2026-10-14T00:00:00Z"]) {
    let rejected = false;
    try { await buildOpenAiEvent({ ...row, occurred_at }, now); } catch { rejected = true; }
    assert(rejected, "Aceitou timestamp: " + occurred_at);
  }
});
