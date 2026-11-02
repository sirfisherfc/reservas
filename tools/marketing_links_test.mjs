import { buildMarketingLink } from '../assets/js/marketing-links.js';

const base = { destination: 'https://reservas.sirfisher.com.br/?lang=en',
  source: 'instagram', medium: 'organic_social', campaign: 'novembro-2026', contentId: '123456789' };
function assert(value, message) { if (!value) throw new Error(message); }
function rejects(args) {
  let rejected = false;
  try { buildMarketingLink({ ...base, ...args }); } catch { rejected = true; }
  assert(rejected, 'Aceitou link/identificador invalido');
}

Deno.test('link organico identifica conteudo e preserva idioma e fragmento', () => {
  const url = new URL(buildMarketingLink({ ...base,
    destination: 'https://www.sirfisher.com.br/conheca/?lang=en&fbclid=old&ad_id=old&email=fixture@example.invalid#reservas' }));
  assert(url.searchParams.get('utm_content') === 'ig_123456789', 'Conteudo sem ID rastreavel');
  assert(url.searchParams.get('utm_campaign') === base.campaign, 'Campanha ausente');
  assert(url.searchParams.get('lang') === 'en' && url.hash === '#reservas', 'Alterou destino/idioma');
  assert(!url.searchParams.has('fbclid') && !url.searchParams.has('ad_id'), 'Herdou clique anterior');
  assert(!url.searchParams.has('email'), 'Manteve parametro pessoal na URL');
});

Deno.test('anuncio registra IDs Meta e utm_id equivalente para GA4', () => {
  const url = new URL(buildMarketingLink({ ...base, source: 'facebook', medium: 'paid_social',
    contentId: '123_456', campaignId: '111', adGroupId: '222', adId: '333' }));
  assert(url.searchParams.get('utm_content') === 'fb_123_456', 'ID Facebook incorreto');
  assert(url.searchParams.get('utm_id') === '111' && url.searchParams.get('campaign_id') === '111', 'IDs divergem');
  assert(url.searchParams.get('ad_group_id') === '222' && url.searchParams.get('ad_id') === '333', 'Anuncio sem IDs');
});

Deno.test('prefixo do conteudo pronto mantem uma unica identificacao', () => {
  assert(new URL(buildMarketingLink({ ...base, contentId: 'ig_123' })).searchParams.get('utm_content') === 'ig_123', 'Duplicou prefixo');
});

Deno.test('rejeita destinos externos, credenciais e dados fora do contrato', () => {
  for (const destination of ['http://reservas.sirfisher.com.br/', 'https://sirfisher.com.br.evil.invalid/',
    'javascript:alert(1)', 'https://user:pass@sirfisher.com.br/', 'https://sirfisher.com.br:444/']) rejects({ destination });
  rejects({ campaign: 'cliente@example.invalid' });
  rejects({ destination: 'https://reservas.sirfisher.com.br/cancelar.html?t=private-token' });
  rejects({ contentId: 'uma-legenda' });
  rejects({ source: 'other' });
  rejects({ medium: 'social' });
  rejects({ medium: 'paid_social', campaignId: '111', adGroupId: '222' });
});
