import { reservationAttribution } from '../assets/js/attribution.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function environment(cookie, { blockedStorage = false, gtag } = {}) {
  const saved = JSON.stringify({ utm_source: 'google_maps', captured_at: '2026-10-06T12:00:00Z' });
  globalThis.document = { cookie: cookie + '; sf_attribution_v1=' + encodeURIComponent(saved), referrer: '' };
  globalThis.window = {
    location: { search: '', href: 'https://reservas.sirfisher.com.br/', hostname: 'reservas.sirfisher.com.br', protocol: 'https:' },
    localStorage: { getItem() { if (blockedStorage) throw new Error('blocked'); return saved; }, setItem() {} },
    gtag,
  };
}

Deno.test('preserva origem e captura sessao GS1 mesmo com storage bloqueado', async () => {
  environment('_ga=GA1.1.123456.1788738227; _ga_F40Z5Y9QT6=GS1.1.1788738226.1.1.1788738250.0.0.0', { blockedStorage: true });
  const result = await reservationAttribution();
  assert(result.utm_source === 'google_maps', 'Origem compartilhada foi perdida');
  assert(result.ga_client_id === '123456.1788738227', 'client_id incorreto');
  assert(result.ga_session_id === '1788738226', 'Sessao legada nao foi capturada');
});

Deno.test('captura sessao no formato GS2', async () => {
  environment('_ga=GA1.1.123456.1788738227; _ga_F40Z5Y9QT6=GS2.1.s1788738999$o1$g1$t1788739001');
  const result = await reservationAttribution();
  assert(result.ga_session_id === '1788738999', 'Sessao GS2 incorreta');
});

Deno.test('prioriza identificadores da API da tag sobre cookies antigos', async () => {
  environment('_ga=GA1.1.123456.1788738227; _ga_F40Z5Y9QT6=GS1.1.1788738226.1.0.0', {
    gtag(command, target, field, callback) { callback(field === 'client_id' ? '987654.1788739000' : 1788739001); },
  });
  const result = await reservationAttribution();
  assert(result.ga_client_id === '987654.1788739000', 'Cookie prevaleceu sobre a tag');
  assert(result.ga_session_id === '1788739001', 'Sessao atual da tag nao prevaleceu');
});

Deno.test('reserva prossegue quando a tag nunca responde', async () => {
  environment('', { blockedStorage: true, gtag() {} });
  const result = await reservationAttribution();
  assert(result.ga_client_id === null && result.ga_session_id === null, 'Inventou identificadores');
});

Deno.test('nao aceita valores arbitrarios da tag', async () => {
  environment('', { gtag(command, target, field, callback) { callback('invalid-value'); } });
  const result = await reservationAttribution();
  assert(result.ga_client_id === null && result.ga_session_id === null, 'Aceitou identificador invalido');
});
