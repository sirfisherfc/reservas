import { supabase } from './supabaseClient.js';
import { getQueryParam, formatDateLong, formatTimeLocal, setLoading, statusLabel } from './utils.js?v=20261007';
import { LANG, t, friendlyError, applyTranslations } from './i18n.js?v=20261007';

const card = document.getElementById('cancel-card');

function friendlyMessage(error) {
  return friendlyError(error, 'err.CANCEL_UNKNOWN');
}

function renderError(message) {
  card.innerHTML = `<div class="alert alert--danger" style="margin:0;">${message}</div>`;
}

function renderConfirm(token) {
  card.innerHTML = `
    <h2 class="section-title">${t('cancelConfirmTitle')}</h2>
    <p>${t('cancelConfirmText')}</p>
    <button id="confirm-cancel-btn" class="btn btn--primary" style="background:var(--color-danger);">
      ${t('cancelConfirmButton')}
    </button>
  `;
  document.getElementById('confirm-cancel-btn').addEventListener('click', () => doCancel(token));
}

function bookingLine(result) {
  const date = formatDateLong(result.reservation_date, LANG);
  const time = formatTimeLocal(result.reservation_time, LANG);
  return `<p><strong>${result.public_code}</strong> — ${date}, ${t('at')} ${time}</p>`;
}

function renderResult(result) {
  if (result.already_cancelled) {
    const isActuallyCancelled = result.status === 'cancelada_cliente' || result.status === 'cancelada_restaurante';
    card.innerHTML = `
      <div class="alert alert--info" style="margin:0 0 12px;">
        ${isActuallyCancelled ? t('cancelAlready') : t('cancelNotAllowed', statusLabel(result.status))}
      </div>
      ${bookingLine(result)}
    `;
    return;
  }
  card.innerHTML = `
    <div class="alert alert--success" style="margin:0 0 12px;">${t('cancelDone')}</div>
    ${bookingLine(result)}
    <p class="hint">${t('cancelReleased')}</p>
  `;
}

async function doCancel(token) {
  const btn = document.getElementById('confirm-cancel-btn');
  setLoading(btn, true, t('cancelling'));

  const { data, error } = await supabase.rpc('fn_cancel_reservation_public', { p_token: token });

  if (error) {
    renderError(friendlyMessage(error));
    return;
  }

  const result = Array.isArray(data) ? data[0] : data;
  renderResult(result);
}

function init() {
  applyTranslations('cancelar');
  const token = getQueryParam('t');
  if (!token) {
    renderError(t('cancelBadLink'));
    return;
  }
  renderConfirm(token);
}

init();
