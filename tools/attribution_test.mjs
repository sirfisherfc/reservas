import { reservationAttribution, captureAttribution, measureReservationConfirmed,
  measureReservationConfirmedGA4, measureReservationConfirmedMeta, metaScheduleEventId } from '../assets/js/attribution.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const FIXTURE_NOW = Date.parse('2026-10-25T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
function test(name, run) {
  Deno.test(name, async () => {
    const RealDate = globalThis.Date;
    globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [FIXTURE_NOW])); }
      static now() { return FIXTURE_NOW; }
    };
    try { await run(); } finally { globalThis.Date = RealDate; }
  });
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

test('preserva origem e captura sessao GS1 mesmo com storage bloqueado', async () => {
  environment('_ga=GA1.1.123456.1788738227; _ga_F40Z5Y9QT6=GS1.1.1788738226.1.1.1788738250.0.0.0', { blockedStorage: true });
  const result = await reservationAttribution();
  assert(result.utm_source === 'google_maps', 'Origem compartilhada foi perdida');
  assert(result.ga_client_id === '123456.1788738227', 'client_id incorreto');
  assert(result.ga_session_id === '1788738226', 'Sessao legada nao foi capturada');
});

test('captura sessao no formato GS2', async () => {
  environment('_ga=GA1.1.123456.1788738227; _ga_F40Z5Y9QT6=GS2.1.s1788738999$o1$g1$t1788739001');
  const result = await reservationAttribution();
  assert(result.ga_session_id === '1788738999', 'Sessao GS2 incorreta');
});

test('prioriza identificadores da API da tag sobre cookies antigos', async () => {
  environment('_ga=GA1.1.123456.1788738227; _ga_F40Z5Y9QT6=GS1.1.1788738226.1.0.0', {
    gtag(command, target, field, callback) { callback(field === 'client_id' ? '987654.1788739000' : 1788739001); },
  });
  const result = await reservationAttribution();
  assert(result.ga_client_id === '987654.1788739000', 'Cookie prevaleceu sobre a tag');
  assert(result.ga_session_id === '1788739001', 'Sessao atual da tag nao prevaleceu');
});

test('reserva prossegue quando a tag nunca responde', async () => {
  environment('', { blockedStorage: true, gtag() {} });
  const result = await reservationAttribution();
  assert(result.ga_client_id === null && result.ga_session_id === null, 'Inventou identificadores');
});

test('nao aceita valores arbitrarios da tag', async () => {
  environment('', { gtag(command, target, field, callback) { callback('invalid-value'); } });
  const result = await reservationAttribution();
  assert(result.ga_client_id === null && result.ga_session_id === null, 'Aceitou identificador invalido');
});

function campaignEnvironment(stored, cookieStored = stored, search = '', { blockedStorage = false } = {}) {
  globalThis.document = { cookie: 'sf_attribution_v1=' + encodeURIComponent(JSON.stringify(cookieStored)), referrer: '' };
  globalThis.window = {
    location: { search, href: 'https://reservas.sirfisher.com.br/' + search,
      hostname: 'reservas.sirfisher.com.br', protocol: 'https:' },
    localStorage: {
      getItem() { if (blockedStorage) throw new Error('blocked'); return JSON.stringify(stored); },
      setItem() { if (blockedStorage) throw new Error('blocked'); },
    },
  };
}

test('nova campanha nao reutiliza oppref nem ad_id da anterior', () => {
  campaignEnvironment({ utm_source: 'chatgpt', oppref: 'old', ad_id: 'old-ad', captured_at: '2026-10-06T12:00:00Z' },
    undefined, '?utm_source=google&utm_medium=cpc&gclid=new');
  const result = captureAttribution();
  assert(result.utm_source === 'google' && result.gclid === 'new', 'Perdeu nova origem');
  assert(!result.oppref && !result.ad_id, 'Misturou origens de cliques diferentes');
});

test('origem mais recente do cookie compartilhado prevalece sobre storage local', () => {
  campaignEnvironment({ utm_source: 'chatgpt', oppref: 'old', captured_at: '2026-10-06T12:00:00Z' },
    { utm_source: 'instagram', captured_at: '2026-10-13T12:00:00Z' });
  const result = captureAttribution();
  assert(result.utm_source === 'instagram' && !result.oppref, 'Reintroduziu campanha antiga');
});

test('navegacao interna com a mesma origem preserva data e pagina do clique', () => {
  const stored = { utm_source: 'chatgpt', oppref: 'same', captured_at: '2026-10-06T12:00:00Z',
    landing_url: 'https://www.sirfisher.com.br/conheca/' };
  campaignEnvironment(stored, stored, '?utm_source=chatgpt&oppref=same');
  const result = captureAttribution();
  assert(result.captured_at === stored.captured_at && result.landing_url === stored.landing_url, 'Regravou o clique na navegacao interna');
});

test('Pixel envia reserva com hashes reais, deduplicacao e sem receita ou cidade presumidas', async () => {
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

test('GA4 conta reserva sem declarar faturamento realizado', () => {
  let event;
  globalThis.window = { gtag(...args) { event = args; } };
  measureReservationConfirmedGA4({ id: 'test', party_size: 2 });
  assert(event[1] === 'reservation_confirmed' && event[2].party_size === 2, 'Perdeu quantidade');
  assert(!('value' in event[2]) && !('currency' in event[2]), 'Reserva virou receita');
});

test('atribuicao com 90 dias expira sem reutilizar origem ou identificador antigo', () => {
  const expired = { utm_source: 'ig', oppref: 'expired-click',
    captured_at: new Date(FIXTURE_NOW - 90 * DAY).toISOString() };
  campaignEnvironment(expired);
  document.referrer = 'https://l.instagram.com/';
  const result = captureAttribution();
  assert(!result.utm_source && !result.oppref, 'Reutilizou campanha expirada');
  assert(result.captured_at === new Date(FIXTURE_NOW).toISOString(), 'Nao registrou nova chegada');
  assert(result.referrer === document.referrer, 'Perdeu referencia disponivel da nova chegada');
});

test('atribuicao valida ate antes do limite mantem o toque original', () => {
  const valid = { utm_source: 'ig', captured_at: new Date(FIXTURE_NOW - 90 * DAY + 1).toISOString() };
  campaignEnvironment(valid);
  assert(captureAttribution().captured_at === valid.captured_at, 'Expirou antes do prazo');
});

test('storage sem data, invalido ou futuro nao cria atribuicao falsa', () => {
  for (const captured_at of [undefined, null, '', 'invalid', '1970-01-01T00:00:00Z',
    new Date(FIXTURE_NOW + 1).toISOString()]) {
    campaignEnvironment({ utm_source: 'ig', captured_at });
    const result = captureAttribution();
    assert(!result.utm_source, 'Aceitou origem sem data valida');
    assert(result.captured_at === new Date(FIXTURE_NOW).toISOString(), 'Reaproveitou data invalida');
  }
});

test('copia invalida nao prevalece sobre a outra fonte valida', () => {
  const valid = { utm_source: 'ig', captured_at: new Date(FIXTURE_NOW - DAY).toISOString() };
  const expired = { utm_source: 'chatgpt', oppref: 'old',
    captured_at: new Date(FIXTURE_NOW - 91 * DAY).toISOString() };
  const future = { utm_source: 'chatgpt', oppref: 'future',
    captured_at: new Date(FIXTURE_NOW + DAY).toISOString() };
  for (const [local, shared] of [[expired, valid], [valid, expired], [valid, future]]) {
    campaignEnvironment(local, shared);
    const result = captureAttribution();
    assert(result.utm_source === 'ig' && !result.oppref, 'Escolheu copia invalida');
    assert(result.captured_at === valid.captured_at, 'Alterou o toque valido');
  }
});

test('captured_at deve ser texto e o registro nao pode ser array', () => {
  const validDate = new Date(FIXTURE_NOW - DAY).toISOString();
  for (const captured_at of [[validDate], FIXTURE_NOW - DAY, {}]) {
    campaignEnvironment({ utm_source: 'ig', captured_at });
    assert(!captureAttribution().utm_source, 'Converteu data que nao era texto');
  }
  campaignEnvironment([{ utm_source: 'ig', captured_at: validDate }]);
  assert(!captureAttribution().utm_source, 'Aceitou array como registro');
});

test('clique interno preserva data e cookie recebe somente o prazo restante', () => {
  const valid = { utm_source: 'ig', captured_at: new Date(FIXTURE_NOW - 10 * DAY).toISOString() };
  campaignEnvironment(valid, valid, '?utm_source=ig');
  const result = captureAttribution();
  assert(result.captured_at === valid.captured_at, 'Reiniciou a data no clique interno');
  assert(document.cookie.includes('Max-Age=' + 80 * DAY / 1000 + ';'), 'Renovou 90 dias a partir da navegacao');
});

test('cookie valido mantem origem e prazo quando storage esta bloqueado', () => {
  const valid = { utm_source: 'ig', captured_at: new Date(FIXTURE_NOW - 10 * DAY).toISOString() };
  campaignEnvironment(null, valid, '?utm_source=ig', { blockedStorage: true });
  const result = captureAttribution();
  assert(result.utm_source === 'ig' && result.captured_at === valid.captured_at, 'Perdeu cookie valido');
  assert(document.cookie.includes('Max-Age=' + 80 * DAY / 1000 + ';'), 'Prazo mudou com storage bloqueado');
});

test('campanha nova apos expirar recebe data atual sem herdar anuncio anterior', () => {
  const expired = { utm_source: 'chatgpt', oppref: 'old', ad_id: 'old-ad',
    captured_at: new Date(FIXTURE_NOW - 91 * DAY).toISOString() };
  campaignEnvironment(expired, expired, '?utm_source=ig&utm_medium=social&utm_content=bio');
  const result = captureAttribution();
  assert(result.utm_source === 'ig' && result.utm_content === 'bio', 'Perdeu nova campanha');
  assert(!result.oppref && !result.ad_id, 'Herdou identificadores expirados');
  assert(result.captured_at === new Date(FIXTURE_NOW).toISOString(), 'Nao registrou o novo toque');
});

test('utm_id chega ao contrato existente sem substituir campaign_id explicito', async () => {
  for (const [query, expected] of [['?utm_source=instagram&utm_id=123', '123'],
    ['?utm_source=instagram&utm_id=123&campaign_id=456', '456']]) {
    campaignEnvironment({}, {}, query);
    const result = await reservationAttribution();
    assert(result.campaign_id === expected, 'ID da campanha nao chegou ao RPC');
  }
});

test('novo conteudo na mesma campanha substitui o toque e nao herda anuncio anterior', async () => {
  const stored = { utm_source: 'instagram', utm_campaign: 'novembro', utm_content: 'ig_100',
    ad_id: 'old', captured_at: '2026-10-06T12:00:00Z' };
  campaignEnvironment(stored, stored, '?utm_source=instagram&utm_campaign=novembro&utm_content=ig_200');
  const result = await reservationAttribution();
  assert(result.utm_content === 'ig_200' && result.ad_id === null, 'Misturou conteudo/anuncio anterior');
  assert(result.captured_at === new Date(FIXTURE_NOW).toISOString(), 'Nao registrou novo toque');
});

test('referrer externo inicia novo toque com mesma fonte sem herdar conteudo antigo', () => {
  const stored = { utm_source: 'instagram', utm_content: 'ig_100', ad_id: 'old',
    captured_at: '2026-10-06T12:00:00Z' };
  campaignEnvironment(stored, stored, '?utm_source=instagram');
  document.referrer = 'https://l.instagram.com/';
  const result = captureAttribution();
  assert(result.utm_source === 'instagram' && !result.utm_content && !result.ad_id, 'Herdou conteudo de outro clique');
  assert(result.captured_at === new Date(FIXTURE_NOW).toISOString(), 'Nao renovou chegada externa');
});

test('referrer interno preserva conteudo e data original entre subdominios', () => {
  const stored = { utm_source: 'instagram', utm_content: 'ig_100',
    captured_at: '2026-10-06T12:00:00Z' };
  for (const referrer of ['https://sirfisher.com.br/', 'https://www.sirfisher.com.br/conheca/']) {
    campaignEnvironment(stored, stored, '?utm_source=instagram');
    document.referrer = referrer;
    const result = captureAttribution();
    assert(result.utm_content === 'ig_100' && result.captured_at === stored.captured_at, 'Perdeu toque interno');
  }
});

test('segunda captura com referrer externo mantem a chegada ja registrada neste documento', () => {
  campaignEnvironment({}, {}, '?utm_source=instagram&utm_content=ig_123');
  document.referrer = 'https://l.instagram.com/';
  const arrival = captureAttribution();
  window.location.href += '#confirmacao';
  const second = captureAttribution();
  assert(second.landing_url === arrival.landing_url, 'Regravou chegada ao enviar formulario');
  assert(second.captured_at === arrival.captured_at, 'Reiniciou data no mesmo documento');
});

test('Pixel Meta preserva Schedule e o ID usado pela CAPI', () => {
  let call;
  globalThis.window = { fbq(...args) { call = args; } };
  measureReservationConfirmedMeta({ id: 'fixture-reservation', party_size: 2 });
  assert(call[1] === 'Schedule', 'Mudou evento Meta existente');
  assert(call[3].eventID === metaScheduleEventId('fixture-reservation')
    && call[3].eventID === 'sf-sched-fixture-reservation', 'Mudou deduplicacao Meta');
});
