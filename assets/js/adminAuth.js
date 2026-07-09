// Lógica exclusiva da tela de login (admin/index.html).
import { supabase } from './supabaseClient.js';

const btn = document.getElementById('google-login-btn');
const statusEl = document.getElementById('login-status');

btn.addEventListener('click', async () => {
  btn.disabled = true;
  statusEl.textContent = '';

  const redirectTo = new URL('./dashboard.html', window.location.href).toString();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });

  if (error) {
    statusEl.textContent = 'Não foi possível iniciar o login. Tente novamente.';
    btn.disabled = false;
  }
});

async function redirectIfAlreadyLoggedIn() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    window.location.href = './dashboard.html';
  }
}

redirectIfAlreadyLoggedIn();
