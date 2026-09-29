// Página pública do Réveillon (reveillon.html).
// Tudo o que é preço, prazo, regra ou texto de negócio vem de rv_public_event
// e rv_simulate; o cálculo é sempre do banco (rv_calc_price), nunca daqui.
import { supabase } from './supabaseClient.js';
import { qs, qsa, maskPhoneBR, setLoading, showToast, debounce } from './utils.js';
import { captureAttribution, reservationAttribution, initOpenAIAdsPixel } from './attribution.js';
import {
  esc, money, pct, dateBR, dateTimeBR, timeBR, longDateBR, fillTemplate, eventTextVars,
  bookingMessageVars, waHref, formatPixKey, parseDbError, renderMap, stateLabel, centerMapScroll,
} from './reveillonCommon.js';

const slug = new URLSearchParams(window.location.search).get('evento') || null;

let data = null;            // retorno de rv_public_event
let vars = {};              // marcadores dos textos
let selected = null;        // mesa escolhida
let counts = { adults: 0, children: 0, infants: 0 };
let lastSim = null;
let simSeq = 0;
let justBookedTableId = null;
let pollTimer = null;

const svg = qs('#rv-map');

// -------------------------------------------------------------------------
// Carga e renderização
// -------------------------------------------------------------------------
async function load() {
  const { data: result, error } = await supabase.rpc('rv_public_event', { p_slug: slug });
  if (error || !result) {
    qs('#load-error').classList.remove('hidden');
    return false;
  }
  data = result;
  vars = eventTextVars(data.event);
  return true;
}

function typeOf(table) {
  return data.types.find((t) => t.id === table.type_id) || {};
}

function setText(sel, value) {
  const node = qs(sel);
  if (node) node.textContent = value ?? '';
}

// "20:00" -> "20h", "02:30" -> "2h30"
function hourBR(ts, tz) {
  const [h, m] = timeBR(ts, tz).split(':');
  return `${Number(h)}h${m === '00' ? '' : m}`;
}

function fillList(sel, items) {
  const ul = qs(sel);
  ul.innerHTML = (items || []).map((i) => `<li>${esc(fillTemplate(i, vars))}</li>`).join('');
}

function renderStatic() {
  const e = data.event;
  const t = e.texts || {};
  document.title = `${e.name} — ${e.venue_name || 'Sir Fisher Praia'}`;
  setText('#hero-kicker', t.hero_kicker);
  setText('#hero-title', t.hero_title || e.name);
  setText('#hero-subtitle', fillTemplate(t.hero_subtitle, vars));
  const day = new Date(e.starts_at).toLocaleDateString('pt-BR', { timeZone: e.timezone, day: 'numeric', month: 'long' });
  setText('#hero-when', `${day} · das ${hourBR(e.starts_at, e.timezone)} às ${hourBR(e.ends_at, e.timezone)} · ${e.venue_name || 'Sir Fisher Praia'}`);

  if (t.experience_title) setText('#experience-title', t.experience_title);
  // "Título | texto", um por momento, na ordem das fotos da página.
  (t.moments || []).forEach((line, i) => {
    const [title, text] = String(line).split('|').map((s) => s.trim());
    const fig = qsa('.rv-moment')[i];
    if (!fig || !title) return;
    fig.querySelector('.js-moment-title').textContent = title;
    fig.querySelector('.js-moment-text').textContent = text || '';
  });
  setText('#proof-line', t.proof_line);
  qs('#proof-line').classList.toggle('hidden', !t.proof_line);
  if (t.final_title) setText('#final-title', t.final_title);
  if (t.final_subtitle) setText('#final-subtitle', fillTemplate(t.final_subtitle, vars));
  renderFaq(e, t);

  const dateStr = longDateBR(e.starts_at, e.timezone);
  setText('#fact-date', dateStr.charAt(0).toUpperCase() + dateStr.slice(1));
  setText('#fact-time', `Das ${hourBR(e.starts_at, e.timezone)} às ${hourBR(e.ends_at, e.timezone)}`);
  setText('#fact-venue', e.venue_name);
  const addr = qs('#fact-address');
  addr.textContent = e.address || '';
  addr.href = e.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.address)}` : '#';

  setText('#included-title', t.included_title);
  fillList('#included-list', e.included_items);
  setText('#menu-note', fillTemplate(t.menu_note, vars));
  const menu = qs('#menu-link');
  if (e.menu_url) menu.href = e.menu_url; else menu.classList.add('hidden');

  setText('#group-note', fillTemplate(t.group_note, vars));
  setText('#guarantee-inline', fillTemplate(t.guarantee_note, vars));
  qsa('.js-child-age').forEach((n) => { n.textContent = String(e.child_max_age); });
  setText('#children-hint', money(e.child_discount) ? `${money(e.child_discount)} de desconto cada` : '');

  qs('#terms-body').textContent = data.terms?.body || '';

  const wa = waHref(e.whatsapp_number, `Olá! Tenho uma dúvida sobre o ${e.name}.`);
  qs('#footer-whatsapp').href = wa;
  qs('#closed-whatsapp').href = wa;
  qs('#final-whatsapp').href = wa;

  qs('#legend-types').innerHTML = data.types.map((ty) => `
    <span class="rv-chip" style="--rv-type:${esc(ty.color)}"><i></i>${esc(ty.name)}</span>`).join('');

  const closed = !e.sales_open;
  qs('#closed-notice').classList.toggle('hidden', !closed);
  setText('#closed-text', fillTemplate(t.closed_message, vars));
  setText('#map-hint', closed ? '' : 'Toque numa mesa livre para ver o valor.');
}

// Perguntas frequentes: as extras do painel (texts.faq, "Pergunta | Resposta")
// e as que já existem em outros textos (pagamento, crianças, termos), para não
// haver duas versões da mesma regra.
const DEFAULT_FAQ = [
  'Dá para ver a queima de fogos? | Sim. Da nossa orla dá para ver a queima oficial do Aterro e também as de vários clubes e hotéis da Beira-Mar.',
  'Tem música? | DJ e cantor ao vivo durante toda a noite.',
];

function renderFaq(e, t) {
  const f = (s) => fillTemplate(s, vars);
  const para = (s) => (s ? `<p>${esc(f(s))}</p>` : '');
  const list = (items) => (items?.length ? `<ul>${items.map((i) => `<li>${esc(f(i))}</li>`).join('')}</ul>` : '');
  const custom = (t.faq?.length ? t.faq : DEFAULT_FAQ).map((line) => {
    const [q, ...a] = String(line).split('|');
    return [q.trim(), para(a.join('|').trim())];
  });
  const items = [
    ['Que horas começa e termina?', para(`Das ${hourBR(e.starts_at, e.timezone)} às ${hourBR(e.ends_at, e.timezone)}.`)],
    ...custom,
    ['Como funciona a consumação?', para(t.menu_note)],
    ['Como faço o pagamento?', [t.pix_note, t.card_note, t.guarantee_note, t.balance_note].map(para).join('')],
    ['Posso levar crianças?', list(t.children_rules)],
    ['Somos um grupo grande. Como fazemos?', para(t.group_note)],
    ['Quais são as regras e o cancelamento?', list(t.terms_summary)],
  ].filter(([q, a]) => q && a);
  qs('#faq-list').innerHTML = items.map(([q, a]) => `
    <details class="rv-faq__item"><summary>${esc(q)}</summary><div class="rv-faq__a">${a}</div></details>`).join('');
}

// Cartões por tipo de mesa + linha de disponibilidade no topo. Recalcula a cada
// atualização do mapa (Realtime/polling), então a escassez mostrada é a real.
function renderAvailability() {
  const open = data.tables.filter((tb) => tb.state !== 'bloqueada');
  const free = open.filter((tb) => tb.state === 'livre').length;
  const avail = qs('#hero-availability');
  let msg = '';
  if (open.length && free === 0) msg = 'Todas as mesas já foram reservadas.';
  else if (open.length && free / open.length <= 0.6) msg = `Restam ${free} das ${open.length} mesas.`;
  avail.textContent = msg;
  avail.classList.toggle('hidden', !msg);

  qs('#types-cards').innerHTML = data.types.map((ty) => {
    const ofType = open.filter((tb) => tb.type_id === ty.id);
    if (!ofType.length) return '';
    const n = ofType.filter((tb) => tb.state === 'livre').length;
    const left = n === 0 ? 'Esgotadas' : n === 1 ? 'Última disponível' : `${n} disponíveis`;
    const inc = ty.included_people;
    let people = `Para ${ty.min_people === inc ? '' : 'até '}${inc} pessoas`;
    if (ty.allows_extra_chairs && ty.max_people > inc) people += ` · até ${ty.max_people} com cadeiras extras`;
    const price = ty.table_price != null ? `
        <p class="rv-type__price">${esc(money(ty.table_price))}</p>
        <p class="rv-type__cons">${esc(money(ty.table_consumption))} de consumação inclusa</p>` : '';
    return `
      <article class="rv-type${n === 0 ? ' is-out' : ''}" style="--rv-type:${esc(ty.color)}">
        <h3><i aria-hidden="true"></i>${esc(ty.name)}</h3>
        <p class="rv-type__desc">${esc(ty.description || '')}</p>
        <p class="rv-type__people">${esc(people)}</p>${price}
        <p class="rv-type__left">${esc(left)}</p>
        <a href="#mapa" class="rv-link">Ver no mapa →</a>
      </article>`;
  }).join('');
}

function drawMap() {
  renderMap(svg, {
    map: data.event.map,
    types: data.types,
    tables: data.tables,
    stateOf: (t) => t.state,
    selectedId: selected?.id,
    onSelect: selectTable,
  });
  renderAvailability();
}

// Zoom só do mapa: pinça com dois dedos, botões − / + e Ctrl+roda no computador.
// Muda a largura do SVG (o viewBox mantém a proporção) e ajusta a rolagem para o
// ponto entre os dedos ficar parado. Vai de "mapa inteiro na tela" a 2,5×.
function initMapZoom() {
  const wrap = svg.parentElement;
  let base = 0;
  const width = () => svg.getBoundingClientRect().width;

  function setWidth(target, cx, cy) {
    if (!base) base = width();
    const lo = Math.min(1, wrap.clientWidth / base);
    const next = Math.min(Math.max(target, base * lo), base * 2.5);
    const old = width();
    if (Math.abs(next - old) < 0.5) return;
    const rect = wrap.getBoundingClientRect();
    const px = (cx ?? rect.left + rect.width / 2) - rect.left;
    const fx = px + wrap.scrollLeft;
    const fy = cy == null ? 0 : cy - svg.getBoundingClientRect().top;
    const k = next / old;
    svg.style.width = `${next}px`;
    svg.style.maxWidth = 'none';
    wrap.scrollLeft = fx * k - px;
    if (fy) window.scrollBy(0, fy * (k - 1));
  }

  let pinch = null;
  const dist = (e) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  wrap.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) pinch = { d: dist(e), w: width() };
  }, { passive: true });
  wrap.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2 || !pinch) return;
    e.preventDefault();
    const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    setWidth(pinch.w * (dist(e) / pinch.d), mx, my);
  }, { passive: false });
  wrap.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinch = null; });
  wrap.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setWidth(width() * (e.deltaY < 0 ? 1.1 : 0.9), e.clientX, e.clientY);
  }, { passive: false });
  qsa('.rv-zoom button').forEach((b) => b.addEventListener('click', () => {
    setWidth(width() * (b.dataset.zoom === 'in' ? 1.35 : 1 / 1.35));
  }));
}

// Botão fixo no celular: aparece depois do topo e some quando o mapa, o
// formulário, a confirmação ou a chamada final estão na tela.
function initStickyCta() {
  const sticky = qs('#sticky-cta');
  if (!('IntersectionObserver' in window)) return;
  const visible = new Set();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => (en.isIntersecting ? visible.add(en.target) : visible.delete(en.target)));
    const show = visible.size === 0;
    sticky.classList.toggle('is-on', show);
    sticky.setAttribute('aria-hidden', String(!show));
    sticky.tabIndex = show ? 0 : -1;
  });
  ['.rv-hero', '#mapa', '#mesa', '#sucesso', '#final'].forEach((sel) => io.observe(qs(sel)));
}

// -------------------------------------------------------------------------
// Escolha de mesa + simulação
// -------------------------------------------------------------------------
function selectTable(table) {
  if (!data.event.sales_open) {
    showToast(fillTemplate(data.event.texts?.closed_message, vars));
    return;
  }
  if (table.state !== 'livre') {
    showToast(`A mesa ${table.label} está ${stateLabel(table.state)}. Escolha uma mesa livre.`);
    return;
  }
  selected = table;
  const ty = typeOf(table);
  counts = { adults: Math.max(1, ty.included_people || ty.min_people || 1), children: 0, infants: 0 };
  lastSim = null;
  drawMap();
  renderTablePanel();
  qs('#mesa').classList.remove('hidden');
  qs('#form-alert-area').innerHTML = '';
  qs('#mesa').scrollIntoView({ behavior: 'smooth', block: 'start' });
  simulate();
}

function peopleRange(ty) {
  if (ty.min_people === ty.max_people) return `${ty.max_people} pessoas`;
  if (ty.min_people <= 1) return `até ${ty.max_people} pessoas`;
  return `de ${ty.min_people} a ${ty.max_people} pessoas`;
}

function renderTablePanel() {
  const ty = typeOf(selected);
  qs('#tp-dot').style.background = ty.color;
  setText('#tp-title', `${ty.name} ${selected.label}`);
  setText('#tp-desc', ty.description);
  const facts = [
    ['Pessoas', peopleRange(ty) + (ty.min_people <= 1 && ty.included_people > 1 ? ` (valor cobre ${ty.included_people})` : '')],
    ['Valor da mesa', money(ty.table_price)],
    ['Consumação inclusa', money(ty.table_consumption)],
  ];
  if (ty.allows_extra_chairs && ty.max_people > ty.included_people) {
    facts.push([`Cadeira extra (a partir da ${ty.included_people + 1}ª pessoa)`,
      `${money(ty.extra_chair_price)} com ${money(ty.extra_chair_consumption)} de consumação`]);
  }
  qs('#tp-facts').innerHTML = facts.map(([k, v]) => `<li><span>${esc(k)}</span><strong>${esc(v)}</strong></li>`).join('');
  setText('#adults-hint', ty.min_people > 1 ? `Mínimo de ${ty.min_people} pessoas na mesa` : '');
  const rules = data.event.texts?.children_rules || [];
  qs('[data-field="infants"] .hint').textContent = rules[0] ? fillTemplate(rules[0], vars) : '';
  renderSteppers();
}

function renderSteppers() {
  const ty = typeOf(selected);
  const limits = {
    adults: [1, ty.max_people - counts.children],
    children: [0, ty.max_people - counts.adults],
    infants: [0, ty.max_infants],
  };
  qsa('.rv-stepper').forEach((row) => {
    const field = row.dataset.field;
    const [min, max] = limits[field];
    row.querySelector('output').textContent = String(counts[field]);
    row.querySelector('[data-step="-1"]').disabled = counts[field] <= min;
    row.querySelector('[data-step="1"]').disabled = counts[field] >= max;
  });
}

qsa('.rv-stepper').forEach((row) => {
  row.addEventListener('click', (evt) => {
    const btn = evt.target.closest('button[data-step]');
    if (!btn || btn.disabled || !selected) return;
    counts[row.dataset.field] = Math.max(0, counts[row.dataset.field] + Number(btn.dataset.step));
    renderSteppers();
    simulateDebounced();
  });
});

async function simulate() {
  if (!selected) return;
  const seq = ++simSeq;
  qs('#sim-box').classList.add('is-loading');
  const { data: sim, error } = await supabase.rpc('rv_simulate', {
    p_table_id: selected.id,
    p_adults: counts.adults,
    p_children: counts.children,
    p_infants: counts.infants,
  });
  if (seq !== simSeq) return;
  qs('#sim-box').classList.remove('is-loading');
  if (error) {
    showSimMessage(parseDbError(error).text);
    lastSim = null;
    qs('#submit-btn').disabled = true;
    return;
  }
  lastSim = sim;
  renderSim(sim);
}
const simulateDebounced = debounce(simulate, 180);

function showSimMessage(text) {
  const box = qs('#sim-message');
  box.textContent = text || '';
  box.classList.toggle('hidden', !text);
}

function renderSim(sim) {
  const p = sim.price;
  const a = sim.after_deposit;
  const ty = typeOf(selected);
  const lines = [[`Mesa ${selected.label} (até ${ty.included_people} pessoas)`, money(p.table_amount)]];
  if (p.extra_chairs > 0) lines.push([`${p.extra_chairs} cadeira${p.extra_chairs > 1 ? 's' : ''} extra${p.extra_chairs > 1 ? 's' : ''}`, money(p.extra_chairs_amount)]);
  if (Number(p.children_discount) > 0) lines.push([`Desconto de ${counts.children} criança${counts.children > 1 ? 's' : ''}`, `− ${money(p.children_discount)}`]);
  lines.push(['Consumação inclusa', money(p.consumption_total)]);
  qs('#sim-lines').innerHTML = lines.map(([k, v]) => `<li><span>${esc(k)}</span><strong>${esc(v)}</strong></li>`).join('');
  setText('#sim-total', money(p.total));
  setText('#sim-pix-label', `No Pix (−${pct(sim.pix_discount_pct)}%)`);
  setText('#sim-total-pix', money(p.total_pix));

  const tz = data.event.timezone;
  qs('#sim-plan').innerHTML = `
    <li><span>Sinal de ${esc(pct(sim.deposit_pct))}% até ${esc(dateTimeBR(sim.hold_expires_at_preview, tz))}</span>
        <strong>${esc(money(p.deposit_min_pix))} no Pix<br><small>ou ${esc(money(p.deposit_min))} no cartão, presencial</small></strong></li>
    <li><span>Saldo até ${esc(dateBR(sim.balance_due_date))}</span>
        <strong>${esc(money(a.balance_pix))} no Pix<br><small>ou ${esc(money(a.balance))} no cartão, presencial</small></strong></li>`;

  showSimMessage(sim.valid ? '' : sim.message);
  qs('#submit-btn').disabled = !sim.valid;
  if (!sim.valid && sim.error_code === 'TABLE_TAKEN') refresh();
}

qs('#tp-close').addEventListener('click', closePanel);

function closePanel() {
  selected = null;
  qs('#mesa').classList.add('hidden');
  drawMap();
  qs('#mapa').scrollIntoView({ behavior: 'smooth' });
}

// -------------------------------------------------------------------------
// Envio
// -------------------------------------------------------------------------
const phoneInput = qs('#phone');
phoneInput.addEventListener('input', () => { phoneInput.value = maskPhoneBR(phoneInput.value); });

function formAlert(text) {
  qs('#form-alert-area').innerHTML = text ? `<div class="alert alert--danger">${esc(text)}</div>` : '';
}

qs('#rv-form').addEventListener('submit', async (evt) => {
  evt.preventDefault();
  formAlert('');
  if (!selected || !lastSim?.valid) {
    formAlert(lastSim?.message || 'Escolha uma mesa livre e a quantidade de pessoas.');
    return;
  }
  const name = qs('#name').value.trim();
  const phone = phoneInput.value.trim();
  const email = qs('#email').value.trim();
  if (!name || !phone || !email) {
    formAlert('Preencha nome, WhatsApp e e-mail.');
    return;
  }
  if (!qs('#accept_terms').checked) {
    formAlert('Para continuar, leia e aceite os termos do evento.');
    return;
  }

  const btn = qs('#submit-btn');
  setLoading(btn, true, 'Reservando...');
  const { data: result, error } = await supabase.rpc('rv_create_prebooking', {
    p_table_id: selected.id,
    p_adults: counts.adults,
    p_children: counts.children,
    p_infants: counts.infants,
    p_name: name,
    p_phone: phone,
    p_email: email,
    p_terms_id: data.terms?.id || null,
    p_accept_terms: true,
    p_marketing_opt_in: qs('#marketing_opt_in').checked,
    p_notes: qs('#notes').value.trim() || null,
    p_honeypot: qs('#website').value || null,
    p_attribution: reservationAttribution(),
  });
  setLoading(btn, false);

  if (error) {
    const { code, text } = parseDbError(error);
    formAlert(text);
    if (code === 'TABLE_TAKEN') {
      await refresh();
      closePanel();
      showToast(text, 'danger');
    }
    if (code === 'TERMS_OUTDATED') await refresh(true);
    return;
  }

  justBookedTableId = selected.id;
  trackPrebooking(result, { name, phone, email });
  saveBooking(result);
  showSuccess(result);
  refresh();
});

// A última pré-reserva fica salva no aparelho do cliente até o prazo do sinal:
// no celular, abrir o WhatsApp pode descartar a aba, e sem isto ele perderia
// o código e a chave Pix.
const BOOKING_KEY = 'sf_rv_last_booking';

function saveBooking(r) {
  try { window.localStorage.setItem(BOOKING_KEY, JSON.stringify(r)); } catch { /* storage bloqueado */ }
}

function loadBooking() {
  try {
    const r = JSON.parse(window.localStorage.getItem(BOOKING_KEY) || 'null');
    if (r && new Date(r.hold_expires_at) > new Date()) return r;
    window.localStorage.removeItem(BOOKING_KEY);
  } catch { /* storage bloqueado ou dado inválido */ }
  return null;
}

function showSuccess(r) {
  const e = data.event;
  const t = e.texts || {};
  const p = r.price;
  const tz = r.timezone || e.timezone;
  qs('#mesa').classList.add('hidden');
  qs('#sucesso').classList.remove('hidden');
  selected = null;

  setText('#success-title', t.success_title);
  setText('#success-code', r.public_code);
  setText('#success-note', fillTemplate(t.success_note, vars));

  const people = r.infants ? `${r.party_size} + ${r.infants} de colo` : String(r.party_size);
  const rows = [
    ['Mesa', `${r.table_type} ${r.table_label}`],
    ['Pessoas', people],
    ['Total', money(p.total)],
    [`No Pix (−${pct(r.pix_discount_pct)}%)`, money(p.total_pix)],
    ['Consumação inclusa', money(p.consumption_total)],
    [`Sinal (${pct(r.deposit_pct)}%)`, `${money(p.deposit_min_pix)} no Pix · ${money(p.deposit_min)} no cartão`],
    ['Prazo do sinal', dateTimeBR(r.hold_expires_at, tz)],
    ['Saldo até', dateBR(r.balance_due_date)],
  ];
  qs('#success-summary').innerHTML = rows.map(([k, v]) => `<li><span>${esc(k)}</span><strong>${esc(v)}</strong></li>`).join('');

  if (r.pix_key) {
    qs('#pix-box').classList.remove('hidden');
    qs('#no-pix').classList.add('hidden');
    setText('#pix-type', r.pix_key_type ? `(${String(r.pix_key_type).toUpperCase()})` : '');
    setText('#pix-key', formatPixKey(r.pix_key, r.pix_key_type));
    setText('#pix-holder', r.pix_holder || '');
    qs('#pix-copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(String(r.pix_key));
        showToast('Chave Pix copiada.');
      } catch {
        showToast('Não deu para copiar. Selecione a chave e copie manualmente.', 'danger');
      }
    };
  } else {
    qs('#pix-box').classList.add('hidden');
    qs('#no-pix').classList.remove('hidden');
    setText('#no-pix', fillTemplate(t.no_pix_message, vars));
  }

  setText('#success-deadline', `${fillTemplate(t.guarantee_note, vars)} Prazo: ${dateTimeBR(r.hold_expires_at, tz)}.`);
  const msg = fillTemplate(e.whatsapp_template, bookingMessageVars(r, e));
  qs('#success-whatsapp').href = waHref(r.whatsapp || e.whatsapp_number, msg);
  qs('#success-help').href = waHref(r.whatsapp || e.whatsapp_number,
    `Olá! Tenho uma dúvida sobre a minha pré-reserva ${r.public_code} do ${e.name}.`);
  setText('#my-booking-link', `Ver minha pré-reserva ${r.public_code}`);
  qs('#my-booking').classList.remove('hidden');
  qs('#sucesso').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Só rola até o mapa: a confirmação continua na página, logo abaixo.
qs('#success-back').addEventListener('click', () => {
  qs('#mapa').scrollIntoView({ behavior: 'smooth' });
});

// Conversões de Ads do réveillon: preparadas, mas só disparam se ligadas em
// rv_events.tracking (padrão: tudo desligado).
async function trackPrebooking(r, customer) {
  const tr = data.event.tracking || {};
  const value = Number(r.price?.total || 0);
  try {
    if (tr.ga4 && typeof window.gtag === 'function') {
      window.gtag('event', 'reveillon_prebooking', {
        currency: 'BRL', value, reservation_code: r.public_code, table_type: r.table_type,
      });
    }
    if (tr.meta && typeof window.fbq === 'function') {
      window.fbq('track', 'Lead', { currency: 'BRL', value, content_name: data.event.name },
        { eventID: `sf-rv-${r.id}` });
    }
    if (tr.openai_ads) {
      initOpenAIAdsPixel();
      if (typeof window.oaiq === 'function') {
        window.oaiq('measure', 'lead_submitted', {
          type: 'customer_action', amount: Math.round(value * 100), currency: 'BRL',
        }, { event_id: `sf-oai-rv-${r.id}` });
      }
    }
  } catch (err) {
    // medição nunca pode atrapalhar a reserva
    console.warn('tracking', err);
  }
  return customer;
}

// -------------------------------------------------------------------------
// Termos
// -------------------------------------------------------------------------
const dialog = qs('#terms-dialog');
qsa('.js-open-terms').forEach((a) => a.addEventListener('click', (evt) => {
  evt.preventDefault();
  if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
}));
qs('#terms-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (evt) => { if (evt.target === dialog) dialog.close(); });

// -------------------------------------------------------------------------
// Atualização automática: Realtime em rv_table_state; polling de 20s se o
// Realtime não conectar.
// -------------------------------------------------------------------------
async function refresh(full = false) {
  const prevSelected = selected;
  if (!(await load())) return;
  if (full) renderStatic();
  if (prevSelected) {
    const now = data.tables.find((t) => t.id === prevSelected.id);
    if (!now || now.state !== 'livre') {
      if (prevSelected.id !== justBookedTableId) {
        showToast(`A mesa ${prevSelected.label} acabou de ser reservada. Escolha outra.`, 'danger');
      }
      selected = null;
      qs('#mesa').classList.add('hidden');
    } else {
      selected = now;
    }
  }
  drawMap();
}
const refreshDebounced = debounce(() => refresh(), 400);

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => { if (!document.hidden) refresh(); }, 20000);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

function subscribe() {
  supabase
    .channel('rv-table-state')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rv_table_state' }, refreshDebounced)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') stopPolling();
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') startPolling();
    });
  startPolling(); // até o Realtime confirmar
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

async function init() {
  captureAttribution();
  if (!(await load())) return;
  renderStatic();
  drawMap();
  centerMapScroll(svg);
  initMapZoom();
  initStickyCta();
  const saved = loadBooking();
  if (saved) showSuccess(saved);
  subscribe();
}

init();
