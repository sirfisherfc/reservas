import { supabase } from './supabaseClient.js';
import { requireStaff, mountLayout } from './adminGuard.js';
import { qs, qsa, showToast } from './utils.js';

let appUser = null;

async function init() {
  appUser = await requireStaff({ adminOnly: true });
  if (!appUser) return;
  mountLayout(appUser, 'usuarios');

  qs('#nu-add-btn').addEventListener('click', addUser);

  await loadUsers();
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

init();
