// Helpers puros da Meta: sem rede, credenciais ou alteracoes na fila.
export function normalizeMetaPhone(raw: string | null): string | null {
  const input = (raw ?? "").trim();
  let digits = input.replace(/\D/g, "");
  if (!input.startsWith("+") && (digits.length === 10 || digits.length === 11)) {
    digits = "55" + digits;
  }
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export function metaEventTimestamp(occurredAt: string, now = Date.now()): number {
  const timestampMs = Date.parse(occurredAt);
  if (!Number.isFinite(timestampMs) || timestampMs < now - 7 * 24 * 60 * 60 * 1000 || timestampMs > now) {
    throw new Error("Meta event timestamp must be within the 7-day window and not in the future");
  }
  return Math.floor(timestampMs / 1000);
}
