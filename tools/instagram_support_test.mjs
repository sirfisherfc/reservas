import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, loadConfig, extractEvents, limitedBody } from '../supabase/functions/instagram-support/core.mjs';
import { ASSETS, LIMITS, MODEL, redactText, inputTokenUpperBound, reviewedReply } from '../supabase/functions/instagram-support/policy.mjs';
import { createTransports, createProfileEnricher } from '../supabase/functions/instagram-support/transport.mjs';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const NOW = Date.parse('2026-11-01T15:00:00Z');
const CUSTOMER = '200000000000001';
const OTHER = '200000000000002';
const AUTH_USER = '00000000-0000-4000-8000-000000000099';
const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const fixtureConfig = () => loadConfig(name => ({ SUPABASE_URL: 'https://' + ASSETS.projectHost,
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key-for-test-only',
  INSTAGRAM_APP_SECRET: 'synthetic-app-secret-for-test-only-000',
  INSTAGRAM_VERIFY_TOKEN: 'synthetic-verify-token-for-test-only-000',
  INSTAGRAM_PAGE_ACCESS_TOKEN: 'synthetic-page-token-for-test-only',
  INSTAGRAM_DRAIN_SECRET: 'synthetic-drain-secret-for-test-only-000',
  GEMINI_API_KEY: 'synthetic-gemini-key-for-test-only', INSTAGRAM_SUPPORT_MODE: 'test',
  INSTAGRAM_AI_DATA_APPROVED: 'true', INSTAGRAM_TEST_SENDER_IDS: CUSTOMER + ',' + OTHER }[name]));
const responseFor = intent => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: intent }] } }],
  usageMetadata: { promptTokenCount: 400, candidatesTokenCount: 3 } });
const envelope = (mid, text = 'Qual é o horário?', sender = CUSTOMER, extra = {}) => ({ object: 'instagram', entry: [{ id: ASSETS.instagramId,
  messaging: [{ sender: { id: sender }, recipient: { id: ASSETS.instagramId }, timestamp: NOW,
    message: { mid, text, ...extra } }] }] });
const incoming = (mid, text = 'Qual é o horário?', sender = CUSTOMER) => ({ mid, sender_id: sender,
  recipient_id: ASSETS.instagramId, timestamp_ms: NOW, text, kind: 'incoming' });
const priority = reason => ({ URGENCY: 100, ALLERGY: 90, PAYMENT_DISPUTE: 80, COMPLAINT: 70, HUMAN: 50 }[reason?.toUpperCase()] ?? 10);

// In-memory contract fixture. Actual SQL locking/lease tests live with the migration.
class Store {
  state = { mode: 'test', paused: false, model: MODEL, max_input_tokens: LIMITS.inputTokens,
    max_output_tokens: LIMITS.outputTokens, model_usage_allowed: true, billing_verified: true,
    test_sender_ids: [CUSTOMER, OTHER], monthly_budget_cents: 4500 };
  threads = new Map(); events = new Map(); outbox = new Map(); cases = [];
  reservationCount = 0; reserved = 0; cap = 4500; count = 0; ingested = []; controls = [];
  async settings() { return structuredClone(this.state); }
  async ingest(input) {
    this.ingested.push(input.kind);
    if (this.events.has(input.mid)) return { status: 'duplicate', queued: false };
    let thread = this.threads.get(input.sender_id);
    if (!thread) { thread = { id: uid(++this.count), version: 0, human: false, clarify: 0, sent: false }; this.threads.set(input.sender_id, thread); }
    if (input.kind === 'echo') {
      const own = [...this.outbox.values()].some(row => row.provider_mid === input.mid);
      if (!own) { thread.human = true; thread.version++; this.cancelNotice(thread);
        if (!this.cases.some(row => row.thread_id === thread.id)) this.cases.push({ thread_id: thread.id, reason: 'manual_echo' }); }
      this.events.set(input.mid, { ...input, status: 'ignored' }); return { queued: false };
    }
    const event = { ...input, event_id: uid(++this.count), thread_id: thread.id,
      message_at: new Date(input.timestamp_ms).toISOString(), status: 'ignored' };
    if (thread.human) {
      const active = this.cases.find(row => row.thread_id === thread.id);
      const notice = active && this.row(active.notice);
      if (input.safety_intent && active && priority(input.safety_intent) > priority(active.reason)) {
        active.reason = input.safety_intent.toLowerCase();
        if (notice?.ack && ['pending', 'completed'].includes(notice.status)) {
          thread.version++; thread.leased = null;
          notice.status = 'pending'; notice.lease = null; notice.thread_version = thread.version; notice.reply_key = input.safety_intent;
        }
      }
      this.events.set(input.mid, event); return { queued: notice?.status === 'pending', case_saved: !!active };
    }
    if (input.safety_intent && !this.state.paused && this.state.mode !== 'off'
      && (this.state.mode !== 'test' || this.state.test_sender_ids.includes(input.sender_id))) {
      thread.human = true; thread.version++;
      const active = { id: uid(++this.count), thread_id: thread.id, reason: input.safety_intent.toLowerCase(), notice: event.event_id };
      this.cases.push(active);
      Object.assign(event, { text: '', status: 'pending', ack: true, handoff_ack: true,
        case_id: active.id, reply_key: input.safety_intent, thread_version: thread.version });
      this.events.set(input.mid, event); return { queued: true, case_saved: true };
    }
    thread.version++;
    const queued = !thread.human && !this.state.paused && this.state.mode !== 'off'
      && (this.state.mode !== 'test' || this.state.test_sender_ids.includes(input.sender_id));
    event.status = queued ? 'pending' : 'ignored';
    this.events.set(input.mid, event); return { queued };
  }
  async claim() {
    if (this.state.paused || this.state.mode === 'off') return [];
    for (const event of this.events.values()) {
      const thread = this.threads.get(event.sender_id);
      if (event.status !== 'pending' || (thread.human && !event.ack) || thread.leased) continue;
      event.status = event.ack ? 'completed' : 'processing'; event.lease = uid(++this.count); event.thread_version = thread.version;
      thread.leased = event.lease;
      return [{ ...event, clarify_count: thread.clarify, first_reply: !thread.sent }];
    }
    return [];
  }
  row(id) { return [...this.events.values()].find(row => row.event_id === id); }
  async reserveBudget(id, lease, cents) {
    const event = this.row(id); const thread = this.threads.get(event.sender_id);
    if (event.reserved) return { allowed: false, reason: 'already_started' };
    if (event.lease !== lease || thread.version !== event.thread_version || thread.human) return { allowed: false, reason: 'lease_invalid' };
    if (this.reserved + cents > this.cap) return { allowed: false, reason: 'monthly_limit' };
    event.reserved = true; this.reserved += cents; this.reservationCount++;
    return { allowed: true, reservation_id: uid(++this.count) };
  }
  async complete(id, lease, result) {
    const event = this.row(id); const thread = this.threads.get(event.sender_id);
    if (event.lease !== lease || event.status !== 'processing' || thread.human || thread.version !== event.thread_version) return { allowed: false, decision: 'cancelled' };
    if (result.skip) { event.status = 'ignored'; thread.leased = null; return { allowed: false, decision: 'cancelled' }; }
    event.result = result; event.status = 'completed';
    let decision = 'reply';
    if (result.intent === 'UNKNOWN') { thread.clarify++; decision = 'clarify'; } else if (!result.handoff_reason) thread.clarify = 0;
    if (result.handoff_reason) { decision = 'handoff'; thread.human = true; thread.version++; event.ack = true;
      this.cases.push({ id: uid(++this.count), thread_id: thread.id, reason: result.handoff_reason, notice: id }); }
    event.thread_version = thread.version;
    return { allowed: true, decision, thread_version: thread.version, case_saved: decision === 'handoff' };
  }
  async prepareSend(id, lease, text, version) {
    const event = this.row(id); const thread = this.threads.get(event.sender_id);
    if (event.status !== 'completed' || event.lease !== lease || thread.version !== version
      || (thread.human && !event.ack) || this.state.paused || this.state.mode === 'off') return { allowed: false };
    if ([...this.outbox.values()].some(row => row.event_id === id)) return { allowed: false };
    const outboxId = uid(++this.count); event.status = 'sending';
    this.outbox.set(outboxId, { event_id: id, sender_id: event.sender_id, status: 'sending', text });
    return { allowed: true, outbox_id: outboxId };
  }
  async finishSend(id, _lease, status, mid) {
    const box = this.outbox.get(id); box.status = status; box.provider_mid = mid;
    const event = this.row(box.event_id); event.status = status;
    const thread = this.threads.get(box.sender_id); thread.leased = null;
    if (status === 'sent') thread.sent = true; else { thread.human = true; thread.version++; this.cases.push({ reason: 'delivery_' + status }); }
    return { changed: true };
  }
  cancelNotice(thread) {
    for (const event of this.events.values()) if (event.thread_id === thread.id && event.ack && ['pending', 'completed'].includes(event.status)) {
      event.status = 'superseded'; event.ack = false; thread.leased = null;
    }
  }
  async control(action, id, args) {
    this.controls.push({ action, thread: id, args });
    if (action === 'pause_global') { this.state.paused = args.paused; if (args.paused) for (const thread of this.threads.values()) this.cancelNotice(thread); }
    else { const thread = [...this.threads.values()].find(row => row.id === id); if (thread) this.cancelNotice(thread); }
    return { changed: true };
  }
}

function harness(options = {}) {
  const store = options.store ?? new Store(); const sent = []; const calls = []; const tasks = [];
  const config = options.config ?? fixtureConfig();
  const app = createHandler({ config, store, now: () => NOW,
    classify: options.classify ?? (async body => { calls.push(body); return responseFor('HOURS'); }),
    send: options.send ?? (async (sender, text) => { sent.push({ sender, text }); return { message_id: 'synthetic-output-' + sent.length }; }),
    authorizeAdmin: options.authorizeAdmin ?? (async () => null), sendAlert: options.sendAlert ?? null,
    enrichCases: options.enrichCases ?? null,
    waitUntil: options.background ? promise => tasks.push(promise) : null,
  });
  return { ...app, store, sent, calls, tasks, config };
}

async function signed(config, payload, overrideBody) {
  const body = overrideBody ?? JSON.stringify(payload);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(config.appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))].map(v => v.toString(16).padStart(2, '0')).join('');
  return new Request('https://example.invalid/functions/v1/instagram-support', { method: 'POST', body,
    headers: { 'x-hub-signature-256': 'sha256=' + signature, 'Content-Type': 'application/json' } });
}

test('challenge requires exact token and mode; default config is off and closed', async () => {
  const app = harness();
  const url = 'https://example.invalid/?hub.mode=subscribe&hub.challenge=123456&hub.verify_token=';
  assert.equal(await (await app.handler(new Request(url + app.config.verifyToken))).text(), '123456');
  assert.equal((await app.handler(new Request(url + 'wrong'))).status, 403);
  const closed = harness({ config: loadConfig(() => undefined) });
  assert.equal(closed.config.mode, 'off');
  assert.equal((await closed.handler(new Request(url))).status, 503);
});

test('HMAC covers raw bytes; missing/tampered signatures have no persistence or model call', async () => {
  const app = harness(); const request = await signed(app.config, envelope('synthetic-mid-1'));
  const tampered = new Request(request.url, { method: 'POST', headers: request.headers, body: await request.text() + ' ' });
  assert.equal((await app.handler(tampered)).status, 401);
  assert.equal((await app.handler(new Request(request.url, { method: 'POST', body: '{}' }))).status, 401);
  assert.equal(app.store.events.size, 0); assert.equal(app.calls.length, 0);
});

test('streamed and announced bodies are bounded before parsing', async () => {
  const app = harness();
  const response = await app.handler(new Request('https://example.invalid', { method: 'POST', body: 'x', headers: { 'content-length': String(LIMITS.bodyBytes + 1) } }));
  assert.equal(response.status, 413);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(9)); controller.close(); } });
  await assert.rejects(() => limitedBody(new Request('https://example.invalid', { method: 'POST', body: stream, duplex: 'half' }), 8), /body_limit/);
});

test('foreign assets, groups, deleted messages, reactions and read events are ignored', () => {
  const foreign = envelope('synthetic-foreign'); foreign.entry[0].id = '999999999999999';
  assert.deepEqual(extractEvents(foreign, NOW), []);
  for (const extra of [{ is_group: true }, { is_deleted: true }]) assert.deepEqual(extractEvents(envelope('synthetic-ignored', '', CUSTOMER, extra), NOW), []);
  const read = envelope('synthetic-read'); read.entry[0].messaging[0].read = { mid: 'synthetic-read' };
  assert.deepEqual(extractEvents(read, NOW), []);
});

test('redaction removes contact identifiers and model byte bound is enforced', () => {
  const text = redactText('teste@example.invalid +55 (11) 90000-0000 @fixture https://example.invalid/a');
  assert.equal(text.includes('example.invalid'), false); assert.equal(text.includes('90000'), false); assert.equal(text.includes('@fixture'), false);
  assert.ok(inputTokenUpperBound('Qual o horário?').tokens < LIMITS.inputTokens);
  assert.ok(inputTokenUpperBound('🙂'.repeat(1200)).tokens > LIMITS.inputTokens);
  assert.equal(redactText('Abre em 2026-12-25?'), 'Abre em 2026-12-25?');
});

test('200 follows durable ingest; persistence failure is retriable without false acknowledgment', async () => {
  const app = harness({ background: true });
  assert.equal((await app.handler(await signed(app.config, envelope('synthetic-durable')))).status, 200);
  assert.equal(app.store.events.size, 1); await Promise.all(app.tasks); assert.equal(app.sent.length, 1);
  const failed = harness(); failed.store.ingest = async () => { throw new Error('synthetic-storage-failure'); };
  assert.equal((await failed.handler(await signed(failed.config, envelope('synthetic-failed')))).status, 503);
  assert.equal(failed.sent.length, 0);
});

test('duplicate callbacks and concurrent drains reserve and send only once', async () => {
  const app = harness();
  await Promise.all([app.handler(await signed(app.config, envelope('synthetic-duplicate'))), app.handler(await signed(app.config, envelope('synthetic-duplicate')))]);
  await Promise.all([app.drain(), app.drain()]);
  assert.equal(app.store.events.size, 1); assert.equal(app.store.reservationCount, 1);
  assert.equal(app.calls.length, 1); assert.equal(app.sent.length, 1);
});

test('unknown echo is persisted before incoming in the same envelope and pauses without AI', async () => {
  const app = harness(); const payload = envelope('synthetic-after-manual');
  payload.entry[0].messaging.push({ sender: { id: ASSETS.instagramId }, recipient: { id: CUSTOMER }, timestamp: NOW,
    message: { mid: 'synthetic-manual-echo', is_echo: true, text: 'Mensagem de atendimento humano.' } });
  await app.handler(await signed(app.config, payload)); await app.drain();
  assert.deepEqual(app.store.ingested, ['echo', 'incoming']); assert.equal(app.calls.length, 0); assert.equal(app.sent.length, 0);
  assert.equal(app.store.threads.get(CUSTOMER).human, true);
});

test('human request creates pause before acknowledgement and future incoming stays silent', async () => {
  const app = harness(); await app.store.ingest(incoming('synthetic-human', 'Quero falar com a gerente.'));
  await app.drain(); assert.equal(app.calls.length, 0); assert.equal(app.store.cases.length, 1);
  assert.equal(app.store.threads.get(CUSTOMER).human, true); assert.match(app.sent[0].text, /pausadas/);
  await app.store.ingest(incoming('synthetic-human-followup', 'Qual é o horário?')); await app.drain();
  assert.equal(app.sent.length, 1); assert.equal(app.calls.length, 0);
});

test('manual takeover racing with model completion suppresses the automatic response', async () => {
  let started; const startedPromise = new Promise(resolve => started = resolve);
  let release; const releasePromise = new Promise(resolve => release = resolve);
  const app = harness({ classify: async () => { started(); await releasePromise; return responseFor('HOURS'); } });
  await app.store.ingest(incoming('synthetic-race'));
  const running = app.drain(); await startedPromise;
  await app.store.ingest({ ...incoming('synthetic-race-echo', ''), kind: 'echo' });
  release(); await running; assert.equal(app.sent.length, 0); assert.equal(app.store.reserved, 2);
});

test('atomic reservation prevents two simultaneous calls from exceeding the budget', async () => {
  const app = harness(); app.store.cap = 2;
  await app.store.ingest(incoming('synthetic-budget-a', 'Horário?', CUSTOMER));
  await app.store.ingest(incoming('synthetic-budget-b', 'Horário?', OTHER));
  await Promise.all([app.drain(), app.drain()]);
  assert.equal(app.calls.length, 1); assert.equal(app.store.reserved, 2);
  assert.ok(app.store.cases.some(row => row.reason === 'budget_or_rate_limit'));
});

test('one clarification then human, with no model calls while human-paused', async () => {
  const app = harness({ classify: async () => responseFor('UNKNOWN') });
  await app.store.ingest(incoming('synthetic-unknown-1', 'Outra questão.')); await app.drain();
  assert.equal(app.store.threads.get(CUSTOMER).clarify, 1); assert.equal(app.store.cases.length, 0);
  await app.store.ingest(incoming('synthetic-unknown-2', 'Ainda não entendi.')); await app.drain();
  assert.equal(app.store.threads.get(CUSTOMER).human, true); assert.equal(app.sent.length, 2);
  await app.store.ingest(incoming('synthetic-unknown-3', 'Pode verificar?')); await app.drain(); assert.equal(app.sent.length, 2);
});

test('unsafe/generated output never becomes a customer response', async () => {
  const app = harness({ classify: async () => responseFor('Sua reserva e pagamento estão confirmados!') });
  await app.store.ingest(incoming('synthetic-invalid-enum')); await app.drain();
  assert.equal(app.store.reserved, 2); assert.equal(app.store.cases[0].reason, 'ai_failed');
  assert.equal(app.sent[0].text.includes('pagamento estão confirmados'), false);
});

test('model failure, missing privacy approval and expired window fail closed', async () => {
  const failed = harness({ classify: async () => { throw new Error('synthetic-failure'); } });
  await failed.store.ingest(incoming('synthetic-ai-failure')); await failed.drain();
  assert.equal(failed.store.reserved, 2); assert.equal(failed.store.cases[0].reason, 'ai_failed');
  const privacy = harness({ config: { ...fixtureConfig(), dataApproved: false } });
  await privacy.store.ingest(incoming('synthetic-privacy')); await privacy.drain();
  assert.equal(privacy.calls.length, 0); assert.equal(privacy.store.cases[0].reason, 'ai_not_ready');
  const old = harness(); await old.store.ingest({ ...incoming('synthetic-expired'), timestamp_ms: NOW - 86_400_001 }); await old.drain();
  assert.equal(old.calls.length, 0); assert.equal(old.sent.length, 0); assert.equal(old.store.cases[0].reason, 'window_expired');
});

test('off mode and a test sender outside both lists never call AI or Graph', async () => {
  const off = harness({ config: { ...fixtureConfig(), mode: 'off' } });
  await off.store.ingest(incoming('synthetic-off')); await off.drain(); assert.equal(off.calls.length, 0); assert.equal(off.sent.length, 0);
  const unlisted = harness({ config: { ...fixtureConfig(), testSenders: new Set() } });
  await unlisted.store.ingest(incoming('synthetic-not-allowlisted')); await unlisted.drain(); assert.equal(unlisted.calls.length, 0); assert.equal(unlisted.sent.length, 0);
});

test('missing Meta send configuration blocks paid model calls as well as sending', async () => {
  const app = harness({ config: { ...fixtureConfig(), pageToken: '' } });
  await app.store.ingest(incoming('synthetic-send-not-ready')); await app.drain();
  assert.equal(app.calls.length, 0); assert.equal(app.sent.length, 0); assert.equal(app.store.reserved, 0);
  assert.equal(app.store.cases[0].reason, 'ai_not_ready');
});

test('uncertain delivery stays final and is not automatically resent', async () => {
  let sends = 0; const app = harness({ send: async () => { sends++; throw new Error('synthetic-network-timeout'); } });
  await app.store.ingest(incoming('synthetic-uncertain')); await app.drain(); await app.drain();
  assert.equal(sends, 1); assert.equal([...app.store.outbox.values()][0].status, 'uncertain');
  assert.equal(app.store.threads.get(CUSTOMER).human, true);
});

test('drain secret and administrator authorization are separate and never accept anonymous control', async () => {
  const app = harness();
  assert.equal((await app.handler(new Request('https://example.invalid/drain', { method: 'POST' }))).status, 401);
  assert.equal((await app.handler(new Request('https://example.invalid/control', { method: 'POST', body: '{"action":"cases"}' }))).status, 403);
  const admin = harness({ authorizeAdmin: async () => AUTH_USER });
  assert.equal((await admin.handler(new Request('https://example.invalid/control', { method: 'POST', body: '{"action":"resume","thread_id":"'+uid(1)+'"}' }))).status, 400);
  assert.equal((await admin.handler(new Request('https://example.invalid/control', { method: 'POST', headers: { Origin: 'https://example.invalid' }, body: '{"action":"cases"}' }))).status, 403);
  assert.equal((await admin.handler(new Request('https://example.invalid/control', { method: 'POST', body: '{"action":"pause_global","paused":true}' }))).status, 200);
  assert.equal(admin.store.controls[0].args.actor_id, AUTH_USER);
});

test('authenticated health proves runtime gates without claiming work, calling AI or sending', async () => {
  const app = harness(); const url = 'https://example.invalid/health';
  assert.equal((await app.handler(new Request(url))).status, 403);
  assert.equal((await app.handler(new Request(url, { headers: { 'x-instagram-drain-secret': 'wrong' } }))).status, 403);
  const result = await app.handler(new Request(url, { headers: { 'x-instagram-drain-secret': app.config.drainSecret } }));
  assert.equal(result.status, 200);
  const health = await result.json();
  assert.equal(health.runtime_mode, 'test'); assert.equal(health.effective_mode, 'test');
  assert.equal(health.runtime_test_senders, 2); assert.equal(health.matched_test_senders, 2);
  assert.equal(JSON.stringify(health).includes(CUSTOMER), false);
  assert.equal(app.calls.length, 0); assert.equal(app.sent.length, 0); assert.equal(app.store.events.size, 0);
});

test('server checks getUser then fn_is_admin using the user JWT, ignoring editable metadata', async () => {
  const seen = []; let isAdmin = false;
  const transport = createTransports(fixtureConfig(), async (url, options) => {
    seen.push({ path: new URL(url).pathname, authorization: options.headers.Authorization });
    return new Response(JSON.stringify(url.endsWith('/auth/v1/user') ? { id: AUTH_USER, user_metadata: { role: 'admin' } } : isAdmin));
  });
  const request = new Request('https://example.invalid/control', { headers: { Authorization: 'Bearer synthetic.jwt.signature' } });
  assert.equal(await transport.authorizeAdmin(request), null); isAdmin = true;
  assert.equal(await transport.authorizeAdmin(request), AUTH_USER);
  assert.ok(seen.every(row => row.authorization === 'Bearer synthetic.jwt.signature'));
  assert.deepEqual(seen.slice(0, 2).map(row => row.path), ['/auth/v1/user', '/rest/v1/rpc/fn_is_admin']);
});

test('curated replies preserve limits and never claim reservation/payment execution', () => {
  assert.match(reviewedReply('MENU', '', NOW), /em conferência/);
  assert.match(reviewedReply('RESERVATION_LINK', '', NOW), /confirmação aparece ao finalizar/);
  assert.match(reviewedReply('HOURS', 'Abre em 2026-12-25?', NOW), /fechada/);
  assert.match(reviewedReply('ALLERGY', '', NOW, { handoff: true }), /cozinha/);
});

function alertHarness(sendAlert, extra = {}) {
  const store = new Store(); store.state.alerts_enabled = true;
  const alert = { alert_id: uid(800), lease: uid(801), case_id: uid(802), revision: 1,
    reason: 'complaint', manager_email: 'fixture@example.invalid', status: 'pending' };
  store.claimAlerts = async () => { if (alert.status !== 'pending') return []; alert.status = 'sending'; return [{ ...alert }]; };
  store.finishAlert = async (_id, _lease, status, provider, retryable) => { alert.status = status; alert.provider_id = provider; alert.retryable = retryable; return { changed: true }; };
  const config = { ...fixtureConfig(), alertsEnabled: true, resendKey: 'synthetic-resend-key',
    resendFrom: 'Fixture <sender@example.invalid>', ...extra };
  return { ...harness({ store, config, sendAlert }), alert };
}

test('email alert is claimed once, acknowledged only after provider result, and never exposes recipient', async () => {
  let sent = 0;
  const app = alertHarness(async () => { sent++; return { id: 'synthetic-email-result' }; });
  const results = await Promise.all([app.drain(), app.drain()]);
  assert.equal(sent, 1); assert.equal(app.alert.status, 'sent');
  assert.equal(app.alert.provider_id, 'synthetic-email-result'); assert.equal(app.sent.length, 0);
  assert.equal(JSON.stringify(results).includes('fixture@example.invalid'), false);
});

test('email timeout is uncertain and does not automatically repeat; default email gate stays off', async () => {
  let sent = 0;
  const app = alertHarness(async () => { sent++; throw new Error('synthetic-email-timeout'); });
  await app.drain(); await app.drain();
  assert.equal(sent, 1); assert.equal(app.alert.status, 'uncertain'); assert.equal(app.alert.retryable, false);
  const off = alertHarness(async () => { throw new Error('must not be called'); }, { alertsEnabled: false });
  await off.drain(); assert.equal(off.alert.status, 'pending');
});

test('email transport sends only fixed topic and panel URL, with stable idempotency key', async () => {
  const captured = [];
  const config = { ...fixtureConfig(), resendKey: 'synthetic-resend-key', resendFrom: 'Fixture <sender@example.invalid>' };
  const transport = createTransports(config, async (url, options) => { captured.push({ url, options }); return new Response('{"id":"synthetic-resend-id"}'); });
  const alert = { alert_id: uid(850), revision: 1, manager_email: 'fixture@example.invalid', reason: 'complaint',
    sender_id: CUSTOMER, verified_username: 'synthetic_person', profile_url: 'https://www.instagram.com/synthetic_person/',
    summary: 'SYNTHETIC_CUSTOMER_TEXT_SHOULD_NOT_BE_SENT' };
  await transport.sendAlert(alert); await transport.sendAlert(alert);
  assert.equal(captured[0].url, 'https://api.resend.com/emails');
  assert.equal(captured[0].options.headers['Idempotency-Key'], captured[1].options.headers['Idempotency-Key']);
  const payload = JSON.parse(captured[0].options.body);
  assert.deepEqual(payload.to, ['fixture@example.invalid']);
  assert.equal(payload.text.includes(CUSTOMER), false); assert.equal(payload.text.includes(alert.summary), false);
  assert.equal(payload.text.includes(alert.verified_username), false); assert.equal(payload.text.includes(alert.profile_url), false);
  assert.match(payload.text, /Reclamação/); assert.match(payload.text, /admin\/atendimento.html/);
  assert.equal(captured[0].url.includes(config.resendKey), false);
});

test('provider error bodies never enter thrown errors and rejected delivery is explicit', async () => {
  const transport = createTransports(fixtureConfig(), async () => new Response('SYNTHETIC_PRIVATE_ERROR_BODY', { status: 400 }));
  await assert.rejects(() => transport.send(CUSTOMER, 'Texto revisado.'), error =>
    error.message === 'provider_rejected' && error.deliveryStatus === 'failed' && !error.message.includes('PRIVATE'));
});

test('long messages preserve safety intent from the tail and never reach the model', async () => {
  const app = harness({ background: true });
  const text = 'Qual o horário? ' + 'contexto '.repeat(170) + 'Tenho alergia grave e quero falar com uma pessoa.';
  const payload = envelope('synthetic-long-risk', text);
  const extracted = extractEvents(payload, NOW)[0];
  assert.equal(extracted.safety_intent, 'ALLERGY'); assert.ok(extracted.text.length < 1200);
  await app.handler(await signed(app.config, payload)); await Promise.all(app.tasks);
  assert.equal(app.calls.length, 0); assert.equal(app.sent.length, 1); assert.match(app.sent[0].text, /mesmo óleo/);
  assert.equal(app.store.threads.get(CUSTOMER).human, true); assert.equal(app.store.cases[0].reason, 'allergy');
});

test('a later message cannot supersede an explicit request for human or allergy', async () => {
  for (const risk of ['Quero falar com a gerente.', 'Tenho alergia grave.']) {
    const app = harness(); const payload = envelope('synthetic-first-risk', risk);
    payload.entry[0].messaging.push(...envelope('synthetic-followup-safe', 'Quais porções têm?').entry[0].messaging);
    await app.handler(await signed(app.config, payload)); await app.drain();
    assert.equal(app.store.threads.get(CUSTOMER).human, true); assert.equal(app.store.cases.length, 1);
    assert.equal(app.calls.length, 0); assert.equal(app.sent.length, 1); assert.match(app.sent[0].text, /wa\.me\/5585988544274/);
  }
});

test('spam vocabulary does not suppress a request for a person', async () => {
  const app = harness();
  await app.store.ingest(incoming('synthetic-spam-human', 'Recebi spam de cassino citando o restaurante. Quero falar com a gerente.'));
  await app.drain(); assert.equal(app.store.threads.get(CUSTOMER).human, true);
  assert.equal(app.store.cases.length, 1); assert.equal(app.calls.length, 0);
});

test('native human FAQ and WhatsApp requests create one curated notice, with zero model spend', async () => {
  for (const text of ['Como falo com uma pessoa?', 'Qual o WhatsApp da equipe?']) {
    const app = harness({ background: true });
    const payload = envelope('synthetic-falo', text);
    assert.equal(extractEvents(payload, NOW)[0].safety_intent, 'HUMAN');
    await app.handler(await signed(app.config, payload)); await Promise.all(app.tasks);
    await app.handler(await signed(app.config, envelope('synthetic-falo-repeat', text))); await Promise.all(app.tasks);
    assert.equal(app.calls.length, 0); assert.equal(app.store.reservationCount, 0); assert.equal(app.sent.length, 1);
    assert.match(app.sent[0].text, /assistente virtual/); assert.match(app.sent[0].text, /envie sua mensagem por lá/);
    assert.match(app.sent[0].text, /7h às 21h/); assert.match(app.sent[0].text, /wa\.me\/5585988544274/);
    assert.doesNotMatch(app.sent[0].text, /Hêmile|encaminhei|avisei|transferi/);
  }
});

test('urgent burst invalidates claimed generic notice and sends urgent guidance without a model', async () => {
  const app = harness();
  await app.store.ingest(extractEvents(envelope('synthetic-generic', 'Como falo com uma pessoa?'), NOW)[0]);
  const old = (await app.store.claim())[0];
  await app.store.ingest(extractEvents(envelope('synthetic-urgent', 'É urgente, tem uma emergência no restaurante.'), NOW)[0]);
  assert.equal((await app.store.prepareSend(old.event_id, old.lease, 'Aviso antigo.', old.thread_version)).allowed, false);
  await app.drain();
  assert.equal(app.sent.length, 1); assert.match(app.sent[0].text, /procure a equipe presente agora/);
  assert.equal(app.calls.length, 0); assert.equal(app.store.reservationCount, 0);
});

test('manual echo and global pause cancel a pending WhatsApp notice before any send', async () => {
  for (const manual of [true, false]) {
    const app = harness();
    await app.store.ingest(extractEvents(envelope('synthetic-pending-wa', 'Como falo com uma pessoa?'), NOW)[0]);
    if (manual) await app.store.ingest({ ...incoming('synthetic-manual-wa'), kind: 'echo' });
    else { await app.store.control('pause_global', null, { paused: true }); await app.store.control('pause_global', null, { paused: false }); }
    await app.drain(); assert.equal(app.sent.length, 0); assert.equal(app.calls.length, 0);
  }
});

test('missing kitchen hours explain the missing source and offer a clear next step', async () => {
  // Intentionally misleading classifier reproduces the real HOURS mistake.
  for (const text of ['Até que horas funciona a cozinha?', 'Qual o horário da cozinha?', 'Que horas fecha a cozinha?', 'Qual o horário do último pedido?']) {
    const app = harness(); // Would return HOURS if a call escaped the source guard.
    await app.handler(await signed(app.config, envelope('synthetic-kitchen', text))); await app.drain();
    assert.equal(app.sent.length, 1); assert.match(app.sent[0].text, /Não tenho uma resposta confirmada/);
    assert.match(app.sent[0].text, /falar com uma pessoa/);
    assert.equal(app.calls.length, 0); assert.equal(app.store.reservationCount, 0);
    assert.doesNotMatch(app.sent[0].text, /9h|22h15|23h/);
  }
});

test('human and sensitive kitchen requests keep priority over the missing-source guard', async () => {
  for (const text of ['Qual o horário da cozinha? Quero falar com uma pessoa.', 'Cozinha fecha quando? Tenho alergia grave.']) {
    const app = harness(); await app.handler(await signed(app.config, envelope('synthetic-kitchen-sensitive', text))); await app.drain();
    assert.equal(app.store.threads.get(CUSTOMER).human, true); assert.equal(app.sent.length, 1);
    assert.match(app.sent[0].text, /wa\.me\/5585988544274/); assert.equal(app.calls.length, 0);
  }
});

test('callback-to-reply retains explicit Christmas date after redaction', async () => {
  const app = harness(); await app.handler(await signed(app.config, envelope('synthetic-christmas', 'Abre em 2026-12-25?')));
  await app.drain(); assert.equal(app.sent.length, 1); assert.match(app.sent[0].text, /fechada em 25\/12\/2026/);
});

test('case profile lookup requests only username from the official Graph host using a header token', async () => {
  const seen = [];
  const enrich = createProfileEnricher(fixtureConfig(), async (url, options) => {
    seen.push({ url, options }); return new Response('{"username":"synthetic_person"}');
  });
  const data = await enrich({ cases: [{ thread_id: uid(1), sender_id: CUSTOMER, summary: 'Synthetic case.' }] });
  assert.equal(data.cases[0].verified_username, 'synthetic_person');
  assert.equal(data.cases[0].profile_url, 'https://www.instagram.com/synthetic_person/');
  assert.equal(data.cases[0].profile_status, 'verified');
  assert.equal(data.cases[0].summary, 'Synthetic case.');
  assert.equal(seen[0].url, 'https://graph.facebook.com/v26.0/' + CUSTOMER + '?fields=username');
  assert.equal(seen[0].options.method, 'GET');
  assert.equal(seen[0].options.headers.Authorization, 'Bearer ' + fixtureConfig().pageToken);
  assert.equal(seen[0].url.includes(fixtureConfig().pageToken), false);
});

test('missing, malformed and malicious profile usernames never become identity links', async () => {
  for (const username of [null, '', '../direct', '..', '.', 'https://invalid.example/', '<script>', 'x'.repeat(31)]) {
    const enrich = createProfileEnricher(fixtureConfig(), async () => new Response(JSON.stringify({ username })));
    const rows = await enrich([{ sender_id: CUSTOMER, verified_username: 'stale', profile_url: 'https://stale.invalid/' }]);
    assert.equal(rows[0].verified_username, null); assert.equal(rows[0].profile_url, null);
    assert.equal(rows[0].profile_status, 'unavailable');
  }
});

test('profile rejection and hard timeout preserve every case without exposing provider bodies', async () => {
  const rows = [{ thread_id: uid(4), sender_id: CUSTOMER, summary: 'Synthetic pending case.' }];
  for (const fetcher of [async () => new Response('SYNTHETIC_PRIVATE_BODY', { status: 403 }), async () => new Promise(() => {})]) {
    const enrich = createProfileEnricher(fixtureConfig(), fetcher, { timeoutMs: 15 });
    const data = await enrich({ cases: rows });
    assert.equal(data.cases.length, 1); assert.equal(data.cases[0].summary, rows[0].summary);
    assert.equal(data.cases[0].profile_status, 'unavailable');
    assert.equal(JSON.stringify(data).includes('SYNTHETIC_PRIVATE_BODY'), false);
  }
});

test('profile cache expires, evicts old entries and caches short-lived failures', async () => {
  let time = 1000; let calls = 0;
  const enrich = createProfileEnricher(fixtureConfig(), async () => { calls++; return new Response('{"username":"synthetic_person"}'); },
    { now: () => time, ttlMs: 100, maxCache: 2 });
  const row = sender_id => [{ sender_id }];
  await enrich(row(CUSTOMER)); await enrich(row(CUSTOMER)); assert.equal(calls, 1);
  await enrich(row(OTHER)); await enrich(row('200000000000003'));
  await enrich(row(CUSTOMER)); assert.equal(calls, 4);
  time += 101; await enrich(row(CUSTOMER)); assert.equal(calls, 5);
  let failures = 0;
  const denied = createProfileEnricher(fixtureConfig(), async () => { failures++; return new Response('{}', { status: 403 }); },
    { now: () => time, negativeTtlMs: 20 });
  await denied(row(CUSTOMER)); await denied(row(CUSTOMER)); assert.equal(failures, 1);
  time += 21; await denied(row(CUSTOMER)); assert.equal(failures, 2);
});

test('profile enrichment limits new lookups and concurrency while preserving unqueried cases', async () => {
  let active = 0, peak = 0, calls = 0;
  const enrich = createProfileEnricher(fixtureConfig(), async () => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5)); active--;
    return new Response('{"username":"synthetic_person"}');
  }, { maxLookups: 3, concurrency: 2 });
  const rows = Array.from({ length: 10 }, (_, i) => ({ sender_id: String(200000000000010 + i), summary: 'Synthetic case ' + i }));
  const result = await enrich(rows);
  assert.equal(calls, 3); assert.ok(peak <= 2); assert.equal(result.length, 10);
  assert.equal(result.filter(row => row.profile_status === 'verified').length, 3);
  assert.equal(result[9].summary, rows[9].summary);
});

test('administrator validation precedes case lookup; enrichment failure keeps the authenticated queue readable', async () => {
  let profiles = 0;
  const unauthorized = harness({ enrichCases: async () => { profiles++; } });
  const request = () => new Request('https://example.invalid/control', { method: 'POST', body: '{"action":"cases"}' });
  assert.equal((await unauthorized.handler(request())).status, 403);
  assert.equal(profiles, 0); assert.equal(unauthorized.store.controls.length, 0);
  const store = new Store(); store.control = async () => ({ cases: [{ sender_id: CUSTOMER, summary: 'Synthetic pending case.' }] });
  const admin = harness({ store, authorizeAdmin: async () => AUTH_USER,
    enrichCases: async () => { profiles++; throw new Error('SYNTHETIC_PRIVATE_ERROR'); } });
  const response = await admin.handler(request()); const payload = await response.json();
  assert.equal(response.status, 200); assert.equal(profiles, 1);
  assert.equal(payload.data.cases[0].summary, 'Synthetic pending case.');
  assert.equal(JSON.stringify(payload).includes('SYNTHETIC_PRIVATE_ERROR'), false);
});

test('panel renders verified profile links with textContent and keeps failed profiles in the queue', async () => {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.textContent = ''; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    addEventListener() {}
    set innerHTML(_) { throw new Error('HTML injection is forbidden'); }
  }
  const container = new Node('div');
  const source = (await readFile(new URL('../assets/js/adminAtendimento.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\r?\n/gm, '').replace(/init\(\)\.catch\([\s\S]*$/, '');
  const context = vm.createContext({ document: { createElement: tag => new Node(tag), getElementById: () => container }, SUPABASE_URL: 'https://example.invalid' });
  vm.runInContext(source, context);
  context.rows = [
    { thread_id: uid(1), profile_status: 'verified', verified_username: 'synthetic_person', profile_url: 'https://www.instagram.com/synthetic_person/' },
    { thread_id: uid(2), profile_status: 'unavailable', last_inbound_at: '2026-11-01T08:00:00Z' },
    { thread_id: uid(3), profile_status: 'verified', verified_username: '<script>', profile_url: 'javascript:alert(1)' },
  ];
  vm.runInContext('renderCases(rows)', context);
  const flatten = node => [node, ...node.children.flatMap(flatten)];
  const nodes = flatten(container);
  assert.equal(container.children.length, 3);
  assert.equal(nodes.filter(node => node.textContent === 'Abrir perfil').length, 1);
  assert.ok(nodes.some(node => node.textContent === '@synthetic_person'));
  assert.equal(nodes.filter(node => node.textContent === 'Abrir Direct').length, 3);
  assert.equal(nodes.filter(node => /Perfil indisponível/.test(node.textContent)).length, 2);
  assert.ok(nodes.some(node => /01\/11\/(?:20)?26/.test(node.textContent)));
  assert.ok(nodes.filter(node => node.href).every(node => /^https:\/\/www\.instagram\.com\//.test(node.href)));
  context.supabase = { auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic-jwt' } } }) } };
  context.SUPABASE_ANON_KEY = 'synthetic-anon';
  context.fetch = async () => new Response('{}', { status: 503 });
  const previous = [...container.children];
  await assert.rejects(() => vm.runInContext('refresh()', context), /Não foi possível concluir/);
  assert.deepEqual(container.children, previous);
});
