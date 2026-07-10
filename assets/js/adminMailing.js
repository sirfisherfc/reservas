import { supabase } from './supabaseClient.js';
import { requireStaff, mountLayout } from './adminGuard.js';
import { qs, qsa, formatDateBR, showToast, toCSV, downloadTextFile } from './utils.js';

let allRows = [];
let filterDebounceTimer;

async function init() {
  const appUser = await requireStaff({ adminOnly: true });
  if (!appUser) return;
  await mountLayout(appUser, 'mailing');

  qs('#filter-marketing').addEventListener('change', renderTable);
  qs('#filter-search').addEventListener('input', () => {
    clearTimeout(filterDebounceTimer);
    filterDebounceTimer = setTimeout(renderTable, 200);
  });
  qs('#export-csv-btn').addEventListener('click', exportCSV);

  await loadCustomers();
}

async function loadCustomers() {
  const tbody = qs('#mailing-tbody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Carregando…</td></tr>';
  qs('#mailing-alert').innerHTML = '';

  const { data, error } = await supabase
    .from('customer_mailing_stats')
    .select('customer_id, name, email, phone, marketing_opt_in, reservation_count, last_reservation_date')
    .order('last_reservation_date', { ascending: false, nullsFirst: false });

  if (error) {
    qs('#mailing-alert').innerHTML = `<div class="alert alert--danger">Erro ao carregar clientes: ${error.message}</div>`;
    tbody.innerHTML = '';
    return;
  }

  allRows = data || [];
  renderTable();
}

function renderTable() {
  const tbody = qs('#mailing-tbody');
  const marketingFilter = qs('#filter-marketing').value;
  const search = qs('#filter-search').value.trim().toLowerCase();

  const filtered = allRows.filter((r) => {
    if (marketingFilter === 'opt_in' && !r.marketing_opt_in) return false;
    if (search) {
      const haystack = `${r.name} ${r.phone || ''} ${r.email || ''}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhum cliente encontrado.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((r) => `
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.phone || '')}</td>
      <td>${escapeHtml(r.email || '')}</td>
      <td>${r.reservation_count}</td>
      <td>${r.last_reservation_date ? formatDateBR(r.last_reservation_date) : '—'}</td>
      <td>${r.marketing_opt_in ? 'Sim' : 'Não'}</td>
    </tr>
  `).join('');
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

function exportCSV() {
  const marketingFilter = qs('#filter-marketing').value;
  const search = qs('#filter-search').value.trim().toLowerCase();

  const filtered = allRows.filter((r) => {
    if (marketingFilter === 'opt_in' && !r.marketing_opt_in) return false;
    if (search) {
      const haystack = `${r.name} ${r.phone || ''} ${r.email || ''}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    showToast('Nada para exportar.', 'danger');
    return;
  }

  const columns = [
    { key: 'name', label: 'Nome' },
    { key: 'phone', label: 'Telefone' },
    { key: 'email', label: 'E-mail' },
    { key: 'reservation_count', label: 'Reservas' },
    { key: 'last_reservation_date', label: 'Última reserva' },
    { key: 'marketing_opt_in', label: 'Aceitou novidades' },
  ];
  const csv = toCSV(filtered, columns);
  downloadTextFile('mailing_sir_fisher.csv', csv);
}

init();
