import { ASSETS, LIMITS, MODEL, OPENAI_MODEL, redactText, prepareIncomingText, incomingSafetyIntent, unconfirmedIntent, isSpam, inputTokenUpperBound,
  parseClassification, classificationUsage, requiresLocalPrivacyHandoff, isSimpleGreeting, reviewedReply, decisionFor } from './policy.mjs';

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
  const provider = read('INSTAGRAM_AI_PROVIDER') ?? 'gemini';
  let projectValid = false;
  try { const parsed = new URL(url); projectValid = parsed.origin === 'https://' + ASSETS.projectHost
    && !parsed.search && !parsed.hash && !parsed.username && !parsed.password
    && (parsed.pathname === '/' || parsed.pathname === ''); } catch { /* closed */ }
  return Object.freeze({ mode: ['off', 'test', 'live'].includes(mode) ? mode : 'off',
    url, projectValid, serviceKey: read('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    appSecret: read('INSTAGRAM_APP_SECRET') ?? '', verifyToken: read('INSTAGRAM_VERIFY_TOKEN') ?? '',
    pageToken: read('INSTAGRAM_PAGE_ACCESS_TOKEN') ?? '', drainSecret: read('INSTAGRAM_DRAIN_SECRET') ?? '',
    provider, model: provider === 'openai' ? OPENAI_MODEL : provider === 'gemini' ? MODEL : null,
    geminiKey: read('GEMINI_API_KEY') ?? '', openaiKey: read('INSTAGRAM_OPENAI_API_KEY') ?? '',
    openaiDataApproved: read('INSTAGRAM_OPENAI_DATA_APPROVED') === 'true',
    openaiPublicDataApproved: read('INSTAGRAM_OPENAI_PUBLIC_DATA_APPROVED') === 'true',
    dataApproved: read('INSTAGRAM_AI_DATA_APPROVED') === 'true',
    publicDataApproved: read('INSTAGRAM_PUBLIC_DATA_APPROVED') === 'true',
    publicDeliveryVerified: read('INSTAGRAM_PUBLIC_DELIVERY_VERIFIED') === 'true',
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
      if (!message || event.read || event.reaction
        || event.is_group || message.is_group || (Array.isArray(event.participants) && event.participants.length > 2)) continue;
      if (typeof message.mid !== 'string' || !message.mid || message.mid.length > 512
        || /[\u0000-\u001f]/.test(message.mid)) continue;
      const timestamp = Number(event.timestamp);
      if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > now + 300_000) continue;
      const sender = String(event.sender?.id ?? '');
      const recipient = String(event.recipient?.id ?? '');
      const own = value => [ASSETS.instagramId, ASSETS.pageId].includes(value);
      const echo = message.is_echo === true;
      const withdrawal = message.is_deleted === true;
      // Customer cancellation targets only that customer's MID. Business echoes remain separate.
      if (withdrawal && (own(sender) || !own(recipient))) continue;
      if (echo ? !own(sender) || own(recipient) : !own(recipient) || own(sender)) continue;
      const customer = echo ? recipient : sender;
      if (!VALID_ID.test(customer)) continue;
      found.push({ mid: message.mid, sender_id: customer, recipient_id: ASSETS.instagramId,
        timestamp_ms: timestamp, ...(echo || withdrawal ? { text: '', safety_intent: null } : prepareIncomingText(message.text)),
        kind: withdrawal ? 'withdrawal' : echo ? 'echo' : 'incoming' });
    }
  }
  // A cancellation wins over late originals in the same envelope; echoes pause before new work.
  const priority = { withdrawal: 0, echo: 1, incoming: 2 };
  return found.sort((a, b) => priority[a.kind] - priority[b.kind]);
}

export function effectiveMode(config, settings) {
  if (!['gemini', 'openai'].includes(config.provider)) return 'off';
  if (config.mode === 'off' || settings?.mode === 'off' || settings?.paused === true) return 'off';
  if (!['test', 'live'].includes(settings?.mode)) return 'off';
  if (config.mode === 'test' || settings.mode === 'test') return 'test';
  return (config.provider !== 'openai' || config.openaiPublicDataApproved === true)
    && config.publicDataApproved === true && config.publicDeliveryVerified === true
    && settings.public_data_approved === true && settings.public_delivery_verified === true ? 'live' : 'off';
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

  async function dispatch(row, reply, version) {
    const fresh = await store.settings();
    if (!senderAllowed(config, fresh, row.sender_id) || config.pageToken.length < 20) return 'paused';
    const prepared = await store.prepareSend(row.event_id, row.lease, reply, version);
    if (!prepared?.allowed) return 'paused';
    let delivered;
    try { delivered = await send(row.sender_id, reply); }
    catch (error) {
      const status = error?.deliveryStatus === 'failed' ? 'failed' : 'uncertain';
      await store.finishSend(prepared.outbox_id, row.lease, status, null);
      return status === 'failed' ? 'human' : 'uncertain';
    }
    const mid = delivered?.message_id;
    if (typeof mid !== 'string' || !mid || mid.length > 512) {
      await store.finishSend(prepared.outbox_id, row.lease, 'uncertain', null); return 'uncertain';
    }
    await store.finishSend(prepared.outbox_id, row.lease, 'sent', mid);
    return 'sent';
  }

  async function process(row, settings) {
    if (!senderAllowed(config, settings, row.sender_id)) {
      await store.complete(row.event_id, row.lease, { intent: 'IGNORE', skip: true, summary: 'Modo de teste: remetente fora da lista.' });
      return 'ignored';
    }
    if (row.handoff_ack === true) {
      // The database saved the case and leased its single WhatsApp notice.
      // No classifier or paid reservation runs on this branch.
      if (!UUID.test(row.case_id ?? '')) return 'paused';
      const reply = reviewedReply(row.reply_key || 'HUMAN', '', now(), {
        firstReply: row.first_reply !== false, handoff: true });
      const outcome = await dispatch(row, reply, row.thread_version);
      return outcome === 'sent' ? 'human' : outcome;
    }
    const eventAt = Date.parse(row.message_at);
    if (!Number.isFinite(eventAt) || eventAt > now() + 300_000 || now() - eventAt >= WINDOW_MS) {
      await handoff(row, 'window_expired', 'Janela automática encerrada; conferir a conversa no Instagram.');
      return 'human';
    }
    const text = redactText(row.text);
    // Fallback for work queued by an older release. The spam policy itself preserves real support requests.
    if (isSpam(text)) {
      await store.complete(row.event_id, row.lease, { intent: 'IGNORE', skip: true, summary: 'Spam inequívoco sem pedido de suporte.' });
      return 'ignored';
    }
    let intent = incomingSafetyIntent(text);
    intent ??= unconfirmedIntent(text);
    intent ??= isSimpleGreeting(text) ? 'GREETING' : null;
    let result;
    if (!text) {
      intent = 'HUMAN';
      result = { intent, reply_key: intent, handoff_reason: 'unsupported_message',
        summary: 'Mensagem sem texto utilizável; conferir mídia no Instagram.' };
    } else if (!intent && config.provider === 'openai' && requiresLocalPrivacyHandoff(text)) {
      result = { intent: 'HUMAN', reply_key: 'HUMAN', handoff_reason: 'privacy_local_only',
        summary: 'Mensagem com indicação de dados pessoais; conferir no Instagram sem enviar ao modelo.' };
    } else if (!intent) {
      const prepared = inputTokenUpperBound(text, config.provider);
      const providerReady = config.provider === 'openai'
        ? config.openaiDataApproved === true && config.openaiKey.length >= 20
        : config.provider === 'gemini' && config.geminiKey.length >= 20;
      if (!prepared.body) {
        result = { intent: 'HUMAN', reply_key: 'HUMAN', handoff_reason: 'privacy_projection_inconclusive',
          summary: 'Mensagem fora do vocabulário público revisado; atendimento sem envio ao modelo.' };
      } else if (!config.dataApproved || !settings.model_usage_allowed || !settings.billing_verified
          || !providerReady || config.pageToken.length < 20 || prepared.tokens > LIMITS.inputTokens
          || settings.model !== config.model || settings.max_input_tokens !== LIMITS.inputTokens
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
          const { input, output } = classificationUsage(response, config.provider);
          intent = parseClassification(response, config.provider);
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
    // Handoff text is allowed only after the case was persisted. Manual pauses still win.
    if (isHandoff && !completed.case_saved) return 'human';
    const reply = reviewedReply(result.reply_key || result.intent, text, now(), {
      firstReply: row.first_reply !== false, handoff: isHandoff });
    const outcome = await dispatch(row, reply, completed.thread_version);
    return isHandoff && outcome === 'sent' ? 'human' : outcome;
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
          ai_provider: config.provider, ai_model: config.model,
          ai_key_configured: (config.provider === 'openai' ? config.openaiKey : config.geminiKey).length >= 20,
          ai_data_approved: config.dataApproved && (config.provider !== 'openai' || config.openaiDataApproved),
          openai_public_data_approved: config.openaiPublicDataApproved,
          public_data_approved: config.publicDataApproved, public_delivery_verified: config.publicDeliveryVerified,
          alerts_configured: config.alertsEnabled && config.resendKey.length >= 10 && Boolean(config.resendFrom),
        } }, 200, cors);
      }
      if (tail === 'health') {
        if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
        if (config.drainSecret.length < 32 || !constantTimeEqual(request.headers.get('x-instagram-drain-secret'), config.drainSecret)) return json({ error: 'unauthorized' }, 403);
        if (!webhookReady(config)) return json({ error: 'not_configured' }, 503);
        const state = await store.settings();
        const allowed = new Set(Array.isArray(state.test_sender_ids) ? state.test_sender_ids : []);
        return json({ runtime_mode: config.mode, effective_mode: effectiveMode(config, state), paused: state.paused === true,
          ai_provider: config.provider, ai_model: config.model,
          ai_data_approved: config.dataApproved && (config.provider !== 'openai' || config.openaiDataApproved),
          openai_public_data_approved: config.openaiPublicDataApproved, alerts_enabled: config.alertsEnabled,
          public_data_approved: config.publicDataApproved && state.public_data_approved === true,
          public_delivery_verified: config.publicDeliveryVerified && state.public_delivery_verified === true,
          runtime_test_senders: config.testSenders.size, database_test_senders: allowed.size,
          matched_test_senders: [...config.testSenders].filter(sender => allowed.has(sender)).length });
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
      let queued = false; let ignoredSpam = 0;
      for (const event of events) {
        if (event.clear_spam) { ignoredSpam++; continue; }
        const result = await store.ingest(event);
        queued ||= result?.queued === true || result?.case_saved === true;
      }
      if (ignoredSpam) safeMetric('ignored_clear_spam', ignoredSpam);
      // Eligible events are durable before 200. Clear spam has no task or stored customer content.
      if (queued && waitUntil && config.mode !== 'off') waitUntil(drain().catch(() => safeMetric('background_failed')));
      return json({ received: events.length - ignoredSpam, ...(ignoredSpam ? { ignored_spam: ignoredSpam } : {}) });
    } catch (error) {
      if (error?.message === 'body_limit') return json({ error: 'body_limit' }, 413, cors);
      safeMetric('handler_failed');
      return json({ error: 'temporarily_unavailable' }, 503, cors);
    }
  }
  return { handler, drain };
}
