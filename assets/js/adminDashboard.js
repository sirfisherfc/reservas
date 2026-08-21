import { supabase } from './supabaseClient.js';
import { requireStaff, mountLayout } from './adminGuard.js';
import {
  qs, qsa, todayISO, addDaysISO, toISODate, formatDateBR, formatTimeBR,
  statusLabel, reservationOriginLabel,
} from './utils.js';

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const CANCELLED_STATUSES = ['cancelada_cliente', 'cancelada_restaurante', 'recusada'];

let calendarDate = new Date();

async function init() {
  const appUser = await requireStaff({ adminOnly: false });
  if (!appUser) return;
  await mountLayout(appUser, 'dashboard');

  const today = todayISO();

  const { data: todayRows, error: todayError } = await supabase
    .from('reservations')
    .select('id, reservation_time, party_size, status, customer_name_snapshot, customer_phone_snapshot')
    .eq('reservation_date', today)
    .order('reservation_time', { ascending: true });

  if (todayError) {
    qs('#stat-bar').innerHTML = `<div class="alert alert--danger">Não foi possível carregar os dados: ${todayError.message}</div>`;
    return;
  }

  const rows = todayRows || [];

  const countBy = (status) => rows.filter((r) => r.status === status).length;
  const confirmedToday = rows.filter((r) => r.status === 'confirmada');
  const peopleToday = confirmedToday.reduce((sum, r) => sum + r.party_size, 0);
  const cancelledToday = countBy('cancelada_cliente') + countBy('cancelada_restaurante');

  const in7 = addDaysISO(6);
  const { count: next7Count } = await supabase
    .from('reservations')
    .select('id', { count: 'exact', head: true })
    .gte('reservation_date', today)
    .lte('reservation_date', in7)
    .eq('status', 'confirmada');

  const from30 = addDaysISO(-30);
  const { data: rateRows } = await supabase
    .from('reservations')
    .select('status')
    .gte('reservation_date', from30)
    .lt('reservation_date', today)
    .in('status', ['compareceu', 'no_show']);

  let noShowRateLabel = 'ND';
  if (rateRows && rateRows.length >= 5) {
    const noShowCount = rateRows.filter((r) => r.status === 'no_show').length;
    noShowRateLabel = `${Math.round((noShowCount / rateRows.length) * 100)}%`;
  }

  renderStats([
    { label: 'Reservas hoje', value: rows.length },
    { label: 'Próximos 7 dias (confirmadas)', value: next7Count ?? '—' },
    { label: 'Confirmadas hoje', value: confirmedToday.length },
    { label: 'Canceladas hoje', value: cancelledToday },
    { label: 'Compareceu hoje', value: countBy('compareceu') },
    { label: 'No-show hoje', value: countBy('no_show') },
    { label: 'Pessoas previstas hoje', value: peopleToday },
    { label: 'Taxa de no-show (30 dias)', value: noShowRateLabel },
  ]);

  renderBySlot(confirmedToday);
  renderUpcoming(confirmedToday);

  wireCalendarControls();
  await loadCalendarMonth();

  wireOriginControls();
  await loadOriginBreakdown();
}

// --- Origem das reservas ---

function wireOriginControls() {
  qsa('#origin-range-chips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      qsa('#origin-range-chips .chip').forEach((c) => c.classList.remove('is-active'));
      chip.classList.add('is-active');
      loadOriginBreakdown();
    });
  });
}

function selectedOriginDays() {
  const active = qs('#origin-range-chips .chip.is-active');
  return Number(active?.dataset.days) || 30;
}

async function loadOriginBreakdown() {
  const el = qs('#origin-list');
  el.innerHTML = '<p class="text-soft">Carregando…</p>';

  const days = selectedOriginDays();

  // Recorte por created_at (quando a reserva foi feita), não por data da
  // reserva: origem é sobre a captação do cliente, não sobre quando ele janta.
  const from = `${addDaysISO(-days)}T00:00:00`;

  const { data, error } = await supabase
    .from('reservations')
    .select('source, openai_oppref, utm_source, party_size, status')
    .gte('created_at', from);

  if (error) {
    el.innerHTML = `<div class="alert alert--danger">Não foi possível carregar as origens: ${error.message}</div>`;
    return;
  }

  const rows = (data || []).filter((r) => !CANCELLED_STATUSES.includes(r.status));

  if (!rows.length) {
    el.innerHTML = `<p class="text-soft">Nenhuma reserva nos últimos ${days} dias.</p>`;
    return;
  }

  const byOrigin = new Map();
  for (const r of rows) {
    const key = reservationOriginLabel(r);
    const entry = byOrigin.get(key) || { reservas: 0, pessoas: 0 };
    entry.reservas += 1;
    entry.pessoas += r.party_size;
    byOrigin.set(key, entry);
  }

  const entries = Array.from(byOrigin.entries()).sort((a, b) => b[1].reservas - a[1].reservas);
  const totalReservas = rows.length;

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Origem</th><th>Reservas</th><th>%</th><th>Pessoas</th></tr></thead>
        <tbody>
          ${entries.map(([origin, stats]) => `
            <tr>
              <td>${escapeHtml(origin)}</td>
              <td>${stats.reservas}</td>
              <td>${Math.round((stats.reservas / totalReservas) * 100)}%</td>
              <td>${stats.pessoas}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <p class="hint">Últimos ${days} dias, pela data em que a reserva foi feita. Não considera reservas canceladas.
    "ChatGPT Ads" é clique em anúncio pago; "chatgpt.com" é indicação orgânica do ChatGPT, sem anúncio.</p>
  `;
}

function renderStats(items) {
  const bar = qs('#stat-bar');
  bar.innerHTML = items.map((item) => `
    <div class="stat-bar__item">
      <span class="stat-bar__label">${item.label}</span>
      <span class="stat-bar__value">${item.value}</span>
    </div>
  `).join('');
}

function renderBySlot(confirmedToday) {
  const el = qs('#by-slot-list');
  const bySlot = new Map();
  for (const r of confirmedToday) {
    const key = r.reservation_time;
    bySlot.set(key, (bySlot.get(key) || 0) + r.party_size);
  }

  const entries = Array.from(bySlot.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  if (!entries.length) {
    el.innerHTML = '<p class="text-soft">Nenhuma reserva confirmada para hoje.</p>';
    return;
  }

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Horário</th><th>Pessoas</th></tr></thead>
        <tbody>
          ${entries.map(([time, count]) => `<tr><td>${formatTimeBR(time)}</td><td>${count}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderUpcoming(confirmedToday) {
  const el = qs('#upcoming-list');

  if (!confirmedToday.length) {
    el.innerHTML = '<p class="text-soft">Nenhuma reserva confirmada para hoje.</p>';
    return;
  }

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Horário</th><th>Cliente</th><th>Telefone</th><th>Pessoas</th><th>Status</th></tr></thead>
        <tbody>
          ${confirmedToday.map((r) => `
            <tr>
              <td>${formatTimeBR(r.reservation_time)}</td>
              <td>${escapeHtml(r.customer_name_snapshot)}</td>
              <td>${escapeHtml(r.customer_phone_snapshot)}</td>
              <td>${r.party_size}</td>
              <td><span class="badge badge--${r.status}">${statusLabel(r.status)}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

// --- Calendário mensal ---

function wireCalendarControls() {
  qs('#cal-prev').addEventListener('click', () => {
    calendarDate.setMonth(calendarDate.getMonth() - 1);
    loadCalendarMonth();
  });
  qs('#cal-next').addEventListener('click', () => {
    calendarDate.setMonth(calendarDate.getMonth() + 1);
    loadCalendarMonth();
  });
  qs('#cal-today').addEventListener('click', () => {
    calendarDate = new Date();
    loadCalendarMonth();
  });
}

async function loadCalendarMonth() {
  const grid = qs('#calendar-grid');
  grid.innerHTML = '<p class="text-soft">Carregando…</p>';

  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();

  const monthLabel = calendarDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  qs('#cal-month-label').textContent = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);

  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const gridEnd = new Date(lastOfMonth);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));

  const { data, error } = await supabase
    .from('reservations')
    .select('reservation_date, party_size, status')
    .gte('reservation_date', toISODate(gridStart))
    .lte('reservation_date', toISODate(gridEnd));

  if (error) {
    grid.innerHTML = `<div class="alert alert--danger">Não foi possível carregar o calendário: ${error.message}</div>`;
    return;
  }

  const byDate = new Map();
  for (const r of data || []) {
    if (CANCELLED_STATUSES.includes(r.status)) continue;
    const entry = byDate.get(r.reservation_date) || { reservas: 0, pessoas: 0 };
    entry.reservas += 1;
    entry.pessoas += r.party_size;
    byDate.set(r.reservation_date, entry);
  }

  renderCalendarGrid(grid, gridStart, gridEnd, month, byDate);
}

function renderCalendarGrid(grid, gridStart, gridEnd, month, byDate) {
  const today = todayISO();

  let html = WEEKDAY_LABELS.map((w) => `<div class="cal-weekday">${w}</div>`).join('');

  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    const iso = toISODate(cursor);
    const stats = byDate.get(iso);
    const classes = ['cal-day'];
    if (stats) classes.push('cal-day--has-reservas');
    if (cursor.getMonth() !== month) classes.push('cal-day--muted');
    if (iso === today) classes.push('cal-day--today');

    const label = stats
      ? `${formatDateBR(iso)} — ${stats.reservas} ${stats.reservas === 1 ? 'reserva' : 'reservas'}, ${stats.pessoas} pessoas`
      : `${formatDateBR(iso)} — sem reservas`;

    html += `
      <button type="button" class="${classes.join(' ')}" data-date="${iso}" title="Ver as reservas deste dia" aria-label="${label}">
        <div class="cal-day__num">${cursor.getDate()}</div>
        ${stats ? `
          <div class="cal-day__stats">
            <div class="cal-day__count">${stats.reservas} <span class="cal-day__count-label">${stats.reservas === 1 ? 'reserva' : 'reservas'}</span></div>
            <div class="cal-day__people">${stats.pessoas} pessoas</div>
          </div>
        ` : ''}
      </button>
    `;
    cursor.setDate(cursor.getDate() + 1);
  }

  grid.innerHTML = html;

  // Cada dia abre a tela de Reservas já filtrada nele — de lá dá para mudar
  // status, ver detalhes e exportar, sem duplicar essa interface aqui.
  qsa('#calendar-grid .cal-day').forEach((cell) => {
    cell.addEventListener('click', () => {
      window.location.href = `./reservas.html?date=${encodeURIComponent(cell.dataset.date)}`;
    });
  });
}

init();
