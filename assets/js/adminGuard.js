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

  if (error) {
    renderDenied('Não foi possível verificar seu acesso agora. Tente novamente em instantes.');
    return null;
  }

  if (appUser && appUser.active) {
    if (adminOnly && appUser.role !== 'admin') {
      renderDenied('Esta área é exclusiva para administradores.');
      return null;
    }
    return appUser;
  }

  if (appUser && !appUser.active) {
    renderDenied('Sua conta foi desativada. Fale com um administrador para reativar o acesso.');
    return null;
  }

  // Ninguém cadastrado para este login: registra (ou consulta) um pedido de acesso.
  const { data: reqData, error: reqError } = await supabase.rpc('fn_request_access');
  const status = reqError ? 'error' : (Array.isArray(reqData) ? reqData[0]?.status : reqData?.status);

  if (status === 'already_staff') {
    window.location.reload();
    return null;
  }

  if (status === 'deactivated') {
    renderDenied('Sua conta foi desativada. Fale com um administrador para reativar o acesso.');
    return null;
  }

  if (status === 'error') {
    renderDenied('Não foi possível registrar sua solicitação de acesso agora. Tente novamente em instantes.');
    return null;
  }

  renderPendingAccess(status);
  return null;
}

export async function mountLayout(appUser, activeKey) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  let pendingCount = 0;
  if (appUser.role === 'admin') {
    const { count } = await supabase
      .from('access_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    pendingCount = count || 0;
  }

  const links = NAV_ITEMS
    .filter((item) => !item.adminOnly || appUser.role === 'admin')
    .map((item) => {
      const badge = item.key === 'usuarios' && pendingCount > 0
        ? ` <span class="nav-badge">${pendingCount}</span>`
        : '';
      return `<a href="${item.href}" class="${item.key === activeKey ? 'is-active' : ''}">${item.label}${badge}</a>`;
    })
    .join('');

  sidebar.innerHTML = `
    <div class="sidebar__brand">
      <img src="../assets/img/logo-icon.png" alt="" class="sidebar__brand-logo" width="536" height="528" />
      <span>Sir Fisher Praia</span>
    </div>
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
        <img src="../assets/img/logo-emblem.png" alt="" class="login-card__logo" width="654" height="700" />
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

function renderPendingAccess(status) {
  const isRejected = status === 'rejected';
  const title = isRejected ? 'Solicitação recusada' : 'Aguardando aprovação';
  const message = isRejected
    ? 'Sua solicitação de acesso foi recusada. Fale com um administrador se acredita que isso é um engano.'
    : 'Seu login foi reconhecido, mas ainda não há acesso liberado para este e-mail. Um administrador precisa aprovar sua solicitação em Usuários.';

  document.body.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <img src="../assets/img/logo-emblem.png" alt="" class="login-card__logo" width="654" height="700" />
        <h1>${title}</h1>
        <p>${message}</p>
        <button id="guard-recheck-btn" class="btn-google" type="button">Verificar novamente</button>
        <button id="guard-logout-btn" class="btn-google" type="button" style="margin-top:10px;">Sair</button>
      </div>
    </div>
  `;
  document.getElementById('guard-recheck-btn').addEventListener('click', () => window.location.reload());
  document.getElementById('guard-logout-btn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = './index.html';
  });
}
