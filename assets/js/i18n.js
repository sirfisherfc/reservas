// Idioma do portal público (reserva e cancelamento): português ou inglês.
//
// O português continua sendo o texto escrito no HTML. Em inglês, os elementos
// marcados com data-i18n recebem o texto de EN_HTML. O idioma vem, nesta
// ordem, de ?lang=en|pt, da última escolha salva e do idioma do navegador.
// Um script no <head> faz a mesma escolha antes da primeira pintura e esconde
// a página por um instante, para o visitante não ver o português piscar.

const STORAGE_KEY = 'sf-lang';

function detectLang() {
  const early = document.documentElement.dataset.lang;
  if (early === 'en' || early === 'pt') return early;
  try {
    const q = new URLSearchParams(window.location.search).get('lang');
    if (q === 'en' || q === 'pt') return q;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'pt') return saved;
  } catch (e) { /* storage indisponível */ }
  return /^en\b/i.test(navigator.language || '') ? 'en' : 'pt';
}

export const LANG = detectLang();

// Textos do HTML em inglês, por chave data-i18n. Podem conter marcação.
const EN_HTML = {
  heroTitle: 'Book a table at Sir Fisher',
  heroText: 'Reserve your table and enjoy the seafront. Tables are assigned on arrival, according to availability.',
  formTitle: 'Make a booking',
  honeypot: 'Leave this field empty',
  labelName: 'Name',
  labelPhone: 'Phone / WhatsApp',
  phoneHint: 'Outside Brazil? Start with + and your country code, e.g. +1 305 555 0123.',
  labelEmail: 'Email',
  labelParty: 'Number of guests',
  labelDate: 'Date',
  labelTime: 'Time',
  slotsHint: 'Choose a date and the number of guests to see available times.',
  waCta: 'For more than <span class="max-party-label">10</span> guests, message our team on WhatsApp so we can check availability.',
  waButton: 'Message us on WhatsApp',
  labelNotes: 'Notes (optional)',
  notesHint: 'The team will consider notes based on availability.',
  rulesTitle: 'Booking rules',
  rulesHint: 'tap to read',
  rule1: 'We hold your table for <span class="tolerance-label">15</span> minutes after the booked time. After that, the booking may be released.',
  rule2: 'The team assigns the table on arrival, according to availability.',
  rule3: 'Only part of the restaurant is bookable. The remaining tables are first come, first served.',
  rule4: 'Groups larger than <span class="max-party-label">10</span> must book through WhatsApp.',
  rule5: 'Reserved seats may be released to other guests after <span class="hold-release-label">1 hour</span> unoccupied.',
  rule6: 'Prices are in Brazilian reais (R$). A 10% service charge is added to the bill and is optional.',
  acceptPolicy: 'I have read and accept the <strong>booking rules</strong> above.',
  marketing: 'Send me offers and menu news. I can unsubscribe at any time.',
  submit: 'Confirm booking',
  successTitle: 'Booking confirmed 🎉',
  successText: 'Your booking details are below. Please arrive within the 15-minute grace period to keep your table.',
  cancelLink: 'Cancel this booking',
  footerTagline: 'online bookings',
  footerHelp: 'Need help?',
  footerWhatsapp: 'Message us on WhatsApp',
  privacy: 'Privacy notice (in Portuguese)',
  cancelTitle: 'Cancel booking',
  loading: 'Loading…',
  backToBooking: '&larr; Back to the booking page',
};

const EN_PLACEHOLDER = {
  phone: '+1 305 555 0123',
  notes: 'Anything we should know about your visit?',
};

const EN_META = {
  reserva: {
    title: 'Book a table — Sir Fisher, Fortaleza seafront',
    description: 'Book a table at Sir Fisher, on the Beira-Mar seafront in Fortaleza, Brazil. Instant confirmation.',
  },
  cancelar: {
    title: 'Cancel booking — Sir Fisher',
  },
};

// Textos usados pelo JavaScript, nos dois idiomas.
const STRINGS = {
  pt: {
    'err.HONEYPOT': 'Não foi possível concluir sua reserva. Tente novamente.',
    'err.INVALID_PARTY_SIZE': 'Quantidade de pessoas inválida.',
    'err.PARTY_TOO_LARGE': 'Para esse número de pessoas, fale com nossa equipe pelo WhatsApp.',
    'err.DATE_NOT_ALLOWED': 'Não é possível reservar para essa data.',
    'err.DATE_BLOCKED': 'Esse dia não está disponível para reservas.',
    'err.SLOT_BLOCKED': 'Esse horário não está disponível.',
    'err.SAME_DAY_CUTOFF': 'Para reservar no mesmo dia, escolha um horário antes do corte. Depois disso, atendemos por ordem de chegada.',
    'err.SLOT_FULL_PEOPLE': 'Esse horário já atingiu o limite de pessoas.',
    'err.SLOT_FULL_RESERVATIONS': 'Esse horário já atingiu o limite de reservas.',
    'err.DUPLICATE_REQUEST': 'Já identificamos uma solicitação recente com esses dados. Aguarde alguns minutos e tente novamente.',
    'err.UNKNOWN': 'Não foi possível concluir sua reserva. Tente novamente ou fale conosco pelo WhatsApp.',
    'err.NOT_FOUND': 'Não encontramos essa reserva. Verifique o link recebido por e-mail ou WhatsApp.',
    'err.CANCEL_UNKNOWN': 'Não foi possível processar o cancelamento. Tente novamente em instantes.',
    partyMin: (min) => `Mínimo ${min} pessoas.`,
    partyFrom1: 'A partir de 1 pessoa.',
    hours: (n) => `${n} hora${n > 1 ? 's' : ''}`,
    minutes: (n) => `${n} minutos`,
    waDefault: (name) => `Olá! Gostaria de falar sobre uma reserva no ${name}.`,
    slotsHint: 'Selecione data e quantidade de pessoas para ver os horários disponíveis.',
    searching: 'Buscando horários…',
    sameDayCutoff: (cutoff) => `Para hoje, confirme a reserva online até ${cutoff}. Depois desse horário, atendemos por ordem de chegada.`,
    noSlots: 'Nenhum horário disponível para essa data e quantidade de pessoas.',
    waAvailability: (name, size, date) => `Olá! Gostaria de verificar disponibilidade no ${name} para ${size} pessoas no dia ${date}.`,
    waButton: 'Falar no WhatsApp',
    learnMore: 'Saiba mais',
    tzNote: '',
    fillRequired: 'Preencha todos os campos obrigatórios.',
    selectTime: 'Selecione um horário disponível.',
    acceptRules: 'É necessário aceitar as regras da reserva para continuar.',
    confirming: 'Confirmando...',
    sumDate: 'Data',
    sumTime: 'Horário',
    sumGuests: 'Pessoas',
    waConfirm: (name, code, date, time) => `Olá! Minha reserva no ${name} é ${code}, ${date}, às ${time}.`,
    cancelConfirmTitle: 'Cancelar sua reserva',
    cancelConfirmText: 'Confirme o cancelamento desta reserva. A ação é definitiva.',
    cancelConfirmButton: 'Sim, cancelar reserva',
    cancelling: 'Cancelando...',
    cancelAlready: 'Esta reserva já estava cancelada.',
    cancelNotAllowed: (status) => `Esta reserva não pode mais ser cancelada por aqui (status atual: ${status}).`,
    cancelDone: 'Reserva cancelada com sucesso.',
    cancelReleased: 'A vaga foi liberada para outros clientes.',
    cancelBadLink: 'Link de cancelamento inválido ou incompleto.',
    at: 'às',
    switchTo: 'English',
  },
  en: {
    'err.HONEYPOT': 'We could not complete your booking. Please try again.',
    'err.INVALID_PARTY_SIZE': 'Invalid number of guests.',
    'err.PARTY_TOO_LARGE': 'For this number of guests, please message our team on WhatsApp.',
    'err.DATE_NOT_ALLOWED': 'Bookings are not available for this date.',
    'err.DATE_BLOCKED': 'This day is not available for bookings.',
    'err.SLOT_BLOCKED': 'This time is not available.',
    'err.SAME_DAY_CUTOFF': 'Same-day bookings must be made before the cut-off time. After that, tables are first come, first served.',
    'err.SLOT_FULL_PEOPLE': 'This time is fully booked.',
    'err.SLOT_FULL_RESERVATIONS': 'This time is fully booked.',
    'err.DUPLICATE_REQUEST': 'We have just received a booking with these details. Please wait a few minutes and try again.',
    'err.UNKNOWN': 'We could not complete your booking. Please try again or message us on WhatsApp.',
    'err.NOT_FOUND': 'We could not find this booking. Please check the link you received by email or WhatsApp.',
    'err.CANCEL_UNKNOWN': 'We could not process the cancellation. Please try again in a moment.',
    partyMin: (min) => `Minimum ${min} guests.`,
    partyFrom1: 'From 1 guest.',
    hours: (n) => `${n} hour${n > 1 ? 's' : ''}`,
    minutes: (n) => `${n} minutes`,
    waDefault: (name) => `Hello! I'd like to ask about a booking at ${name}.`,
    slotsHint: 'Choose a date and the number of guests to see available times.',
    searching: 'Checking available times…',
    sameDayCutoff: (cutoff) => `For today, online bookings close at ${cutoff} (Fortaleza time). After that, tables are first come, first served.`,
    noSlots: 'No times available for this date and number of guests.',
    waAvailability: (name, size, date) => `Hello! I'd like to check availability at ${name} for ${size} guests on ${date}.`,
    waButton: 'Message us on WhatsApp',
    learnMore: 'Learn more',
    tzNote: 'Times are local to Fortaleza (UTC−3).',
    fillRequired: 'Please fill in all required fields.',
    selectTime: 'Please choose an available time.',
    acceptRules: 'Please accept the booking rules to continue.',
    confirming: 'Confirming...',
    sumDate: 'Date',
    sumTime: 'Time',
    sumGuests: 'Guests',
    waConfirm: (name, code, date, time) => `Hello! My booking at ${name} is ${code}, ${date}, at ${time}.`,
    cancelConfirmTitle: 'Cancel your booking',
    cancelConfirmText: 'Please confirm the cancellation. This cannot be undone.',
    cancelConfirmButton: 'Yes, cancel booking',
    cancelling: 'Cancelling...',
    cancelAlready: 'This booking was already cancelled.',
    cancelNotAllowed: (status) => `This booking can no longer be cancelled here (current status: ${status}).`,
    cancelDone: 'Your booking has been cancelled.',
    cancelReleased: 'The table is now available to other guests.',
    cancelBadLink: 'This cancellation link is invalid or incomplete.',
    at: 'at',
    switchTo: 'Português',
  },
};

export function t(key, ...args) {
  const value = STRINGS[LANG][key] ?? STRINGS.pt[key];
  return typeof value === 'function' ? value(...args) : (value ?? '');
}

// Mensagem amigável a partir do erro do banco ("CODIGO: texto em português").
// Em inglês o texto do banco é descartado e vale a tradução do código.
export function friendlyError(error, fallbackKey = 'err.UNKNOWN') {
  const raw = (error && error.message) || '';
  const sepIndex = raw.indexOf(':');
  const code = (sepIndex > -1 ? raw.slice(0, sepIndex) : raw).trim();
  const rest = sepIndex > -1 ? raw.slice(sepIndex + 1).trim() : '';
  const known = STRINGS[LANG][`err.${code}`];
  if (LANG === 'en') return known || STRINGS.en[fallbackKey];
  return rest || known || STRINGS.pt[fallbackKey];
}

// Link para a mesma página no outro idioma, preservando utm e demais parâmetros.
export function langUrl(lang) {
  const url = new URL(window.location.href);
  url.searchParams.set('lang', lang);
  return url.pathname + url.search + url.hash;
}

export function applyTranslations(page = 'reserva') {
  const root = document.documentElement;
  root.lang = LANG === 'en' ? 'en' : 'pt-BR';
  try { localStorage.setItem(STORAGE_KEY, LANG); } catch (e) { /* ok */ }

  if (LANG === 'en') {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const html = EN_HTML[el.dataset.i18n];
      if (html !== undefined) el.innerHTML = html;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const text = EN_PLACEHOLDER[el.dataset.i18nPlaceholder];
      if (text !== undefined) el.setAttribute('placeholder', text);
    });
    const meta = EN_META[page];
    if (meta?.title) document.title = meta.title;
    if (meta?.description) document.querySelector('meta[name="description"]')?.setAttribute('content', meta.description);
  }

  document.querySelectorAll('[data-only-lang]').forEach((el) => {
    el.classList.toggle('hidden', el.dataset.onlyLang !== LANG);
  });

  document.querySelectorAll('[data-lang-switch]').forEach((a) => {
    const other = LANG === 'en' ? 'pt' : 'en';
    a.textContent = t('switchTo');
    a.setAttribute('hreflang', other === 'en' ? 'en' : 'pt-BR');
    a.setAttribute('lang', other === 'en' ? 'en' : 'pt-BR');
    a.href = langUrl(other);
  });

  root.classList.remove('i18n-pending');
}
