// Módulo de Réveillon — helpers compartilhados entre a página pública
// (reveillon.html) e o painel (admin/reveillon.html).
// Nada de preço, prazo ou texto de negócio aqui: tudo vem do banco
// (rv_public_event / rv_staff_board). Este arquivo só formata e desenha.

const SVG_NS = 'http://www.w3.org/2000/svg';

export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function money(value) {
  const n = Number(value ?? 0);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function pct(value) {
  const n = Number(value ?? 0);
  return Number.isInteger(n) ? String(n) : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

// "2026-12-20" -> "20/12/2026" (data pura, sem fuso)
export function dateBR(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

// timestamptz -> "31/12 às 20:00" no fuso do evento
export function dateTimeBR(ts, timeZone = 'America/Fortaleza', { withYear = false } = {}) {
  if (!ts) return '';
  const d = new Date(ts);
  const date = d.toLocaleDateString('pt-BR', {
    timeZone, day: '2-digit', month: '2-digit', ...(withYear ? { year: 'numeric' } : {}),
  });
  const time = d.toLocaleTimeString('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' });
  return `${date} às ${time}`;
}

export function timeBR(ts, timeZone = 'America/Fortaleza') {
  return new Date(ts).toLocaleTimeString('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' });
}

export function longDateBR(ts, timeZone = 'America/Fortaleza') {
  return new Date(ts).toLocaleDateString('pt-BR', {
    timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

// Contagem regressiva curta (cabe dentro da mesa no mapa): "31h", "4h05", "45min", "vencido"
export function countdown(ts, now = Date.now()) {
  const ms = new Date(ts).getTime() - now;
  if (ms <= 0) return 'vencido';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 10) return `${h}h`;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`;
}

export function formatPixKey(key, type) {
  const k = String(key ?? '');
  const d = k.replace(/\D/g, '');
  if (type === 'cnpj' && d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (type === 'cpf' && d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return k;
}

// Troca marcadores {chave} num texto vindo do banco.
export function fillTemplate(text, vars) {
  return String(text ?? '').replace(/\{(\w+)\}/g, (all, key) => (
    Object.prototype.hasOwnProperty.call(vars, key) && vars[key] !== null && vars[key] !== undefined
      ? String(vars[key]) : all
  ));
}

// Marcadores dos textos públicos do evento.
export function eventTextVars(event) {
  return {
    pix_discount_pct: pct(event.pix_discount_pct),
    deposit_pct: pct(event.deposit_pct),
    hold_hours: String(event.hold_hours ?? ''),
    balance_due_date: dateBR(event.balance_due_date),
    child_discount: money(event.child_discount),
    child_max_age: String(event.child_max_age ?? ''),
  };
}

// Marcadores das mensagens de WhatsApp de uma reserva (payload de
// rv_booking_payload / rv_create_prebooking, ou booking do painel + price).
export function bookingMessageVars(b, event = {}) {
  const p = b.price || {};
  const tz = b.timezone || event.timezone || 'America/Fortaleza';
  const people = (b.party_size ?? (Number(b.adults || 0) + Number(b.children || 0)));
  const infants = Number(b.infants || 0);
  return {
    nome: String(b.name || b.customer_name || '').split(' ')[0] || '',
    nome_completo: String(b.name || b.customer_name || ''),
    codigo: b.public_code || '',
    mesa: b.table_label || '',
    tipo: b.table_type || '',
    pessoas: infants ? `${people} + ${infants} de colo` : String(people),
    evento: b.event_name || event.name || '',
    total: money(p.total),
    total_pix: money(p.total_pix),
    sinal: money(p.deposit_remaining ?? p.deposit_min),
    sinal_pix: money(p.deposit_remaining_pix ?? p.deposit_min_pix),
    saldo: money(p.balance),
    saldo_pix: money(p.balance_pix),
    consumacao: money(p.consumption_total),
    prazo: b.hold_expires_at ? dateTimeBR(b.hold_expires_at, tz) : '',
    data_saldo: dateBR(b.balance_due_date || event.balance_due_date),
    pix_chave: formatPixKey(b.pix_key || event.pix_key, b.pix_key_type || event.pix_key_type),
    endereco: b.address || event.address || '',
  };
}

export function waHref(number, message) {
  const digits = String(number ?? '').replace(/\D/g, '');
  if (!digits) return '#';
  return `https://wa.me/${digits}?text=${encodeURIComponent(message || '')}`;
}

// Mensagem de erro 'CODIGO: texto' vinda do banco -> { code, text }
export function parseDbError(error) {
  const raw = (error && error.message) || '';
  const i = raw.indexOf(':');
  const code = i > -1 ? raw.slice(0, i).trim() : raw.trim();
  const text = i > -1 ? raw.slice(i + 1).trim() : '';
  return { code, text: text || 'Não foi possível concluir agora. Tente novamente.' };
}

// -------------------------------------------------------------------------
// Mapa SVG
// -------------------------------------------------------------------------
// renderMap(svg, { map, types, tables, stateOf, selectedId, onSelect, badge })
//   stateOf(table)   -> string usada como classe CSS (livre, negociacao, ...)
//   badge(table)     -> texto opcional abaixo do rótulo (ex.: contagem regressiva)
//   onSelect(table)  -> toque/enter na mesa
// Devolve um mapa id -> <g> para quem precisar (ex.: modo editar mapa).
export function renderMap(svg, opts) {
  const { map = {}, types = [], tables = [], stateOf, selectedId, onSelect, badge } = opts;
  const vb = Array.isArray(map.viewBox) && map.viewBox.length === 4 ? map.viewBox : [0, 0, 1000, 1100];
  svg.setAttribute('viewBox', vb.join(' '));
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.textContent = '';

  const typeById = Object.fromEntries(types.map((t) => [t.id, t]));

  const defs = el('defs');
  defs.innerHTML = `
    <linearGradient id="rv-sea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0f6b6b"/><stop offset="1" stop-color="#3aa6a6"/>
    </linearGradient>
    <pattern id="rv-hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="12" height="12" fill="rgba(255,255,255,0)"/>
      <line x1="0" y1="0" x2="0" y2="12" stroke="rgba(255,255,255,.55)" stroke-width="6"/>
    </pattern>`;
  svg.appendChild(defs);

  const floor = el('rect', { x: vb[0], y: vb[1], width: vb[2], height: vb[3], class: 'rv-floor' });
  svg.appendChild(floor);

  for (const d of map.decor || []) {
    const g = el('g', { class: `rv-decor rv-decor--${d.kind}` });
    if (d.kind === 'label') {
      g.appendChild(el('text', { x: d.x, y: d.y, 'text-anchor': 'middle', class: 'rv-decor__label' }, d.label));
    } else {
      g.appendChild(el('rect', { x: d.x, y: d.y, width: d.w, height: d.h, rx: d.kind === 'dj' ? 14 : 0 }));
      if (d.kind === 'sea') {
        for (let i = 0; i < 3; i += 1) {
          const y = d.y + d.h * (0.35 + i * 0.2);
          let path = `M ${d.x} ${y}`;
          for (let x = d.x; x < d.x + d.w; x += 60) path += ` q 15 -10 30 0 t 30 0`;
          g.appendChild(el('path', { d: path, class: 'rv-wave' }));
        }
      }
      if (d.label && d.kind !== 'wall') {
        g.appendChild(el('text', {
          x: d.x + d.w / 2, y: d.y + d.h / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central',
          class: 'rv-decor__label',
        }, d.label));
      }
    }
    svg.appendChild(g);
  }

  const nodes = {};
  for (const t of tables) {
    const type = typeById[t.type_id] || {};
    const state = stateOf ? stateOf(t) : 'livre';
    const w = Number(t.w); const h = Number(t.h);
    const g = el('g', {
      class: `rv-table rv-table--${state}${t.id === selectedId ? ' is-selected' : ''}`,
      transform: `translate(${Number(t.x)} ${Number(t.y)}) rotate(${Number(t.rotation) || 0} ${w / 2} ${h / 2})`,
      tabindex: '0',
      role: 'button',
      'data-id': t.id,
      'aria-label': `${type.name || 'Mesa'} ${t.label}: ${stateLabel(state)}`,
      style: `--rv-type:${type.color || '#2f6f8f'}`,
    });
    const shape = t.shape === 'round'
      ? el('ellipse', { cx: w / 2, cy: h / 2, rx: w / 2, ry: h / 2, class: 'rv-table__shape' })
      : el('rect', { x: 0, y: 0, width: w, height: h, rx: 10, class: 'rv-table__shape' });
    g.appendChild(shape);
    if (state === 'negociacao' || state === 'pre_reserva') {
      g.appendChild(t.shape === 'round'
        ? el('ellipse', { cx: w / 2, cy: h / 2, rx: w / 2, ry: h / 2, class: 'rv-table__hatch' })
        : el('rect', { x: 0, y: 0, width: w, height: h, rx: 10, class: 'rv-table__hatch' }));
    }
    const extra = badge ? badge(t) : '';
    // O rótulo fica sempre na horizontal, mesmo com a mesa girada.
    const label = el('text', {
      x: w / 2, y: extra ? h / 2 - 8 : h / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central',
      class: 'rv-table__label', transform: `rotate(${-(Number(t.rotation) || 0)} ${w / 2} ${h / 2})`,
    }, t.label);
    g.appendChild(label);
    if (extra) {
      g.appendChild(el('text', {
        x: w / 2, y: h / 2 + 14, 'text-anchor': 'middle', 'dominant-baseline': 'central',
        class: 'rv-table__badge', transform: `rotate(${-(Number(t.rotation) || 0)} ${w / 2} ${h / 2})`,
      }, extra));
    }
    if (onSelect) {
      g.addEventListener('click', () => onSelect(t));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(t); }
      });
    }
    svg.appendChild(g);
    nodes[t.id] = g;
  }
  return nodes;
}

const STATE_LABELS = {
  livre: 'livre',
  negociacao: 'em negociação',
  reservada: 'reservada',
  bloqueada: 'bloqueada',
  pre_reserva: 'pré-reserva',
  sinal_pago: 'sinal pago',
  quitada: 'quitada',
  cancelada: 'cancelada',
  expirada: 'expirada',
};

export function stateLabel(state) {
  return STATE_LABELS[state] || state;
}

function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}
