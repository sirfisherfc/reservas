// Gera links públicos; não acessa APIs nem altera campanhas/publicações.
const DESTINATION_HOSTS = new Set(['sirfisher.com.br', 'www.sirfisher.com.br', 'reservas.sirfisher.com.br']);
const MARKETING_KEYS = ['oppref', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
  'utm_term', 'utm_id', 'campaign_id', 'ad_group_id', 'ad_id', 'fbclid', 'gclid'];

function identifier(value, label, pattern = /^[a-z0-9][a-z0-9_-]{0,119}$/) {
  const text = String(value || '').trim();
  if (!pattern.test(text)) throw new Error(`Confira ${label}. Use o identificador informado na plataforma.`);
  return text;
}

export function buildMarketingLink({ destination, source, medium, campaign, contentId,
  campaignId = '', adGroupId = '', adId = '' }) {
  let url;
  try { url = new URL(destination); } catch { throw new Error('Informe uma URL completa do site ou do portal de reservas.'); }
  if (url.protocol !== 'https:' || !DESTINATION_HOSTS.has(url.hostname)
      || url.username || url.password || url.port) {
    throw new Error('Use uma URL HTTPS do site Sir Fisher ou do portal de reservas.');
  }
  if (url.hostname === 'reservas.sirfisher.com.br'
      && !['/', '/index.html', '/reveillon.html'].includes(url.pathname)) {
    throw new Error('Escolha uma página pública de reserva como destino.');
  }
  if (!['instagram', 'facebook'].includes(source)) throw new Error('Escolha Instagram ou Facebook.');
  if (!['organic_social', 'paid_social'].includes(medium)) throw new Error('Escolha conteúdo orgânico ou anúncio.');
  const campaignName = identifier(campaign, 'o nome da campanha');
  const prefix = source === 'instagram' ? 'ig_' : 'fb_';
  const content = identifier(String(contentId || '').replace(new RegExp(`^${prefix}`), ''),
    'o ID da publicação', /^\d{1,80}(?:_\d{1,80})?$/);
  for (const key of MARKETING_KEYS) url.searchParams.delete(key);
  // Conserva somente contexto público conhecido; links de marketing não
  // carregam tokens de clientes ou valores arbitrários de uma URL copiada.
  for (const [key, value] of [...url.searchParams]) {
    const allowed = key === 'lang' ? ['pt', 'en'].includes(value)
      : ['sf_origin', 'sf_cta'].includes(key) && /^[a-z0-9_-]{1,80}$/.test(value);
    if (!allowed) url.searchParams.delete(key);
  }
  url.searchParams.set('utm_source', source);
  url.searchParams.set('utm_medium', medium);
  url.searchParams.set('utm_campaign', campaignName);
  url.searchParams.set('utm_content', prefix + content);
  if (medium === 'paid_social') {
    for (const [key, value, label] of [
      ['campaign_id', campaignId, 'o ID da campanha'],
      ['ad_group_id', adGroupId, 'o ID do conjunto de anúncios'],
      ['ad_id', adId, 'o ID do anúncio'],
    ]) url.searchParams.set(key, identifier(value, label, /^\d{1,80}$/));
    url.searchParams.set('utm_id', url.searchParams.get('campaign_id'));
  }
  return url.href;
}
