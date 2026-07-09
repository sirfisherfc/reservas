import { supabase } from './supabaseClient.js';
import { requireStaff, mountLayout } from './adminGuard.js';
import { qs, qsa, showToast, formatDateBR, formatTimeBR, todayISO, weekdayIndex } from './utils.js';

let appUser = null;

async function init() {
  appUser = await requireStaff({ adminOnly: true });
  if (!appUser) return;
  await mountLayout(appUser, 'bloqueios');

  qs('#bd-date').min = todayISO();
  qs('#bs-date').min = todayISO();

  qs('#bd-add-btn').addEventListener('click', addBlockedDate);
  qs('#bs-add-btn').addEventListener('click', addBlockedSlotRange);

  await Promise.all([loadBlockedDates(), loadBlockedSlots()]);
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

// --- Dias inteiros ---

async function loadBlockedDates() {
  const { data, error } = await supabase
    .from('blocked_dates')
    .select('id, date, reason, active')
    .eq('active', true)
    .order('date', { ascending: true });

  const tbody = qs('#bd-tbody');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="3" class="empty-state">Erro: ${error.message}</td></tr>`;
    return;
  }

  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-state">Nenhum dia bloqueado.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map((row) => `
    <tr>
      <td>${formatDateBR(row.date)}</td>
      <td>${escapeHtml(row.reason || '—')}</td>
      <td><button class="btn btn--outline btn--sm" data-id="${row.id}" type="button">Remover</button></td>
    </tr>
  `).join('');

  qsa('#bd-tbody button[data-id]').forEach((btn) => {
    btn.addEventListener('click', () => removeBlockedDate(btn.dataset.id));
  });
}

async function addBlockedDate() {
  const date = qs('#bd-date').value;
  const reason = qs('#bd-reason').value.trim();

  if (!date) {
    showToast('Informe uma data.', 'danger');
    return;
  }

  const { error } = await supabase.from('blocked_dates').insert({
    date,
    reason: reason || null,
    created_by_user_id: appUser.id,
  });

  if (error) {
    showToast(`Erro ao bloquear dia: ${error.message}`, 'danger');
    return;
  }

  qs('#bd-date').value = '';
  qs('#bd-reason').value = '';
  showToast('Dia bloqueado com sucesso.');
  await loadBlockedDates();
}

async function removeBlockedDate(id) {
  if (!window.confirm('Remover este bloqueio de dia inteiro?')) return;
  const { error } = await supabase.from('blocked_dates').delete().eq('id', id);
  if (error) {
    showToast(`Erro ao remover: ${error.message}`, 'danger');
    return;
  }
  showToast('Bloqueio removido.');
  await loadBlockedDates();
}

// --- Horários específicos ---

async function loadBlockedSlots() {
  const { data, error } = await supabase
    .from('blocked_time_slots')
    .select('id, date, time_slot, reason, active')
    .eq('active', true)
    .order('date', { ascending: true })
    .order('time_slot', { ascending: true });

  const tbody = qs('#bs-tbody');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Erro: ${error.message}</td></tr>`;
    return;
  }

  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Nenhum horário bloqueado.</td></tr>';
    return;
  }

  // Agrupa por (data, motivo) para mostrar uma faixa bloqueada como uma única linha,
  // já que cada horário da faixa é uma linha própria em blocked_time_slots.
  const groups = new Map();
  for (const row of data) {
    const key = `${row.date}|${row.reason || ''}`;
    if (!groups.has(key)) {
      groups.set(key, { date: row.date, reason: row.reason, ids: [], times: [] });
    }
    const group = groups.get(key);
    group.ids.push(row.id);
    group.times.push(row.time_slot);
  }

  tbody.innerHTML = Array.from(groups.values()).map((g) => {
    const first = formatTimeBR(g.times[0]);
    const last = formatTimeBR(g.times[g.times.length - 1]);
    const rangeLabel = first === last ? first : `${first} – ${last} (${g.times.length} horários)`;
    return `
      <tr data-ids="${g.ids.join(',')}">
        <td>${formatDateBR(g.date)}</td>
        <td>${rangeLabel}</td>
        <td>${escapeHtml(g.reason || '—')}</td>
        <td><button class="btn btn--outline btn--sm" data-remove-group type="button">Remover todos</button></td>
      </tr>
    `;
  }).join('');

  qsa('#bs-tbody button[data-remove-group]').forEach((btn) => {
    const ids = btn.closest('tr').dataset.ids.split(',');
    btn.addEventListener('click', () => removeBlockedSlotGroup(ids));
  });
}

async function addBlockedSlotRange() {
  const date = qs('#bs-date').value;
  const startTime = qs('#bs-time-start').value;
  const endTimeInput = qs('#bs-time-end').value;
  const endTime = endTimeInput || startTime;
  const reason = qs('#bs-reason').value.trim();

  if (!date || !startTime) {
    showToast('Informe data e horário inicial.', 'danger');
    return;
  }
  if (endTime < startTime) {
    showToast('O horário final deve ser igual ou depois do inicial.', 'danger');
    return;
  }

  const weekday = weekdayIndex(date);
  const { data: rules, error: rulesError } = await supabase
    .from('availability_rules')
    .select('time_slot')
    .eq('weekday', weekday)
    .gte('time_slot', startTime)
    .lte('time_slot', endTime);

  if (rulesError) {
    showToast(`Erro ao consultar a grade: ${rulesError.message}`, 'danger');
    return;
  }

  if (!rules.length) {
    showToast('Nenhum horário configurado na grade dentro dessa faixa.', 'danger');
    return;
  }

  const rows = rules.map((r) => ({
    date,
    time_slot: r.time_slot,
    reason: reason || null,
    created_by_user_id: appUser.id,
  }));

  const { error } = await supabase
    .from('blocked_time_slots')
    .upsert(rows, { onConflict: 'date,time_slot', ignoreDuplicates: true });

  if (error) {
    showToast(`Erro ao bloquear horários: ${error.message}`, 'danger');
    return;
  }

  qs('#bs-date').value = '';
  qs('#bs-time-start').value = '';
  qs('#bs-time-end').value = '';
  qs('#bs-reason').value = '';
  showToast(`${rows.length} horário(s) bloqueado(s) com sucesso.`);
  await loadBlockedSlots();
}

async function removeBlockedSlotGroup(ids) {
  if (!window.confirm(`Remover ${ids.length} bloqueio(s) de horário?`)) return;
  const { error } = await supabase.from('blocked_time_slots').delete().in('id', ids);
  if (error) {
    showToast(`Erro ao remover: ${error.message}`, 'danger');
    return;
  }
  showToast('Bloqueio(s) removido(s).');
  await loadBlockedSlots();
}

init();
