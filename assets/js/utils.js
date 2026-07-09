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

export function todayISO() {
  const d = new Date();
  return toISODate(d);
}

export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysISO(days, base = new Date()) {
  const d = new Date(base);
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

// Formatação leve de telefone BR enquanto o usuário digita (não valida, só melhora a UX).
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
