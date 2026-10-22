// Funil da reserva comum. Nunca envia conteudo de campos, datas ou erros brutos.
const POSITIONS = new Set(['topo', 'abertura', 'reservas', 'visita', 'cardapio_rodape', 'conteudo']);
const STAGES = {
  view: 'reservation_form_view', start: 'reservation_form_start',
  availability: 'reservation_availability', slot: 'reservation_slot_selected',
  submit: 'reservation_submit_attempt', unavailable: 'reservation_unavailable',
  error: 'reservation_error',
};
const REASONS = new Set([
  'available', 'no_slots', 'same_day_cutoff', 'party_size_limit', 'special_date',
  'required_fields', 'time_required', 'policy_required', 'invalid_input',
  'date_unavailable', 'slot_full', 'duplicate_request', 'not_allowed',
  'network_error', 'service_error', 'initialization',
]);

export function reservationFunnelContext() {
  let position = 'unspecified';
  try {
    const value = new URLSearchParams(window.location?.search || '').get('sf_cta');
    if (POSITIONS.has(value)) position = value;
  } catch { /* Origem ausente nao impede a reserva. */ }
  return { form_kind: 'standard', cta_position: position };
}

export function reservationFailure(error) {
  const code = String(typeof error === 'string' ? error : error?.message || '')
    .split(':')[0].trim();
  const unavailable = {
    SAME_DAY_CUTOFF: 'same_day_cutoff', PARTY_TOO_LARGE: 'party_size_limit',
    DATE_NOT_ALLOWED: 'date_unavailable', DATE_BLOCKED: 'date_unavailable',
    SLOT_BLOCKED: 'date_unavailable', SLOT_FULL_PEOPLE: 'slot_full',
    SLOT_FULL_RESERVATIONS: 'slot_full',
  };
  if (unavailable[code]) return { stage: 'unavailable', reason: unavailable[code] };
  const errors = {
    INVALID_INPUT: 'invalid_input', INVALID_PARTY_SIZE: 'invalid_input',
    DUPLICATE_REQUEST: 'duplicate_request', HONEYPOT: 'not_allowed',
    NETWORK_ERROR: 'network_error',
  };
  return { stage: 'error', reason: errors[code] || 'service_error' };
}

export function createReservationFunnel(form) {
  const context = reservationFunnelContext();
  let viewed = false;
  let started = false;
  let lastUnavailable = null;
  const track = (stage, reason) => {
    if (!STAGES[stage]) return;
    const params = { ...context, reservation_stage: stage };
    if (REASONS.has(reason)) params.reservation_reason = reason;
    try {
      if (typeof window.gtag === 'function') window.gtag('event', STAGES[stage], params);
    } catch { /* Medicao nunca interrompe atendimento, mesmo com tag defeituosa. */ }
  };
  const interact = () => {
    if (!started) { started = true; track('start'); }
  };
  const start = (event) => {
    const target = event?.target;
    if (started || !target || target.id === 'website'
      || !['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
    interact();
  };
  form?.addEventListener('input', start);
  form?.addEventListener('change', start);
  return {
    view() { if (!viewed) { viewed = true; track('view'); } },
    interact,
    track,
    unavailable(reason, key = '') {
      const signature = `${reason}:${key}`;
      if (signature !== lastUnavailable) { lastUnavailable = signature; track('unavailable', reason); }
    },
    available() { lastUnavailable = null; track('availability', 'available'); },
    failure(error) { const { stage, reason } = reservationFailure(error); track(stage, reason); },
  };
}
