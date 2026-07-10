import { supabase } from './supabaseClient.js';
import { fetchPublicSettings, fetchAvailableSlots, renderSlots } from './availability.js';
import {
  qs, qsa, todayISO, addDaysISO, maskPhoneBR, waLink,
  setLoading, debounce, formatDateBR, formatTimeBR,
} from './utils.js';
import { WHATSAPP_NUMBER, RESTAURANT_NAME } from './config.js';

const form = qs('#reservation-form');
const alertArea = qs('#form-alert-area');
const partySizeInput = qs('#party_size');
const dateInput = qs('#date');
const slotsContainer = qs('#slots-container');
const whatsappCta = qs('#whatsapp-cta');
const whatsappCtaLink = qs('#whatsapp-cta-link');
const phoneInput = qs('#phone');
const submitBtn = qs('#submit-btn');
const successPanel = qs('#success-panel');

let settings = null;
let selectedTime = null;
let currentSlots = [];

const FRIENDLY_FALLBACK = {
  HONEYPOT: 'Não foi possível concluir sua reserva. Tente novamente.',
  INVALID_PARTY_SIZE: 'Quantidade de pessoas inválida.',
  PARTY_TOO_LARGE: 'Para esse número de pessoas, fale com nossa equipe pelo WhatsApp.',
  DATE_NOT_ALLOWED: 'Não é possível reservar para essa data.',
  DATE_BLOCKED: 'Esse dia não está disponível para reservas.',
  SLOT_BLOCKED: 'Esse horário não está disponível.',
  SAME_DAY_CUTOFF: 'Reservas para o mesmo dia são aceitas somente até o horário de corte. Após esse horário, o atendimento funciona por ordem de chegada.',
  SLOT_FULL_PEOPLE: 'Esse horário já atingiu o limite de pessoas.',
  SLOT_FULL_RESERVATIONS: 'Esse horário já atingiu o limite de reservas.',
  DUPLICATE_REQUEST: 'Já identificamos uma solicitação recente com esses dados. Aguarde alguns minutos e tente novamente.',
  UNKNOWN: 'Não foi possível concluir sua reserva. Tente novamente ou fale conosco pelo WhatsApp.',
};

function friendlyMessage(error) {
  const raw = (error && error.message) || '';
  const sepIndex = raw.indexOf(':');
  const code = sepIndex > -1 ? raw.slice(0, sepIndex).trim() : raw.trim();
  const rest = sepIndex > -1 ? raw.slice(sepIndex + 1).trim() : '';
  return rest || FRIENDLY_FALLBACK[code] || FRIENDLY_FALLBACK.UNKNOWN;
}

function showAlert(message, type = 'danger') {
  alertArea.innerHTML = `<div class="alert alert--${type}">${message}</div>`;
}

function clearAlert() {
  alertArea.innerHTML = '';
}

function applyMaxPartyLabels(max) {
  qsa('.max-party-label, #max-party-label').forEach((el) => {
    el.textContent = String(max);
  });
}

function applyToleranceLabels(minutes) {
  qsa('.tolerance-label').forEach((el) => {
    el.textContent = String(minutes);
  });
}

function applyHoldReleaseLabels(minutes) {
  const text = minutes % 60 === 0 ? `${minutes / 60} hora${minutes > 60 ? 's' : ''}` : `${minutes} minutos`;
  qsa('.hold-release-label').forEach((el) => {
    el.textContent = text;
  });
}

function buildWaLink(message) {
  const number = settings?.whatsapp_number || WHATSAPP_NUMBER;
  return waLink(number, message);
}

async function init() {
  settings = await fetchPublicSettings();

  const min = Number(settings.min_party_size) || 2;
  const max = Number(settings.max_party_size) || 10;
  const advanceDays = Number(settings.advance_booking_days) || 60;

  partySizeInput.min = min;
  partySizeInput.max = max;
  qs('#party-size-hint').textContent = `Mínimo ${min} pessoas.`;
  applyMaxPartyLabels(max);
  applyToleranceLabels(Number(settings.tolerance_minutes) || 15);
  applyHoldReleaseLabels(Number(settings.hold_release_minutes) || 60);

  dateInput.min = todayISO();
  dateInput.max = addDaysISO(advanceDays);

  const waDefaultMsg = settings.whatsapp_message_template || `Olá! Gostaria de falar sobre uma reserva no ${RESTAURANT_NAME}.`;
  const waHref = buildWaLink(waDefaultMsg) || '#';
  whatsappCtaLink.href = waHref;
  qs('#footer-whatsapp').href = waHref;
  if (!settings.whatsapp_number && !WHATSAPP_NUMBER) {
    qs('#footer-whatsapp').classList.add('hidden');
  }

  phoneInput.addEventListener('input', () => {
    phoneInput.value = maskPhoneBR(phoneInput.value);
  });

  partySizeInput.addEventListener('input', debounce(handleAvailabilityInputs, 250));
  dateInput.addEventListener('input', debounce(handleAvailabilityInputs, 250));

  form.addEventListener('submit', handleSubmit);
}

function checkPartySizeOverflow() {
  const size = Number(partySizeInput.value);
  const max = Number(partySizeInput.max);
  if (size > max) {
    whatsappCta.classList.remove('hidden');
    slotsContainer.innerHTML = '';
    submitBtn.disabled = true;
    return true;
  }
  whatsappCta.classList.add('hidden');
  submitBtn.disabled = false;
  return false;
}

async function handleAvailabilityInputs() {
  clearAlert();
  selectedTime = null;

  if (checkPartySizeOverflow()) return;

  const date = dateInput.value;
  const size = Number(partySizeInput.value);
  const min = Number(partySizeInput.min);

  if (!date || !size || size < min) {
    slotsContainer.innerHTML = '<p class="hint">Selecione data e quantidade de pessoas para ver os horários disponíveis.</p>';
    return;
  }

  slotsContainer.innerHTML = '<p class="hint">Buscando horários…</p>';

  const { slots, error } = await fetchAvailableSlots(date, size);

  if (error) {
    renderNoAvailability(date, size, error);
    return;
  }

  currentSlots = slots;

  if (!slots.length) {
    renderNoAvailability(date, size, null);
    return;
  }

  renderSlots(slotsContainer, currentSlots, selectedTime, selectSlot);
}

function renderNoAvailability(date, size, errorCode) {
  const waHref = buildWaLink(`Olá! Gostaria de verificar disponibilidade no ${RESTAURANT_NAME} para ${size} pessoas no dia ${date}.`) || '#';

  if (errorCode === 'SAME_DAY_CUTOFF' && date === todayISO()) {
    const cutoff = String(settings?.same_day_cutoff_time || '12:00').slice(0, 5);
    slotsContainer.innerHTML = `
      <p class="hint">Reservas para o mesmo dia são aceitas somente até ${cutoff}. Após esse horário não conseguimos mais confirmar reserva online, mas temos mesas para atendimento por ordem de chegada — venha nos visitar!</p>
      <a class="btn btn--whatsapp" style="margin-top:8px;" href="${waHref}" target="_blank" rel="noopener">Falar no WhatsApp</a>
    `;
    return;
  }

  const message = errorCode ? friendlyMessage({ message: `${errorCode}:` }) : 'Nenhum horário disponível para essa data e quantidade de pessoas.';
  slotsContainer.innerHTML = `
    <p class="hint">${message}</p>
    <a class="btn btn--whatsapp" style="margin-top:8px;" href="${waHref}" target="_blank" rel="noopener">Falar no WhatsApp</a>
  `;
}

function selectSlot(time) {
  selectedTime = time;
  renderSlots(slotsContainer, currentSlots, selectedTime, selectSlot);
}

async function handleSubmit(evt) {
  evt.preventDefault();
  clearAlert();

  const honeypot = qs('#website').value;
  const name = qs('#name').value.trim();
  const email = qs('#email').value.trim();
  const phone = phoneInput.value.trim();
  const partySize = Number(partySizeInput.value);
  const date = dateInput.value;
  const notes = qs('#notes').value.trim();
  const acceptPolicy = qs('#accept_policy').checked;
  const marketingOptIn = qs('#marketing_opt_in').checked;

  if (!name || !email || !phone || !date || !partySize) {
    showAlert('Preencha todos os campos obrigatórios.');
    return;
  }
  if (!selectedTime) {
    showAlert('Selecione um horário disponível.');
    return;
  }
  if (!acceptPolicy) {
    showAlert('É necessário aceitar as regras da reserva para continuar.');
    return;
  }
  if (checkPartySizeOverflow()) return;

  setLoading(submitBtn, true, 'Confirmando...');

  const { data, error } = await supabase.rpc('fn_create_reservation', {
    p_name: name,
    p_email: email,
    p_phone: phone,
    p_date: date,
    p_time: selectedTime,
    p_party_size: partySize,
    p_notes: notes || null,
    p_marketing_opt_in: marketingOptIn,
    p_accepted_policy: acceptPolicy,
    p_honeypot: honeypot || null,
  });

  setLoading(submitBtn, false);

  if (error) {
    showAlert(friendlyMessage(error));
    return;
  }

  const result = Array.isArray(data) ? data[0] : data;
  showSuccess(result);
}

function showSuccess(result) {
  form.classList.add('hidden');
  clearAlert();
  successPanel.classList.remove('hidden');

  qs('#success-code').textContent = result.public_code;

  const list = qs('#success-summary');
  list.innerHTML = `
    <li><span>Data</span><strong>${formatDateBR(result.reservation_date)}</strong></li>
    <li><span>Horário</span><strong>${formatTimeBR(result.reservation_time)}</strong></li>
    <li><span>Pessoas</span><strong>${result.party_size}</strong></li>
  `;

  const waMsg = `Olá! Minha reserva no ${RESTAURANT_NAME} é ${result.public_code}, dia ${formatDateBR(result.reservation_date)} às ${formatTimeBR(result.reservation_time)}.`;
  qs('#success-whatsapp').href = buildWaLink(waMsg) || '#';

  qs('#success-cancel-link').href = `./cancelar.html?t=${encodeURIComponent(result.cancellation_token)}`;

  successPanel.scrollIntoView({ behavior: 'smooth' });
}

init();
