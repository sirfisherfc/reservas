// Guarda de acesso do painel: toda página protegida chama requireStaff() antes de renderizar.
// A autorização "de verdade" é sempre feita pelo RLS no banco — este guard só evita que uma
// pessoa sem perfil ativo veja a interface do painel.
import { supabase } from './supabaseClient.js';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', href: './dashboard.html', adminOnly: false },
  { key: 'reservas', label: 'Reservas', href: './reservas.html', adminOnly: false },
  { key: 'configuracoes', label: 'Configurações', href: './configuracoes.html', adminOnly: true },
  { key: 'bloqueios', label: 'Bloqueios', href: './bloqueios.html', adminOnly: true },
  { key: 'usuarios', label: 'Usuários', href: './usuarios.html', adminOnly: true },
];

export async function requireStaff({ adminOnly = false } = {}) {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    window.location.href = './index.html';
    return null;
  }

  // Vincula automaticamente um convite pendente (linha em app_users cadastrada pelo admin
  // por e-mail, ainda sem auth_user_id) ao usuário Google que acabou de logar. Não faz nada
  // se não houver convite pendente para este e-mail.
  await supabase.rpc('fn_claim_app_user');

  const { data: appUser, error } = await supabase
    .from('app_users')
    .select('id, name, email, role, active')
    .eq('auth_user_id', session.user.id)
    .maybeSingle();

  if (error || !appUser || !appUser.active) {
    renderDenied('Seu usuário Google não tem acesso autorizado a este painel. Peça para um administrador cadastrar seu e-mail em Usuários.');
    return null;
  }

  if (adminOnly && appUser.role !== 'admin') {
    renderDenied('Esta área é exclusiva para administradores.');
    return null;
  }

  return appUser;
}

export function mountLayout(appUser, activeKey) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  const links = NAV_ITEMS
    .filter((item) => !item.adminOnly || appUser.role === 'admin')
    .map((item) => `<a href="${item.href}" class="${item.key === activeKey ? 'is-active' : ''}">${item.label}</a>`)
    .join('');

  sidebar.innerHTML = `
    <div class="sidebar__brand">Sir Fisher Praia</div>
    <div class="sidebar__role">${appUser.role === 'admin' ? 'Administrador' : 'Operador'} · ${appUser.name || appUser.email}</div>
    ${links}
    <div class="sidebar__spacer"></div>
    <button class="sidebar__logout" id="sidebar-logout-btn" type="button">Sair</button>
  `;

  document.getElementById('sidebar-logout-btn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = './index.html';
  });
}

function renderDenied(message) {
  document.body.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <h1>Acesso negado</h1>
        <p>${message}</p>
        <button id="guard-logout-btn" class="btn-google" type="button">Sair e tentar outra conta</button>
      </div>
    </div>
  `;
  document.getElementById('guard-logout-btn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = './index.html';
  });
}
