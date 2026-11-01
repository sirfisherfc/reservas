import test from 'node:test';
import assert from 'node:assert/strict';
import { activationPlan, activationServices, main, queries } from './activate_instagram_support_test.mjs';

const SENDER = '200000000000001';
const INPUT = { INSTAGRAM_TEST_SENDER_IDS: SENDER, INSTAGRAM_PAGE_ACCESS_TOKEN: 'synthetic-canonical-page-token',
  INSTAGRAM_TEST_USERNAME: 'owner_test', INSTAGRAM_DRAIN_SECRET: 'synthetic-worker-secret-for-test-only-000' };
const NAMES = ['INSTAGRAM_APP_SECRET', 'INSTAGRAM_VERIFY_TOKEN', 'INSTAGRAM_PAGE_ACCESS_TOKEN',
  'INSTAGRAM_DRAIN_SECRET', 'GEMINI_API_KEY', 'META_ANALYTICS_UNRELATED', 'RESEND_API_KEY'];

function fixture(failAt = null) {
  const order = [], changes = [], output = [];
  const sql = queries(SENDER);
  const client = {
    async verify() { order.push('project'); },
    async secretNames() { return [...NAMES]; },
    async getFunction() { return { slug: 'instagram-support', status: 'ACTIVE', verify_jwt: false, version: 6 }; },
    async verifySecrets(entries) {
      order.push(entries.some(row => row.value === 'test') ? 'verify-test' : 'verify-off');
      return true;
    },
    async putSecrets(entries) { changes.push(entries); order.push(entries.some(row => row.value === 'test') ? 'runtime-test' : 'runtime-off'); },
  };
  return { order, changes, output, dependencies: { readInput: async () => INPUT, output: item => output.push(item), services: {
    client,
    async verifyUsername() { order.push('profile'); return failAt !== 'profile'; },
    async health() { order.push('health'); if (failAt === 'health_transport') throw new Error('SYNTHETIC_PRIVATE_ERROR');
      return { runtime_mode: 'test', effective_mode: 'test', paused: false, ai_data_approved: failAt !== 'health',
      alerts_enabled: false, runtime_test_senders: 1, database_test_senders: 1, matched_test_senders: 1 }; },
    async query(query, readOnly = true) {
      if (query === sql.preflight) { order.push('preflight'); assert.equal(readOnly, true);
        return [{ off_ready: failAt !== 'preflight', signed_inbound_known: true, idle: true, notice_schema_ready: true }]; }
      if (query === sql.activate) { order.push('database-test'); assert.equal(readOnly, false);
        if (failAt === 'database') throw new Error('SYNTHETIC_PRIVATE_ERROR'); return [{ test_ready: true }]; }
      if (query === sql.readback) { order.push('readback'); return [{ test_ready: failAt !== 'readback', sender_count: 1, bootstrap_pending: 0 }]; }
      if (query === sql.rollback) { order.push('database-off'); assert.equal(readOnly, false); return [{ off_ready: true }]; }
      throw new Error('unexpected query');
    },
  } } };
}

test('default plan reads no credentials and performs no network or mutation', async () => {
  const output = [];
  await main([], { output: row => output.push(row), readInput: () => { throw new Error('must not read'); } });
  assert.equal(output[0].action, 'plan'); assert.equal(output[0].mode, 'test'); assert.equal(output[0].live_supported, false);
  for (const argv of [['live'], ['--apply', SENDER], ['--apply', '--check']]) await assert.rejects(() => main(argv), /arguments_invalid/);
});

test('strict one-sender plan owns only four test flags and leaves provider credentials intact', () => {
  for (const sender of ['', SENDER + ',200000000000002', '12345;select1', '107690041045934'])
    assert.throws(() => activationPlan({ ...INPUT, INSTAGRAM_TEST_SENDER_IDS: sender }), /exactly_one/);
  const plan = activationPlan(INPUT);
  assert.deepEqual(plan.secrets.map(row => row.name).sort(), ['INSTAGRAM_AI_DATA_APPROVED', 'INSTAGRAM_ALERTS_ENABLED', 'INSTAGRAM_SUPPORT_MODE', 'INSTAGRAM_TEST_SENDER_IDS']);
  assert.equal(plan.secrets.some(row => /TOKEN|KEY|SECRET/.test(row.name)), false);
});

test('read-only check verifies canonical off state and exact owner before reporting readiness', async () => {
  const data = fixture(); await main(['--check'], data.dependencies);
  assert.equal(data.changes.length, 0); assert.deepEqual(data.order, ['project', 'verify-off', 'preflight', 'profile']);
  assert.deepEqual(data.output[0], { action: 'checked_off', ready: true, matched: true, sender_count: 1 });
  assert.equal(JSON.stringify(data.output).includes(SENDER), false);
});

test('owner mismatch or changed off settings prevent every mutation', async () => {
  for (const cause of ['profile', 'preflight']) {
    const data = fixture(cause);
    await assert.rejects(() => main(['--apply'], data.dependencies), /mismatch|preflight/);
    assert.equal(data.changes.length, 0); assert.equal(data.order.includes('database-test'), false);
  }
});

test('apply sets runtime test while DB is off, commits DB last and prints booleans/counts only', async () => {
  const data = fixture(); await main(['--apply'], data.dependencies);
  assert.deepEqual(data.order, ['project', 'verify-off', 'preflight', 'profile', 'runtime-test', 'verify-test', 'database-test', 'readback', 'health']);
  assert.equal(data.output[0].action, 'restricted_test_ready'); assert.equal(data.output[0].fresh_message_required, true);
  assert.equal(data.changes.length, 1); assert.equal(JSON.stringify(data.output).includes(INPUT.INSTAGRAM_PAGE_ACCESS_TOKEN), false);
  assert.equal(JSON.stringify(data.output).includes(SENDER), false);
});

test('partial failure closes DB first then runtime and conceals provider error bodies', async () => {
  for (const cause of ['database', 'readback', 'health', 'health_transport']) {
    const data = fixture(cause);
    await assert.rejects(() => main(['--apply'], data.dependencies), error => error.message === 'activation_failed_restored_off');
    assert.deepEqual(data.order.slice(-3), ['database-off', 'runtime-off', 'verify-off']);
    assert.equal(data.changes.at(-1).find(row => row.name === 'INSTAGRAM_SUPPORT_MODE').value, 'off');
  }
});

test('activation SQL guards exact assets/OFF and discards bootstrap before enabling a fresh test only', () => {
  const sql = queries(SENDER);
  assert.match(sql.activate, /for update/); assert.match(sql.activate, /activation_guard_failed/);
  assert.match(sql.activate, /test_activation_requires_new_message/);
  assert.ok(sql.activate.indexOf('test_activation_requires_new_message') < sql.activate.indexOf("mode='test'"));
  assert.match(sql.activate, /pricing_valid_until=now\(\)\+interval '30 days'/);
  assert.match(sql.activate, /manager_auth_user_id=null/); assert.match(sql.activate, /cron_enabled=false/);
  assert.doesNotMatch(sql.activate, /mode='live'|app_users|delete from|resend|http_post/i);
});

test('profile read sends only username with header auth and never sends Meta POST', async () => {
  const calls = [];
  const services = activationServices('synthetic-management-token', async (url, options) => {
    calls.push({ url, options }); return Response.json({ username: 'owner_test' });
  });
  assert.equal(await services.verifyUsername(SENDER, INPUT.INSTAGRAM_PAGE_ACCESS_TOKEN, INPUT.INSTAGRAM_TEST_USERNAME), true);
  const call = calls[0]; assert.equal(new URL(call.url).search, '?fields=username');
  assert.equal(call.options.method, undefined); assert.equal(call.options.headers.Authorization, 'Bearer ' + INPUT.INSTAGRAM_PAGE_ACCESS_TOKEN);
  assert.equal(call.url.includes(INPUT.INSTAGRAM_PAGE_ACCESS_TOKEN), false);
});
