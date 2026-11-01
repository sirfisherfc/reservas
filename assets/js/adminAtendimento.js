import { supabase } from './supabaseClient.js';
import { requireStaff, mountLayout } from './adminGuard.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const el = id => document.getElementById(id);
const endpoint = SUPABASE_URL + '/functions/v1/instagram-support/control';
let paused = true;
let busy = false;
const reasons = {
  human: 'Pedido de atendimento humano', complaint: 'Reclamação', payment_dispute: 'Cobrança ou pagamento',
  urgency: 'Situação urgente', allergy: 'Alergia ou restrição alimentar', reservation_change: 'Alteração ou cancelamento',
  group_event: 'Grupo ou evento', lost_item: 'Objeto perdido', manual_echo: 'Atendimento assumido no Instagram',
  unknown_after_clarification: 'Dúvida sem resposta', ai_failed: 'Falha na classificação',
  ai_not_ready: 'IA aguardando configuração', budget_or_rate_limit: 'Limite de uso',
  window_expired: 'Janela de resposta automática encerrada', unsupported_message: 'Mídia para conferir no Direct',
  delivery_uncertain: 'Envio para conferir no Instagram',
};

function notice(text, danger = false) {
  const node = el('support-message');
  node.textContent = text;
  node.className = 'alert ' + (danger ? 'alert--danger' : 'alert--success');
  node.hidden = !text;
}

async function control(action, extra = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Seu login expirou. Entre novamente para continuar.');
  const response = await fetch(endpoint, { method: 'POST',
    headers: { Authorization: 'Bearer ' + session.access_token, apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...extra }) });
  if (!response.ok) throw new Error(response.status === 403
    ? 'Esta área está disponível somente para administradores ativos.'
    : 'Não foi possível concluir a ação. Confira o estado antes de tentar novamente.');
  const result = await response.json();
  if (!result || typeof result !== 'object' || !Object.hasOwn(result, 'data')) throw new Error('A integração retornou um resultado incompleto.');
  return result;
}

function requireChange(result) {
  if (result?.data?.changed === true) return;
  if (result?.data?.reason === 'send_in_progress_or_unreconciled') throw new Error('Há um envio em andamento ou com resultado incerto. Confira o Direct antes de retomar; a pausa foi mantida.');
  throw new Error('A ação não foi confirmada. Atualize a fila e confira o estado da conversa.');
}

function money(cents) { return Number.isFinite(Number(cents)) ? (Number(cents) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'indisponível'; }
function date(value) { const parsed = new Date(value); return Number.isFinite(parsed.getTime())
  ? parsed.toLocaleString('pt-BR', { timeZone: 'America/Fortaleza', dateStyle: 'short', timeStyle: 'short' }) : 'Horário indisponível'; }
function verifiedProfile(row) {
  const username = row?.verified_username;
  if (row?.profile_status !== 'verified' || typeof username !== 'string'
    || !/^(?!\.{1,2}$)[A-Za-z0-9._]{1,30}$/.test(username)) return null;
  const url = 'https://www.instagram.com/' + username + '/';
  return row.profile_url === url ? { username, url } : null;
}

async function refresh() {
  const [statusResult, casesResult] = await Promise.all([control('status'), control('cases')]);
  const status = statusResult.data ?? {};
  const settings = status.settings ?? status;
  const data = casesResult.data;
  const rows = Array.isArray(data) ? data : data?.cases;
  if (!['off', 'test', 'live'].includes(statusResult.runtime_mode) || !['off', 'test', 'live'].includes(settings.mode)
    || typeof settings.paused !== 'boolean' || !Array.isArray(rows)) throw new Error('A integração retornou um estado incompleto. Nenhuma ativação foi confirmada.');
  paused = settings.paused === true;
  const mode = statusResult.runtime_mode === 'off' || settings.mode === 'off' ? 'Desligado'
    : statusResult.runtime_mode === 'test' || settings.mode === 'test' ? 'Teste com lista permitida' : 'Produção configurada';
  const runtime = statusResult.runtime ?? {};
  const ready = runtime.webhook_configured && runtime.send_configured && runtime.ai_key_configured && runtime.ai_data_approved
    && settings.model_usage_allowed && settings.billing_verified;
  el('support-status').textContent = `Modo: ${mode}. ${paused ? 'As respostas automáticas estão pausadas.'
    : ready ? 'A pausa global está liberada; os controles por conversa e orçamento continuam valendo.'
      : 'A automação ainda depende de configuração ou validação. Os casos seguem para atendimento humano.'}`;
  const budget = status.budget ?? {};
  const reserved = budget.reserved_cents == null || budget.spent_cents == null ? undefined
    : Number(budget.reserved_cents) + Number(budget.spent_cents);
  const cap = budget.cap_cents ?? settings.monthly_budget_cents;
  el('support-budget').textContent = status.budget == null
    ? `Nenhuma reserva de custo registrada neste mês. Teto do agente: ${money(cap)}.`
    : `Custo reservado e contabilizado de IA neste mês: ${money(reserved)}. Teto do agente: ${money(cap)}.`;
  el('support-pause').textContent = paused ? 'Liberar pausa global' : 'Pausar automação';
  el('support-pause').disabled = false;
  renderCases(rows);
  return { rows, paused };
}

function button(label, action, thread, needsConfirmation = false) {
  const node = document.createElement('button');
  node.type = 'button'; node.className = 'btn btn--outline btn--sm'; node.textContent = label;
  node.addEventListener('click', () => run(async () => {
    if (needsConfirmation && !await confirmResume('Confira o histórico no Direct. A retomada permite novas respostas automáticas nesta conversa.')) return;
    requireChange(await control(action, { thread_id: thread, ...(needsConfirmation ? { confirm: true } : {}) }));
    const snapshot = await refresh();
    const current = snapshot.rows.find(row => row.thread_id === thread);
    if (action === 'assume' && (!current?.human_paused || !current.assigned_to)) throw new Error('A atribuição não foi confirmada ao atualizar a fila. Confira o Direct e o responsável.');
    if (action === 'close' && (!current?.human_paused || current.status !== 'closed')) throw new Error('O encerramento não foi confirmado ao atualizar a fila. Confira o caso.');
    if (action === 'resume' && current?.human_paused) throw new Error('A conversa continua pausada. Confira o caso antes de retomar.');
    notice(action === 'resume' ? 'Retomada registrada. Os controles de modo e orçamento continuam valendo.'
      : action === 'close' ? 'Caso encerrado. A conversa continua com a automação pausada.' : 'Caso assumido para atendimento humano.');
  }));
  return node;
}

function renderCases(rows) {
  const container = el('support-cases');
  container.replaceChildren();
  if (!rows.length) { const empty = document.createElement('p'); empty.className = 'text-soft'; empty.textContent = 'Nenhum caso foi retornado pela fila.'; container.append(empty); return; }
  for (const row of rows) {
    const card = document.createElement('article'); card.className = 'card support-case';
    const title = document.createElement('h3'); title.textContent = reasons[row.reason] ?? 'Atendimento humano';
    const summary = document.createElement('p'); summary.textContent = String(row.summary ?? 'Confira a conversa no Instagram.').slice(0, 400);
    const meta = document.createElement('p'); meta.className = 'support-case-meta';
    const state = document.createElement('span'); state.textContent = 'Estado: ' + ({ open: 'Pendente', closed: 'Encerrado' }[row.status] ?? 'Pendente');
    const when = document.createElement('span'); when.textContent = date(row.last_inbound_at ?? row.created_at);
    const profile = verifiedProfile(row);
    const identity = document.createElement('span'); identity.textContent = profile ? '@' + profile.username : 'Perfil indisponível; confira o horário no Direct';
    const notice = document.createElement('span'); notice.textContent = 'Orientação para WhatsApp: ' + ({ pending: 'aviso pendente',
      sending: 'envio em andamento', sent: 'link enviado no Instagram', failed: 'envio falhou; confira o Direct',
      uncertain: 'resultado incerto; confira o Direct', cancelled: 'aviso cancelado', not_queued: 'sem aviso automático' }[row.handoff_notice_status] ?? 'estado a conferir');
    meta.append(state, when, identity, notice);
    const actions = document.createElement('div'); actions.className = 'support-actions';
    const direct = document.createElement('a'); direct.className = 'btn btn--outline btn--sm'; direct.href = 'https://www.instagram.com/direct/inbox/';
    direct.target = '_blank'; direct.rel = 'noopener noreferrer'; direct.textContent = 'Abrir Direct';
    if (profile) {
      const link = document.createElement('a'); link.className = 'btn btn--outline btn--sm'; link.href = profile.url;
      link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Abrir perfil'; actions.append(link);
    }
    actions.append(direct, button('Assumir caso', 'assume', row.thread_id), button('Encerrar caso', 'close', row.thread_id), button('Retomar automação', 'resume', row.thread_id, true));
    card.append(title, summary, meta, actions); container.append(card);
  }
}

function confirmResume(text) {
  const dialog = el('support-confirm');
  el('support-confirm-text').textContent = text;
  dialog.returnValue = 'cancel';
  return new Promise(resolve => { dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }); dialog.showModal(); });
}

async function run(action) {
  if (busy) return;
  busy = true;
  for (const node of document.querySelectorAll('main button:not(dialog button)')) node.disabled = true;
  try { await action(); } catch (error) { notice(error.message, true); }
  finally { busy = false; for (const node of document.querySelectorAll('main button:not(dialog button)')) node.disabled = false; }
}

async function init() {
  const user = await requireStaff({ adminOnly: true });
  if (!user) return;
  await mountLayout(user, 'atendimento');
  el('support-refresh').addEventListener('click', () => run(refresh));
  el('support-pause').addEventListener('click', () => run(async () => {
    if (paused && !await confirmResume('Liberar a pausa global permite novas respostas nas conversas automáticas. Casos humanos continuam pausados.')) return;
    const targetPaused = !paused;
    requireChange(await control('pause_global', { paused: targetPaused }));
    const snapshot = await refresh();
    if (snapshot.paused !== targetPaused) throw new Error('O estado da pausa mudou durante a ação. Atualize e confira antes de continuar.');
    notice(paused ? 'Automação pausada.' : 'Pausa global liberada. O modo configurado continua valendo.');
  }));
  await run(refresh);
}
init().catch(() => notice('Não foi possível abrir o atendimento. Atualize a página e confira seu login.', true));
