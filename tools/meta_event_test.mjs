import { metaEventTimestamp, normalizeMetaPhone } from '../supabase/functions/send-openai-ads-conversions/meta-event.ts';

const NOW = Date.parse('2026-10-25T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
function assert(condition, message) { if (!condition) throw new Error(message); }

Deno.test('Meta normaliza BR e preserva pais explicito de telefone internacional', () => {
  for (const [raw, expected] of [
    ['(85) 99999-9999', '5585999999999'],
    ['(85) 3333-4444', '558533334444'],
    [' +1 (202) 555-0123 ', '12025550123'],
    ['+55 (85) 99999-9999', '5585999999999'],
    ['+685 12345', '68512345'],
    ['+123456789012345', '123456789012345'],
  ]) assert(normalizeMetaPhone(raw) === expected, 'Telefone normalizado incorretamente');
  for (const raw of [null, '', '1234567', '+1234567890123456']) {
    assert(normalizeMetaPhone(raw) === null, 'Aceitou telefone fora dos limites');
  }
});

Deno.test('Meta preserva ocorrencia e aceita o limite de sete dias', () => {
  assert(metaEventTimestamp('2026-10-25T05:59:59-03:00', NOW) === NOW / 1000 - 1, 'Alterou instante/fuso');
  assert(metaEventTimestamp(new Date(NOW - 7 * DAY).toISOString(), NOW) === (NOW - 7 * DAY) / 1000,
    'Rejeitou o limite da janela');
});

Deno.test('Meta rejeita data invalida, futura ou expirada sem substituir por hoje', () => {
  for (const value of ['', 'invalid', new Date(NOW + 1).toISOString(),
    new Date(NOW - 7 * DAY - 1).toISOString()]) {
    let rejected = false;
    try { metaEventTimestamp(value, NOW); } catch { rejected = true; }
    assert(rejected, 'Aceitou ocorrencia invalida');
  }
});

Deno.test('worker Meta preserva hash e ID sem receita estimada nem datas rejeitadas', async () => {
  const original = { serve: Deno.serve, envGet: Deno.env.get, fetch: globalThis.fetch, now: Date.now };
  const finalized = [];
  const sent = [];
  let handler;
  const row = { email: null, phone: '+12025550123', fbp: null, fbc: null,
    party_size: 2, landing_url: 'https://example.invalid/' };
  const rows = [
    { ...row, queue_id: 'valid-us', event_id: 'sf-sched-fixture-us', occurred_at: new Date(NOW - 1000).toISOString() },
    { ...row, queue_id: 'valid-br', event_id: 'sf-sched-fixture-br', phone: '(85) 99999-9999',
      occurred_at: new Date(NOW - 2000).toISOString() },
    { ...row, queue_id: 'expired', event_id: 'sf-sched-fixture-expired', occurred_at: new Date(NOW - 8 * DAY).toISOString() },
    { ...row, queue_id: 'future', event_id: 'sf-sched-fixture-future', occurred_at: new Date(NOW + 1000).toISOString() },
    { ...row, queue_id: 'invalid', event_id: 'sf-sched-fixture-invalid', occurred_at: 'invalid' },
  ];
  globalThis.__metaTest = { client: { async rpc(name, args) {
    if (name === 'fn_advertising_event_allowed') return { data: true, error: null };
    if (name === 'fn_claim_pending_meta_conversions') return { data: rows, error: null };
    if (name === 'fn_finalize_openai_ads_conversion') { finalized.push(args); return { error: null }; }
    throw new Error('Unexpected RPC in offline Meta fixture');
  } } };
  try {
    Date.now = () => NOW;
    Deno.env.get = (key) => ({ SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture',
      META_PIXEL_ID: 'fixture-pixel', META_CAPI_TOKEN: 'fixture-token', OPENAI_ADS_TRIGGER_SECRET: 'fixture-trigger' }[key] || '');
    Deno.serve = (callback) => { handler = callback; };
    globalThis.fetch = async (_url, options) => {
      sent.push(JSON.parse(options.body).data[0]);
      return new Response('{"events_received":1}', { status: 200 });
    };
    let source = await Deno.readTextFile(new URL('../supabase/functions/send-openai-ads-conversions/index.ts', import.meta.url));
    source = source.replace('import { createClient } from "https://esm.sh/@supabase/supabase-js@2";',
      'const createClient = () => globalThis.__metaTest.client;');
    for (const helper of ['openai-event.ts', 'meta-event.ts']) {
      source = source.replace('"./' + helper + '"', JSON.stringify(new URL('../supabase/functions/send-openai-ads-conversions/' + helper, import.meta.url).href));
    }
    await import('data:application/typescript;base64,' + btoa(unescape(encodeURIComponent(source))));
    const response = await handler(new Request('https://example.invalid', { method: 'POST',
      headers: { 'x-openai-ads-secret': 'fixture-trigger' }, body: '{}' }));
    const result = await response.json();
    assert(result.providers.meta.sent === 2 && result.providers.meta.failed === 3, 'Resultado da fila divergente');
    assert(sent.length === 2 && finalized.length === 5, 'Enviou data invalida ou perdeu finalizacao');
    const hex = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
    assert(sent[0].user_data.ph[0] === await hex('12025550123'), 'Hash Meta alterou o pais explicito');
    assert(sent[1].user_data.ph[0] === await hex('5585999999999'), 'Hash Meta perdeu o codigo BR');
    assert(sent[0].event_id === rows[0].event_id && sent[0].event_time === (NOW - 1000) / 1000, 'ID ou ocorrencia alterados');
    assert(sent.every(event => event.event_name === 'Schedule' && event.custom_data.num_guests === 2
      && !('value' in event.custom_data) && !('currency' in event.custom_data)), 'Reserva virou receita presumida');
    assert(finalized.filter(row => row.p_status === 'failed').length === 3, 'Data rejeitada virou envio concluido');
  } finally {
    Deno.serve = original.serve; Deno.env.get = original.envGet; globalThis.fetch = original.fetch; Date.now = original.now;
    delete globalThis.__metaTest;
  }
});
