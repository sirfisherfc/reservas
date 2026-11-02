import { requireStaff, mountLayout } from './adminGuard.js';
import { buildMarketingLink } from './marketing-links.js?v=20261102';

async function init() {
  const appUser = await requireStaff({ adminOnly: true });
  if (!appUser) return;
  await mountLayout(appUser, 'links-marketing');
  document.getElementById('marketing-main').hidden = false;
  const form = document.getElementById('marketing-form');
  const preview = document.getElementById('marketing-preview');
  const error = document.getElementById('marketing-error');
  const output = document.getElementById('marketing-link');
  const adFields = document.getElementById('ad-fields');
  form.addEventListener('input', () => {
    preview.hidden = true;
    error.textContent = '';
    const paid = form.elements.medium.value === 'paid_social';
    adFields.hidden = !paid;
    adFields.disabled = !paid;
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const link = buildMarketingLink(Object.fromEntries(new FormData(form)));
      output.value = link;
      document.getElementById('open-link').href = link;
      preview.hidden = false;
      error.textContent = '';
    } catch (failure) {
      preview.hidden = true;
      error.textContent = failure.message;
    }
  });
  document.getElementById('copy-link').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(output.value);
      error.textContent = 'Link copiado.';
    } catch {
      output.focus();
      output.select();
      error.textContent = 'Selecione e copie o link acima.';
    }
  });
}

init();
