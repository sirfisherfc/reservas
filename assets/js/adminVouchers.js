import { supabase } from './supabaseClient.js';
import { requireStaff, mountLayout } from './adminGuard.js';
import {
  createVoucherSession, voucherBenefit, voucherDate, voucherEventTime, voucherStatus,
} from './benefit-vouchers.mjs?v=20261105-short';

const byId = (id) => document.getElementById(id);
const session = createVoucherSession((name, args) => supabase.rpc(name, args));
const feedback = byId('voucher-feedback');
const dialog = byId('voucher-confirm-dialog');
let operation = false;

const messages = {
  invalid_code: 'Confira os 6 caracteres do código. Os códigos antigos também podem ser consultados. Não foi feita nenhuma utilização.',
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

function setBusy(busy, label = 'Consultando…') {
  operation = busy;
  byId('voucher-search-button').disabled = busy;
  byId('voucher-search-button').textContent = busy ? label : 'Consultar voucher';
  byId('voucher-code').disabled = busy;
  byId('voucher-refresh-button').disabled = busy;
  byId('voucher-use-button').disabled = busy;
  byId('voucher-confirm-submit').disabled = busy;
  byId('voucher-result').setAttribute('aria-busy', String(busy));
}

function renderVoucher({ focus = false } = {}) {
  const voucher = session.state.voucher;
  byId('voucher-result').hidden = !voucher;
  if (!voucher) return;
  const status = voucherStatus(voucher.status);
  byId('voucher-status').textContent = status.label;
  byId('voucher-status').className = `voucher-status voucher-status--${voucher.status}`;
  byId('voucher-status-description').textContent = status.description;
  byId('voucher-benefit').textContent = voucherBenefit(voucher);
  byId('voucher-beneficiary').textContent = voucher.beneficiary_name;
  byId('voucher-result-code').textContent = voucher.code;
  byId('voucher-expires').textContent = voucherDate(voucher.expires_on);
  byId('voucher-unit').textContent = voucher.unit_name;
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
      setFeedback(session.state.voucher.status === 'available' ? 'Voucher localizado. Confira os dados e as condições abaixo.' : 'Voucher localizado. Confira a situação registrada abaixo.');
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
        used: 'Este voucher já foi utilizado.', expired: 'Este voucher venceu.',
        cancelled: 'Este voucher foi cancelado.', not_found: 'O voucher não foi localizado.',
        rate_limited: 'Aguarde um minuto antes de consultar novamente.',
      }[result.reason] || 'A utilização não foi autorizada.';
      setFeedback(`${reason} A utilização solicitada não foi registrada. Confira a situação atual abaixo ou consulte novamente.`, 'danger');
    } else {
      setFeedback(messages[result.kind] || messages.uncertain, 'danger');
    }
  } finally {
    setBusy(false);
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
  byId('voucher-refresh-button').addEventListener('click', lookup);
  byId('voucher-use-button').addEventListener('click', openConfirmation);
  byId('voucher-confirm-form').addEventListener('submit', confirmUse);
  byId('voucher-confirm-cancel').addEventListener('click', () => dialog.close());
}

init().catch(() => {
  if (!byId('vouchers-main').hidden) setFeedback('Não foi possível iniciar a página. Atualize para verificar seu acesso novamente.', 'danger');
});
