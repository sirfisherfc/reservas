import { supabase } from './supabaseClient.js';
import { requireStaff, mountLayout } from './adminGuard.js';
import {
  createVoucherSession, createRecentVoucherList, RECENT_VOUCHERS_PAGE_SIZE, voucherBenefit, voucherDate, voucherEventTime, voucherStatus,
} from './benefit-vouchers.mjs?v=20261105-expired';

const byId = (id) => document.getElementById(id);
const session = createVoucherSession((name, args) => supabase.rpc(name, args));
const recent = createRecentVoucherList((name, args) => supabase.rpc(name, args));
const feedback = byId('voucher-feedback');
const dialog = byId('voucher-confirm-dialog');
const expiredDialog = byId('voucher-expired-dialog');
let operation = false;

const messages = {
  invalid_code: 'Confira os 6 caracteres do código. Não foi feita nenhuma utilização.',
  not_found: 'Voucher não encontrado. Confira o código apresentado pelo cliente.',
  rate_limited: 'Muitas consultas em pouco tempo. Aguarde um minuto antes de consultar novamente.',
  denied: 'Seu acesso não permite esta operação. Entre novamente ou fale com um administrador.',
  lookup_failed: 'Não foi possível consultar agora. Consulte novamente antes de aplicar qualquer benefício.',
  uncertain: 'Não foi possível confirmar a resposta da utilização. O estado foi consultado novamente quando possível. Confira a situação, a data e o responsável; consulte novamente antes de aplicar o benefício. Não repita a utilização às cegas.',
  refresh_required: 'Consulte o voucher novamente antes de registrar a utilização.',
};

function setFeedback(message = '', type = '') {
  feedback.textContent = message;
  feedback.className = `voucher-feedback${type ? ` voucher-feedback--${type}` : ''}`;
}

function showExpiredNotice(voucher) {
  byId('voucher-expired-details').textContent = voucher ? `Código ${voucher.code} · Vencimento ${voucherDate(voucher.expires_on)}` : '';
  if (typeof expiredDialog.showModal === 'function') {
    if (!expiredDialog.open) expiredDialog.showModal();
  } else {
    window.alert(voucherStatus('expired').description);
  }
}

function recentControls() {
  const { busy, offset, items, total } = recent.state;
  byId('voucher-recent').setAttribute('aria-busy', String(busy));
  byId('voucher-recent-refresh').disabled = busy;
  byId('voucher-recent-prev').disabled = busy || offset === 0;
  byId('voucher-recent-next').disabled = busy || offset + items.length >= total;
}

async function loadRecent(offset = 0) {
  const request = recent.load(offset);
  recentControls();
  byId('voucher-recent-message').textContent = 'Carregando validações…';
  const result = await request;
  if (result.kind === 'superseded') return;
  recentControls();
  const { items, total } = recent.state;
  const list = byId('voucher-recent-list');
  list.replaceChildren();
  byId('voucher-recent-pager').hidden = result.kind !== 'loaded' || total <= RECENT_VOUCHERS_PAGE_SIZE;
  if (result.kind !== 'loaded') {
    byId('voucher-recent-message').textContent = result.kind === 'denied' ? messages.denied
      : result.kind === 'rate_limited' ? 'Muitas atualizações. Aguarde um minuto antes de atualizar a lista.'
      : 'Não foi possível carregar as validações. Tente atualizar a lista.';
    return;
  }
  byId('voucher-recent-message').textContent = total ? `${total} voucher${total === 1 ? '' : 's'} validado${total === 1 ? '' : 's'} neste período.` : 'Nenhum voucher validado neste período.';
  byId('voucher-recent-count').textContent = items.length ? `${offset + 1}–${offset + items.length} de ${total}` : `0 de ${total}`;
  for (const item of items) {
    const row = document.createElement('article'); row.className = 'voucher-recent__item';
    const details = document.createElement('div');
    const name = document.createElement('h3'); name.textContent = item.beneficiary_name;
    const code = document.createElement('p'); code.className = 'voucher-code'; code.textContent = item.code;
    const validation = document.createElement('p'); validation.className = 'hint';
    validation.textContent = `${voucherEventTime(item.used_at)} · ${item.used_by_name}`;
    const benefit = document.createElement('strong'); benefit.textContent = voucherBenefit(item);
    details.append(name, code, validation); row.append(details, benefit); list.append(row);
  }
}

function setBusy(busy, label = 'Consultando…') {
  operation = busy;
  byId('voucher-search-button').disabled = busy;
  byId('voucher-search-button').textContent = busy ? label : 'Consultar voucher';
  byId('voucher-code').disabled = busy;
  byId('voucher-use-button').disabled = busy;
  byId('voucher-confirm-submit').disabled = busy;
  byId('voucher-result').setAttribute('aria-busy', String(busy));
}

function renderVoucher({ focus = false } = {}) {
  const voucher = session.state.voucher;
  byId('voucher-result').hidden = !voucher;
  byId('voucher-result').classList.toggle('voucher-result--expired', voucher?.status === 'expired');
  if (voucher?.status !== 'expired' && expiredDialog.open) expiredDialog.close();
  if (!voucher) return;
  const status = voucherStatus(voucher.status);
  byId('voucher-status').textContent = status.label;
  byId('voucher-status').className = `voucher-status voucher-status--${voucher.status}`;
  byId('voucher-status-description').textContent = status.description;
  byId('voucher-benefit').textContent = voucherBenefit(voucher);
  byId('voucher-beneficiary').textContent = voucher.beneficiary_name;
  byId('voucher-result-code').textContent = voucher.code;
  byId('voucher-expires').textContent = voucherDate(voucher.expires_on);
  byId('voucher-used-detail').hidden = voucher.status !== 'used';
  byId('voucher-used-at').textContent = `${voucherEventTime(voucher.used_at)} (Fortaleza)`;
  byId('voucher-used-by').textContent = voucher.used_by_name ? `Responsável: ${voucher.used_by_name}` : 'Responsável registrado no histórico interno.';
  byId('voucher-cancelled-detail').hidden = voucher.status !== 'cancelled';
  byId('voucher-cancelled-at').textContent = `${voucherEventTime(voucher.cancelled_at)} (Fortaleza)`;
  const conditions = byId('voucher-conditions');
  conditions.replaceChildren();
  for (const text of voucher.conditions) {
    const item = document.createElement('li');
    item.textContent = text;
    conditions.appendChild(item);
  }
  if (!voucher.conditions.length) {
    const item = document.createElement('li');
    item.textContent = 'Condições indisponíveis. Consulte novamente antes de aplicar o benefício.';
    conditions.appendChild(item);
  }
  byId('voucher-use-button').hidden = voucher.status !== 'available' || session.state.needsRefresh || !voucher.conditions.length;
  byId('voucher-actions').hidden = byId('voucher-use-button').hidden;
  if (focus) byId('voucher-beneficiary').focus();
}

async function lookup() {
  if (operation) return;
  setBusy(true);
  setFeedback('Consultando a situação atual…');
  try {
    const result = await session.lookup(byId('voucher-code').value);
    renderVoucher({ focus: result.kind === 'found' });
    if (result.kind === 'found') {
      byId('voucher-code').value = session.state.voucher.code;
      if (session.state.voucher.status === 'expired') {
        setFeedback();
        showExpiredNotice(session.state.voucher);
      } else {
        setFeedback(session.state.voucher.status === 'available' ? 'Voucher localizado. Confira os dados e as condições abaixo.' : 'Voucher localizado. Confira a situação registrada abaixo.');
      }
    } else {
      setFeedback(messages[result.kind] || 'Não foi possível consultar. Tente novamente.', 'danger');
    }
  } finally {
    setBusy(false);
  }
}

function openConfirmation() {
  const voucher = session.state.voucher;
  if (operation || !voucher || voucher.status !== 'available' || session.state.needsRefresh || !voucher.conditions.length) return;
  byId('voucher-confirm-check').checked = false;
  byId('voucher-confirm-description').textContent = `${voucherBenefit(voucher)} para ${voucher.beneficiary_name}. Código ${voucher.code}. Válido até ${voucherDate(voucher.expires_on)}, às 23h59 (Fortaleza).`;
  if (typeof dialog.showModal !== 'function') {
    setFeedback('Este navegador não oferece a confirmação necessária. Use um navegador atualizado para registrar a utilização.', 'danger');
    return;
  }
  dialog.showModal();
}

async function confirmUse(event) {
  event.preventDefault();
  if (operation || !dialog.open || !byId('voucher-confirm-check').checked) return;
  const presentedVoucher = session.state.voucher;
  byId('voucher-confirm-check').checked = false;
  dialog.close();
  setBusy(true, 'Registrando utilização…');
  setFeedback('Registrando a utilização. Aguarde a confirmação do sistema.');
  try {
    const result = await session.redeem(true);
    renderVoucher({ focus: true });
    if (result.kind === 'redeemed') {
      setFeedback('Utilização registrada. O voucher não poderá ser utilizado novamente.', 'success');
    } else if (result.kind === 'refused' && result.reason === 'changed') {
      setFeedback(session.state.needsRefresh
        ? 'O voucher foi alterado. Consulte novamente para conferir os dados atualizados antes de confirmar a utilização.'
        : 'O voucher foi alterado. Confira os dados atualizados e confirme novamente.', 'danger');
    } else if (result.kind === 'refused') {
      const reason = {
        used: 'Este voucher já foi utilizado.', expired: 'Este voucher venceu. Consulte o emissor do voucher.',
        cancelled: 'Este voucher foi cancelado.', not_found: 'O voucher não foi localizado.',
        rate_limited: 'Aguarde um minuto antes de consultar novamente.',
      }[result.reason] || 'A utilização não foi autorizada.';
      setFeedback(`${reason} A utilização solicitada não foi registrada. Confira a situação atual abaixo ou consulte novamente.`, 'danger');
      if (result.reason === 'expired') showExpiredNotice(session.state.voucher || presentedVoucher);
    } else {
      setFeedback(messages[result.kind] || messages.uncertain, 'danger');
      if (session.state.voucher?.status === 'expired') showExpiredNotice(session.state.voucher);
    }
  } finally {
    setBusy(false);
    loadRecent();
  }
}

async function init() {
  const user = await requireStaff({ adminOnly: false });
  if (!user) return;
  await mountLayout(user, 'vouchers');
  byId('vouchers-main').hidden = false;
  byId('voucher-search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    lookup();
  });
  byId('voucher-code').addEventListener('input', () => {
    if (operation) return;
    session.clear();
    renderVoucher();
    setFeedback();
  });
  byId('voucher-use-button').addEventListener('click', openConfirmation);
  byId('voucher-confirm-form').addEventListener('submit', confirmUse);
  byId('voucher-confirm-cancel').addEventListener('click', () => dialog.close());
  byId('voucher-expired-close').addEventListener('click', () => expiredDialog.close());
  expiredDialog.addEventListener('close', () => byId('voucher-code').focus());
  byId('voucher-recent-refresh').addEventListener('click', () => loadRecent());
  byId('voucher-recent-prev').addEventListener('click', () => loadRecent(Math.max(0, recent.state.offset - RECENT_VOUCHERS_PAGE_SIZE)));
  byId('voucher-recent-next').addEventListener('click', () => loadRecent(recent.state.offset + RECENT_VOUCHERS_PAGE_SIZE));
  loadRecent();
}

init().catch(() => {
  if (!byId('vouchers-main').hidden) setFeedback('Não foi possível iniciar a página. Atualize para verificar seu acesso novamente.', 'danger');
});
