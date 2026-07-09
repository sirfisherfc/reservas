import { supabase } from './supabaseClient.js';
import { requireStaff, mountLayout } from './adminGuard.js';
import { qs, todayISO, addDaysISO, formatTimeBR, statusLabel } from './utils.js';

async function init() {
  const appUser = await requireStaff({ adminOnly: false });
  if (!appUser) return;
  mountLayout(appUser, 'dashboard');

  const today = todayISO();

  const { data: todayRows, error: todayError } = await supabase
    .from('reservations')
    .select('id, reservation_time, party_size, status, customer_name_snapshot, customer_phone_snapshot')
    .eq('reservation_date', today)
    .order('reservation_time', { ascending: true });

  if (todayError) {
    qs('#stat-grid').innerHTML = `<div class="alert alert--danger">Não foi possível carregar os dados: ${todayError.message}</div>`;
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

  let noShowRateLabel = 'Dados insuficientes';
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
}

function renderStats(items) {
  const grid = qs('#stat-grid');
  grid.innerHTML = items.map((item) => `
    <div class="stat-card">
      <div class="stat-card__label">${item.label}</div>
      <div class="stat-card__value">${item.value}</div>
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

init();
