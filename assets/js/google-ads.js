/* Publicidade opcional Google/Meta/OpenAI, com escolha por navegador.
   Manter idêntico a reservas/assets/js/google-ads.js. */
(function (w, d) {
  'use strict';
  if (w.sfGoogleAds) return;
  var GA = 'G-F40Z5Y9QT6';
  var ADS = 'AW-10856025003';
  var COOKIE = 'sf_advertising_v2';
  var PENDING = 'sf_ads_revoke_pending_v1';
  var receipt = null;
  var acceptedAt = null;
  var POLICY = '2026-11-03';
  var UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  var ROOT = 'sirfisher.com.br';
  var originalTag = typeof w.gtag === 'function' ? w.gtag : null;
  var metaScript = null;
  var state = null;
  var banner, title, description, allow, deny, privacy, preferences;
  var previousPadding = '', basePadding = 0, previousFocus = null;

  function consent(value) {
    return { ad_storage: value, ad_user_data: value, ad_personalization: value };
  }

  function rootDomain() {
    return w.location.hostname === ROOT || w.location.hostname.endsWith('.' + ROOT);
  }

  function cookieOptions() {
    return '; Path=/; SameSite=Lax' + (rootDomain() ? '; Domain=' + ROOT : '') +
      (w.location.protocol === 'https:' ? '; Secure' : '');
  }

  function readChoice() {
    try {
      var match = d.cookie.match(/(?:^|;\s*)sf_advertising_v2=(denied|granted\.([a-f0-9-]{36})\.(\d{10}))(?:;|$)/i);
      receipt = match && UUID.test(match[2] || '') ? match[2] : null;
      acceptedAt = receipt ? Number(match[3]) * 1000 : null;
      if (acceptedAt && (acceptedAt > Date.now() + 300000 || acceptedAt <= Date.now() - 15552000000)) {
        receipt = null; acceptedAt = null;
      }
      return match ? (receipt ? 'granted' : 'denied') : null;
    } catch (e) { return null; }
  }

  function clearAdsCookies() {
    try {
      d.cookie.split(';').forEach(function (part) {
        var name = part.split('=')[0].trim();
        if (!/^(?:_gcl_|_fb[pc]$|__obref$|__oppref$|sf_google_ads_v1$)/.test(name)) return;
        var expired = name + '=; Max-Age=0; Path=/; SameSite=Lax';
        d.cookie = expired;
        if (rootDomain()) d.cookie = expired + '; Domain=' + ROOT;
        d.cookie = expired + '; Domain=' + w.location.hostname;
      });
    } catch (e) { /* Bloqueio de cookies nao impede a navegacao. */ }
  }

  function pendingRevocations() {
    try {
      var match = d.cookie.match(/(?:^|;\s*)sf_ads_revoke_pending_v1=([^;]*)/);
      return match ? match[1].split(',').filter(function (id) { return UUID.test(id); }) : [];
    } catch (e) { return []; }
  }

  function savePending(ids) {
    try { d.cookie = PENDING + '=' + ids.slice(-20).join(',') + '; Max-Age=' +
      (ids.length ? '15552000' : '0') + cookieOptions(); } catch (e) {}
  }

  function revoke(id) {
    if (!UUID.test(id || '')) return;
    var ids = pendingRevocations();
    if (ids.indexOf(id) === -1) ids.push(id);
    savePending(ids);
    fetch('https://lucpxoynpvogkvzepagi.supabase.co/rest/v1/rpc/fn_revoke_advertising_consent', {
      method: 'POST', credentials: 'omit', keepalive: true,
      headers: { 'Content-Type': 'application/json', apikey: 'sb_publishable_MrmIRQL5aE7yI_0Tu1jnmQ_CJKyDelF' },
      body: JSON.stringify({ p_receipt: id })
    }).then(function (response) {
      if (!response.ok) throw new Error('Revogacao pendente');
      return response.json();
    }).then(function (ok) {
      if (ok === true) savePending(pendingRevocations().filter(function (item) { return item !== id; }));
    }).catch(function () { /* A recusa local vale agora; a revogacao sera reenviada. */ });
  }

  function providers() {
    var granted = state === 'granted';
    if (originalTag && granted && !w.fbq) {
      var pixel = w.fbq = function () {
        if (/^track/.test(arguments[0]) && state !== 'granted') return;
        if (pixel.callMethod) pixel.callMethod.apply(pixel, arguments);
        else pixel.queue.push(arguments);
      };
      w._fbq = pixel;
      pixel.queue = []; pixel.loaded = true; pixel.version = '2.0';
      pixel('consent', 'grant');
      pixel('set', 'autoConfig', false, '948509834960152');
      pixel('init', '948509834960152');
      pixel('track', 'PageView');
      metaScript = d.createElement('script'); metaScript.async = true;
      metaScript.src = 'https://connect.facebook.net/en_US/fbevents.js';
    } else if (typeof w.fbq === 'function') w.fbq('consent', granted ? 'grant' : 'revoke');
    if (granted && metaScript && !metaScript.isConnected) {
      var load = function () { if (state === 'granted' && !metaScript.isConnected) d.head.appendChild(metaScript); };
      if (w.sfAfterFirstPaint) w.sfAfterFirstPaint(load); else load();
    }
    if (typeof w.oaiq === 'function') w.oaiq('consent', granted);
    w.dispatchEvent(new CustomEvent('sf-advertising-consent', { detail: { granted: granted } }));
  }

  // Novos destinos gtag recebem eventos sem send_to por padrao. Eventos
  // existentes do restaurante seguem apenas para o GA4; uma futura conversao
  // Ads exige seu proprio send_to explicito, depois de conferir as acoes.
  if (originalTag) {
    w.gtag = function () {
      var args = Array.prototype.slice.call(arguments);
      if (args[0] === 'event' && !(args[2] && args[2].send_to)) {
        args[2] = Object.assign({}, args[2] || {}, { send_to: GA });
      }
      return originalTag.apply(w, args);
    };
  }

  function tag() {
    if (originalTag) w.gtag.apply(w, arguments);
  }

  function safeUrl(value) {
    try {
      var url = new URL(value);
      return url.origin + url.pathname;
    } catch (e) { return ''; }
  }

  state = readChoice();
  if (state !== 'granted') clearAdsCookies();
  if (originalTag) {
    tag('set', 'ads_data_redaction', true);
    if (state) tag('consent', 'update', consent(state));
    tag('set', 'allow_ad_personalization_signals', state === 'granted');
    tag('set', 'allow_google_signals', state === 'granted');
    tag('config', ADS, {
      allow_enhanced_conversions: false,
      page_location: safeUrl(w.location.href),
      page_referrer: safeUrl(d.referrer)
    });
  }

  function english() { return /^en\b/i.test(d.documentElement.lang || ''); }

  function text() {
    var en = english();
    title.textContent = en ? 'Advertising cookies' : 'Cookies de publicidade';
    description.textContent = en
      ? 'Allow cookies to measure and personalise ads? Other cookies stay active.'
      : 'Permitir cookies para medir e personalizar anúncios? Os demais seguem ativos.';
    allow.textContent = en ? 'Allow' : 'Permitir';
    deny.textContent = en ? 'Decline' : 'Recusar';
    privacy.textContent = en ? 'Privacy notice' : 'Aviso de privacidade';
    preferences.textContent = en ? 'Cookie preferences' : 'Preferências de cookies';
    size();
  }

  function size() {
    if (banner && !banner.hidden) {
      d.body.style.paddingBottom = (basePadding + banner.offsetHeight + 24) + 'px';
    }
  }

  function show(focus) {
    previousFocus = d.activeElement;
    banner.hidden = false;
    preferences.setAttribute('aria-expanded', 'true');
    size();
    if (focus) allow.focus();
  }

  function choose(value) {
    var oldReceipt = receipt;
    if (value === 'granted' && !receipt) {
      try { receipt = w.crypto.randomUUID(); acceptedAt = Date.now(); } catch (e) { value = 'denied'; }
    }
    state = value;
    try { d.cookie = COOKIE + '=' + value + (value === 'granted' ? '.' + receipt + '.' + Math.floor(acceptedAt / 1000) : '') +
      '; Max-Age=' + (value === 'granted' ? Math.max(1, Math.floor((acceptedAt + 15552000000 - Date.now()) / 1000)) : 15552000) + cookieOptions(); } catch (e) {}
    if (value !== 'granted') { receipt = null; acceptedAt = null; if (oldReceipt) revoke(oldReceipt); }
    if (value !== 'granted') clearAdsCookies();
    tag('consent', 'update', consent(value));
    tag('set', 'allow_ad_personalization_signals', value === 'granted');
    tag('set', 'allow_google_signals', value === 'granted');
    // Contagem estatistica da escolha, sem comprovante nem dado pessoal.
    tag('event', value === 'granted' ? 'publicidade_aceita' : 'publicidade_recusada');
    providers();
    banner.hidden = true;
    d.body.style.paddingBottom = previousPadding;
    preferences.setAttribute('aria-expanded', 'false');
    if (previousFocus && previousFocus.isConnected && previousFocus !== d.body) previousFocus.focus();
  }

  function element(name, className, parent) {
    var el = d.createElement(name);
    if (className) el.className = className;
    if (parent) parent.appendChild(el);
    return el;
  }

  function render() {
    if (!d.body || banner) return;
    previousPadding = d.body.style.paddingBottom;
    basePadding = parseFloat(w.getComputedStyle(d.body).paddingBottom) || 0;
    var style = element('style', '', d.head);
    style.textContent = '.sf-gads-banner{position:fixed;z-index:10000;bottom:12px;right:12px;width:min(420px,calc(100% - 24px));box-sizing:border-box;background:#f6ecd9;color:#12293d;border:1px solid #8c8170;border-radius:10px;padding:12px;box-shadow:0 4px 20px #0003;font:13px/1.45 system-ui,sans-serif;text-align:left}.sf-gads-banner[hidden]{display:none}.sf-gads-title{font-size:14px;margin:0 0 5px}.sf-gads-description{margin:0 0 10px}.sf-gads-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.sf-gads-actions button{font:inherit;font-weight:600;border:1px solid #12293d;border-radius:6px;padding:7px 12px;min-height:40px;cursor:pointer}.sf-gads-allow{background:#1a4f8a;color:#fff}.sf-gads-deny{background:#fff;color:#12293d}.sf-gads-actions a{color:#1a4f8a;text-decoration:underline;font-size:12px}.sf-gads-controls{clear:both;display:block;text-align:center;padding:12px}.sf-gads-preferences{font:12px/1.5 system-ui,sans-serif;background:transparent;color:inherit;border:1px solid currentColor;border-radius:6px;padding:6px 10px;cursor:pointer}.sf-gads-banner button:focus-visible,.sf-gads-banner a:focus-visible,.sf-gads-preferences:focus-visible{outline:3px solid #b64226;outline-offset:3px}';
    var controls = element('div', 'sf-gads-controls', d.body);
    preferences = element('button', 'sf-gads-preferences', controls);
    preferences.type = 'button';
    preferences.setAttribute('aria-controls', 'sf-gads-banner');
    preferences.setAttribute('aria-expanded', 'false');
    preferences.addEventListener('click', function () { show(true); });
    banner = element('section', 'sf-gads-banner', d.body);
    banner.id = 'sf-gads-banner';
    banner.hidden = true;
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-labelledby', 'sf-gads-title');
    title = element('h2', 'sf-gads-title', banner);
    title.id = 'sf-gads-title';
    description = element('p', 'sf-gads-description', banner);
    var actions = element('div', 'sf-gads-actions', banner);
    allow = element('button', 'sf-gads-allow', actions);
    allow.type = 'button';
    deny = element('button', 'sf-gads-deny', actions);
    deny.type = 'button';
    privacy = element('a', '', actions);
    privacy.href = 'https://www.sirfisher.com.br/privacidade/#anuncios-google';
    allow.addEventListener('click', function () { choose('granted'); });
    deny.addEventListener('click', function () { choose('denied'); });
    text();
    if (!state) {
      show(false);
      tag('event', 'publicidade_aviso_exibido');
    }
    w.addEventListener('resize', size);
    if (w.MutationObserver) new w.MutationObserver(text).observe(d.documentElement, { attributes: true, attributeFilter: ['lang'] });
  }

  w.sfGoogleAds = {
    show: function () { if (banner) show(true); },
    getChoice: function () { return state; },
    snapshot: function () { return {
      advertising_consent: state === 'granted' && UUID.test(receipt || ''),
      advertising_consent_receipt: state === 'granted' ? receipt : null,
      advertising_consent_at: state === 'granted' && acceptedAt ? new Date(acceptedAt).toISOString() : null,
      advertising_consent_version: POLICY
    }; }
  };
  providers();
  pendingRevocations().forEach(revoke);
  w.addEventListener('online', function () { pendingRevocations().forEach(revoke); });
  w.addEventListener('focus', function () {
    var previous = state;
    state = readChoice();
    if (previous !== state) {
      tag('consent', 'update', consent(state === 'granted' ? 'granted' : 'denied'));
      tag('set', 'allow_ad_personalization_signals', state === 'granted');
    tag('set', 'allow_google_signals', state === 'granted');
      if (state !== 'granted') clearAdsCookies();
      providers();
    }
    pendingRevocations().forEach(revoke);
  });
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', render, { once: true });
  else render();
})(window, document);
