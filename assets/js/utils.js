// Helpers genéricos compartilhados entre site público e painel admin.

export function qs(selector, parent = document) {
  return parent.querySelector(selector);
}

export function qsa(selector, parent = document) {
  return Array.from(parent.querySelectorAll(selector));
}

// Usa textContent (nunca innerHTML) para evitar XSS ao exibir dados vindos do banco.
export function setText(el, value) {
  if (el) el.textContent = value ?? '';
}

// "Hoje" no fuso do restaurante, e não no do aparelho: quem reserva do
// exterior (ou com o relógio em outro fuso) vê o mesmo calendário de Fortaleza.
const RESTAURANT_TZ = 'America/Fortaleza';

export function todayISO() {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: RESTAURANT_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const get = (type) => parts.find((p) => p.type === type)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch (e) {
    return toISODate(new Date());
  }
}

export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysISO(days, base) {
  const [ty, tm, td] = todayISO().split('-').map(Number);
  const d = base ? new Date(base) : new Date(ty, tm - 1, td, 12);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

// 0 = domingo ... 6 = sábado (mesma convenção usada em availability_rules.weekday)
export function weekdayIndex(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

export function formatDateBR(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

export function formatTimeBR(time) {
  if (!time) return '';
  return time.slice(0, 5);
}

// Data por extenso ("sábado, 10 de outubro de 2026" / "Saturday, October 10,
// 2026"). Evita a ambiguidade de 10/07 x 07/10 para quem lê no padrão dos EUA.
export function formatDateLong(isoDate, lang = 'pt') {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  try {
    return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'pt-BR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    }).format(new Date(Date.UTC(y, m - 1, d)));
  } catch (e) {
    return formatDateBR(isoDate);
  }
}

// Hora local de Fortaleza: 24h em português, 12h em inglês ("7:00 pm").
export function formatTimeLocal(time, lang = 'pt') {
  if (!time) return '';
  if (lang !== 'en') return time.slice(0, 5);
  const [h, mi] = time.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(mi).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`;
}

export function formatDateTimeBR(isoDateTime) {
  if (!isoDateTime) return '';
  const d = new Date(isoDateTime);
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function debounce(fn, wait = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

// Formatação leve de telefone enquanto o usuário digita (não valida, só melhora a UX).
// Número que começa com "+" é internacional: mantém o código do país e a
// pontuação digitada, até 15 dígitos (E.164). Sem "+", segue a máscara do Brasil.
export function maskPhone(value) {
  const raw = String(value || '').replace(/^\s+/, '');
  if (!raw.startsWith('+')) return maskPhoneBR(raw);
  let count = 0;
  let rest = '';
  for (const ch of raw.slice(1)) {
    if (/\d/.test(ch)) {
      if (count >= 15) continue;
      count += 1;
      rest += ch;
    } else if (/[\s\-().]/.test(ch) && rest) {
      rest += ch;
    }
  }
  const digits = rest.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length > 2) return `+55 ${maskPhoneBR(digits.slice(2))}`;
  return `+${rest.replace(/\s{2,}/g, ' ')}`;
}

export function maskPhoneBR(value) {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function onlyDigits(value) {
  return (value || '').replace(/\D/g, '');
}

export function waLink(number, message = '') {
  const digits = onlyDigits(number);
  if (!digits) return null;
  const text = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${digits}${text}`;
}

let toastTimer;
export function showToast(message, type = 'info') {
  let el = document.getElementById('js-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'js-toast';
    el.className = 'toast hidden';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `toast${type === 'danger' ? ' toast--danger' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}

export function setLoading(button, isLoading, loadingText = 'Enviando...') {
  if (!button) return;
  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span> ${loadingText}`;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || button.textContent;
  }
}

// Converte um array de objetos simples em CSV (usado na exportação do painel).
export function toCSV(rows, columns) {
  const escape = (value) => {
    const s = value === null || value === undefined ? '' : String(value);
    if (/[",\n;]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const header = columns.map((c) => escape(c.label)).join(';');
  const lines = rows.map((row) => columns.map((c) => escape(row[c.key])).join(';'));
  return [header, ...lines].join('\n');
}

export function downloadTextFile(filename, content, mime = 'text/csv;charset=utf-8;') {
  const blob = new Blob(['﻿' + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const STATUS_LABELS = {
  confirmada: 'Confirmada',
  cancelada_cliente: 'Cancelada (cliente)',
  cancelada_restaurante: 'Cancelada (restaurante)',
  compareceu: 'Compareceu',
  no_show: 'Não compareceu',
  desistiu: 'Desistiu',
  recusada: 'Recusada',
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

// Origem da reserva, na ordem em que a informação é confiável:
// 1. openai_oppref só existe quando houve clique em anúncio pago do ChatGPT;
// 2. utm_source cobre o resto do tráfego identificado — atenção: o ChatGPT
//    carimba `utm_source=chatgpt.com` nos links que mostra organicamente, o que
//    NÃO é anúncio (por isso o oppref vem antes);
// 3. sem nada disso, distingue reserva feita pelo painel da feita pelo site.
// Retorna texto cru: quem exibe em HTML precisa escapar.
export function reservationOriginLabel(reservation) {
  if (reservation.openai_oppref) return 'ChatGPT Ads';
  if (reservation.utm_source) return reservation.utm_source;
  return reservation.source === 'admin' ? 'Painel' : 'Site';
}
