import { ASSETS, MODEL, isReviewedOpenAIRequest } from './policy.mjs';
import { limitedBody } from './core.mjs';

async function requestJson(fetcher, url, options, timeout = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetcher(url, { ...options, redirect: 'error', signal: controller.signal });
    if (!response.ok) {
      const error = new Error('provider_rejected');
      // No response body or request URL is included in errors or logs.
      error.deliveryStatus = response.status >= 400 && response.status < 500 ? 'failed' : 'uncertain';
      throw error;
    }
    return JSON.parse(new TextDecoder().decode(await limitedBody(response, 65_536)));
  } finally { clearTimeout(timer); }
}

const USERNAME = /^(?!\.{1,2}$)[A-Za-z0-9._]{1,30}$/;

// Read-only, ephemeral profile cache. Called only after admin authorization.
export function createProfileEnricher(config, fetcher = fetch, {
  now = () => Date.now(), timeoutMs = 2_500, ttlMs = 120_000,
  negativeTtlMs = 30_000, maxCache = 128, maxLookups = 12, concurrency = 4,
} = {}) {
  const cache = new Map();
  const inFlight = new Map();
  function cached(id) {
    const entry = cache.get(id);
    if (entry && entry.expires > now()) return entry;
    cache.delete(id); return null;
  }
  function save(id, value) {
    for (const [key, entry] of cache) if (entry.expires <= now()) cache.delete(key);
    cache.delete(id);
    while (cache.size >= maxCache) cache.delete(cache.keys().next().value);
    cache.set(id, { value, expires: now() + (value ? ttlMs : negativeTtlMs) });
    return value;
  }
  async function lookup(id, remaining) {
    const previous = cached(id);
    if (previous) return previous.value;
    if (inFlight.has(id)) return await inFlight.get(id);
    if (inFlight.size >= concurrency || remaining <= 0 || config.pageToken.length < 20) return null;
    const controller = new AbortController();
    let timer;
    const request = (async () => {
      try {
        const response = await fetcher('https://graph.facebook.com/v26.0/' + id + '?fields=username', {
          method: 'GET', headers: { Authorization: 'Bearer ' + config.pageToken },
          redirect: 'error', signal: controller.signal,
        });
        if (!response.ok) return null;
        const profile = JSON.parse(new TextDecoder().decode(await limitedBody(response, 4_096)));
        return typeof profile?.username === 'string' && USERNAME.test(profile.username) ? profile.username : null;
      } catch { return null; }
    })();
    // A hard deadline preserves the queue even if a transport ignores abort.
    const pending = Promise.race([request, new Promise(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve(null); }, Math.min(timeoutMs, remaining));
    })]);
    inFlight.set(id, pending);
    try { return save(id, await pending); }
    finally { clearTimeout(timer); inFlight.delete(id); }
  }
  return async function enrichCases(data) {
    const rows = Array.isArray(data) ? data : data?.cases;
    if (!Array.isArray(rows)) return data;
    const deadline = now() + timeoutMs;
    const results = rows.map(row => ({ ...row, verified_username: null, profile_url: null, profile_status: 'unavailable' }));
    const candidates = [...new Set(results.map(row => row.sender_id).filter(id => /^\d{5,30}$/.test(id ?? '')))];
    const resolved = new Map(); const jobs = [];
    for (const id of candidates) {
      const previous = cached(id);
      if (previous) resolved.set(id, previous.value);
      else if (jobs.length < maxLookups) jobs.push(id);
    }
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (next < jobs.length && now() < deadline) {
        const id = jobs[next++];
        resolved.set(id, await lookup(id, deadline - now()));
      }
    }));
    for (const row of results) {
      const username = resolved.get(row.sender_id);
      if (username) Object.assign(row, { verified_username: username,
        profile_url: 'https://www.instagram.com/' + username + '/', profile_status: 'verified' });
    }
    return Array.isArray(data) ? results : { ...data, cases: results };
  };
}

export function createTransports(config, fetcher = fetch) {
  const base = config.url.replace(/\/$/, '');
  const serviceHeaders = { apikey: config.serviceKey, 'Content-Type': 'application/json',
    ...(config.serviceKey.startsWith('eyJ') ? { Authorization: 'Bearer ' + config.serviceKey } : {}) };
  async function rpc(name, args = {}, authorization = null) {
    return await requestJson(fetcher, base + '/rest/v1/rpc/' + name, { method: 'POST',
      headers: { ...serviceHeaders, ...(authorization ? { Authorization: authorization } : {}) },
      body: JSON.stringify(args) });
  }
  const store = {
    settings: () => rpc('ig_support_settings'),
    ingest: event => rpc('ig_support_ingest', { p_event: event }),
    claim: (worker, limit) => rpc('ig_support_claim', { p_worker: worker, p_limit: limit }),
    reserveBudget: (event, lease, cents) => rpc('ig_support_reserve_budget',
      { p_event_id: event, p_lease: lease, p_max_cost_cents: cents }),
    complete: (event, lease, result) => rpc('ig_support_complete',
      { p_event_id: event, p_lease: lease, p_result: result }),
    prepareSend: (event, lease, text, version) => rpc('ig_support_prepare_send',
      { p_event_id: event, p_lease: lease, p_text: text, p_expected_version: version }),
    finishSend: (outbox, lease, status, messageId) => rpc('ig_support_finish_send',
      { p_outbox_id: outbox, p_lease: lease, p_status: status, p_provider_message_id: messageId }),
    control: (action, thread, args) => rpc('ig_support_control',
      { p_action: action, p_thread_id: thread, p_args: args }),
    claimAlerts: (worker, limit) => rpc('ig_support_claim_alerts', { p_worker: worker, p_limit: limit }),
    finishAlert: (alert, lease, status, provider, retryable) => rpc('ig_support_finish_alert',
      { p_alert_id: alert, p_lease: lease, p_status: status, p_provider_id: provider, p_retryable: retryable }),
  };
  async function authorizeAdmin(request) {
    const authorization = request.headers.get('authorization') ?? '';
    if (!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization)) return null;
    try {
      const user = await requestJson(fetcher, base + '/auth/v1/user', { method: 'GET',
        headers: { apikey: config.serviceKey, Authorization: authorization } });
      if (!/^[0-9a-f-]{36}$/i.test(user?.id ?? '')) return null;
      // The user's JWT, not the service role, is used for this authorization decision.
      const admin = await rpc('fn_is_admin', {}, authorization);
      return admin === true ? user.id : null;
    } catch { return null; }
  }
  const classify = body => {
    if (config.provider === 'openai') {
      if (!config.openaiDataApproved || config.openaiKey.length < 20 || !isReviewedOpenAIRequest(body)) {
        throw new Error('openai_not_approved');
      }
      return requestJson(fetcher, 'https://api.openai.com/v1/responses', {
        method: 'POST', headers: { Authorization: 'Bearer ' + config.openaiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body) }, 20_000);
    }
    if (config.provider !== 'gemini') throw new Error('provider_not_supported');
    return requestJson(fetcher, 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent', {
      method: 'POST', headers: { 'x-goog-api-key': config.geminiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body) }, 20_000);
  };
  const send = (recipient, text) => requestJson(fetcher,
    'https://graph.facebook.com/v26.0/' + ASSETS.pageId + '/messages', {
      method: 'POST', headers: { Authorization: 'Bearer ' + config.pageToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: recipient }, messaging_type: 'RESPONSE', message: { text } }) }, 15_000);
  const sendAlert = alert => {
    const labels = { human: 'Pedido de pessoa', complaint: 'Reclamação', payment_dispute: 'Cobrança ou pagamento',
      urgency: 'Situação urgente', allergy: 'Alergia ou restrição alimentar', reservation_change: 'Reserva',
      group_event: 'Grupo ou evento', lost_item: 'Objeto perdido', manual_echo: 'Conversa assumida no Instagram',
      unknown_after_clarification: 'Dúvida sem resposta', unresolved_question: 'Dúvida sem resposta',
      delivery_uncertain: 'Envio a conferir', delivery_failed: 'Falha de envio',
      ai_failed: 'Falha da IA', ai_not_ready: 'IA aguardando configuração', budget_or_rate_limit: 'Limite de uso' };
    const subject = labels[alert.reason] ?? 'Atendimento humano';
    return requestJson(fetcher, 'https://api.resend.com/emails', { method: 'POST',
      headers: { Authorization: 'Bearer ' + config.resendKey, 'Content-Type': 'application/json',
        'Idempotency-Key': 'ig-support/' + alert.alert_id + '/v1' },
      body: JSON.stringify({ from: config.resendFrom, to: [alert.manager_email],
        subject: 'Sir Fisher: novo caso do Instagram',
        text: 'Há um novo caso do Instagram para conferir.\nAssunto: ' + subject
          + '.\nAbra o painel: https://reservas.sirfisher.com.br/admin/atendimento.html'
          + '\nConfira o histórico no Direct antes de responder.' }) }, 15_000);
  };
  return { store, authorizeAdmin, classify, send, sendAlert, enrichCases: createProfileEnricher(config, fetcher) };
}
