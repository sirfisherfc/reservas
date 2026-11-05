// Exercise the actual controller with a small DOM adapter; no network or real redemption.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as helpers from '../assets/js/benefit-vouchers.mjs';

const html = await readFile(new URL('../admin/vouchers.html', import.meta.url), 'utf8');
const controller = (await readFile(new URL('../assets/js/adminVouchers.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?from '[^']+';\r?\n/gm, '')
  .replace('\ninit().catch(', '\nglobalThis.ready = init().catch(');
const base = { id: '11111111-1111-4111-8111-111111111111', code: 'A1B2C3', revision: 3,
  beneficiary_name: 'Cliente de teste', benefit_type: 'fixed', benefit_value: 100,
  expires_on: '2026-11-03', conditions: ['Uso único.'], status: 'expired' };

async function mount(results, redeem = { ok: false, reason: 'expired' }) {
  const calls = [], alerts = [], nodes = new Map();
  let active = null;
  class Element {
    constructor() { this.hidden = false; this.open = false; this.checked = false; this.children = []; this.events = new Map(); this.classes = new Set();
      this.classList = { toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) }; }
    addEventListener(name, fn) { this.events.set(name, fn); }
    setAttribute(name, value) { this[name] = value; }
    replaceChildren(...items) { this.children = items; }
    appendChild(item) { this.children.push(item); }
    append(...items) { this.children.push(...items); }
    focus() { active = this; }
    showModal() { this.open = true; }
    close() { this.open = false; this.events.get('close')?.(); }
    click() { this.events.get('click')?.({ preventDefault() {} }); }
  }
  for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) nodes.set(id, new Element());
  const context = { ...helpers, document: { getElementById: id => { assert.ok(nodes.has(id), `Missing DOM target ${id}`); return nodes.get(id); }, createElement: () => new Element() },
    window: { alert: message => alerts.push(message) }, requireStaff: async () => ({ role: 'operator' }), mountLayout: async () => {},
    supabase: { rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'benefit_voucher_recent') return { data: { ok: true, items: [], total: 0 } };
      if (name === 'benefit_voucher_redeem') return { data: redeem };
      assert.equal(name, 'benefit_voucher_lookup');
      const response = results.shift();
      if (response instanceof Error) throw response;
      assert.ok(response, 'Unexpected lookup'); return { data: { ok: true, voucher: { ...base, ...response } } };
    } } };
  vm.runInNewContext(controller + '\nglobalThis.ui = { lookup, confirmUse };', context);
  await context.ready;
  nodes.get('voucher-code').value = base.code;
  return { ...context, nodes, calls, alerts, active: () => active };
}

test('consulta vencida abre alerta com orientação e mantém a utilização bloqueada', async () => {
  const app = await mount([{}]); await app.ui.lookup();
  assert.equal(app.nodes.get('voucher-expired-dialog').open, true);
  assert.match(app.nodes.get('voucher-expired-details').textContent, /A1B2C3.*03\/11\/2026/);
  assert.match(app.nodes.get('voucher-status-description').textContent, /Consulte o emissor/);
  assert.equal(app.nodes.get('voucher-actions').hidden, true);
  assert.equal(app.nodes.get('voucher-use-button').hidden, true);
  assert.equal(app.calls.filter(c => c.name === 'benefit_voucher_redeem').length, 0);
  assert.equal(app.nodes.has('voucher-unit'), false); assert.equal(app.nodes.has('voucher-refresh-button'), false);
  app.nodes.get('voucher-expired-close').click();
  assert.equal(app.nodes.get('voucher-expired-dialog').open, false);
  assert.equal(app.active(), app.nodes.get('voucher-code'));
});

test('nova consulta disponível remove o destaque de vencimento e não abre alerta', async () => {
  const app = await mount([{}, { status: 'available', expires_on: '2099-12-31' }]);
  await app.ui.lookup(); app.nodes.get('voucher-expired-close').click(); await app.ui.lookup();
  assert.equal(app.nodes.get('voucher-expired-dialog').open, false);
  assert.equal(app.nodes.get('voucher-result').classes.has('voucher-result--expired'), false);
  assert.equal(app.nodes.get('voucher-actions').hidden, false);
});

for (const refresh of [{}, new Error('offline')]) test(`recusa por vencimento abre alerta mesmo com reconsulta ${refresh instanceof Error ? 'indisponível' : 'disponível'}`, async () => {
  const app = await mount([{ status: 'available', expires_on: '2026-11-03' }, refresh]);
  await app.ui.lookup(); app.nodes.get('voucher-use-button').click();
  app.nodes.get('voucher-confirm-check').checked = true;
  await app.ui.confirmUse({ preventDefault() {} });
  assert.equal(app.nodes.get('voucher-expired-dialog').open, true);
  assert.match(app.nodes.get('voucher-feedback').textContent, /Consulte o emissor/);
  assert.equal(app.calls.filter(c => c.name === 'benefit_voucher_redeem').length, 1);
  assert.equal(app.nodes.get('voucher-result').hidden || app.nodes.get('voucher-use-button').hidden, true);
});

test('sem dialog nativo, alerta do navegador e destaque persistente informam o vencimento', async () => {
  const app = await mount([{}]); app.nodes.get('voucher-expired-dialog').showModal = undefined;
  await app.ui.lookup(); assert.equal(app.alerts.length, 1);
  assert.match(app.alerts[0], /Consulte o emissor/);
  assert.equal(app.nodes.get('voucher-result').classes.has('voucher-result--expired'), true);
});
