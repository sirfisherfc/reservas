import { supabase } from './supabaseClient.js';
import { requireStaff, mountLayout } from './adminGuard.js';
import { qs, qsa, showToast, setLoading, formatTimeBR } from './utils.js';

const SETTINGS_META = [
  { key: 'capacity_total', label: 'Capacidade total da casa (pessoas)', type: 'number' },
  { key: 'reservable_percentage', label: 'Percentual reservável da capacidade (%)', type: 'number' },
  { key: 'min_party_size', label: 'Mínimo de pessoas por reserva', type: 'number' },
  { key: 'max_party_size', label: 'Máximo de pessoas por reserva (site)', type: 'number' },
  { key: 'same_day_cutoff_time', label: 'Horário de corte — reserva no mesmo dia', type: 'time' },
  { key: 'advance_booking_days', label: 'Dias de antecedência permitidos', type: 'number' },
  { key: 'tolerance_minutes', label: 'Tolerância de chegada (minutos)', type: 'number' },
  { key: 'hold_release_minutes', label: 'Liberação da mesa após (minutos sem check-in)', type: 'number' },
  { key: 'whatsapp_number', label: 'Número de WhatsApp (só dígitos, com DDI+DDD)', type: 'text' },
  { key: 'whatsapp_message_template', label: 'Mensagem padrão do WhatsApp', type: 'text' },
];

const WEEKDAY_LABELS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

let appUser = null;
let currentWeekday = new Date().getDay();
let currentRules = [];

async function init() {
  appUser = await requireStaff({ adminOnly: true });
  if (!appUser) return;
  await mountLayout(appUser, 'configuracoes');

  await loadSettings();
  renderWeekdayChips();
  await loadRules();

  qs('#save-settings-btn').addEventListener('click', saveSettings);
  qs('#save-rules-btn').addEventListener('click', saveRules);
  qs('#add-slot-btn').addEventListener('click', addSlot);
}

// --- Parâmetros gerais ---

async function loadSettings() {
  const { data, error } = await supabase.from('restaurant_settings').select('key, value');
  if (error) {
    qs('#settings-alert').innerHTML = `<div class="alert alert--danger">Erro ao carregar parâmetros: ${error.message}</div>`;
    return;
  }

  const map = new Map((data || []).map((row) => [row.key, row.value]));
  const container = qs('#settings-form');

  container.innerHTML = SETTINGS_META.map((meta) => `
    <div class="form-field">
      <label for="setting-${meta.key}">${meta.label}</label>
      <input
        type="${meta.type === 'number' ? 'number' : meta.type === 'time' ? 'time' : 'text'}"
        id="setting-${meta.key}"
        data-key="${meta.key}"
        data-type="${meta.type}"
        value="${map.has(meta.key) ? String(map.get(meta.key)) : ''}"
      />
    </div>
  `).join('');
}

async function saveSettings() {
  const btn = qs('#save-settings-btn');
  setLoading(btn, true, 'Salvando...');
  qs('#settings-alert').innerHTML = '';

  const inputs = qsa('#settings-form input[data-key]');
  const errors = [];

  for (const input of inputs) {
    const key = input.dataset.key;
    const type = input.dataset.type;
    const value = type === 'number' ? Number(input.value) : input.value;

    const { error } = await supabase
      .from('restaurant_settings')
      .update({ value, updated_by_user_id: appUser.id, updated_at: new Date().toISOString() })
      .eq('key', key);

    if (error) errors.push(`${key}: ${error.message}`);
  }

  setLoading(btn, false);

  if (errors.length) {
    qs('#settings-alert').innerHTML = `<div class="alert alert--danger">Erro ao salvar: ${errors.join('; ')}</div>`;
  } else {
    showToast('Parâmetros salvos com sucesso.');
  }
}

// --- Grade de horários (availability_rules) ---

function renderWeekdayChips() {
  const el = qs('#weekday-chips');
  el.innerHTML = WEEKDAY_LABELS.map((label, idx) => `
    <button class="chip${idx === currentWeekday ? ' is-active' : ''}" data-weekday="${idx}" type="button">${label}</button>
  `).join('');

  qsa('#weekday-chips .chip').forEach((chip) => {
    chip.addEventListener('click', async () => {
      qsa('#weekday-chips .chip').forEach((c) => c.classList.remove('is-active'));
      chip.classList.add('is-active');
      currentWeekday = Number(chip.dataset.weekday);
      await loadRules();
    });
  });
}

async function loadRules() {
  qs('#rules-alert').innerHTML = '';
  const { data, error } = await supabase
    .from('availability_rules')
    .select('*')
    .eq('weekday', currentWeekday)
    .order('time_slot', { ascending: true });

  if (error) {
    qs('#rules-alert').innerHTML = `<div class="alert alert--danger">Erro ao carregar grade: ${error.message}</div>`;
    return;
  }

  currentRules = data || [];
  renderRulesTable();
}

function renderRulesTable() {
  const tbody = qs('#rules-tbody');

  if (!currentRules.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Nenhum horário cadastrado para este dia.</td></tr>';
    return;
  }

  tbody.innerHTML = currentRules.map((rule) => `
    <tr data-id="${rule.id}">
      <td>${formatTimeBR(rule.time_slot)}</td>
      <td><input type="checkbox" data-field="enabled" ${rule.enabled ? 'checked' : ''} /></td>
      <td><input type="number" min="0" data-field="max_people" value="${rule.max_people}" style="width:90px;" /></td>
      <td><input type="number" min="0" data-field="max_reservations" value="${rule.max_reservations}" style="width:90px;" /></td>
      <td><button class="btn btn--outline btn--sm" data-remove="${rule.id}" type="button">Remover</button></td>
    </tr>
  `).join('');

  qsa('#rules-tbody button[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => removeSlot(btn.dataset.remove));
  });
}

async function saveRules() {
  const btn = qs('#save-rules-btn');
  setLoading(btn, true, 'Salvando...');
  qs('#rules-alert').innerHTML = '';

  const rows = qsa('#rules-tbody tr[data-id]');
  const errors = [];

  for (const row of rows) {
    const id = row.dataset.id;
    const enabled = row.querySelector('[data-field="enabled"]').checked;
    const maxPeople = Number(row.querySelector('[data-field="max_people"]').value);
    const maxReservations = Number(row.querySelector('[data-field="max_reservations"]').value);

    const { error } = await supabase
      .from('availability_rules')
      .update({ enabled, max_people: maxPeople, max_reservations: maxReservations, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) errors.push(error.message);
  }

  setLoading(btn, false);

  if (errors.length) {
    qs('#rules-alert').innerHTML = `<div class="alert alert--danger">Erro ao salvar: ${errors.join('; ')}</div>`;
  } else {
    showToast('Grade salva com sucesso.');
    await loadRules();
  }
}

async function addSlot() {
  const time = qs('#new-slot-time').value;
  const maxPeople = Number(qs('#new-slot-max-people').value);
  const maxReservations = Number(qs('#new-slot-max-reservations').value);

  if (!time) {
    showToast('Informe um horário.', 'danger');
    return;
  }

  const { error } = await supabase.from('availability_rules').insert({
    weekday: currentWeekday,
    time_slot: time,
    enabled: true,
    max_people: maxPeople,
    max_reservations: maxReservations,
  });

  if (error) {
    showToast(`Erro ao adicionar horário: ${error.message}`, 'danger');
    return;
  }

  qs('#new-slot-time').value = '';
  showToast('Horário adicionado.');
  await loadRules();
}

async function removeSlot(id) {
  if (!window.confirm('Remover este horário da grade recorrente? Reservas já feitas não são afetadas.')) return;

  const { error } = await supabase.from('availability_rules').delete().eq('id', id);
  if (error) {
    showToast(`Erro ao remover: ${error.message}`, 'danger');
    return;
  }
  showToast('Horário removido.');
  await loadRules();
}

init();
