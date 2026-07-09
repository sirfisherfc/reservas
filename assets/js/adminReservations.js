import { supabase } from './supabaseClient.js';
import { requireStaff, mountLayout } from './adminGuard.js';
import { fetchAvailableSlots } from './availability.js';
import {
  qs, qsa, todayISO, addDaysISO, formatDateBR, formatTimeBR, formatDateTimeBR,
  statusLabel, showToast, toCSV, downloadTextFile, setLoading, maskPhoneBR,
} from './utils.js';

let appUser = null;
let allRows = [];
let currentRange = 'today';
let filterDebounceTimer;
let nrDebounceTimer;

const STATUS_ACTIONS = [
  { status: 'compareceu', label: 'Compareceu' },
  { status: 'no_show', label: 'Não compareceu' },
  { status: 'desistiu', label: 'Desistiu' },
  { status: 'cancelada_restaurante', label: 'Cancelar (restaurante)' },
];

const TERMINAL_STATUSES = ['cancelada_cliente', 'cancelada_restaurante', 'compareceu', 'no_show', 'desistiu', 'recusada'];

async function init() {
  appUser = await requireStaff({ adminOnly: false });
  if (!appUser) return;
  await mountLayout(appUser, 'reservas');

  if (appUser.role !== 'admin') {
    qs('#export-csv-btn').classList.add('hidden');
  }

  wireFilters();
  qs('#new-reservation-btn').addEventListener('click', openNewReservationModal);
  qs('#export-csv-btn').addEventListener('click', exportCSV);

  await loadReservations();
}

function wireFilters() {
  qsa('#range-chips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      qsa('#range-chips .chip').forEach((c) => c.classList.remove('is-active'));
      chip.classList.add('is-active');
      currentRange = chip.dataset.range;
      qs('#filter-date').value = '';
      loadReservations();
    });
  });

  qs('#filter-date').addEventListener('change', loadReservations);
  qs('#filter-status').addEventListener('change', renderTable);
  qs('#filter-search').addEventListener('input', () => {
    clearTimeout(filterDebounceTimer);
    filterDebounceTimer = setTimeout(renderTable, 200);
  });
}

function getDateRange() {
  const customDate = qs('#filter-date').value;
  if (customDate) return { from: customDate, to: customDate };

  const today = todayISO();
  switch (currentRange) {
    case 'today': return { from: today, to: today };
    case 'tomorrow': { const t = addDaysISO(1); return { from: t, to: t }; }
    case 'next7': return { from: today, to: addDaysISO(6) };
    case 'all': return null;
    default: return { from: today, to: today };
  }
}

async function loadReservations() {
  const tbody = qs('#reservations-tbody');
  tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Carregando…</td></tr>';
  qs('#reservations-alert').innerHTML = '';

  const range = getDateRange();
  let query = supabase
    .from('reservations')
    .select('id, public_code, reservation_date, reservation_time, party_size, status, source, customer_name_snapshot, customer_phone_snapshot')
    .order('reservation_date', { ascending: true })
    .order('reservation_time', { ascending: true })
    .limit(500);

  if (range) {
    query = query.gte('reservation_date', range.from).lte('reservation_date', range.to);
  }

  const { data, error } = await query;

  if (error) {
    qs('#reservations-alert').innerHTML = `<div class="alert alert--danger">Erro ao carregar reservas: ${error.message}</div>`;
    tbody.innerHTML = '';
    return;
  }

  allRows = data || [];
  renderTable();
}

function renderTable() {
  const tbody = qs('#reservations-tbody');
  const statusFilter = qs('#filter-status').value;
  const search = qs('#filter-search').value.trim().toLowerCase();

  const filtered = allRows.filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (search) {
      const haystack = `${r.customer_name_snapshot} ${r.customer_phone_snapshot} ${r.public_code}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Nenhuma reserva encontrada.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((r) => `
    <tr>
      <td>${escapeHtml(r.public_code)}</td>
      <td>${formatDateBR(r.reservation_date)}</td>
      <td>${formatTimeBR(r.reservation_time)}</td>
      <td>${escapeHtml(r.customer_name_snapshot)}</td>
      <td>${escapeHtml(r.customer_phone_snapshot)}</td>
      <td>${r.party_size}</td>
      <td><span class="badge badge--${r.status}">${statusLabel(r.status)}</span></td>
      <td>${r.source === 'admin' ? 'Painel' : 'Site'}</td>
      <td><button class="btn btn--outline btn--sm" data-id="${r.id}" type="button">Ver</button></td>
    </tr>
  `).join('');

  qsa('#reservations-tbody button[data-id]').forEach((btn) => {
    btn.addEventListener('click', () => openDetailModal(btn.dataset.id));
  });
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

function closeModal() {
  qs('#modal-mount').innerHTML = '';
}

// --- Detalhe / mudança de status / observação interna ---

async function openDetailModal(id) {
  const { data: res, error } = await supabase
    .from('reservations')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !res) {
    showToast('Não foi possível carregar a reserva.', 'danger');
    return;
  }

  const { data: history } = await supabase
    .from('reservation_status_history')
    .select('old_status, new_status, changed_by_type, note, created_at')
    .eq('reservation_id', id)
    .order('created_at', { ascending: false });

  renderDetailModal(res, history || []);
}

function renderDetailModal(res, history) {
  const mount = qs('#modal-mount');
  const isTerminal = TERMINAL_STATUSES.includes(res.status);

  mount.innerHTML = `
    <div class="modal-backdrop" id="detail-backdrop">
      <div class="modal">
        <div class="modal__header">
          <div>
            <h2 style="margin:0;">${escapeHtml(res.public_code)}</h2>
            <span class="badge badge--${res.status}">${statusLabel(res.status)}</span>
          </div>
          <button class="modal__close" id="detail-close" type="button">&times;</button>
        </div>

        ${appUser.role === 'admin' ? `
          <div class="form-grid mb-16">
            <div class="form-field"><label for="edit-name">Nome</label><input type="text" id="edit-name" value="${escapeAttr(res.customer_name_snapshot)}" maxlength="120" /></div>
            <div class="form-field"><label for="edit-phone">Telefone</label><input type="tel" id="edit-phone" value="${escapeAttr(res.customer_phone_snapshot)}" maxlength="20" /></div>
            <div class="form-field"><label for="edit-email">E-mail</label><input type="email" id="edit-email" value="${escapeAttr(res.customer_email_snapshot || '')}" maxlength="160" /></div>
            <div class="form-field"><label for="edit-party">Pessoas</label><input type="number" id="edit-party" value="${res.party_size}" min="1" /></div>
            <div class="form-field"><label for="edit-date">Data</label><input type="date" id="edit-date" value="${res.reservation_date}" /></div>
            <div class="form-field"><label for="edit-time">Horário</label><input type="time" id="edit-time" value="${res.reservation_time.slice(0, 5)}" step="1800" /></div>
          </div>
          <div class="form-field">
            <label for="edit-customer-notes">Observação do cliente</label>
            <textarea id="edit-customer-notes" rows="2" maxlength="500">${escapeHtml(res.customer_notes || '')}</textarea>
          </div>
          <button class="btn btn--outline btn--sm mb-16" id="save-edit-btn" type="button">Salvar dados da reserva</button>
          <p class="hint" style="margin-top:-8px;">Edição direta não reconsulta a disponibilidade do horário — use com cuidado.</p>
        ` : `
          <p><strong>${escapeHtml(res.customer_name_snapshot)}</strong><br>
          ${escapeHtml(res.customer_phone_snapshot)} · ${escapeHtml(res.customer_email_snapshot || '')}</p>

          <p>${formatDateBR(res.reservation_date)} às ${formatTimeBR(res.reservation_time)} — ${res.party_size} pessoas</p>

          ${res.customer_notes ? `<p><strong>Observação do cliente:</strong><br>${escapeHtml(res.customer_notes)}</p>` : ''}
        `}

        <div class="form-field">
          <label for="internal-notes-input">Observação interna (não visível ao cliente)</label>
          <textarea id="internal-notes-input" rows="3">${escapeHtml(res.internal_notes || '')}</textarea>
          <button class="btn btn--outline btn--sm mt-16" id="save-notes-btn" type="button">Salvar observação</button>
        </div>

        ${!isTerminal ? `
          <div class="mb-16">
            <label for="status-note-input">Alterar status — nota opcional</label>
            <input type="text" id="status-note-input" placeholder="Ex.: cliente avisou que chegaria atrasado" style="margin-bottom:10px;" />
            <div class="chip-group" id="status-actions"></div>
          </div>
        ` : '<p class="text-soft">Esta reserva está em um status final.</p>'}

        <div>
          <label>Histórico</label>
          <ul class="history-list">
            ${history.length ? history.map((h) => `
              <li>
                <strong>${statusLabel(h.new_status)}</strong>
                (${h.changed_by_type === 'customer' ? 'cliente' : h.changed_by_type === 'system' ? 'sistema' : h.changed_by_type})
                — ${formatDateTimeBR(h.created_at)}
                ${h.note ? `<br><span class="text-soft">${escapeHtml(h.note)}</span>` : ''}
              </li>
            `).join('') : '<li class="text-soft">Sem alterações registradas.</li>'}
          </ul>
        </div>
      </div>
    </div>
  `;

  qs('#detail-close').addEventListener('click', closeModal);
  qs('#detail-backdrop').addEventListener('click', (evt) => {
    if (evt.target.id === 'detail-backdrop') closeModal();
  });

  qs('#save-notes-btn').addEventListener('click', async () => {
    const btn = qs('#save-notes-btn');
    setLoading(btn, true, 'Salvando...');
    const notes = qs('#internal-notes-input').value.trim();
    const { error } = await supabase.rpc('fn_update_internal_notes', {
      p_reservation_id: res.id,
      p_internal_notes: notes || null,
    });
    setLoading(btn, false);
    showToast(error ? 'Erro ao salvar observação.' : 'Observação salva.', error ? 'danger' : 'info');
  });

  if (!isTerminal) {
    const actionsEl = qs('#status-actions');
    actionsEl.innerHTML = STATUS_ACTIONS.map((a) => `<button class="chip" data-status="${a.status}" type="button">${a.label}</button>`).join('');
    qsa('#status-actions button').forEach((btn) => {
      btn.addEventListener('click', () => changeStatus(res.id, btn.dataset.status));
    });
  }

  const saveEditBtn = qs('#save-edit-btn');
  if (saveEditBtn) {
    saveEditBtn.addEventListener('click', () => saveReservationEdit(res.id));
  }
}

async function saveReservationEdit(id) {
  const btn = qs('#save-edit-btn');
  setLoading(btn, true, 'Salvando...');

  const { error } = await supabase.from('reservations').update({
    customer_name_snapshot: qs('#edit-name').value.trim(),
    customer_phone_snapshot: qs('#edit-phone').value.trim(),
    customer_email_snapshot: qs('#edit-email').value.trim() || null,
    party_size: Number(qs('#edit-party').value),
    reservation_date: qs('#edit-date').value,
    reservation_time: qs('#edit-time').value,
    customer_notes: qs('#edit-customer-notes').value.trim() || null,
  }).eq('id', id);

  setLoading(btn, false);

  if (error) {
    showToast(`Erro ao salvar: ${error.message}`, 'danger');
    return;
  }

  showToast('Reserva atualizada.');
  closeModal();
  await loadReservations();
}

async function changeStatus(id, newStatus) {
  const note = qs('#status-note-input')?.value.trim() || null;
  const { error } = await supabase.rpc('fn_update_reservation_status', {
    p_reservation_id: id,
    p_new_status: newStatus,
    p_note: note,
  });
  if (error) {
    showToast(`Erro ao alterar status: ${error.message}`, 'danger');
    return;
  }
  showToast('Status atualizado.');
  closeModal();
  await loadReservations();
}

// --- Nova reserva manual ---

function openNewReservationModal() {
  const mount = qs('#modal-mount');
  mount.innerHTML = `
    <div class="modal-backdrop" id="new-res-backdrop">
      <div class="modal">
        <div class="modal__header">
          <h2 style="margin:0;">Nova reserva manual</h2>
          <button class="modal__close" id="new-res-close" type="button">&times;</button>
        </div>
        <div id="new-res-alert"></div>
        <form id="new-res-form">
          <div class="form-grid mb-16">
            <div class="form-field">
              <label for="nr-name">Nome</label>
              <input type="text" id="nr-name" required maxlength="120" />
            </div>
            <div class="form-field">
              <label for="nr-phone">Telefone/WhatsApp</label>
              <input type="tel" id="nr-phone" required maxlength="20" />
            </div>
            <div class="form-field">
              <label for="nr-email">E-mail</label>
              <input type="email" id="nr-email" required maxlength="160" />
            </div>
            <div class="form-field">
              <label for="nr-party">Quantidade de pessoas</label>
              <input type="number" id="nr-party" min="1" required />
            </div>
            <div class="form-field">
              <label for="nr-date">Data</label>
              <input type="date" id="nr-date" required />
            </div>
            <div class="form-field">
              <label for="nr-time">Horário</label>
              <select id="nr-time" required><option value="">Selecione a data primeiro</option></select>
            </div>
          </div>
          <div class="form-field">
            <label for="nr-customer-notes">Observação do cliente (opcional)</label>
            <textarea id="nr-customer-notes" rows="2" maxlength="500"></textarea>
          </div>
          <div class="form-field">
            <label for="nr-internal-notes">Observação interna (opcional, não visível ao cliente)</label>
            <textarea id="nr-internal-notes" rows="2" maxlength="500"></textarea>
          </div>
          <div class="form-field checkbox-field" style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox" id="nr-marketing" style="width:auto;" />
            <label for="nr-marketing" style="margin:0; font-weight:400;">Cliente aceitou receber novidades/promoções</label>
          </div>
          <button type="submit" class="btn btn--primary btn--block mt-16" id="nr-submit-btn">Criar reserva</button>
        </form>
      </div>
    </div>
  `;

  qs('#new-res-close').addEventListener('click', closeModal);
  qs('#new-res-backdrop').addEventListener('click', (evt) => {
    if (evt.target.id === 'new-res-backdrop') closeModal();
  });
  qs('#nr-phone').addEventListener('input', () => {
    qs('#nr-phone').value = maskPhoneBR(qs('#nr-phone').value);
  });
  qs('#nr-date').min = todayISO();
  qs('#nr-date').addEventListener('change', loadTimeOptionsForNewReservation);
  qs('#nr-party').addEventListener('input', () => {
    clearTimeout(nrDebounceTimer);
    nrDebounceTimer = setTimeout(loadTimeOptionsForNewReservation, 250);
  });
  qs('#new-res-form').addEventListener('submit', submitNewReservation);
}

async function loadTimeOptionsForNewReservation() {
  const date = qs('#nr-date').value;
  const party = Number(qs('#nr-party').value);
  const select = qs('#nr-time');
  if (!date || !party) {
    select.innerHTML = '<option value="">Selecione data e pessoas</option>';
    return;
  }
  select.innerHTML = '<option value="">Carregando…</option>';
  const { slots, error } = await fetchAvailableSlots(date, party);
  if (error) {
    select.innerHTML = '<option value="">Erro ao carregar horários</option>';
    return;
  }
  const available = slots.filter((s) => s.is_available);
  if (!available.length) {
    select.innerHTML = '<option value="">Nenhum horário disponível</option>';
    return;
  }
  select.innerHTML = '<option value="">Selecione…</option>' +
    available.map((s) => `<option value="${s.time_slot}">${formatTimeBR(s.time_slot)}</option>`).join('');
}

async function submitNewReservation(evt) {
  evt.preventDefault();
  const btn = qs('#nr-submit-btn');
  const alertEl = qs('#new-res-alert');
  alertEl.innerHTML = '';

  const time = qs('#nr-time').value;
  if (!time) {
    alertEl.innerHTML = '<div class="alert alert--danger">Selecione um horário disponível.</div>';
    return;
  }

  setLoading(btn, true, 'Criando...');

  const { error } = await supabase.rpc('fn_create_reservation', {
    p_name: qs('#nr-name').value.trim(),
    p_email: qs('#nr-email').value.trim(),
    p_phone: qs('#nr-phone').value.trim(),
    p_date: qs('#nr-date').value,
    p_time: time,
    p_party_size: Number(qs('#nr-party').value),
    p_notes: qs('#nr-customer-notes').value.trim() || null,
    p_marketing_opt_in: qs('#nr-marketing').checked,
    p_accepted_policy: true,
    p_honeypot: null,
    p_internal_notes: qs('#nr-internal-notes').value.trim() || null,
  });

  setLoading(btn, false);

  if (error) {
    alertEl.innerHTML = `<div class="alert alert--danger">${error.message}</div>`;
    return;
  }

  showToast('Reserva criada com sucesso.');
  closeModal();
  await loadReservations();
}

// --- CSV ---

function exportCSV() {
  if (!allRows.length) {
    showToast('Nada para exportar.', 'danger');
    return;
  }
  const columns = [
    { key: 'public_code', label: 'Código' },
    { key: 'reservation_date', label: 'Data' },
    { key: 'reservation_time', label: 'Horário' },
    { key: 'customer_name_snapshot', label: 'Cliente' },
    { key: 'customer_phone_snapshot', label: 'Telefone' },
    { key: 'party_size', label: 'Pessoas' },
    { key: 'status', label: 'Status' },
    { key: 'source', label: 'Origem' },
  ];
  const csv = toCSV(allRows, columns);
  downloadTextFile(`reservas_${todayISO()}.csv`, csv);
}

init();
