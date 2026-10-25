import { supabase } from './supabaseClient.js';
import { fetchPublicSettings, fetchAvailableSlots, renderSlots } from './availability.js?v=20261025';
import {
  qs, qsa, todayISO, addDaysISO, maskPhone, waLink,
  setLoading, debounce, formatDateLong, formatTimeLocal,
} from './utils.js?v=20261007';
import { LANG, t, friendlyError, applyTranslations } from './i18n.js?v=20261007';
import { WHATSAPP_NUMBER, RESTAURANT_NAME } from './config.js';
import {
  initOpenAIAdsPixel, measureReservationPageViewed, measureReservationConfirmed,
  measureReservationConfirmedGA4, measureReservationConfirmedMeta, reservationAttribution,
} from './attribution.js?v=20261022';
import { createReservationFunnel, reservationFailure } from './reservation-funnel.js?v=20261022';

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
const funnel = createReservationFunnel(form);

let settings = null;
let selectedTime = null;
let currentSlots = [];
let availabilityVersion = 0;

// Mensagens de erro por código: ver STRINGS em i18n.js.
const friendlyMessage = (error) => friendlyError(error);

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
  const text = minutes % 60 === 0 ? t('hours', minutes / 60) : t('minutes', minutes);
  qsa('.hold-release-label').forEach((el) => {
    el.textContent = text;
  });
}

function buildWaLink(message) {
  const number = settings?.whatsapp_number || WHATSAPP_NUMBER;
  return waLink(number, message);
}

async function init() {
  applyTranslations('reserva');
  funnel.view();
  if (t('tzNote')) {
    qs('#tz-note').textContent = t('tzNote');
    qs('#tz-note').classList.remove('hidden');
  }
  try {
    initOpenAIAdsPixel();
    measureReservationPageViewed();
  } catch { /* Uma falha do pixel nao impede a montagem do formulario. */ }
  settings = await fetchPublicSettings();

  const min = Number(settings.min_party_size) || 1;
  const max = Number(settings.max_party_size) || 10;
  const advanceDays = Number(settings.advance_booking_days) || 60;

  partySizeInput.min = min;
  partySizeInput.max = max;
  qs('#party-size-hint').textContent = min > 1
    ? t('partyMin', min)
    : t('partyFrom1');
  applyMaxPartyLabels(max);
  applyToleranceLabels(Number(settings.tolerance_minutes) || 15);
  applyHoldReleaseLabels(Number(settings.hold_release_minutes) || 60);

  dateInput.min = todayISO();
  dateInput.max = addDaysISO(advanceDays);

  const waDefaultMsg = (LANG === 'pt' && settings.whatsapp_message_template) || t('waDefault', RESTAURANT_NAME);
  const waHref = buildWaLink(waDefaultMsg) || '#';
  whatsappCtaLink.href = waHref;
  qs('#footer-whatsapp').href = waHref;
  if (!settings.whatsapp_number && !WHATSAPP_NUMBER) {
    qs('#footer-whatsapp').classList.add('hidden');
  }

  phoneInput.addEventListener('input', () => {
    phoneInput.value = maskPhone(phoneInput.value);
  });

  const queryAvailability = debounce(handleAvailabilityInputs, 250);
  const refreshAvailability = () => {
    // Invalida a escolha anterior no mesmo evento, antes de aguardar o debounce.
    // Assim um envio rapido usa apenas horarios da data e do grupo atuais.
    availabilityVersion += 1;
    selectedTime = null;
    currentSlots = [];
    slotsContainer.innerHTML = `<p class="hint">${t('slotsHint')}</p>`;
    queryAvailability();
  };
  partySizeInput.addEventListener('input', refreshAvailability);
  dateInput.addEventListener('input', refreshAvailability);
  // O seletor nativo de data do Safari/iOS confirma a escolha via `change`.
  dateInput.addEventListener('change', refreshAvailability);
  // O campo nativo mostra dd/mm ou mm/dd conforme o navegador: a data por
  // extenso logo abaixo tira a dúvida de quem reserva do exterior.
  const showReadableDate = () => {
    qs('#date-readable').textContent = dateInput.value ? formatDateLong(dateInput.value, LANG) : '';
  };
  dateInput.addEventListener('input', showReadableDate);
  dateInput.addEventListener('change', showReadableDate);

  form.addEventListener('submit', handleSubmit);
}

function checkPartySizeOverflow() {
  const size = Number(partySizeInput.value);
  const max = Number(partySizeInput.max);
  if (size > max) {
    funnel.unavailable('party_size_limit', String(size));
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
  const version = ++availabilityVersion;
  clearAlert();
  selectedTime = null;

  if (checkPartySizeOverflow()) return;

  // Datas com reserva própria (ex.: Réveillon): mostra o aviso e o link em
  // vez dos horários. Vem de restaurant_settings.special_date_notices.
  const notice = specialDateNotice(dateInput.value);
  if (notice) {
    renderSpecialDateNotice(notice);
    return;
  }

  const date = dateInput.value;
  const size = Number(partySizeInput.value);
  const min = Number(partySizeInput.min);

  if (!date || !size || size < min) {
    slotsContainer.innerHTML = `<p class="hint">${t('slotsHint')}</p>`;
    return;
  }

  slotsContainer.innerHTML = `<p class="hint">${t('searching')}</p>`;
  const isCurrent = () => version === availabilityVersion
    && dateInput.value === date && Number(partySizeInput.value) === size;

  let response;
  try {
    response = await fetchAvailableSlots(date, size);
  } catch {
    if (!isCurrent()) return;
    renderNoAvailability(date, size, 'NETWORK_ERROR');
    return;
  }
  // Uma resposta de uma selecao anterior nao descreve a escolha atual.
  if (!isCurrent()) return;
  const { slots, error } = response;

  if (error) {
    renderNoAvailability(date, size, error);
    return;
  }

  currentSlots = slots;

  if (!slots.length) {
    renderNoAvailability(date, size, null);
    return;
  }

  if (slots.some((slot) => slot.is_available)) funnel.available();
  else funnel.unavailable('no_slots', `${date}:${size}`);

  renderSlots(slotsContainer, currentSlots, selectedTime, selectSlot, LANG);
}

function specialDateNotice(date) {
  const list = Array.isArray(settings?.special_date_notices) ? settings.special_date_notices : [];
  return date ? list.find((n) => n && n.date === date) : null;
}

function renderSpecialDateNotice(notice) {
  funnel.unavailable('special_date', dateInput.value);
  slotsContainer.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'alert alert--info';
  const text = document.createElement('p');
  text.style.margin = '0 0 10px';
  text.textContent = notice.message || '';
  box.appendChild(text);
  if (notice.url) {
    const link = document.createElement('a');
    link.className = 'btn btn--primary';
    link.href = notice.url;
    link.textContent = notice.cta || t('learnMore');
    box.appendChild(link);
  }
  slotsContainer.appendChild(box);
  submitBtn.disabled = true;
}

function renderNoAvailability(date, size, errorCode) {
  if (errorCode) {
    const { stage, reason } = reservationFailure(errorCode);
    if (stage === 'unavailable') funnel.unavailable(reason, `${date}:${size}`);
    else funnel.track(stage, reason);
  } else funnel.unavailable('no_slots', `${date}:${size}`);
  const waHref = buildWaLink(t('waAvailability', RESTAURANT_NAME, size, formatDateLong(date, LANG))) || '#';

  if (errorCode === 'SAME_DAY_CUTOFF' && date === todayISO()) {
    const cutoff = String(settings?.same_day_cutoff_time || '15:30').slice(0, 5);
    slotsContainer.innerHTML = `
      <p class="hint">${t('sameDayCutoff', formatTimeLocal(cutoff, LANG))}</p>
      <a class="btn btn--whatsapp" style="margin-top:8px;" href="${waHref}" target="_blank" rel="noopener">${t('waButton')}</a>
    `;
    return;
  }

  const message = errorCode ? friendlyMessage({ message: `${errorCode}:` }) : t('noSlots');
  slotsContainer.innerHTML = `
    <p class="hint">${message}</p>
    <a class="btn btn--whatsapp" style="margin-top:8px;" href="${waHref}" target="_blank" rel="noopener">${t('waButton')}</a>
  `;
}

function selectSlot(time) {
  funnel.interact();
  funnel.track('slot');
  selectedTime = time;
  renderSlots(slotsContainer, currentSlots, selectedTime, selectSlot, LANG);
}

async function handleSubmit(evt) {
  evt.preventDefault();
  clearAlert();
  funnel.interact();
  funnel.track('submit');

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
    funnel.track('error', 'required_fields');
    showAlert(t('fillRequired'));
    return;
  }
  if (!selectedTime) {
    funnel.track('error', 'time_required');
    showAlert(t('selectTime'));
    return;
  }
  if (!acceptPolicy) {
    funnel.track('error', 'policy_required');
    showAlert(t('acceptRules'));
    return;
  }
  if (checkPartySizeOverflow()) return;

  setLoading(submitBtn, true, t('confirming'));

  let response;
  try {
    response = await supabase.rpc('fn_create_reservation', {
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
      // lang define o idioma dos e-mails de confirmação e de lembrete.
      p_attribution: { ...(await reservationAttribution()), lang: LANG },
    });
  } catch {
    funnel.track('error', 'network_error');
    showAlert(friendlyMessage({ message: 'UNKNOWN:' }));
    return;
  } finally {
    setLoading(submitBtn, false);
  }
  const { data, error } = response;

  if (error) {
    funnel.failure(error);
    showAlert(friendlyMessage(error));
    return;
  }

  const result = Array.isArray(data) ? data[0] : data;
  // Uma falha em qualquer pixel nao pode esconder uma reserva ja criada.
  try { await measureReservationConfirmed(result, { email, phone, name }); } catch { /* pixel */ }
  try { measureReservationConfirmedGA4(result); } catch { /* tag */ }
  try { measureReservationConfirmedMeta(result); } catch { /* pixel */ }
  showSuccess(result);
}

function showSuccess(result) {
  form.classList.add('hidden');
  clearAlert();
  successPanel.classList.remove('hidden');

  qs('#success-code').textContent = result.public_code;

  const list = qs('#success-summary');
  const dateText = formatDateLong(result.reservation_date, LANG);
  const timeText = formatTimeLocal(result.reservation_time, LANG);
  list.innerHTML = `
    <li><span>${t('sumDate')}</span><strong>${dateText}</strong></li>
    <li><span>${t('sumTime')}</span><strong>${timeText}</strong></li>
    <li><span>${t('sumGuests')}</span><strong>${result.party_size}</strong></li>
  `;

  const waMsg = t('waConfirm', RESTAURANT_NAME, result.public_code, dateText, timeText);
  qs('#success-whatsapp').href = buildWaLink(waMsg) || '#';

  qs('#success-cancel-link').href = `./cancelar.html?t=${encodeURIComponent(result.cancellation_token)}&lang=${LANG}`;

  successPanel.scrollIntoView({ behavior: 'smooth' });
}

init().catch(() => {
  funnel.track('error', 'initialization');
  showAlert(friendlyMessage({ message: 'UNKNOWN:' }));
});
