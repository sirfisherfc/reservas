import { reservationAttribution, captureAttribution, measureReservationConfirmed,
  measureReservationConfirmedGA4 } from '../assets/js/attribution.js';

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

function campaignEnvironment(stored, cookieStored = stored, search = '') {
  globalThis.document = { cookie: 'sf_attribution_v1=' + encodeURIComponent(JSON.stringify(cookieStored)), referrer: '' };
  globalThis.window = {
    location: { search, href: 'https://reservas.sirfisher.com.br/' + search,
      hostname: 'reservas.sirfisher.com.br', protocol: 'https:' },
    localStorage: { getItem() { return JSON.stringify(stored); }, setItem() {} },
  };
}

Deno.test('nova campanha nao reutiliza oppref nem ad_id da anterior', () => {
  campaignEnvironment({ utm_source: 'chatgpt', oppref: 'old', ad_id: 'old-ad', captured_at: '2026-10-06T12:00:00Z' },
    undefined, '?utm_source=google&utm_medium=cpc&gclid=new');
  const result = captureAttribution();
  assert(result.utm_source === 'google' && result.gclid === 'new', 'Perdeu nova origem');
  assert(!result.oppref && !result.ad_id, 'Misturou origens de cliques diferentes');
});

Deno.test('origem mais recente do cookie compartilhado prevalece sobre storage local', () => {
  campaignEnvironment({ utm_source: 'chatgpt', oppref: 'old', captured_at: '2026-10-06T12:00:00Z' },
    { utm_source: 'instagram', captured_at: '2026-10-13T12:00:00Z' });
  const result = captureAttribution();
  assert(result.utm_source === 'instagram' && !result.oppref, 'Reintroduziu campanha antiga');
});

Deno.test('navegacao interna com a mesma origem preserva data e pagina do clique', () => {
  const stored = { utm_source: 'chatgpt', oppref: 'same', captured_at: '2026-10-06T12:00:00Z',
    landing_url: 'https://www.sirfisher.com.br/conheca/' };
  campaignEnvironment(stored, stored, '?utm_source=chatgpt&oppref=same');
  const result = captureAttribution();
  assert(result.captured_at === stored.captured_at && result.landing_url === stored.landing_url, 'Regravou o clique na navegacao interna');
});

Deno.test('Pixel envia reserva com hashes reais, deduplicacao e sem receita ou cidade presumidas', async () => {
  const calls = [];
  globalThis.window = { oaiq(...args) { calls.push(args); } };
  await measureReservationConfirmed({ id: 'test-reservation', party_size: 2 },
    { email: ' VISITOR@example.invalid ', phone: '+441234567890', name: 'Test Visitor' });
  const user = calls[0][1].user;
  assert(user.email_sha256?.length === 64 && user.phone_number_sha256?.length === 64, 'Hash ausente');
  assert(!user.city && !user.region && !user.country, 'Inventou localizacao do visitante');
  assert(calls[1][1] === 'appointment_scheduled' && calls[1][3].event_id === 'sf-oai-sched-test-reservation', 'Deduplicacao divergente');
  assert(!('amount' in calls[1][2]) && !('currency' in calls[1][2]), 'Reserva virou receita estimada');
});

Deno.test('GA4 conta reserva sem declarar faturamento realizado', () => {
  let event;
  globalThis.window = { gtag(...args) { event = args; } };
  measureReservationConfirmedGA4({ id: 'test', party_size: 2 });
  assert(event[1] === 'reservation_confirmed' && event[2].party_size === 2, 'Perdeu quantidade');
  assert(!('value' in event[2]) && !('currency' in event[2]), 'Reserva virou receita');
});
