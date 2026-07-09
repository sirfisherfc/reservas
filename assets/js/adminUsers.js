import { supabase } from './supabaseClient.js';
import { requireStaff, mountLayout } from './adminGuard.js';
import { qs, qsa, showToast, formatDateTimeBR } from './utils.js';

let appUser = null;

async function init() {
  appUser = await requireStaff({ adminOnly: true });
  if (!appUser) return;
  await mountLayout(appUser, 'usuarios');

  qs('#nu-add-btn').addEventListener('click', addUser);

  await Promise.all([loadUsers(), loadRequests()]);
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

async function loadUsers() {
  const { data, error } = await supabase
    .from('app_users')
    .select('id, name, email, role, active, auth_user_id')
    .order('created_at', { ascending: true });

  const tbody = qs('#users-tbody');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Erro: ${error.message}</td></tr>`;
    return;
  }

  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhum usuário cadastrado.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map((u) => {
    const isSelf = u.id === appUser.id;
    return `
      <tr data-id="${u.id}">
        <td>${escapeHtml(u.name || '—')}</td>
        <td>${escapeHtml(u.email)}</td>
        <td>
          <select data-field="role" ${isSelf ? 'disabled' : ''}>
            <option value="operator" ${u.role === 'operator' ? 'selected' : ''}>Operador</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrador</option>
          </select>
        </td>
        <td><input type="checkbox" data-field="active" ${u.active ? 'checked' : ''} ${isSelf ? 'disabled' : ''} /></td>
        <td>${u.auth_user_id ? 'Já logou' : 'Aguardando primeiro login'}</td>
        <td><button class="btn btn--outline btn--sm" data-remove type="button" ${isSelf ? 'disabled' : ''}>Remover</button></td>
      </tr>
    `;
  }).join('');

  qsa('#users-tbody tr[data-id]').forEach((row) => {
    const id = row.dataset.id;
    row.querySelector('[data-field="role"]').addEventListener('change', (evt) => updateUser(id, { role: evt.target.value }));
    row.querySelector('[data-field="active"]').addEventListener('change', (evt) => updateUser(id, { active: evt.target.checked }));
    const removeBtn = row.querySelector('[data-remove]');
    if (removeBtn) removeBtn.addEventListener('click', () => removeUser(id));
  });
}

async function addUser() {
  const name = qs('#nu-name').value.trim();
  const email = qs('#nu-email').value.trim();
  const role = qs('#nu-role').value;

  if (!email) {
    showToast('Informe o e-mail do Google da pessoa.', 'danger');
    return;
  }

  const { error } = await supabase.from('app_users').insert({
    name: name || null,
    email,
    role,
    active: true,
  });

  if (error) {
    qs('#users-alert').innerHTML = `<div class="alert alert--danger">Erro ao adicionar usuário: ${error.message}</div>`;
    return;
  }

  qs('#users-alert').innerHTML = '';
  qs('#nu-name').value = '';
  qs('#nu-email').value = '';
  showToast('Usuário adicionado. O acesso será liberado no primeiro login com esse e-mail.');
  await loadUsers();
}

async function updateUser(id, patch) {
  const { error } = await supabase
    .from('app_users')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    showToast(`Erro ao atualizar usuário: ${error.message}`, 'danger');
    await loadUsers();
    return;
  }
  showToast('Usuário atualizado.');
}

async function removeUser(id) {
  if (!window.confirm('Remover este usuário do painel? O histórico de reservas feitas por ele é mantido.')) return;

  const { error } = await supabase.from('app_users').delete().eq('id', id);
  if (error) {
    showToast(`Erro ao remover usuário: ${error.message}`, 'danger');
    return;
  }
  showToast('Usuário removido.');
  await loadUsers();
}

// --- Solicitações de acesso pendentes ---

async function loadRequests() {
  const { data, error } = await supabase
    .from('access_requests')
    .select('id, name, email, requested_at')
    .eq('status', 'pending')
    .order('requested_at', { ascending: true });

  const card = qs('#requests-card');
  const tbody = qs('#requests-tbody');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Erro: ${error.message}</td></tr>`;
    return;
  }

  if (!data.length) {
    card.classList.add('hidden');
    return;
  }

  card.classList.remove('hidden');
  tbody.innerHTML = data.map((r) => `
    <tr data-id="${r.id}">
      <td>${escapeHtml(r.name || '—')}</td>
      <td>${escapeHtml(r.email)}</td>
      <td>${formatDateTimeBR(r.requested_at)}</td>
      <td>
        <select data-field="role">
          <option value="operator">Operador</option>
          <option value="admin">Administrador</option>
        </select>
      </td>
      <td class="stack" style="flex-direction:row; gap:6px;">
        <button class="btn btn--success btn--sm" data-approve type="button">Aprovar</button>
        <button class="btn btn--outline btn--sm" data-reject type="button">Recusar</button>
      </td>
    </tr>
  `).join('');

  qsa('#requests-tbody tr[data-id]').forEach((row) => {
    const id = row.dataset.id;
    row.querySelector('[data-approve]').addEventListener('click', () => {
      const role = row.querySelector('[data-field="role"]').value;
      reviewRequest(id, true, role);
    });
    row.querySelector('[data-reject]').addEventListener('click', () => reviewRequest(id, false, null));
  });
}

async function reviewRequest(id, approve, role) {
  if (!approve && !window.confirm('Recusar esta solicitação de acesso?')) return;

  const { error } = await supabase.rpc('fn_review_access_request', {
    p_request_id: id,
    p_approve: approve,
    p_role: role,
  });

  if (error) {
    qs('#requests-alert').innerHTML = `<div class="alert alert--danger">Erro: ${error.message}</div>`;
    return;
  }

  qs('#requests-alert').innerHTML = '';
  showToast(approve ? 'Acesso aprovado.' : 'Solicitação recusada.');
  await Promise.all([loadRequests(), loadUsers()]);
}

init();
