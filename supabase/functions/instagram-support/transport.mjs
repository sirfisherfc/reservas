import { ASSETS, MODEL } from './policy.mjs';
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
  const classify = body => requestJson(fetcher,
    'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent', {
      method: 'POST', headers: { 'x-goog-api-key': config.geminiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body) }, 20_000);
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
  return { store, authorizeAdmin, classify, send, sendAlert };
}
