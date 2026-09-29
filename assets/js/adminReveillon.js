// Painel do Réveillon (admin/reveillon.html) — pensado para o celular.
// Admin: tudo. Operador: mapa (status, nome, pessoas, observações) e portaria,
// SEM valores — e isso é garantido no banco: rv_staff_board / rv_door_list
// não devolvem colunas financeiras para quem não é admin, e as tabelas com
// valor não têm leitura para o operador.
import { supabase } from './supabaseClient.js';
import { requireStaff, mountLayout } from './adminGuard.js';
import { qs, qsa, showToast, toCSV, downloadTextFile, maskPhoneBR, debounce } from './utils.js';
import {
  esc, money, pct, dateBR, dateTimeBR, countdown, fillTemplate, bookingMessageVars,
  waHref, parseDbError, renderMap, stateLabel, centerMapScroll,
} from './reveillonCommon.js';

let appUser = null;
let isAdmin = false;
let board = null;
let serverOffset = 0;
let activeTab = 'mapa';
let sheet = null;            // { mode, bookingId, tableId }
let editMode = false;
let editState = null;        // { pos: {id: {x,y,rotation}}, map, mapChanged, selected }
let exportRows = [];
let doorRows = [];

const METHOD_LABELS = { pix: 'Pix', debito: 'Débito', credito: 'Crédito' };
const ACTIVE = ['pre_reserva', 'sinal_pago', 'quitada'];

const nowMs = () => Date.now() + serverOffset;

function rpcError(error) {
  return parseDbError(error).text;
}

function alertPage(text, type = 'danger') {
  qs('#page-alert').innerHTML = text ? `<div class="alert alert--${type}">${esc(text)}</div>` : '';
}

// -------------------------------------------------------------------------
// Inicialização
// -------------------------------------------------------------------------
async function init() {
  appUser = await requireStaff({ adminOnly: false });
  if (!appUser) return;
  isAdmin = appUser.role === 'admin';
  await mountLayout(appUser, 'reveillon');
  if (!isAdmin) qsa('[data-admin]').forEach((b) => b.remove());

  qsa('.rv-tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  wireDoor();
  wireSummary();
  wireEditBar();

  await loadBoard();
  centerMapScroll(qs('#rv-map'));
  subscribe();
  setInterval(() => { if (!editMode && board) drawMap(); }, 30000);
}

function switchTab(tab) {
  if (editMode && tab !== 'mapa') exitEditMode(false);
  activeTab = tab;
  qsa('.rv-tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
  qsa('.rv-panel').forEach((p) => p.classList.toggle('hidden', p.id !== `tab-${tab}`));
  alertPage('');
  if (tab === 'portaria') loadDoor();
  if (tab === 'resumo') loadSummary();
  if (tab === 'config') loadConfig();
}

// -------------------------------------------------------------------------
// Mapa
// -------------------------------------------------------------------------
async function loadBoard() {
  const { data, error } = await supabase.rpc('rv_staff_board', { p_slug: null });
  if (error) {
    alertPage(rpcError(error));
    return;
  }
  board = data;
  serverOffset = new Date(data.now).getTime() - Date.now();
  qs('#page-title').textContent = data.event.name;
  qs('#sync-status').textContent = `Atualizado ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  renderCounters();
  qs('#legend-types').innerHTML = board.types.map((t) => `<span class="rv-chip" style="--rv-type:${esc(t.color)}"><i></i>${esc(t.name)}</span>`).join('');
  if (!editMode) drawMap();
}

function typeOf(typeId) {
  return board.types.find((t) => t.id === typeId) || {};
}

function tableById(id) {
  return board.tables.find((t) => t.id === id);
}

function tableState(t) {
  if (!t.active || t.blocked) return 'bloqueada';
  const b = t.booking;
  if (!b) return t.negotiating ? 'em_negociacao' : 'livre_admin';
  if (b.status === 'pre_reserva' && b.hold_expires_at && new Date(b.hold_expires_at).getTime() <= nowMs()) {
    return 'pre_reserva_vencida';
  }
  return b.status;
}

function tableBadge(t) {
  const b = t.booking;
  if (!b || t.blocked) return '';
  const st = tableState(t);
  if (st === 'pre_reserva') return countdown(b.hold_expires_at, nowMs());
  if (st === 'pre_reserva_vencida') return 'vencido';
  const people = Number(b.adults) + Number(b.children);
  return `${people}p`;
}

function renderCounters() {
  const c = { livre: 0, neg: 0, pre: 0, sinal: 0, quitada: 0, bloqueada: 0, pessoas: 0 };
  for (const t of board.tables) {
    const st = tableState(t);
    if (st === 'livre_admin') c.livre += 1;
    else if (st === 'em_negociacao') c.neg += 1;
    else if (st === 'bloqueada') c.bloqueada += 1;
    else if (st.startsWith('pre_reserva')) c.pre += 1;
    else if (st === 'sinal_pago') c.sinal += 1;
    else if (st === 'quitada') c.quitada += 1;
    if (t.booking) c.pessoas += Number(t.booking.adults) + Number(t.booking.children);
  }
  qs('#counters').innerHTML = [
    ['Livres', c.livre], ['Em negociação', c.neg], ['Pré-reserva', c.pre], ['Sinal pago', c.sinal],
    ['Quitadas', c.quitada], ['Bloqueadas', c.bloqueada], ['Pessoas', c.pessoas],
  ].map(([k, v]) => `<div class="rv-counter"><span>${k}</span><strong>${v}</strong></div>`).join('');
}

function drawMap() {
  const svg = qs('#rv-map');
  const tables = editMode
    ? board.tables.map((t) => ({ ...t, ...(editState.pos[t.id] || {}) }))
    : board.tables;
  renderMap(svg, {
    map: editMode ? editState.map : board.event.map,
    types: board.types,
    tables,
    stateOf: tableState,
    selectedId: editMode ? editState.selected : sheet?.tableId,
    onSelect: editMode ? null : (t) => openTableSheet(t.id),
    badge: editMode ? null : tableBadge,
  });
  svg.classList.toggle('is-editing', editMode);
}

const reloadDebounced = debounce(async () => {
  await loadBoard();
  if (sheet?.mode === 'detail' && sheet.bookingId) openBookingSheet(sheet.bookingId, { silent: true });
  if (activeTab === 'portaria') loadDoor();
  if (activeTab === 'resumo') loadSummary();
}, 500);

function subscribe() {
  let poll = setInterval(() => { if (!document.hidden) reloadDebounced(); }, 20000);
  supabase
    .channel('rv-admin-table-state')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rv_table_state' }, reloadDebounced)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') { clearInterval(poll); poll = null; }
      if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !poll) {
        poll = setInterval(() => { if (!document.hidden) reloadDebounced(); }, 20000);
      }
    });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) reloadDebounced(); });
}

// -------------------------------------------------------------------------
// Folha (modal) genérica
// -------------------------------------------------------------------------
function openSheet(html, ctx) {
  sheet = ctx;
  const mount = qs('#sheet-mount');
  mount.innerHTML = `<div class="rv-sheet-backdrop" id="sheet-backdrop"><div class="rv-sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  qs('#sheet-backdrop').addEventListener('click', (e) => { if (e.target.id === 'sheet-backdrop') closeSheet(); });
  qsa('.js-sheet-close', mount).forEach((b) => b.addEventListener('click', closeSheet));
  document.body.style.overflow = 'hidden';
  if (!editMode) drawMap();
  return mount.querySelector('.rv-sheet');
}

function closeSheet() {
  qs('#sheet-mount').innerHTML = '';
  document.body.style.overflow = '';
  sheet = null;
  if (board && !editMode) drawMap();
}

function sheetHead(title, sub = '', badgeHtml = '') {
  return `<div class="rv-sheet__head"><div><h2>${esc(title)}</h2>
    <div class="text-soft" style="font-size:.85rem;">${sub}</div></div>${badgeHtml}
    <button type="button" class="rv-sheet__close js-sheet-close" aria-label="Fechar">×</button></div>`;
}

function statusBadge(status, holdTs) {
  const vencida = status === 'pre_reserva' && holdTs && new Date(holdTs).getTime() <= nowMs();
  const cls = vencida ? 'vencida' : status;
  const txt = vencida ? 'prazo vencido' : stateLabel(status);
  return `<span class="rv-status rv-status--${cls}">${esc(txt)}</span>`;
}

function kv(rows) {
  return `<ul class="rv-kv">${rows.filter(Boolean).map(([k, v, raw]) => `<li><span>${esc(k)}</span><strong>${raw ? v : esc(v)}</strong></li>`).join('')}</ul>`;
}

function peopleText(b) {
  const parts = [`${b.adults} adulto${b.adults === 1 ? '' : 's'}`];
  if (b.children) parts.push(`${b.children} criança${b.children === 1 ? '' : 's'}`);
  if (b.infants) parts.push(`${b.infants} de colo`);
  return parts.join(' · ');
}

function phoneDigits(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d;
}

// -------------------------------------------------------------------------
// Toque numa mesa
// -------------------------------------------------------------------------
function openTableSheet(tableId) {
  const t = tableById(tableId);
  if (!t) return;
  if (t.booking) {
    if (isAdmin) openBookingSheet(t.booking.id);
    else openOperatorSheet(t);
    return;
  }
  const ty = typeOf(t.type_id);
  const blocked = t.blocked || !t.active;
  const negotiating = !blocked && t.negotiating;
  const status = blocked ? 'bloqueada' : negotiating ? 'em_negociacao' : 'livre';
  let body = kv([
    ['Tipo', ty.name],
    ['Pessoas', ty.min_people === ty.max_people ? `${ty.max_people}` : `${ty.min_people} a ${ty.max_people} (valor cobre ${ty.included_people})`],
    blocked ? ['Bloqueio', t.block_reason || (t.active ? 'sem motivo' : 'mesa desativada')] : null,
    negotiating ? ['Negociação', t.negotiation_note || 'sem observação · sem prazo'] : null,
  ]);
  if (isAdmin) {
    if (blocked) {
      body += `<div class="rv-actions"><button class="btn btn--primary rv-wide rv-big" id="unblock-btn" type="button">Desbloquear mesa</button></div>`;
    } else if (negotiating) {
      body += `<div class="rv-actions">
          <button class="btn btn--primary rv-wide rv-big" id="manual-btn" type="button">Criar reserva manual</button>
          <button class="btn btn--outline rv-wide" id="unneg-btn" type="button">Liberar mesa (tirar de negociação)</button>
        </div>`;
    } else {
      body += `<div class="rv-actions">
          <button class="btn btn--primary rv-wide rv-big" id="manual-btn" type="button">Criar reserva manual</button>
          <button class="btn btn--outline rv-wide" id="neg-btn" type="button">Marcar em negociação</button>
          <button class="btn btn--outline rv-wide" id="block-btn" type="button">Bloquear mesa</button>
        </div>`;
    }
  }
  const root = openSheet(sheetHead(`Mesa ${t.label}`, esc(ty.name), `<span class="rv-status rv-status--${status}">${stateLabel(status === 'em_negociacao' ? 'negociacao' : status)}</span>`) + body,
    { mode: 'table', tableId: t.id });
  qs('#manual-btn', root)?.addEventListener('click', () => openManualForm(t));
  const setNegotiating = async (on, note) => {
    const { error } = await supabase.rpc('rv_admin_set_table_negotiating', { p_table_id: t.id, p_on: on, p_note: note });
    if (error) { showToast(rpcError(error), 'danger'); return; }
    showToast(on ? `Mesa ${t.label} em negociação.` : `Mesa ${t.label} liberada.`);
    closeSheet();
    loadBoard();
  };
  qs('#neg-btn', root)?.addEventListener('click', () => {
    const note = window.prompt('Com quem está negociando? (opcional)', '');
    if (note !== null) setNegotiating(true, note);
  });
  qs('#unneg-btn', root)?.addEventListener('click', () => setNegotiating(false, null));
  qs('#block-btn', root)?.addEventListener('click', async () => {
    const reason = window.prompt('Motivo do bloqueio (ex.: patrocinador, equipe):', '');
    if (reason === null) return;
    const { error } = await supabase.rpc('rv_admin_set_table_block', { p_table_id: t.id, p_blocked: true, p_reason: reason });
    if (error) { showToast(rpcError(error), 'danger'); return; }
    showToast(`Mesa ${t.label} bloqueada.`);
    closeSheet();
    loadBoard();
  });
  qs('#unblock-btn', root)?.addEventListener('click', async () => {
    const { error } = await supabase.rpc('rv_admin_set_table_block', { p_table_id: t.id, p_blocked: false, p_reason: null });
    if (error) { showToast(rpcError(error), 'danger'); return; }
    showToast(`Mesa ${t.label} desbloqueada.`);
    closeSheet();
    loadBoard();
  });
}

function openOperatorSheet(t) {
  const b = t.booking;
  const ty = typeOf(t.type_id);
  const body = kv([
    ['Responsável', b.customer_name],
    ['Pessoas', peopleText(b)],
    b.status === 'pre_reserva' ? ['Prazo do sinal', `${dateTimeBR(b.hold_expires_at, board.event.timezone)} (${countdown(b.hold_expires_at, nowMs())})`] : null,
    ['Código', b.public_code],
    b.customer_notes ? ['Obs. do cliente', b.customer_notes] : null,
    b.internal_notes ? ['Obs. interna', b.internal_notes] : null,
  ]);
  openSheet(sheetHead(`Mesa ${t.label}`, esc(ty.name), statusBadge(b.status, b.hold_expires_at)) + body,
    { mode: 'operator', tableId: t.id });
}

// -------------------------------------------------------------------------
// Detalhe da reserva (admin)
// -------------------------------------------------------------------------
async function openBookingSheet(bookingId, { silent = false } = {}) {
  const { data, error } = await supabase.rpc('rv_booking_detail', { p_booking_id: bookingId });
  if (error) {
    if (!silent) showToast(rpcError(error), 'danger');
    return;
  }
  renderBookingSheet(data);
}

function msgVars(d) {
  const e = board.event;
  return bookingMessageVars({
    ...d,
    name: d.customer_name,
    event_name: e.name,
    timezone: e.timezone,
    pix_key: e.pix_key,
    pix_key_type: e.pix_key_type,
    balance_due_date: e.balance_due_date,
    address: e.address,
  }, e);
}

function renderBookingSheet(d) {
  const p = d.price;
  const e = board.event;
  const active = ACTIVE.includes(d.status);
  const tz = e.timezone;
  const vars = msgVars(d);
  const tpl = e.whatsapp_templates || {};
  const phone = phoneDigits(d.customer_phone);
  const wa = (key) => waHref(phone, fillTemplate(tpl[key] || '', vars));
  const hasDiscount = Number(p.manual_discount) > 0;

  let html = sheetHead(`${d.table_type} ${d.table_label}`, `${esc(d.public_code)} · ${esc(d.lot_name || '')}`, statusBadge(d.status, d.hold_expires_at));

  if (d.status === 'pre_reserva' && d.hold_expires_at) {
    const venc = new Date(d.hold_expires_at).getTime() <= nowMs();
    html += `<div class="alert ${venc ? 'alert--danger' : 'alert--info'}">${venc
      ? `Prazo do sinal vencido em ${esc(dateTimeBR(d.hold_expires_at, tz))}. ${Number(p.paid_gross) > 0 ? 'Há pagamento parcial, então a mesa não foi liberada.' : ''}`
      : `Sinal até ${esc(dateTimeBR(d.hold_expires_at, tz))} · faltam ${esc(countdown(d.hold_expires_at, nowMs()))}`}</div>`;
  }

  html += `<div class="rv-money">
      <div><span>Total</span><strong>${money(p.total)}</strong><small>Pix ${money(p.total_pix)}</small></div>
      <div><span>Recebido</span><strong>${money(p.paid_net)}</strong><small>abate ${money(p.paid_gross)}</small></div>
      <div class="${Number(p.deposit_remaining) > 0 && active ? 'is-due' : ''}"><span>Falta p/ sinal</span><strong>${money(p.deposit_remaining_pix)}</strong><small>Pix · cartão ${money(p.deposit_remaining)}</small></div>
      <div class="${Number(p.balance) > 0 && active ? 'is-due' : ''}"><span>Saldo</span><strong>${money(p.balance_pix)}</strong><small>Pix · cartão ${money(p.balance)}</small></div>
    </div>`;

  if (active) {
    html += `<div class="rv-actions"><button class="btn btn--primary rv-wide rv-big" id="pay-btn" type="button">Registrar pagamento</button></div>`;
  }

  html += kv([
    ['Responsável', d.customer_name],
    ['WhatsApp', `<a href="tel:+${esc(phone)}">${esc(d.customer_phone)}</a>`, true],
    d.customer_email ? ['E-mail', d.customer_email] : null,
    ['Pessoas', peopleText(d)],
    Number(p.extra_chairs) ? ['Cadeiras extras', `${p.extra_chairs} (${money(p.extra_chairs_amount)})`] : null,
    Number(p.children_discount) ? ['Desconto crianças', `− ${money(p.children_discount)}`] : null,
    hasDiscount ? ['Desconto manual', `− ${money(p.manual_discount)} · ${d.manual_discount_reason || ''} (${d.discount_by || '—'})`] : null,
    ['Consumação', money(p.consumption_total)],
    d.customer_notes ? ['Obs. do cliente', d.customer_notes] : null,
    d.internal_notes ? ['Obs. interna', d.internal_notes] : null,
    d.below_min_override ? ['Atenção', 'abaixo do mínimo (autorizado)'] : null,
    ['Origem', d.source === 'admin' ? 'painel' : 'site'],
    d.terms_accepted_at ? ['Aceite dos termos', `${dateTimeBR(d.terms_accepted_at, tz, { withYear: true })} (v${d.terms_version})`] : ['Aceite dos termos', 'não registrado'],
    d.cancel_reason ? ['Motivo do cancelamento', d.cancel_reason] : null,
  ]);

  html += `<p class="rv-subhead">WhatsApp para o cliente</p>
    <div class="rv-actions">
      <a class="btn btn--wa" target="_blank" rel="noopener" href="${wa('cobranca_sinal')}">Cobrar sinal</a>
      <a class="btn btn--wa" target="_blank" rel="noopener" href="${wa('sinal_recebido')}">Sinal recebido</a>
      <a class="btn btn--wa" target="_blank" rel="noopener" href="${wa('lembrete_saldo')}">Lembrar saldo</a>
      <a class="btn btn--wa" target="_blank" rel="noopener" href="${wa('confirmacao_final')}">Confirmação final</a>
    </div>`;

  if (active) {
    html += `<p class="rv-subhead">Ações</p><div class="rv-actions">
      <button class="btn btn--outline" type="button" data-act="discount">Desconto</button>
      ${d.status !== 'quitada' ? '<button class="btn btn--outline" type="button" data-act="paid">Marcar quitada</button>' : ''}
      ${d.status === 'pre_reserva' ? '<button class="btn btn--outline" type="button" data-act="extend">Alterar prazo</button>' : ''}
      <button class="btn btn--outline" type="button" data-act="move">Mover de mesa</button>
      <button class="btn btn--outline" type="button" data-act="edit">Editar dados</button>
      <button class="btn btn--danger" type="button" data-act="cancel">Cancelar</button>
    </div>`;
  }

  html += `<p class="rv-subhead">Pagamentos</p>`;
  html += d.payments.length
    ? `<ul class="rv-payments">${d.payments.map((pay) => `
        <li class="${pay.voided_at ? 'is-void' : ''}"><div><strong>${money(pay.amount)}</strong> · ${esc(METHOD_LABELS[pay.method] || pay.method)}
          <br><small class="text-soft">${esc(dateTimeBR(pay.paid_at, tz))}${pay.payer_name ? ' · ' + esc(pay.payer_name) : ''} · por ${esc(pay.created_by || '—')}${pay.voided_at ? ' · estornado: ' + esc(pay.void_reason || '') : ''}</small></div>
          ${pay.voided_at ? '' : `<button type="button" data-void="${esc(pay.id)}">estornar</button>`}</li>`).join('')}</ul>`
    : '<p class="text-soft">Nenhum pagamento registrado.</p>';

  html += `<details style="margin-top:12px;"><summary class="rv-subhead" style="cursor:pointer;">Histórico</summary>
    <ul class="history-list">${d.history.map((h) => `<li><strong>${esc(historyLabel(h))}</strong><br>
      <small class="text-soft">${esc(dateTimeBR(h.created_at, tz, { withYear: true }))} · ${esc(h.actor_name || h.actor_type)}</small></li>`).join('')}</ul></details>`;

  const root = openSheet(html, { mode: 'detail', bookingId: d.id, tableId: d.table_id });
  qs('#pay-btn', root)?.addEventListener('click', () => openPaymentForm(d));
  qsa('[data-act]', root).forEach((b) => b.addEventListener('click', () => {
    const act = b.dataset.act;
    if (act === 'discount') openDiscountForm(d);
    if (act === 'paid') openMarkPaidForm(d);
    if (act === 'extend') openExtendForm(d);
    if (act === 'move') openMoveForm(d);
    if (act === 'edit') openEditForm(d);
    if (act === 'cancel') openCancelForm(d);
  }));
  qsa('[data-void]', root).forEach((b) => b.addEventListener('click', async () => {
    const reason = window.prompt('Motivo do estorno:', '');
    if (!reason) return;
    const { data, error } = await supabase.rpc('rv_admin_void_payment', { p_payment_id: b.dataset.void, p_reason: reason });
    if (error) { showToast(rpcError(error), 'danger'); return; }
    showToast('Pagamento estornado.');
    renderBookingSheet(data);
  }));
}

function historyLabel(h) {
  const d = h.details || {};
  switch (h.action) {
    case 'criada': return `Criada (${d.origem || ''}) · ${money(d.total)}`;
    case 'pagamento': return `Pagamento ${money(d.valor)} · ${METHOD_LABELS[d.forma] || d.forma}`;
    case 'pagamento_estornado': return `Estorno de ${money(d.valor)} · ${d.motivo || ''}`;
    case 'status_automatico': return `Status: ${stateLabel(h.old_status)} → ${stateLabel(h.new_status)}`;
    case 'desconto': return `Desconto ${d.tipo === 'pct' ? pct(d.valor) + '%' : money(d.valor)} · ${d.motivo || ''}`;
    case 'marcada_quitada': return `Marcada como quitada${d.nota ? ' · ' + d.nota : ''}`;
    case 'prazo_estendido': return `Prazo estendido em ${d.horas}h`;
    case 'movida': return `Movida da mesa ${d.de} para ${d.para} (${money(d.total_antes)} → ${money(d.total_depois)})`;
    case 'editada': return 'Dados editados';
    case 'cancelada': return `Cancelada · ${d.motivo || ''}`;
    case 'expirada': return 'Expirada (prazo do sinal vencido)';
    default: return h.action;
  }
}

// ---- formulários da reserva ----
function formShell(d, title, inner, submitLabel, submitClass = 'btn--primary') {
  return `${sheetHead(title, `${esc(d.table_type)} ${esc(d.table_label)} · ${esc(d.customer_name)}`)}
    <form id="sheet-form" novalidate>${inner}
      <div id="sheet-alert"></div>
      <div class="rv-actions">
        <button type="button" class="btn btn--outline" id="sheet-back">Voltar</button>
        <button type="submit" class="btn ${submitClass} rv-big">${esc(submitLabel)}</button>
      </div>
    </form>`;
}

function mountForm(d, html, onSubmit, mode = 'form') {
  const root = openSheet(html, { mode, bookingId: d.id, tableId: d.table_id });
  qs('#sheet-back', root).addEventListener('click', () => renderBookingSheet(d));
  qs('#sheet-form', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = qs('#sheet-form button[type="submit"]', root);
    btn.disabled = true;
    const { data, error } = await onSubmit(root);
    btn.disabled = false;
    if (error) {
      qs('#sheet-alert', root).innerHTML = `<div class="alert alert--danger">${esc(rpcError(error))}</div>`;
      return;
    }
    if (data && data.id) renderBookingSheet(data);
  });
  return root;
}

function nowLocalInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function openPaymentForm(d) {
  const p = d.price;
  const useDeposit = d.status === 'pre_reserva' && Number(p.deposit_remaining) > 0;
  const suggest = (method) => {
    if (method === 'pix') return useDeposit ? p.deposit_remaining_pix : p.balance_pix;
    return useDeposit ? p.deposit_remaining : p.balance;
  };
  const inner = `
    <div class="rv-seg" id="method-seg">
      <button type="button" data-m="pix" class="is-active">Pix</button>
      <button type="button" data-m="debito">Débito</button>
      <button type="button" data-m="credito">Crédito</button>
    </div>
    <div class="form-field"><label for="pay-amount">Valor recebido (R$)</label>
      <input id="pay-amount" class="rv-amount" type="number" inputmode="decimal" step="0.01" min="0.01" value="${Number(suggest('pix')).toFixed(2)}" required /></div>
    <div class="rv-seg" id="amount-seg">
      <button type="button" data-a="deposit" class="${useDeposit ? 'is-active' : ''}">Sinal</button>
      <button type="button" data-a="balance" class="${useDeposit ? '' : 'is-active'}">Saldo total</button>
    </div>
    <div class="form-field"><label for="pay-date">Data do pagamento</label>
      <input id="pay-date" type="datetime-local" value="${nowLocalInput()}" /></div>
    <div class="form-field"><label for="pay-payer">Quem pagou</label>
      <input id="pay-payer" type="text" maxlength="120" value="${esc(d.customer_name)}" /></div>
    <div class="form-field"><label for="pay-notes">Observação (opcional)</label>
      <input id="pay-notes" type="text" maxlength="300" /></div>`;
  let method = 'pix';
  let amountKind = useDeposit ? 'deposit' : 'balance';
  const amountFor = () => {
    if (amountKind === 'deposit') return method === 'pix' ? p.deposit_remaining_pix : p.deposit_remaining;
    return method === 'pix' ? p.balance_pix : p.balance;
  };
  const root = mountForm(d, formShell(d, 'Registrar pagamento', inner, 'Salvar pagamento', 'btn--success'), (r) => supabase.rpc('rv_admin_register_payment', {
    p_booking_id: d.id,
    p_amount: Number(qs('#pay-amount', r).value),
    p_method: method,
    p_paid_at: qs('#pay-date', r).value ? new Date(qs('#pay-date', r).value).toISOString() : null,
    p_payer_name: qs('#pay-payer', r).value,
    p_notes: qs('#pay-notes', r).value,
  }), 'payment');
  qsa('#method-seg button', root).forEach((b) => b.addEventListener('click', () => {
    method = b.dataset.m;
    qsa('#method-seg button', root).forEach((x) => x.classList.toggle('is-active', x === b));
    qs('#pay-amount', root).value = Number(amountFor()).toFixed(2);
  }));
  qsa('#amount-seg button', root).forEach((b) => b.addEventListener('click', () => {
    amountKind = b.dataset.a;
    qsa('#amount-seg button', root).forEach((x) => x.classList.toggle('is-active', x === b));
    qs('#pay-amount', root).value = Number(amountFor()).toFixed(2);
  }));
}

function openDiscountForm(d) {
  const cur = d.manual_discount_type;
  const inner = `
    <p class="text-soft">Total atual: <strong>${money(d.price.total)}</strong>${cur ? ` · desconto atual: ${cur === 'pct' ? pct(d.manual_discount_value) + '%' : money(d.manual_discount_value)}` : ''}</p>
    <div class="rv-seg" id="disc-seg">
      <button type="button" data-t="pct" class="${cur !== 'amount' ? 'is-active' : ''}">%</button>
      <button type="button" data-t="amount" class="${cur === 'amount' ? 'is-active' : ''}">R$</button>
    </div>
    <div class="form-field"><label for="disc-value">Valor do desconto</label>
      <input id="disc-value" class="rv-amount" type="number" inputmode="decimal" step="0.01" min="0" value="${cur ? Number(d.manual_discount_value) : ''}" /></div>
    <div class="form-field"><label for="disc-reason">Motivo (obrigatório)</label>
      <input id="disc-reason" type="text" maxlength="300" required /></div>
    <p class="hint">Para remover o desconto, deixe o valor em 0 e informe o motivo.</p>`;
  let type = cur === 'amount' ? 'amount' : 'pct';
  const root = mountForm(d, formShell(d, 'Desconto', inner, 'Aplicar desconto'), (r) => {
    const value = Number(qs('#disc-value', r).value || 0);
    return supabase.rpc('rv_admin_apply_discount', {
      p_booking_id: d.id, p_type: value > 0 ? type : null, p_value: value, p_reason: qs('#disc-reason', r).value,
    });
  });
  qsa('#disc-seg button', root).forEach((b) => b.addEventListener('click', () => {
    type = b.dataset.t;
    qsa('#disc-seg button', root).forEach((x) => x.classList.toggle('is-active', x === b));
  }));
}

function openMarkPaidForm(d) {
  const bal = Number(d.price.balance);
  const inner = bal > 0
    ? `<div class="alert alert--info">Ainda há saldo de ${money(d.price.balance)} (Pix ${money(d.price.balance_pix)}). Registre o pagamento, ou explique por que está quitando.</div>
       <div class="form-field"><label for="paid-note">Justificativa</label><input id="paid-note" type="text" maxlength="300" required /></div>`
    : '<p>Confirmar que esta reserva está quitada?</p>';
  mountForm(d, formShell(d, 'Marcar como quitada', inner, 'Marcar quitada', 'btn--success'), (r) => supabase.rpc('rv_admin_mark_paid', {
    p_booking_id: d.id, p_note: qs('#paid-note', r)?.value || null,
  }));
}

function openExtendForm(d) {
  const tz = board.event.timezone;
  // Os atalhos somam a partir do prazo atual (ou de agora, se já venceu) e
  // só preenchem o campo; o admin pode escolher qualquer data e hora.
  const base = Math.max(new Date(d.hold_expires_at || Date.now()).getTime(), Date.now());
  const plus = (h) => toLocalInput(new Date(base + h * 3600e3).toISOString(), tz);
  const inner = `<p class="text-soft">Prazo atual: ${esc(dateTimeBR(d.hold_expires_at, tz))}</p>
    <div class="rv-seg" id="ext-seg">
      <button type="button" data-h="12">+12h</button>
      <button type="button" data-h="24" class="is-active">+24h</button>
      <button type="button" data-h="48">+48h</button>
    </div>
    <div class="form-field"><label for="ext-until">Novo prazo</label>
      <input id="ext-until" type="datetime-local" value="${plus(24)}" max="${toLocalInput(board.event.starts_at, tz)}" required /></div>`;
  const root = mountForm(d, formShell(d, 'Alterar prazo do sinal', inner, 'Salvar prazo'), (r) => {
    const until = fromLocalInput(qs('#ext-until', r).value, tz);
    if (!until) return { data: null, error: { message: 'INVALID_INPUT: Escolha a data e a hora.' } };
    return supabase.rpc('rv_admin_set_hold', { p_booking_id: d.id, p_until: until });
  });
  const input = qs('#ext-until', root);
  qsa('#ext-seg button', root).forEach((b) => b.addEventListener('click', () => {
    input.value = plus(Number(b.dataset.h));
    qsa('#ext-seg button', root).forEach((x) => x.classList.toggle('is-active', x === b));
  }));
  input.addEventListener('input', () => qsa('#ext-seg button', root).forEach((x) => x.classList.remove('is-active')));
}

function openMoveForm(d) {
  const free = board.tables.filter((t) => tableState(t) === 'livre_admin' && t.id !== d.table_id);
  const inner = free.length
    ? `<div class="form-field"><label for="move-to">Mesa de destino</label>
        <select id="move-to">${free.map((t) => `<option value="${esc(t.id)}">${esc(t.label)} · ${esc(typeOf(t.type_id).name)}</option>`).join('')}</select></div>
       <label class="rv-check"><input type="checkbox" id="move-below" /> Permitir abaixo do mínimo da nova mesa</label>
       <div id="move-preview" class="rv-sim-mini hidden"></div>`
    : '<p>Não há mesa livre para mover.</p>';
  let previewed = null;
  const root = mountForm(d, formShell(d, 'Mover de mesa', inner, 'Ver valores'), async (r) => {
    const to = qs('#move-to', r)?.value;
    if (!to) return { data: null, error: { message: 'NO_TABLE: Escolha a mesa de destino.' } };
    const below = qs('#move-below', r).checked;
    if (previewed !== `${to}|${below}`) {
      const res = await supabase.rpc('rv_admin_move', { p_booking_id: d.id, p_new_table_id: to, p_apply: false, p_allow_below_min: below });
      if (res.error) return res;
      const pv = res.data;
      const box = qs('#move-preview', r);
      box.classList.remove('hidden');
      box.innerHTML = pv.type_changed
        ? `Mesa ${esc(pv.from)} → ${esc(pv.to)} muda o tipo.<br>Total: <strong>${money(pv.old_price.total)} → ${money(pv.new_price.total)}</strong><br>Saldo: ${money(pv.new_price.balance)} (Pix ${money(pv.new_price.balance_pix)})`
        : `Mesa ${esc(pv.from)} → ${esc(pv.to)} · mesmo tipo, mesmo valor (${money(pv.new_price.total)}).`;
      previewed = `${to}|${below}`;
      qs('#sheet-form button[type="submit"]', r).textContent = 'Confirmar mudança';
      return { data: null, error: null };
    }
    return supabase.rpc('rv_admin_move', { p_booking_id: d.id, p_new_table_id: to, p_apply: true, p_allow_below_min: below });
  });
  const reset = () => { previewed = null; qs('#sheet-form button[type="submit"]', root).textContent = 'Ver valores'; qs('#move-preview', root)?.classList.add('hidden'); };
  qs('#move-to', root)?.addEventListener('change', reset);
  qs('#move-below', root)?.addEventListener('change', reset);
}

function openEditForm(d) {
  const inner = `
    <div class="form-field"><label for="ed-name">Nome</label><input id="ed-name" type="text" maxlength="120" value="${esc(d.customer_name)}" /></div>
    <div class="form-field"><label for="ed-phone">WhatsApp</label><input id="ed-phone" type="tel" maxlength="20" value="${esc(d.customer_phone)}" /></div>
    <div class="form-field"><label for="ed-email">E-mail</label><input id="ed-email" type="email" maxlength="160" value="${esc(d.customer_email || '')}" /></div>
    <div class="rv-steppers">
      <div><label for="ed-adults">Adultos</label><input id="ed-adults" type="number" inputmode="numeric" min="1" value="${d.adults}" /></div>
      <div><label for="ed-children">Crianças</label><input id="ed-children" type="number" inputmode="numeric" min="0" value="${d.children}" /></div>
      <div><label for="ed-infants">Colo</label><input id="ed-infants" type="number" inputmode="numeric" min="0" value="${d.infants}" /></div>
    </div>
    <label class="rv-check"><input type="checkbox" id="ed-below" ${d.below_min_override ? 'checked' : ''} /> Permitir abaixo do mínimo</label>
    <div class="form-field"><label for="ed-notes">Obs. do cliente</label><textarea id="ed-notes" maxlength="500">${esc(d.customer_notes || '')}</textarea></div>
    <div class="form-field"><label for="ed-internal">Obs. interna</label><textarea id="ed-internal" maxlength="2000">${esc(d.internal_notes || '')}</textarea></div>`;
  mountForm(d, formShell(d, 'Editar dados', inner, 'Salvar'), (r) => supabase.rpc('rv_admin_update_booking', {
    p_booking_id: d.id,
    p_name: qs('#ed-name', r).value,
    p_phone: qs('#ed-phone', r).value,
    p_email: qs('#ed-email', r).value,
    p_adults: Number(qs('#ed-adults', r).value),
    p_children: Number(qs('#ed-children', r).value),
    p_infants: Number(qs('#ed-infants', r).value),
    p_customer_notes: qs('#ed-notes', r).value,
    p_internal_notes: qs('#ed-internal', r).value,
    p_allow_below_min: qs('#ed-below', r).checked,
  }));
}

function openCancelForm(d) {
  const inner = `<div class="alert alert--danger">A mesa volta a ficar livre. Pagamentos já feitos continuam registrados (${money(d.price.paid_net)}); a devolução, se houver, é feita por fora.</div>
    <div class="form-field"><label for="cancel-reason">Motivo (obrigatório)</label><textarea id="cancel-reason" maxlength="300" required></textarea></div>`;
  mountForm(d, formShell(d, 'Cancelar reserva', inner, 'Cancelar reserva', 'btn--danger'), (r) => supabase.rpc('rv_admin_cancel', {
    p_booking_id: d.id, p_reason: qs('#cancel-reason', r).value,
  }));
}

// ---- reserva manual ----
function openManualForm(t) {
  const ty = typeOf(t.type_id);
  const html = `${sheetHead(`Reserva manual · Mesa ${t.label}`, esc(ty.name))}
    <form id="sheet-form" novalidate>
      <div class="form-field"><label for="mn-name">Nome do responsável</label><input id="mn-name" type="text" maxlength="120" required /></div>
      <div class="form-field"><label for="mn-phone">WhatsApp</label><input id="mn-phone" type="tel" maxlength="20" inputmode="tel" required /></div>
      <div class="form-field"><label for="mn-email">E-mail (opcional)</label><input id="mn-email" type="email" maxlength="160" /></div>
      <div class="rv-steppers">
        <div><label for="mn-adults">Adultos</label><input id="mn-adults" type="number" inputmode="numeric" min="1" value="${ty.included_people}" /></div>
        <div><label for="mn-children">Crianças</label><input id="mn-children" type="number" inputmode="numeric" min="0" value="0" /></div>
        <div><label for="mn-infants">Colo</label><input id="mn-infants" type="number" inputmode="numeric" min="0" value="0" /></div>
      </div>
      <div class="rv-sim-mini" id="mn-sim">Calculando…</div>
      <label class="rv-check"><input type="checkbox" id="mn-below" /> Permitir abaixo do mínimo (${ty.min_people} pessoas)</label>
      <label class="rv-check"><input type="checkbox" id="mn-terms" /> Cliente recebeu e aceitou os termos (ex.: pelo WhatsApp)</label>
      <div class="form-field"><label for="mn-notes">Obs. do cliente</label><textarea id="mn-notes" maxlength="500"></textarea></div>
      <div class="form-field"><label for="mn-internal">Obs. interna</label><textarea id="mn-internal" maxlength="2000"></textarea></div>
      <div id="sheet-alert"></div>
      <div class="rv-actions">
        <button type="button" class="btn btn--outline js-sheet-close">Cancelar</button>
        <button type="submit" class="btn btn--primary rv-big">Criar pré-reserva</button>
      </div>
    </form>`;
  const root = openSheet(html, { mode: 'form', tableId: t.id });
  const phone = qs('#mn-phone', root);
  phone.addEventListener('input', () => { phone.value = maskPhoneBR(phone.value); });
  const vals = () => ({
    a: Number(qs('#mn-adults', root).value || 0),
    c: Number(qs('#mn-children', root).value || 0),
    i: Number(qs('#mn-infants', root).value || 0),
  });
  const sim = debounce(async () => {
    const v = vals();
    const { data, error } = await supabase.rpc('rv_simulate', { p_table_id: t.id, p_adults: v.a, p_children: v.c, p_infants: v.i });
    const box = qs('#mn-sim', root);
    if (!box) return;
    if (error) { box.textContent = rpcError(error); return; }
    const pr = data.price;
    const below = qs('#mn-below', root).checked && data.error_code === 'PARTY_TOO_SMALL';
    box.innerHTML = `Total <strong>${money(pr.total)}</strong> · Pix ${money(pr.total_pix)}<br>Sinal ${money(pr.deposit_min_pix)} Pix / ${money(pr.deposit_min)} cartão · consumação ${money(pr.consumption_total)}
      ${!data.valid && !below ? `<br><span style="color:var(--color-danger)">${esc(data.message)}</span>` : ''}`;
  }, 250);
  ['#mn-adults', '#mn-children', '#mn-infants', '#mn-below'].forEach((s) => qs(s, root).addEventListener('input', sim));
  sim();
  qs('#sheet-form', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = vals();
    const btn = qs('#sheet-form button[type="submit"]', root);
    btn.disabled = true;
    const { data, error } = await supabase.rpc('rv_create_prebooking', {
      p_table_id: t.id,
      p_adults: v.a,
      p_children: v.c,
      p_infants: v.i,
      p_name: qs('#mn-name', root).value,
      p_phone: phone.value,
      p_email: qs('#mn-email', root).value || null,
      p_terms_id: null,
      p_accept_terms: qs('#mn-terms', root).checked,
      p_marketing_opt_in: false,
      p_notes: qs('#mn-notes', root).value || null,
      p_honeypot: null,
      p_attribution: {},
      p_internal_notes: qs('#mn-internal', root).value || null,
      p_allow_below_min: qs('#mn-below', root).checked,
    });
    btn.disabled = false;
    if (error) {
      qs('#sheet-alert', root).innerHTML = `<div class="alert alert--danger">${esc(rpcError(error))}</div>`;
      return;
    }
    showToast(`Pré-reserva ${data.public_code} criada.`);
    await loadBoard();
    openBookingSheet(data.id);
  });
}

// -------------------------------------------------------------------------
// Portaria (sem valores — admin e operador)
// -------------------------------------------------------------------------
function wireDoor() {
  qs('#door-search').addEventListener('input', renderDoor);
  qs('#door-print').addEventListener('click', () => window.print());
  qs('#door-csv').addEventListener('click', () => {
    const cols = [
      { key: 'table_label', label: 'Mesa' }, { key: 'table_type', label: 'Tipo' },
      { key: 'customer_name', label: 'Responsável' }, { key: 'adults', label: 'Adultos' },
      { key: 'children', label: 'Crianças' }, { key: 'infants', label: 'Colo' },
      { key: 'status_txt', label: 'Status' }, { key: 'public_code', label: 'Código' },
      { key: 'customer_notes', label: 'Obs. cliente' }, { key: 'internal_notes', label: 'Obs. interna' },
    ];
    const rows = doorRows.map((r) => ({ ...r, status_txt: stateLabel(r.status) }));
    downloadTextFile('reveillon-portaria.csv', toCSV(rows, cols));
  });
}

async function loadDoor() {
  const { data, error } = await supabase.rpc('rv_door_list', { p_slug: null });
  if (error) { alertPage(rpcError(error)); return; }
  doorRows = data || [];
  const e = board?.event;
  qs('#door-print-head').innerHTML = e ? `<h2>${esc(e.name)} — lista da portaria</h2><p>Gerada em ${esc(new Date().toLocaleString('pt-BR'))}</p>` : '';
  renderDoor();
}

function renderDoor() {
  const q = qs('#door-search').value.trim().toLowerCase();
  const rows = doorRows.filter((r) => !q || `${r.table_label} ${r.customer_name} ${r.public_code}`.toLowerCase().includes(q));
  qs('#door-tbody').innerHTML = rows.length ? rows.map((r) => `
    <tr><td><strong>${esc(r.table_label)}</strong><br><small class="text-soft">${esc(r.table_type)}</small></td>
      <td>${esc(r.customer_name)}</td>
      <td>${r.people}${r.infants ? ` + ${r.infants} colo` : ''}<br><small class="text-soft">${r.adults}A ${r.children}C</small></td>
      <td>${statusBadge(r.status)}</td>
      <td>${esc([r.customer_notes, r.internal_notes].filter(Boolean).join(' · '))}</td>
      <td class="print-only">☐</td></tr>`).join('')
    : '<tr><td colspan="6" class="empty-state">Nenhuma reserva ativa.</td></tr>';
  const people = rows.reduce((s, r) => s + Number(r.people), 0);
  const infants = rows.reduce((s, r) => s + Number(r.infants), 0);
  qs('#door-total').textContent = `${rows.length} mesas · ${people} pessoas${infants ? ` + ${infants} de colo` : ''}`;
}

// -------------------------------------------------------------------------
// Resumo financeiro (admin)
// -------------------------------------------------------------------------
function wireSummary() {
  qs('#export-csv')?.addEventListener('click', exportCSV);
  qs('#list-status')?.addEventListener('change', renderList);
  qs('#list-search')?.addEventListener('input', renderList);
}

async function loadSummary() {
  if (!isAdmin) return;
  const [s, x] = await Promise.all([
    supabase.rpc('rv_admin_summary', { p_slug: null }),
    supabase.rpc('rv_admin_export', { p_slug: null }),
  ]);
  if (s.error || x.error) { alertPage(rpcError(s.error || x.error)); return; }
  exportRows = x.data || [];
  const t = s.data.totals;
  const occ = t.capacity ? Math.round((t.people_all / t.capacity) * 100) : 0;
  const stat = (k, v, small = '') => `<div class="rv-stat"><span>${esc(k)}</span><strong>${v}</strong>${small ? `<small>${small}</small>` : ''}</div>`;
  qs('#summary-stats').innerHTML = [
    stat('Mesas vendidas', t.bookings_sold, `${t.bookings_paid_in_full} quitadas`),
    stat('Em negociação', t.bookings_negotiating, t.deposit_incomplete ? `${t.deposit_incomplete} com sinal incompleto` : ''),
    stat('Pessoas', t.people_all, `${t.people_sold} vendidas · ${t.children} crianças · ${t.infants} colo`),
    t.seat_limit
      ? stat('Cadeiras (sem bistrô)', `${t.seats_used} / ${t.seat_limit}`, `restam ${Math.max(t.seat_limit - t.seats_used, 0)} · bistrôs ${t.bistro_people} de ${t.bistro_capacity}`)
      : stat('Ocupação', `${occ}%`, `${t.people_all} de ${t.capacity} lugares`),
    stat('Total vendido', money(t.total_sold), `+ ${money(t.total_negotiating)} em negociação`),
    stat('Recebido', money(t.received), Object.entries(t.by_method || {}).map(([m, v]) => `${METHOD_LABELS[m] || m} ${money(v)}`).join(' · ')),
    stat('A receber', money(t.to_receive), `Pix ${money(t.to_receive_pix)}`),
    stat('Consumação comprometida', money(t.consumption_committed), `+ ${money(t.consumption_negotiating)} em negociação`),
    stat('Descontos', money(Number(t.children_discounts) + Number(t.manual_discounts) + Number(t.pix_discounts)),
      `crianças ${money(t.children_discounts)} · manual ${money(t.manual_discounts)} · Pix ${money(t.pix_discounts)}`),
    Number(t.received_on_cancelled) ? stat('Recebido de canceladas', money(t.received_on_cancelled)) : '',
  ].join('');
  qs('#summary-types').innerHTML = s.data.by_type.map((r) => `
    <tr><td><span class="rv-chip" style="--rv-type:${esc(r.color)}"><i></i>${esc(r.name)}</span></td>
      <td>${r.sold} / ${r.tables_total}</td><td>${r.negotiating}</td>
      <td>${r.people_all}${r.infants ? ` + ${r.infants} colo` : ''}</td>
      <td>${r.capacity ? Math.round((r.people_all / r.capacity) * 100) : 0}% de ${r.capacity}</td>
      <td>${money(r.total_sold)}</td></tr>`).join('');
  renderList();
}

function renderList() {
  const st = qs('#list-status').value;
  const q = qs('#list-search').value.trim().toLowerCase();
  const rows = exportRows.filter((r) => (st === 'ativas' ? ACTIVE.includes(r.status) : (!st || r.status === st))
    && (!q || `${r.mesa} ${r.responsavel} ${r.codigo} ${r.whatsapp}`.toLowerCase().includes(q)));
  qs('#list-tbody').innerHTML = rows.length ? rows.map((r) => `
    <tr class="rv-row-link" data-id="${esc(r.id)}" data-table="${esc(r.table_id)}">
      <td><strong>${esc(r.mesa)}</strong><br><small class="text-soft">${esc(r.codigo)}</small></td>
      <td>${esc(r.responsavel)}<br><small class="text-soft">${Number(r.adultos) + Number(r.criancas)} pessoas</small></td>
      <td>${statusBadge(r.status, r.prazo_sinal)}</td>
      <td>${money(r.total)}</td><td>${money(r.recebido)}</td><td>${money(r.saldo)}</td></tr>`).join('')
    : '<tr><td colspan="6" class="empty-state">Nenhuma reserva.</td></tr>';
  qsa('#list-tbody tr[data-id]').forEach((tr) => tr.addEventListener('click', () => openBookingSheet(tr.dataset.id)));
}

function exportCSV() {
  const num = (v) => (v === null || v === undefined || v === '' ? '' : String(Number(v).toFixed(2)).replace('.', ','));
  const tz = board.event.timezone;
  const cols = [
    ['codigo', 'Código'], ['status', 'Status'], ['mesa', 'Mesa'], ['tipo', 'Tipo'], ['lote', 'Lote'],
    ['responsavel', 'Responsável'], ['whatsapp', 'WhatsApp'], ['email', 'E-mail'],
    ['adultos', 'Adultos'], ['criancas', 'Crianças'], ['colo', 'Colo'], ['cadeiras_extras', 'Cadeiras extras'],
    ['valor_mesa', 'Valor mesa', num], ['valor_extras', 'Valor extras', num],
    ['desconto_criancas', 'Desc. crianças', num], ['desconto_manual', 'Desc. manual', num], ['motivo_desconto', 'Motivo desconto'],
    ['total', 'Total', num], ['total_pix', 'Total Pix', num], ['consumacao', 'Consumação', num],
    ['sinal_minimo', 'Sinal mínimo', num], ['recebido', 'Recebido', num], ['abatido', 'Abatido (bruto)', num],
    ['saldo', 'Saldo', num], ['saldo_pix', 'Saldo Pix', num],
    ['prazo_sinal', 'Prazo do sinal', (v) => (v ? dateTimeBR(v, tz, { withYear: true }) : '')],
    ['criada_em', 'Criada em', (v) => dateTimeBR(v, tz, { withYear: true })], ['origem', 'Origem'],
    ['obs_cliente', 'Obs. cliente'], ['obs_interna', 'Obs. interna'], ['aceite_marketing', 'Aceite marketing', (v) => (v ? 'sim' : 'não')],
    ['aceite_termos_em', 'Aceite termos', (v) => (v ? dateTimeBR(v, tz, { withYear: true }) : '')], ['versao_termos', 'Versão termos'],
    ['motivo_cancelamento', 'Motivo cancelamento'],
  ];
  const rows = exportRows.map((r) => Object.fromEntries(cols.map(([k, , f]) => [k, f ? f(r[k]) : r[k]])));
  downloadTextFile('reveillon-reservas.csv', toCSV(rows, cols.map(([key, label]) => ({ key, label }))));
}

// -------------------------------------------------------------------------
// Configurações (admin)
// -------------------------------------------------------------------------
const TEXT_FIELDS = [
  ['hero_kicker', 'Chamada acima do título', 'input'],
  ['hero_title', 'Título', 'input'],
  ['hero_subtitle', 'Subtítulo', 'textarea'],
  ['included_title', 'Título do "incluso"', 'input'],
  ['menu_note', 'Nota sobre o cardápio', 'textarea'],
  ['pix_note', 'Pagamento no Pix', 'textarea'],
  ['card_note', 'Pagamento no cartão (presencial)', 'textarea'],
  ['guarantee_note', 'Garantia da mesa / sinal', 'textarea'],
  ['balance_note', 'Prazo do saldo', 'textarea'],
  ['children_rules', 'Regras de crianças (uma por linha)', 'lines'],
  ['group_note', 'Orientação para grupos grandes', 'textarea'],
  ['terms_summary', 'Termos resumidos (um por linha)', 'lines'],
  ['success_title', 'Título depois de reservar', 'input'],
  ['success_note', 'Texto depois de reservar', 'textarea'],
  ['no_pix_message', 'Mensagem quando não há chave Pix', 'textarea'],
  ['closed_message', 'Mensagem de vendas fechadas', 'textarea'],
];
const WA_FIELDS = [
  ['comprovante', 'Cliente → restaurante: envio do comprovante'],
  ['cobranca_sinal', 'Cobrança do sinal'],
  ['sinal_recebido', 'Sinal recebido'],
  ['lembrete_saldo', 'Lembrete do saldo'],
  ['confirmacao_final', 'Confirmação final'],
];

let cfg = null;

function tzOffset(tz, date) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    .formatToParts(date).find((p) => p.type === 'timeZoneName')?.value || 'GMT';
  const m = part.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? `${m[1]}:${m[2] || '00'}` : '+00:00';
}

function toLocalInput(ts, tz) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('sv-SE', { timeZone: tz }).replace(' ', 'T').slice(0, 16);
}

function fromLocalInput(value, tz) {
  if (!value) return null;
  return `${value}:00${tzOffset(tz, new Date(`${value}:00Z`))}`;
}

async function loadConfig() {
  const [ev, terms, types, tables, lots, prices] = await Promise.all([
    supabase.from('rv_events').select('*').eq('id', board.event.id).single(),
    supabase.from('rv_terms').select('*').eq('event_id', board.event.id).order('version', { ascending: false }).limit(1),
    supabase.from('rv_table_types').select('*').eq('event_id', board.event.id).order('sort_order'),
    supabase.from('rv_tables').select('*').eq('event_id', board.event.id).order('sort_order'),
    supabase.from('rv_lots').select('*').eq('event_id', board.event.id).order('sort_order'),
    supabase.from('rv_lot_prices').select('*'),
  ]);
  const err = [ev, terms, types, tables, lots, prices].find((r) => r.error);
  if (err) { alertPage(err.error.message); return; }
  cfg = { event: ev.data, terms: terms.data[0], types: types.data, tables: tables.data, lots: lots.data, prices: prices.data };
  renderConfig();
}

function field(id, label, value, { type = 'text', kind = 'input', hint = '', attrs = '' } = {}) {
  const v = value ?? '';
  const control = kind === 'textarea'
    ? `<textarea id="${id}" ${attrs}>${esc(v)}</textarea>`
    : `<input id="${id}" type="${type}" value="${esc(v)}" ${attrs} />`;
  return `<div class="form-field"><label for="${id}">${esc(label)}</label>${control}${hint ? `<p class="hint">${esc(hint)}</p>` : ''}</div>`;
}

function check(id, label, checked) {
  return `<label class="rv-check"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''} /> ${esc(label)}</label>`;
}

function renderConfig() {
  const e = cfg.event;
  const tz = e.timezone;
  const t = e.texts || {};
  const tr = e.tracking || {};
  const typeOpts = (sel) => cfg.types.map((ty) => `<option value="${ty.id}" ${ty.id === sel ? 'selected' : ''}>${esc(ty.name)}</option>`).join('');

  qs('#config-root').innerHTML = `
    <details open><summary>Vendas e integrações</summary><div class="rv-config__body">
      ${check('c-sales', 'Vendas abertas no site', e.sales_open)}
      ${check('c-emails', 'Enviar e-mails automáticos (pré-reserva, aviso de expiração, sinal, quitada)', e.emails_enabled)}
      <p class="rv-subhead">Conversões de Ads do réveillon</p>
      ${check('c-tr-ga4', 'GA4', tr.ga4)}${check('c-tr-meta', 'Meta (Pixel)', tr.meta)}${check('c-tr-oai', 'ChatGPT Ads (OpenAI)', tr.openai_ads)}
      <button class="btn btn--success rv-save" type="button" id="save-sales">Salvar</button>
    </div></details>

    <details><summary>Evento, Pix e WhatsApp</summary><div class="rv-config__body">
      ${field('c-name', 'Nome do evento', e.name)}
      <div class="form-grid">
        ${field('c-start', 'Início', toLocalInput(e.starts_at, tz), { type: 'datetime-local' })}
        ${field('c-end', 'Fim', toLocalInput(e.ends_at, tz), { type: 'datetime-local' })}
      </div>
      ${field('c-venue', 'Local', e.venue_name)}
      ${field('c-address', 'Endereço', e.address)}
      ${field('c-menu', 'Link do cardápio', e.menu_url, { type: 'url' })}
      <div class="form-grid">
        ${field('c-pix', 'Chave Pix', e.pix_key)}
        <div class="form-field"><label for="c-pixtype">Tipo da chave</label><select id="c-pixtype">
          ${['cnpj', 'cpf', 'email', 'telefone', 'aleatoria'].map((o) => `<option ${e.pix_key_type === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
      </div>
      ${field('c-holder', 'Titular do Pix (opcional)', e.pix_holder)}
      ${field('c-wa', 'WhatsApp do restaurante (só dígitos, com 55)', e.whatsapp_number, { type: 'tel' })}
      <button class="btn btn--success rv-save" type="button" id="save-event">Salvar evento</button>
    </div></details>

    <details><summary>Regras de pagamento e prazos</summary><div class="rv-config__body">
      <div class="form-grid">
        ${field('c-dep', 'Sinal mínimo (%)', e.deposit_pct, { type: 'number', attrs: 'step="0.01" min="1" max="100"' })}
        ${field('c-pixd', 'Desconto no Pix (%)', e.pix_discount_pct, { type: 'number', attrs: 'step="0.01" min="0" max="99"' })}
        ${field('c-hold', 'Validade da pré-reserva (horas)', e.hold_hours, { type: 'number', attrs: 'min="1"' })}
        ${field('c-warn', 'Aviso antes de expirar (horas)', e.expiry_warning_hours, { type: 'number', attrs: 'min="0"' })}
        ${field('c-baldue', 'Saldo até', e.balance_due_date, { type: 'date' })}
        ${field('c-child', 'Desconto por criança (R$)', e.child_discount, { type: 'number', attrs: 'step="0.01" min="0"' })}
        ${field('c-childage', 'Idade máxima da criança', e.child_max_age, { type: 'number', attrs: 'min="0" max="17"' })}
        ${field('c-holds', 'Pré-reservas abertas por cliente', e.max_active_holds_per_contact, { type: 'number', attrs: 'min="1"' })}
        ${field('c-seatlimit', 'Limite de cadeiras (sem bistrô)', e.seat_limit, { type: 'number', attrs: 'min="1"', hint: 'Soma de pessoas em todas as mesas laterais e centrais. Em branco = sem limite.' })}
      </div>
      <p class="hint">Reservas já feitas guardam os valores de quando foram criadas.</p>
      <button class="btn btn--success rv-save" type="button" id="save-rules">Salvar regras</button>
    </div></details>

    <details><summary>Textos da página</summary><div class="rv-config__body">
      <p class="hint">Marcadores: {pix_discount_pct} {deposit_pct} {hold_hours} {balance_due_date} {child_discount} {child_max_age}</p>
      ${field('c-included', 'Incluso em todas as mesas (um por linha)', (e.included_items || []).join('\n'), { kind: 'textarea' })}
      ${TEXT_FIELDS.map(([k, label, kind]) => field(`c-t-${k}`, label, kind === 'lines' ? (t[k] || []).join('\n') : t[k], { kind: kind === 'input' ? 'input' : 'textarea' })).join('')}
      <button class="btn btn--success rv-save" type="button" id="save-texts">Salvar textos</button>
    </div></details>

    <details><summary>Mensagens de WhatsApp</summary><div class="rv-config__body">
      <p class="hint">Marcadores: {nome} {nome_completo} {codigo} {mesa} {tipo} {pessoas} {evento} {total} {total_pix} {sinal} {sinal_pix} {saldo} {saldo_pix} {consumacao} {prazo} {data_saldo} {pix_chave} {endereco}</p>
      ${WA_FIELDS.map(([k, label]) => field(`c-wa-${k}`, label, (e.whatsapp_templates || {})[k], { kind: 'textarea' })).join('')}
      <button class="btn btn--success rv-save" type="button" id="save-wa">Salvar mensagens</button>
    </div></details>

    <details><summary>Termos (texto integral)</summary><div class="rv-config__body">
      <p class="hint">Versão atual: ${cfg.terms ? cfg.terms.version : '—'}. Salvar cria uma nova versão; reservas antigas continuam ligadas à versão que o cliente aceitou.</p>
      <div class="form-field"><textarea id="c-terms" class="rv-terms">${esc(cfg.terms?.body || '')}</textarea></div>
      <button class="btn btn--success rv-save" type="button" id="save-terms">Salvar nova versão</button>
    </div></details>

    <details><summary>Tipos de mesa</summary><div class="rv-config__body">
      ${cfg.types.map((ty) => `
        <div class="rv-grid-row" data-type="${ty.id}">
          <div class="rv-grid-title">${esc(ty.name)}</div>
          ${field(`ty-name-${ty.id}`, 'Nome', ty.name)}
          ${field(`ty-color-${ty.id}`, 'Cor', ty.color, { type: 'color' })}
          ${field(`ty-min-${ty.id}`, 'Mín. pessoas', ty.min_people, { type: 'number', attrs: 'min="1"' })}
          ${field(`ty-inc-${ty.id}`, 'Incluídas no valor', ty.included_people, { type: 'number', attrs: 'min="1"' })}
          ${field(`ty-max-${ty.id}`, 'Máx. pessoas', ty.max_people, { type: 'number', attrs: 'min="1"' })}
          ${field(`ty-inf-${ty.id}`, 'Máx. colo', ty.max_infants, { type: 'number', attrs: 'min="0"' })}
          <div class="form-field">${check(`ty-extra-${ty.id}`, 'Cadeira extra', ty.allows_extra_chairs)}</div>
          <div class="form-field">${check(`ty-limit-${ty.id}`, 'Conta no limite de cadeiras', ty.counts_toward_limit)}</div>
          <div style="grid-column:1/-1">${field(`ty-desc-${ty.id}`, 'Descrição', ty.description)}</div>
        </div>`).join('')}
      <button class="btn btn--success rv-save" type="button" id="save-types">Salvar tipos</button>
    </div></details>

    <details><summary>Lotes e preços</summary><div class="rv-config__body">
      <p class="hint">Vale o primeiro lote ativo (pela ordem) dentro da vigência. Datas em branco = sem limite.</p>
      ${cfg.lots.map((l) => `
        <div class="rv-grid-row" data-lot="${l.id}">
          <div class="rv-grid-title">${esc(l.name)} ${l.active ? '<span class="rv-status rv-status--quitada">ativo</span>' : '<span class="rv-status rv-status--expirada">inativo</span>'}</div>
          ${field(`lot-name-${l.id}`, 'Nome', l.name)}
          ${field(`lot-sort-${l.id}`, 'Ordem', l.sort_order, { type: 'number' })}
          ${field(`lot-start-${l.id}`, 'Início', toLocalInput(l.starts_at, tz), { type: 'datetime-local' })}
          ${field(`lot-end-${l.id}`, 'Fim', toLocalInput(l.ends_at, tz), { type: 'datetime-local' })}
          <div class="form-field">${check(`lot-active-${l.id}`, 'Ativo', l.active)}</div>
          ${cfg.types.map((ty) => {
            const pr = cfg.prices.find((x) => x.lot_id === l.id && x.table_type_id === ty.id) || {};
            return `<div class="rv-grid-title" style="font-weight:600;">${esc(ty.name)}</div>
              ${field(`lp-p-${l.id}-${ty.id}`, 'Valor da mesa', pr.table_price, { type: 'number', attrs: 'step="0.01" min="0"' })}
              ${field(`lp-c-${l.id}-${ty.id}`, 'Consumação', pr.table_consumption, { type: 'number', attrs: 'step="0.01" min="0"' })}
              ${field(`lp-ep-${l.id}-${ty.id}`, 'Cadeira extra', pr.extra_chair_price, { type: 'number', attrs: 'step="0.01" min="0"' })}
              ${field(`lp-ec-${l.id}-${ty.id}`, 'Consumação extra', pr.extra_chair_consumption, { type: 'number', attrs: 'step="0.01" min="0"' })}`;
          }).join('')}
          <button class="btn btn--success rv-save" type="button" data-save-lot="${l.id}" style="grid-column:1/-1">Salvar ${esc(l.name)}</button>
        </div>`).join('')}
      <button class="btn btn--outline rv-save" type="button" id="new-lot">+ Novo lote (copia os preços do último)</button>
    </div></details>

    <details><summary>Mesas e mapa</summary><div class="rv-config__body">
      <button class="btn btn--secondary rv-save" type="button" id="edit-map">Editar mapa (arrastar mesas)</button>
      ${cfg.tables.map((tb) => `
        <div class="rv-grid-row" data-table="${tb.id}">
          ${field(`tb-label-${tb.id}`, 'Mesa', tb.label)}
          <div class="form-field"><label for="tb-type-${tb.id}">Tipo</label><select id="tb-type-${tb.id}">${typeOpts(tb.table_type_id)}</select></div>
          <div class="form-field"><label for="tb-shape-${tb.id}">Forma</label><select id="tb-shape-${tb.id}">
            <option value="rect" ${tb.shape === 'rect' ? 'selected' : ''}>retângulo</option>
            <option value="round" ${tb.shape === 'round' ? 'selected' : ''}>redonda</option></select></div>
          ${field(`tb-w-${tb.id}`, 'Largura', tb.w, { type: 'number' })}
          ${field(`tb-h-${tb.id}`, 'Altura', tb.h, { type: 'number' })}
          ${field(`tb-sort-${tb.id}`, 'Ordem', tb.sort_order, { type: 'number' })}
          <div class="form-field">${check(`tb-active-${tb.id}`, 'Ativa', tb.active)}</div>
        </div>`).join('')}
      <button class="btn btn--success rv-save" type="button" id="save-tables">Salvar mesas</button>
      <button class="btn btn--outline rv-save" type="button" id="new-table">+ Nova mesa</button>
      ${field('c-map', 'Mapa avançado (JSON: viewBox e elementos de referência — mar, mureta, DJ)', JSON.stringify(e.map, null, 2), { kind: 'textarea', attrs: 'style="min-height:220px;font-family:monospace;font-size:13px;"' })}
      <button class="btn btn--success rv-save" type="button" id="save-map">Salvar mapa avançado</button>
    </div></details>`;

  wireConfig();
}

async function saveEvent(patch, okMsg = 'Salvo.') {
  const { error } = await supabase.from('rv_events').update(patch).eq('id', cfg.event.id);
  if (error) { showToast(error.message, 'danger'); return false; }
  showToast(okMsg);
  await loadBoard();
  await loadConfig();
  return true;
}

const val = (id) => qs(`#${id}`)?.value;
const numOrNull = (id) => (val(id) === '' || val(id) === undefined ? null : Number(val(id)));
const lines = (id) => String(val(id) || '').split('\n').map((s) => s.trim()).filter(Boolean);

function wireConfig() {
  const e = cfg.event;
  const tz = e.timezone;
  qs('#save-sales').addEventListener('click', () => saveEvent({
    sales_open: qs('#c-sales').checked,
    emails_enabled: qs('#c-emails').checked,
    tracking: { ga4: qs('#c-tr-ga4').checked, meta: qs('#c-tr-meta').checked, openai_ads: qs('#c-tr-oai').checked },
  }));
  qs('#save-event').addEventListener('click', () => saveEvent({
    name: val('c-name'),
    starts_at: fromLocalInput(val('c-start'), tz),
    ends_at: fromLocalInput(val('c-end'), tz),
    venue_name: val('c-venue') || null,
    address: val('c-address') || null,
    menu_url: val('c-menu') || null,
    pix_key: val('c-pix') || null,
    pix_key_type: val('c-pixtype') || null,
    pix_holder: val('c-holder') || null,
    whatsapp_number: String(val('c-wa') || '').replace(/\D/g, '') || null,
  }));
  qs('#save-rules').addEventListener('click', () => saveEvent({
    deposit_pct: numOrNull('c-dep'),
    pix_discount_pct: numOrNull('c-pixd'),
    hold_hours: numOrNull('c-hold'),
    expiry_warning_hours: numOrNull('c-warn'),
    balance_due_date: val('c-baldue') || null,
    child_discount: numOrNull('c-child'),
    child_max_age: numOrNull('c-childage'),
    max_active_holds_per_contact: numOrNull('c-holds'),
    seat_limit: numOrNull('c-seatlimit'),
  }));
  qs('#save-texts').addEventListener('click', () => {
    const texts = { ...(e.texts || {}) };
    TEXT_FIELDS.forEach(([k, , kind]) => { texts[k] = kind === 'lines' ? lines(`c-t-${k}`) : val(`c-t-${k}`); });
    saveEvent({ texts, included_items: lines('c-included') });
  });
  qs('#save-wa').addEventListener('click', () => {
    const tpl = { ...(e.whatsapp_templates || {}) };
    WA_FIELDS.forEach(([k]) => { tpl[k] = val(`c-wa-${k}`); });
    saveEvent({ whatsapp_templates: tpl });
  });
  qs('#save-terms').addEventListener('click', async () => {
    if (!window.confirm('Salvar uma nova versão dos termos? Quem estiver com a página aberta precisará recarregar para aceitar a versão nova.')) return;
    const { data, error } = await supabase.rpc('rv_admin_save_terms', { p_event_id: e.id, p_body: val('c-terms') });
    if (error) { showToast(rpcError(error), 'danger'); return; }
    showToast(`Termos salvos (versão ${data.version}).`);
    loadConfig();
  });
  qs('#save-types').addEventListener('click', async () => {
    const results = await Promise.all(cfg.types.map((ty) => supabase.from('rv_table_types').update({
      name: val(`ty-name-${ty.id}`),
      color: val(`ty-color-${ty.id}`),
      min_people: numOrNull(`ty-min-${ty.id}`),
      included_people: numOrNull(`ty-inc-${ty.id}`),
      max_people: numOrNull(`ty-max-${ty.id}`),
      max_infants: numOrNull(`ty-inf-${ty.id}`),
      allows_extra_chairs: qs(`#ty-extra-${ty.id}`).checked,
      counts_toward_limit: qs(`#ty-limit-${ty.id}`).checked,
      description: val(`ty-desc-${ty.id}`) || null,
    }).eq('id', ty.id)));
    const err = results.find((r) => r.error);
    if (err) { showToast(err.error.message, 'danger'); return; }
    showToast('Tipos salvos.');
    await loadBoard();
    loadConfig();
  });
  qsa('[data-save-lot]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.saveLot;
    const lotRes = await supabase.from('rv_lots').update({
      name: val(`lot-name-${id}`),
      sort_order: numOrNull(`lot-sort-${id}`) ?? 0,
      starts_at: fromLocalInput(val(`lot-start-${id}`), tz),
      ends_at: fromLocalInput(val(`lot-end-${id}`), tz),
      active: qs(`#lot-active-${id}`).checked,
    }).eq('id', id);
    if (lotRes.error) { showToast(lotRes.error.message, 'danger'); return; }
    const rows = cfg.types.map((ty) => ({
      lot_id: id,
      table_type_id: ty.id,
      table_price: numOrNull(`lp-p-${id}-${ty.id}`) ?? 0,
      table_consumption: numOrNull(`lp-c-${id}-${ty.id}`) ?? 0,
      extra_chair_price: numOrNull(`lp-ep-${id}-${ty.id}`) ?? 0,
      extra_chair_consumption: numOrNull(`lp-ec-${id}-${ty.id}`) ?? 0,
    }));
    const pr = await supabase.from('rv_lot_prices').upsert(rows, { onConflict: 'lot_id,table_type_id' });
    if (pr.error) { showToast(pr.error.message, 'danger'); return; }
    showToast('Lote salvo.');
    loadConfig();
  }));
  qs('#new-lot').addEventListener('click', async () => {
    const last = cfg.lots[cfg.lots.length - 1];
    const n = cfg.lots.length + 1;
    const { data: lot, error } = await supabase.from('rv_lots').insert({
      event_id: e.id, name: `Lote ${n}`, active: false, sort_order: (last?.sort_order ?? 0) + 1,
    }).select().single();
    if (error) { showToast(error.message, 'danger'); return; }
    if (last) {
      const rows = cfg.prices.filter((p) => p.lot_id === last.id).map((p) => ({
        lot_id: lot.id, table_type_id: p.table_type_id, table_price: p.table_price,
        table_consumption: p.table_consumption, extra_chair_price: p.extra_chair_price,
        extra_chair_consumption: p.extra_chair_consumption,
      }));
      if (rows.length) await supabase.from('rv_lot_prices').insert(rows);
    }
    showToast(`Lote ${n} criado (inativo). Ajuste preços e vigência e ative.`);
    loadConfig();
  });
  qs('#save-tables').addEventListener('click', async () => {
    const results = await Promise.all(cfg.tables.map((tb) => supabase.from('rv_tables').update({
      label: val(`tb-label-${tb.id}`),
      table_type_id: val(`tb-type-${tb.id}`),
      shape: val(`tb-shape-${tb.id}`),
      w: numOrNull(`tb-w-${tb.id}`),
      h: numOrNull(`tb-h-${tb.id}`),
      sort_order: numOrNull(`tb-sort-${tb.id}`) ?? 0,
      active: qs(`#tb-active-${tb.id}`).checked,
    }).eq('id', tb.id)));
    const err = results.find((r) => r.error);
    if (err) { showToast(err.error.message, 'danger'); return; }
    showToast('Mesas salvas.');
    await loadBoard();
    loadConfig();
  });
  qs('#new-table').addEventListener('click', async () => {
    const label = window.prompt('Número/rótulo da nova mesa:', '');
    if (!label) return;
    const vb = board.event.map?.viewBox || [0, 0, 1000, 1100];
    const { error } = await supabase.from('rv_tables').insert({
      event_id: e.id, table_type_id: cfg.types[0].id, label,
      x: vb[2] / 2 - 50, y: vb[3] / 2 - 30, w: 100, h: 60, sort_order: cfg.tables.length + 1,
    });
    if (error) { showToast(error.message, 'danger'); return; }
    showToast(`Mesa ${label} criada no centro do mapa. Use "Editar mapa" para posicionar.`);
    await loadBoard();
    loadConfig();
  });
  qs('#save-map').addEventListener('click', () => {
    let map;
    try { map = JSON.parse(val('c-map')); } catch { showToast('JSON inválido.', 'danger'); return; }
    saveEvent({ map }, 'Mapa salvo.');
  });
  qs('#edit-map').addEventListener('click', () => { switchTab('mapa'); enterEditMode(); });
}

// -------------------------------------------------------------------------
// Modo "editar mapa": arrastar e girar mesas; arrastar quiosque, DJ, árvore e
// textos (elementos de referência do mapa).
// -------------------------------------------------------------------------
function shiftDecor(d, dx, dy) {
  const out = JSON.parse(JSON.stringify(d));
  if (Array.isArray(out.points)) out.points = out.points.map(([x, y]) => [Math.round(x + dx), Math.round(y + dy)]);
  if (out.x !== undefined) out.x = Math.round(Number(out.x) + dx);
  if (out.y !== undefined) out.y = Math.round(Number(out.y) + dy);
  return out;
}

function wireEditBar() {
  qs('#edit-cancel').addEventListener('click', () => exitEditMode(false));
  qs('#edit-save').addEventListener('click', () => exitEditMode(true));
  qs('#rot-left').addEventListener('click', () => rotateSelected(-15));
  qs('#rot-right').addEventListener('click', () => rotateSelected(15));

  const svg = qs('#rv-map');
  let drag = null;
  const toSvg = (evt) => {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  };
  svg.addEventListener('pointerdown', (evt) => {
    if (!editMode) return;
    const p = toSvg(evt);
    const g = evt.target.closest('.rv-table');
    if (g) {
      const id = g.dataset.id;
      const t = { ...tableById(id), ...(editState.pos[id] || {}) };
      drag = { kind: 'table', id, g, dx: p.x - Number(t.x), dy: p.y - Number(t.y), moved: false, t };
    } else {
      const dg = evt.target.closest('.rv-decor.is-movable');
      if (!dg) return;
      drag = { kind: 'decor', idx: Number(dg.dataset.decor), g: dg, sx: p.x, sy: p.y, moved: false };
    }
    drag.g.classList.add('is-dragging');
    svg.setPointerCapture(evt.pointerId);
    evt.preventDefault();
  });
  svg.addEventListener('pointermove', (evt) => {
    if (!drag) return;
    const p = toSvg(evt);
    if (drag.kind === 'decor') {
      drag.ddx = Math.round(p.x - drag.sx);
      drag.ddy = Math.round(p.y - drag.sy);
      if (Math.abs(drag.ddx) + Math.abs(drag.ddy) > 3) drag.moved = true;
      drag.g.setAttribute('transform', `translate(${drag.ddx} ${drag.ddy})`);
      return;
    }
    const x = Math.round(p.x - drag.dx);
    const y = Math.round(p.y - drag.dy);
    if (Math.abs(x - Number(drag.t.x)) + Math.abs(y - Number(drag.t.y)) > 3) drag.moved = true;
    const w = Number(drag.t.w); const h = Number(drag.t.h);
    drag.g.setAttribute('transform', `translate(${x} ${y}) rotate(${Number(drag.t.rotation) || 0} ${w / 2} ${h / 2})`);
    drag.nx = x;
    drag.ny = y;
  });
  const end = () => {
    if (!drag) return;
    if (drag.kind === 'decor') {
      if (drag.moved) {
        editState.map.decor[drag.idx] = shiftDecor(editState.map.decor[drag.idx], drag.ddx, drag.ddy);
        editState.mapChanged = true;
      }
      editState.selected = null;
    } else {
      const { id, moved, nx, ny, t } = drag;
      if (moved) editState.pos[id] = { x: nx, y: ny, rotation: Number(t.rotation) || 0 };
      editState.selected = id;
    }
    drag = null;
    updateEditBar();
    drawMap();
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
}

function enterEditMode() {
  closeSheet();
  editMode = true;
  editState = { pos: {}, map: JSON.parse(JSON.stringify(board.event.map || {})), mapChanged: false, selected: null };
  qs('#edit-bar').classList.remove('hidden');
  updateEditBar();
  drawMap();
  qs('#rv-map').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateEditBar() {
  const t = editState?.selected ? tableById(editState.selected) : null;
  const n = Object.keys(editState?.pos || {}).length;
  const changes = `${n} mesa(s)${editState?.mapChanged ? ' e elementos do mapa' : ''} alterado(s).`;
  qs('#edit-selected').textContent = t
    ? `Mesa ${t.label} selecionada. ${changes}`
    : `Arraste mesas, quiosque, DJ ou árvore. Toque numa mesa para girar. ${n || editState?.mapChanged ? changes : ''}`;
  qs('#rot-left').disabled = !t;
  qs('#rot-right').disabled = !t;
}

function rotateSelected(deg) {
  const id = editState.selected;
  if (!id) return;
  const t = { ...tableById(id), ...(editState.pos[id] || {}) };
  editState.pos[id] = { x: Number(t.x), y: Number(t.y), rotation: ((Number(t.rotation) || 0) + deg + 360) % 360 };
  updateEditBar();
  drawMap();
}

async function exitEditMode(save) {
  if (save && editState) {
    const jobs = Object.entries(editState.pos).map(([id, p]) => (
      supabase.from('rv_tables').update({ x: p.x, y: p.y, rotation: p.rotation }).eq('id', id)
    ));
    if (editState.mapChanged) {
      jobs.push(supabase.from('rv_events').update({ map: editState.map }).eq('id', board.event.id));
    }
    if (jobs.length) {
      const results = await Promise.all(jobs);
      const err = results.find((r) => r.error);
      if (err) { showToast(err.error.message, 'danger'); return; }
      showToast('Mapa salvo.');
    }
  }
  editMode = false;
  editState = null;
  qs('#edit-bar').classList.add('hidden');
  await loadBoard();
}

init();
