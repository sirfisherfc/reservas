import { OPENAI_ADS_PIXEL_ID } from './config.js';

const STORAGE_KEY = 'sf_attribution_v1';
const COOKIE_KEY = 'sf_attribution_v1';
const TRACKED_KEYS = [
  'oppref', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'campaign_id', 'ad_group_id', 'ad_id',
];

function readCookie(name) {
  const prefix = `${name}=`;
  const entry = document.cookie.split('; ').find((item) => item.startsWith(prefix));
  if (!entry) return null;
  try {
    return decodeURIComponent(entry.slice(prefix.length));
  } catch {
    return null;
  }
}

function loadStoredAttribution() {
  for (const raw of [window.localStorage.getItem(STORAGE_KEY), readCookie(COOKIE_KEY)]) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // Atributos corrompidos não impedem uma reserva.
    }
  }
  return {};
}

function persistAttribution(attribution) {
  const value = JSON.stringify(attribution);
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Privacidade do navegador pode bloquear storage local.
  }

  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  const domain = window.location.hostname.endsWith('.sirfisher.com.br')
    ? '; Domain=.sirfisher.com.br'
    : '';
  document.cookie = `${COOKIE_KEY}=${encodeURIComponent(value)}; Max-Age=7776000; Path=/${domain}; SameSite=Lax${secure}`;
}

function limitedValue(value, max = 255) {
  return typeof value === 'string' && value.length <= max ? value : null;
}

export function captureAttribution() {
  const params = new URLSearchParams(window.location.search);
  const incoming = {};

  TRACKED_KEYS.forEach((key) => {
    const max = key === 'oppref' ? 1024 : 255;
    const value = limitedValue(params.get(key), max);
    if (value) incoming[key] = value;
  });

  if (Object.keys(incoming).length) {
    const attribution = {
      ...loadStoredAttribution(),
      ...incoming,
      landing_url: window.location.href.slice(0, 2000),
      captured_at: new Date().toISOString(),
    };
    persistAttribution(attribution);
    return attribution;
  }

  return loadStoredAttribution();
}

export function reservationAttribution() {
  const a = captureAttribution();
  return {
    oppref: limitedValue(a.oppref, 1024),
    utm_source: limitedValue(a.utm_source),
    utm_medium: limitedValue(a.utm_medium),
    utm_campaign: limitedValue(a.utm_campaign),
    utm_content: limitedValue(a.utm_content),
    utm_term: limitedValue(a.utm_term),
    campaign_id: limitedValue(a.campaign_id),
    ad_group_id: limitedValue(a.ad_group_id),
    ad_id: limitedValue(a.ad_id),
    landing_url: limitedValue(a.landing_url, 2000),
    captured_at: limitedValue(a.captured_at),
  };
}

export function initOpenAIAdsPixel() {
  if (!OPENAI_ADS_PIXEL_ID || window.oaiq) return;

  const queue = function queuePixelCall(...args) {
    queue.q.push(args);
  };
  queue.q = [];
  window.oaiq = queue;

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://bzrcdn.openai.com/sdk/oaiq.min.js';
  document.head.appendChild(script);
  window.oaiq('init', { pixelId: OPENAI_ADS_PIXEL_ID });
}

export function measureReservationPageViewed() {
  if (typeof window.oaiq !== 'function') return;
  window.oaiq('measure', 'page_viewed', {
    type: 'contents',
    contents: [{
      id: 'reservation_page',
      name: 'Reserva Sir Fisher Praia',
      content_type: 'page',
    }],
  });
}

export function measureReservationConfirmed() {
  if (typeof window.oaiq !== 'function') return;
  window.oaiq('measure', 'appointment_scheduled', { type: 'customer_action' });
}
