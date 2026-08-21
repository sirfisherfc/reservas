import { supabase } from './supabaseClient.js';
import { requireStaff, mountLayout } from './adminGuard.js';
import { qs, qsa, formatDateBR, showToast, toCSV, downloadTextFile } from './utils.js';

let allRows = [];
let filterDebounceTimer;

// Direção inicial de cada coluna ao clicar nela pela primeira vez: texto começa
// em A→Z, números e datas começam pelo maior, que é o que se quer ver primeiro.
const SORT_DEFAULT_DIR = {
  name: 'asc',
  phone: 'asc',
  email: 'asc',
  reservation_count: 'desc',
  last_reservation_date: 'desc',
  marketing_opt_in: 'desc',
};

// Mesma ordenação do carregamento inicial (ver loadCustomers).
let sortKey = 'last_reservation_date';
let sortDir = 'desc';

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
  wireSorting();

  await loadCustomers();
}

function wireSorting() {
  qsa('#mailing-head .th-sort').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.sort;
      if (key === sortKey) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey = key;
        sortDir = SORT_DEFAULT_DIR[key] || 'asc';
      }
      renderTable();
    });
  });
}

function renderSortIndicators() {
  qsa('#mailing-head .th-sort').forEach((btn) => {
    const isActive = btn.dataset.sort === sortKey;
    btn.classList.toggle('is-active', isActive);
    // aria-sort pertence ao cabeçalho da coluna (<th>), não ao botão dentro dele.
    btn.parentElement?.setAttribute('aria-sort', isActive ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
    qs('.th-sort__arrow', btn).textContent = isActive ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
  });
}

// Vazios ficam sempre no fim, nas duas direções — um cliente sem e-mail no topo
// da lista só atrapalha quem está montando um disparo.
function sortRows(rows) {
  const dir = sortDir === 'asc' ? 1 : -1;
  return rows.slice().sort((rowA, rowB) => {
    const a = rowA[sortKey];
    const b = rowB[sortKey];
    const aEmpty = a === null || a === undefined || a === '';
    const bEmpty = b === null || b === undefined || b === '';
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    if (typeof a === 'boolean' || typeof a === 'number') {
      return (Number(a) - Number(b)) * dir;
    }
    return String(a).localeCompare(String(b), 'pt-BR', { sensitivity: 'base' }) * dir;
  });
}

function getVisibleRows() {
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

  return sortRows(filtered);
}

// A API REST corta o número de linhas por requisição (o padrão do Supabase é
// 1000) e a base já passa disso. Sem paginar, a tela mostraria só uma parte da
// lista — e a ordenação por cabeçalho ordenaria esse pedaço, dando um "top 10"
// errado. Por isso buscamos em blocos até vir uma página incompleta.
const FETCH_PAGE_SIZE = 1000;

async function loadCustomers() {
  const tbody = qs('#mailing-tbody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Carregando…</td></tr>';
  qs('#mailing-alert').innerHTML = '';

  // Avançamos pelo tamanho realmente devolvido, e não pelo que pedimos: assim
  // o laço termina certo mesmo que o servidor corte em menos que FETCH_PAGE_SIZE.
  // Custa uma requisição a mais no fim (a que volta vazia) e nunca trunca.
  const rows = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('customer_mailing_stats')
      .select('customer_id, name, email, phone, marketing_opt_in, reservation_count, last_reservation_date')
      .order('last_reservation_date', { ascending: false, nullsFirst: false })
      // Desempate obrigatório: sem uma ordem total, duas páginas seguidas podem
      // devolver a mesma linha (ou pular uma) quando há empate na data.
      .order('customer_id', { ascending: true })
      .range(offset, offset + FETCH_PAGE_SIZE - 1);

    if (error) {
      qs('#mailing-alert').innerHTML = `<div class="alert alert--danger">Erro ao carregar clientes: ${error.message}</div>`;
      tbody.innerHTML = '';
      return;
    }

    const page = data || [];
    if (!page.length) break;
    rows.push(...page);
    offset += page.length;
  }

  allRows = rows;
  renderTable();
}

function renderTable() {
  const tbody = qs('#mailing-tbody');
  const filtered = getVisibleRows();
  renderSortIndicators();

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
  // Exporta exatamente o que está na tela, na mesma ordem.
  const filtered = getVisibleRows();

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
