import { supabase } from './supabaseClient.js';
import { getQueryParam, formatDateBR, formatTimeBR, setLoading, statusLabel } from './utils.js';

const card = document.getElementById('cancel-card');

const FRIENDLY_FALLBACK = {
  NOT_FOUND: 'Não encontramos essa reserva. Verifique o link recebido por e-mail ou WhatsApp.',
  UNKNOWN: 'Não foi possível processar o cancelamento. Tente novamente em instantes.',
};

function friendlyMessage(error) {
  const raw = (error && error.message) || '';
  const sepIndex = raw.indexOf(':');
  const code = sepIndex > -1 ? raw.slice(0, sepIndex).trim() : raw.trim();
  const rest = sepIndex > -1 ? raw.slice(sepIndex + 1).trim() : '';
  return rest || FRIENDLY_FALLBACK[code] || FRIENDLY_FALLBACK.UNKNOWN;
}

function renderError(message) {
  card.innerHTML = `<div class="alert alert--danger" style="margin:0;">${message}</div>`;
}

function renderConfirm(token) {
  card.innerHTML = `
    <h2 class="section-title">Cancelar sua reserva</h2>
    <p>Tem certeza que deseja cancelar esta reserva? Essa ação não pode ser desfeita.</p>
    <button id="confirm-cancel-btn" class="btn btn--primary" style="background:var(--color-danger);">
      Sim, cancelar reserva
    </button>
  `;
  document.getElementById('confirm-cancel-btn').addEventListener('click', () => doCancel(token));
}

function renderResult(result) {
  if (result.already_cancelled) {
    const isActuallyCancelled = result.status === 'cancelada_cliente' || result.status === 'cancelada_restaurante';
    card.innerHTML = `
      <div class="alert alert--info" style="margin:0 0 12px;">
        ${isActuallyCancelled ? 'Esta reserva já estava cancelada.' : `Esta reserva não pode mais ser cancelada por aqui (status atual: ${statusLabel(result.status)}).`}
      </div>
      <p><strong>${result.public_code}</strong> — ${formatDateBR(result.reservation_date)} às ${formatTimeBR(result.reservation_time)}</p>
    `;
    return;
  }
  card.innerHTML = `
    <div class="alert alert--success" style="margin:0 0 12px;">Reserva cancelada com sucesso.</div>
    <p><strong>${result.public_code}</strong> — ${formatDateBR(result.reservation_date)} às ${formatTimeBR(result.reservation_time)}</p>
    <p class="hint">A vaga foi liberada para outros clientes.</p>
  `;
}

async function doCancel(token) {
  const btn = document.getElementById('confirm-cancel-btn');
  setLoading(btn, true, 'Cancelando...');

  const { data, error } = await supabase.rpc('fn_cancel_reservation_public', { p_token: token });

  if (error) {
    renderError(friendlyMessage(error));
    return;
  }

  const result = Array.isArray(data) ? data[0] : data;
  renderResult(result);
}

function init() {
  const token = getQueryParam('t');
  if (!token) {
    renderError('Link de cancelamento inválido ou incompleto.');
    return;
  }
  renderConfirm(token);
}

init();
