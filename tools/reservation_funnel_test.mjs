import { createReservationFunnel, reservationFailure, reservationFunnelContext } from '../assets/js/reservation-funnel.js';
import { measureReservationConfirmedGA4 } from '../assets/js/attribution.js';

function assert(ok, message) { if (!ok) throw new Error(message); }
function setup(tag) {
  const events = [];
  globalThis.window = { location: { search: '?sf_cta=topo' }, gtag: tag || ((...args) => events.push(args)) };
  const listeners = {};
  const form = { addEventListener(name, fn) { listeners[name] = fn; } };
  return { events, listeners, funnel: createReservationFunnel(form) };
}

Deno.test('view e primeira interacao sao unicas, sem contar honeypot ou ler conteudo', () => {
  const { funnel, listeners, events } = setup();
  funnel.view(); funnel.view();
  listeners.input({ target: { id: 'website', tagName: 'INPUT' } });
  const target = { id: 'email', tagName: 'INPUT', get value() { throw new Error('PII must not be read'); } };
  listeners.input({ target }); listeners.change({ target });
  assert(events.length === 2, 'Duplicou entrada/inicio ou contou honeypot');
  assert(events[1][1] === 'reservation_form_start', 'Nao mediu interacao real');
});

Deno.test('indisponibilidade repetida nao infla evento e disponibilidade permite nova ocorrencia', () => {
  const { funnel, events } = setup();
  funnel.unavailable('no_slots', 'date-a:2');
  funnel.unavailable('no_slots', 'date-a:2');
  funnel.available();
  funnel.unavailable('no_slots', 'date-a:2');
  assert(events.length === 3, 'Deduplicacao incorreta');
  assert(!JSON.stringify(events).includes('date-a'), 'Enviou data/chave interna');
});

Deno.test('codigos operacionais sao separados de erro tecnico e texto livre nunca e enviado', () => {
  assert(reservationFailure('SAME_DAY_CUTOFF').stage === 'unavailable', 'Corte virou falha tecnica');
  assert(reservationFailure('SLOT_FULL_PEOPLE').reason === 'slot_full', 'Lotacao perdeu motivo');
  const { funnel, events } = setup();
  funnel.failure({ message: 'UNKNOWN: person@example.invalid segredo de cliente' });
  assert(events[0][2].reservation_reason === 'service_error', 'Motivo nao normalizado');
  assert(!JSON.stringify(events).includes('segredo'), 'Vazou erro bruto');
  assert(!JSON.stringify(events).includes('@'), 'Vazou dado pessoal');
});

Deno.test('parametro de CTA usa enum e nao aceita valor arbitrario de URL', () => {
  setup();
  assert(reservationFunnelContext().cta_position === 'topo', 'Perdeu CTA valido');
  window.location.search = '?sf_cta=person%40example.invalid';
  assert(reservationFunnelContext().cta_position === 'unspecified', 'Propagou PII pela origem');
});

Deno.test('tag ausente ou que lanca erro nao interrompe nenhuma etapa', () => {
  for (const tag of [null, () => { throw new Error('blocked'); }]) {
    const { funnel } = setup(tag);
    if (!tag) delete window.gtag;
    funnel.view(); funnel.track('submit'); funnel.available(); funnel.failure('UNKNOWN');
  }
});

Deno.test('confirmacao existente recebe contexto sem criar segunda conversao', () => {
  const { events } = setup();
  measureReservationConfirmedGA4({ id: 'fixture', public_code: 'FIXTURE', party_size: 2 });
  assert(events.length === 1 && events[0][1] === 'reservation_confirmed', 'Duplicou ou mudou evento');
  assert(events[0][2].reservation_stage === 'confirmed' && events[0][2].cta_position === 'topo', 'Perdeu contexto');
  assert(!('value' in events[0][2]), 'Inventou receita');
});
