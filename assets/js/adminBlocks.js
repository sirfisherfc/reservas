import { supabase } from './supabaseClient.js';
import { requireStaff, mountLayout } from './adminGuard.js';
import { qs, qsa, showToast, formatDateBR, formatTimeBR, todayISO } from './utils.js';

let appUser = null;

async function init() {
  appUser = await requireStaff({ adminOnly: true });
  if (!appUser) return;
  mountLayout(appUser, 'bloqueios');

  qs('#bd-date').min = todayISO();
  qs('#bs-date').min = todayISO();

  qs('#bd-add-btn').addEventListener('click', addBlockedDate);
  qs('#bs-add-btn').addEventListener('click', addBlockedSlot);

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

  tbody.innerHTML = data.map((row) => `
    <tr>
      <td>${formatDateBR(row.date)}</td>
      <td>${formatTimeBR(row.time_slot)}</td>
      <td>${escapeHtml(row.reason || '—')}</td>
      <td><button class="btn btn--outline btn--sm" data-id="${row.id}" type="button">Remover</button></td>
    </tr>
  `).join('');

  qsa('#bs-tbody button[data-id]').forEach((btn) => {
    btn.addEventListener('click', () => removeBlockedSlot(btn.dataset.id));
  });
}

async function addBlockedSlot() {
  const date = qs('#bs-date').value;
  const time = qs('#bs-time').value;
  const reason = qs('#bs-reason').value.trim();

  if (!date || !time) {
    showToast('Informe data e horário.', 'danger');
    return;
  }

  const { error } = await supabase.from('blocked_time_slots').insert({
    date,
    time_slot: time,
    reason: reason || null,
    created_by_user_id: appUser.id,
  });

  if (error) {
    showToast(`Erro ao bloquear horário: ${error.message}`, 'danger');
    return;
  }

  qs('#bs-date').value = '';
  qs('#bs-time').value = '';
  qs('#bs-reason').value = '';
  showToast('Horário bloqueado com sucesso.');
  await loadBlockedSlots();
}

async function removeBlockedSlot(id) {
  if (!window.confirm('Remover este bloqueio de horário?')) return;
  const { error } = await supabase.from('blocked_time_slots').delete().eq('id', id);
  if (error) {
    showToast(`Erro ao remover: ${error.message}`, 'danger');
    return;
  }
  showToast('Bloqueio removido.');
  await loadBlockedSlots();
}

init();
