import { ASSETS, LIMITS, MODEL, redactText, prepareIncomingText, urgentIntent, isSpam, inputTokenUpperBound,
  parseClassification, reviewedReply, decisionFor } from './policy.mjs';

const encoder = new TextEncoder();
const VALID_ID = /^\d{5,30}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADMIN_ORIGIN = 'https://reservas.sirfisher.com.br';
const WINDOW_MS = 24 * 60 * 60 * 1000;

export function constantTimeEqual(left, right) {
  const a = encoder.encode(String(left ?? ''));
  const b = encoder.encode(String(right ?? ''));
  if (a.length !== b.length || a.length === 0) return false;
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a[i] ^ b[i];
  return different === 0;
}

export async function verifySignature(bytes, signature, secret) {
  if (!/^sha256=[a-f0-9]{64}$/.test(signature ?? '') || !secret) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes));
  const expected = 'sha256=' + [...signed].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return constantTimeEqual(signature, expected);
}

export function loadConfig(read) {
  const mode = read('INSTAGRAM_SUPPORT_MODE') ?? 'off';
  const url = read('SUPABASE_URL') ?? '';
  let projectValid = false;
  try { const parsed = new URL(url); projectValid = parsed.origin === 'https://' + ASSETS.projectHost
    && !parsed.search && !parsed.hash && !parsed.username && !parsed.password
    && (parsed.pathname === '/' || parsed.pathname === ''); } catch { /* closed */ }
  return Object.freeze({ mode: ['off', 'test', 'live'].includes(mode) ? mode : 'off',
    url, projectValid, serviceKey: read('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    appSecret: read('INSTAGRAM_APP_SECRET') ?? '', verifyToken: read('INSTAGRAM_VERIFY_TOKEN') ?? '',
    pageToken: read('INSTAGRAM_PAGE_ACCESS_TOKEN') ?? '', drainSecret: read('INSTAGRAM_DRAIN_SECRET') ?? '',
    geminiKey: read('GEMINI_API_KEY') ?? '', dataApproved: read('INSTAGRAM_AI_DATA_APPROVED') === 'true',
    resendKey: read('RESEND_API_KEY') ?? '', resendFrom: read('RESEND_FROM') ?? '',
    alertsEnabled: read('INSTAGRAM_ALERTS_ENABLED') === 'true',
    testSenders: new Set(String(read('INSTAGRAM_TEST_SENDER_IDS') ?? '').split(',')
      .map(value => value.trim()).filter(value => VALID_ID.test(value))) });
}

function webhookReady(config) {
  return config.projectValid && config.serviceKey.length >= 20
    && config.appSecret.length >= 32 && config.verifyToken.length >= 32;
}

export async function limitedBody(request, maximum = LIMITS.bodyBytes) {
  const announced = request.headers.get('content-length');
  if (announced && (!/^\d+$/.test(announced) || Number(announced) > maximum)) throw new Error('body_limit');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) { await reader.cancel(); throw new Error('body_limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const part of chunks) { body.set(part, offset); offset += part.byteLength; }
  return body;
}

export function extractEvents(payload, now) {
  if (!payload || payload.object !== 'instagram' || !Array.isArray(payload.entry)
      || payload.entry.length > LIMITS.events) throw new Error('payload_invalid');
  const found = [];
  let seen = 0;
  for (const entry of payload.entry) {
    if (![ASSETS.instagramId, ASSETS.pageId].includes(String(entry?.id))) continue;
    if (!Array.isArray(entry.messaging)) continue;
    for (const event of entry.messaging) {
      if (++seen > LIMITS.events) throw new Error('event_limit');
      const message = event?.message;
      if (!message || event.read || event.reaction || message.is_deleted
        || event.is_group || message.is_group || (Array.isArray(event.participants) && event.participants.length > 2)) continue;
      if (typeof message.mid !== 'string' || !message.mid || message.mid.length > 512
        || /[\u0000-\u001f]/.test(message.mid)) continue;
      const timestamp = Number(event.timestamp);
      if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > now + 300_000) continue;
      const sender = String(event.sender?.id ?? '');
      const recipient = String(event.recipient?.id ?? '');
      const own = value => [ASSETS.instagramId, ASSETS.pageId].includes(value);
      const echo = message.is_echo === true;
      if (echo ? !own(sender) || own(recipient) : !own(recipient) || own(sender)) continue;
      const customer = echo ? recipient : sender;
      if (!VALID_ID.test(customer)) continue;
      found.push({ mid: message.mid, sender_id: customer, recipient_id: ASSETS.instagramId,
        timestamp_ms: timestamp, ...(echo ? { text: '', safety_intent: null } : prepareIncomingText(message.text)),
        kind: echo ? 'echo' : 'incoming' });
    }
  }
  // Pause events are persisted before an incoming message from the same envelope.
  return found.sort((a, b) => Number(a.kind !== 'echo') - Number(b.kind !== 'echo'));
}

export function effectiveMode(config, settings) {
  if (config.mode === 'off' || settings?.mode === 'off' || settings?.paused === true) return 'off';
  if (!['test', 'live'].includes(settings?.mode)) return 'off';
  return config.mode === 'test' || settings.mode === 'test' ? 'test' : 'live';
}

function senderAllowed(config, settings, sender) {
  const mode = effectiveMode(config, settings);
  return mode === 'live' || (mode === 'test' && config.testSenders.has(sender)
    && Array.isArray(settings.test_sender_ids) && settings.test_sender_ids.includes(sender));
}

function json(value, status = 200, cors = false) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', ...(cors ? { 'Access-Control-Allow-Origin': ADMIN_ORIGIN,
      'Vary': 'Origin', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS' } : {}) } });
}

export function createHandler({ config, store, classify, send, sendAlert = null, authorizeAdmin, enrichCases = null,
  waitUntil = null, now = () => Date.now(), randomUUID = () => crypto.randomUUID(), metric = () => {} }) {
  const safeMetric = (name, count = 1) => metric(name, count);

  async function handoff(row, reason, summary) {
    return await store.complete(row.event_id, row.lease, { intent: 'HUMAN', reply_key: 'HUMAN',
      handoff_reason: reason, summary });
  }

  async function process(row, settings) {
    if (!senderAllowed(config, settings, row.sender_id)) {
      await store.complete(row.event_id, row.lease, { intent: 'IGNORE', skip: true, summary: 'Modo de teste: remetente fora da lista.' });
      return 'ignored';
    }
    const eventAt = Date.parse(row.message_at);
    if (!Number.isFinite(eventAt) || eventAt > now() + 300_000 || now() - eventAt >= WINDOW_MS) {
      await handoff(row, 'window_expired', 'Janela automática encerrada; conferir a conversa no Instagram.');
      return 'human';
    }
    const text = redactText(row.text);
    let intent = urgentIntent(text);
    if (!intent && isSpam(text)) {
      await store.complete(row.event_id, row.lease, { intent: 'IGNORE', skip: true, summary: 'Conteúdo de prospecção de jogos/apostas.' });
      return 'ignored';
    }
    let result;
    if (!text) {
      intent = 'HUMAN';
      result = { intent, reply_key: intent, handoff_reason: 'unsupported_message',
        summary: 'Mensagem sem texto utilizável; conferir mídia no Instagram.' };
    } else if (!intent) {
      const prepared = inputTokenUpperBound(text);
      if (!config.dataApproved || !settings.model_usage_allowed || !settings.billing_verified
          || config.geminiKey.length < 20 || config.pageToken.length < 20 || prepared.tokens > LIMITS.inputTokens
          || settings.model !== MODEL || settings.max_input_tokens !== LIMITS.inputTokens
          || settings.max_output_tokens !== LIMITS.outputTokens) {
        result = { intent: 'HUMAN', reply_key: 'HUMAN', handoff_reason: 'ai_not_ready',
          summary: 'IA indisponível ou aguardando verificação de configuração e custo.' };
      } else {
        const reservation = await store.reserveBudget(row.event_id, row.lease, LIMITS.reserveCents);
        if (!reservation?.allowed) {
          // Duplicate worker must not change an event that another lease owns.
          if (['already_started', 'lease_invalid', 'lease_expired'].includes(reservation?.reason)) return 'skipped';
          result = { intent: 'HUMAN', reply_key: 'HUMAN', handoff_reason: 'budget_or_rate_limit',
            summary: 'Limite de uso ou orçamento atingido; atendimento humano necessário.' };
        } else {
          let response;
          try { response = await classify(prepared.body); } catch { /* no model retry */ }
          const input = Number(response?.usageMetadata?.promptTokenCount);
          const output = Number(response?.usageMetadata?.candidatesTokenCount ?? 0)
            + Number(response?.usageMetadata?.thoughtsTokenCount ?? 0);
          intent = parseClassification(response);
          if (!intent || !Number.isSafeInteger(input) || input <= 0 || input > LIMITS.inputTokens
              || !Number.isSafeInteger(output) || output < 0 || output > LIMITS.outputTokens) {
            result = { intent: 'HUMAN', reply_key: 'HUMAN', handoff_reason: 'ai_failed',
              summary: 'Não foi possível classificar a mensagem com segurança.',
              ...(input > LIMITS.inputTokens || output > LIMITS.outputTokens ? { policy_error: 'usage_bound_exceeded' } : {}) };
          } else {
            result = { ...decisionFor(intent, Number(row.clarify_count) || 0),
              usage: { input, output, total: input + output }, usage_known: true };
          }
        }
      }
    }
    result ??= decisionFor(intent, Number(row.clarify_count) || 0);
    const completed = await store.complete(row.event_id, row.lease, result);
    if (!completed?.allowed || completed.decision === 'cancelled') return 'skipped';
    const isHandoff = completed.decision === 'handoff';
    // Handoff text is allowed only after the case and pause were persisted.
    if (isHandoff && !completed.case_saved) return 'human';
    const reply = reviewedReply(result.reply_key || result.intent, text, now(), {
      firstReply: row.first_reply !== false, handoff: isHandoff });
    const fresh = await store.settings();
    if (!senderAllowed(config, fresh, row.sender_id) || config.pageToken.length < 20) return 'paused';
    const preparedSend = await store.prepareSend(row.event_id, row.lease, reply, completed.thread_version);
    if (!preparedSend?.allowed) return 'paused';
    let delivered;
    try {
      delivered = await send(row.sender_id, reply);
    } catch (error) {
      const status = error?.deliveryStatus === 'failed' ? 'failed' : 'uncertain';
      await store.finishSend(preparedSend.outbox_id, row.lease, status, null);
      return status === 'failed' ? 'human' : 'uncertain';
    }
    const messageId = delivered?.message_id;
    if (typeof messageId !== 'string' || !messageId || messageId.length > 512) {
      await store.finishSend(preparedSend.outbox_id, row.lease, 'uncertain', null);
      return 'uncertain';
    }
    await store.finishSend(preparedSend.outbox_id, row.lease, 'sent', messageId);
    return isHandoff ? 'human' : 'sent';
  }

  async function drainAlerts(worker) {
    const counts = { accepted: 0, failed: 0, uncertain: 0 };
    if (!config.alertsEnabled || !sendAlert || config.resendKey.length < 10 || !config.resendFrom) return counts;
    const settings = await store.settings();
    if (!settings.alerts_enabled || settings.mode === 'off') return counts;
    const alerts = await store.claimAlerts(worker, 1);
    for (const alert of Array.isArray(alerts) ? alerts : []) {
      if (!UUID.test(alert.alert_id) || !UUID.test(alert.lease)
          || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(alert.manager_email ?? '')
          || alert.revision !== 1) {
        if (UUID.test(alert.alert_id) && UUID.test(alert.lease)) await store.finishAlert(alert.alert_id, alert.lease, 'failed', null, false);
        counts.failed++;
        continue;
      }
      try {
        const result = await sendAlert(alert);
        if (typeof result?.id !== 'string' || !result.id || result.id.length > 200) throw new Error('email_result_incomplete');
        await store.finishAlert(alert.alert_id, alert.lease, 'sent', result.id, false);
        counts.accepted++;
      } catch (error) {
        const status = error?.deliveryStatus === 'failed' ? 'failed' : 'uncertain';
        await store.finishAlert(alert.alert_id, alert.lease, status, null, false);
        counts[status]++;
      }
    }
    return counts;
  }

  async function drain(maximum = 3) {
    const summary = { processed: 0, sent: 0, human: 0, uncertain: 0, ignored: 0, paused: 0, skipped: 0,
      alerts: { accepted: 0, failed: 0, uncertain: 0 } };
    if (!webhookReady(config) || config.mode === 'off') return summary;
    const worker = randomUUID();
    for (let i = 0; i < Math.min(Math.max(maximum, 1), 3); i++) {
      const settings = await store.settings();
      if (effectiveMode(config, settings) === 'off') break;
      const rows = await store.claim(worker, 1);
      if (!Array.isArray(rows) || rows.length === 0) break;
      const row = rows[0];
      try {
        const outcome = await process(row, settings);
        summary.processed++;
        if (Object.hasOwn(summary, outcome)) summary[outcome]++;
      } catch {
        // Lease recovery in SQL handles interrupted work; do not repeat a side effect.
        safeMetric('worker_failed');
        break;
      }
    }
    try { summary.alerts = await drainAlerts(worker); }
    catch { safeMetric('alert_worker_failed'); }
    return summary;
  }

  async function handler(request) {
    const url = new URL(request.url);
    const tail = url.pathname.replace(/\/+$/, '').split('/').at(-1);
    const control = tail === 'control';
    const origin = request.headers.get('origin');
    const cors = control && origin === ADMIN_ORIGIN;
    try {
      if (request.method === 'OPTIONS') return control && cors ? json({}, 200, true) : json({ error: 'origin_denied' }, 403);
      if (control) {
        if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);
        if (origin && !cors) return json({ error: 'origin_denied' }, 403);
        if (!config.projectValid || config.serviceKey.length < 20) return json({ error: 'not_configured' }, 503, cors);
        const actor = await authorizeAdmin(request);
        if (!actor) return json({ error: 'admin_required' }, 403, cors);
        let body;
        try { body = JSON.parse(new TextDecoder().decode(await limitedBody(request, 4_096))); }
        catch { return json({ error: 'invalid_request' }, 400, cors); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'invalid_request' }, 400, cors);
        const actions = ['status', 'cases', 'assume', 'close', 'resume', 'pause_global'];
        if (!actions.includes(body.action) || (body.thread_id != null && !UUID.test(body.thread_id))
          || (['assume', 'close', 'resume'].includes(body.action) && !body.thread_id)
          || (body.action === 'pause_global' && typeof body.paused !== 'boolean')
          || (body.action === 'resume' && body.confirm !== true)) return json({ error: 'invalid_action' }, 400, cors);
        let data = await store.control(body.action, body.thread_id ?? null,
          { actor_id: actor, ...(body.action === 'pause_global' ? { paused: body.paused } : {}),
            ...(body.action === 'resume' ? { confirm: true } : {}) });
        if (body.action === 'cases' && enrichCases) {
          try { data = await enrichCases(data); }
          catch { safeMetric('profile_lookup_failed'); }
        }
        return json({ data, runtime_mode: config.mode, runtime: {
          webhook_configured: webhookReady(config), send_configured: config.pageToken.length >= 20,
          ai_key_configured: config.geminiKey.length >= 20, ai_data_approved: config.dataApproved,
          alerts_configured: config.alertsEnabled && config.resendKey.length >= 10 && Boolean(config.resendFrom),
        } }, 200, cors);
      }
      if (tail === 'drain') {
        if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
        if (config.drainSecret.length < 32 || !constantTimeEqual(request.headers.get('x-instagram-drain-secret'), config.drainSecret)) return json({ error: 'unauthorized' }, 401);
        return json(await drain());
      }
      if (!webhookReady(config)) return json({ error: 'not_configured' }, 503);
      if (request.method === 'GET') {
        const challenge = url.searchParams.get('hub.challenge') ?? '';
        if (url.searchParams.get('hub.mode') !== 'subscribe' || !constantTimeEqual(url.searchParams.get('hub.verify_token'), config.verifyToken)
          || !/^[a-zA-Z0-9_-]{1,256}$/.test(challenge)) return json({ error: 'verification_failed' }, 403);
        return new Response(challenge, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
      }
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      const bytes = await limitedBody(request);
      if (!await verifySignature(bytes, request.headers.get('x-hub-signature-256'), config.appSecret)) return json({ error: 'signature_invalid' }, 401);
      let events;
      try { events = extractEvents(JSON.parse(new TextDecoder().decode(bytes)), now()); }
      catch { return json({ error: 'payload_invalid' }, 400); }
      let queued = false;
      for (const event of events) {
        const result = await store.ingest(event);
        queued ||= result?.queued === true || result?.case_saved === true;
      }
      // Acknowledge only durable ingestion. waitUntil is an accelerator, not the queue.
      if (queued && waitUntil && config.mode !== 'off') waitUntil(drain().catch(() => safeMetric('background_failed')));
      return json({ received: events.length });
    } catch (error) {
      if (error?.message === 'body_limit') return json({ error: 'body_limit' }, 413, cors);
      safeMetric('handler_failed');
      return json({ error: 'temporarily_unavailable' }, 503, cors);
    }
  }
  return { handler, drain };
}
