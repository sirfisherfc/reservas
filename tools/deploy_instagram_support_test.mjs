import test from 'node:test';
import assert from 'node:assert/strict';
import { bundle, main, managementClient, managementToken, PROJECT, secretPlan } from './deploy_instagram_support.mjs';

test('multifile package contains only four reviewed sources and explicit webhook metadata', async () => {
  const pack = await bundle();
  assert.deepEqual(pack.form.getAll('file').map(file => file.name), ['index.ts', 'core.mjs', 'policy.mjs', 'transport.mjs']);
  assert.deepEqual(JSON.parse(pack.form.get('metadata')), { name: 'instagram-support', entrypoint_path: 'index.ts', verify_jwt: false });
  assert.equal(pack.manifest.length, 4); assert.ok(pack.manifest.every(file => /^[a-f0-9]{64}$/.test(file.sha256)));
});

test('deploy defaults to an offline plan and never reads credentials or calls management', async () => {
  const output = [];
  await main(['deploy'], { output: item => output.push(item), client: { verify() { throw new Error('network must not run'); } } });
  assert.equal(output[0].action, 'plan'); assert.equal(output[0].install_mode, 'off');
  assert.equal(output[0].project, PROJECT);
});

test('secret plan preserves existing provider/email settings and never permits activation', () => {
  const planned = secretPlan({ GEMINI_API_KEY: 'synthetic-candidate', INSTAGRAM_APP_SECRET: 'synthetic-app-secret' }, ['GEMINI_API_KEY', 'RESEND_API_KEY', 'RESEND_FROM']);
  assert.deepEqual(planned.preserved, ['GEMINI_API_KEY']);
  assert.equal(planned.updated.some(row => row.name.startsWith('RESEND')), false);
  assert.equal(planned.updated.find(row => row.name === 'INSTAGRAM_SUPPORT_MODE').value, 'off');
  assert.throws(() => secretPlan({ SUPABASE_SERVICE_ROLE_KEY: 'synthetic' }), /secret_not_allowed/);
  assert.throws(() => secretPlan({ INSTAGRAM_SUPPORT_MODE: 'live' }), /activation_not_supported/);
  assert.throws(() => secretPlan({ INSTAGRAM_AI_DATA_APPROVED: 'true' }), /activation_not_supported/);
  for (const name of ['INSTAGRAM_PUBLIC_DATA_APPROVED', 'INSTAGRAM_PUBLIC_DELIVERY_VERIFIED']) {
    assert.equal(planned.updated.find(row => row.name === name).value, 'false');
    assert.throws(() => secretPlan({ [name]: 'true' }), /activation_not_supported/);
  }
});

test('secret dry run uses stdin object and prints names only', async () => {
  const output = [];
  await main(['secrets'], { readInput: async () => ({ INSTAGRAM_APP_SECRET: 'SYNTHETIC_VALUE_MUST_NOT_BE_PRINTED' }), output: item => output.push(item) });
  assert.ok(output[0].names.includes('INSTAGRAM_APP_SECRET'));
  assert.equal(JSON.stringify(output).includes('SYNTHETIC_VALUE'), false);
});

test('deployment forces off gates first, preserves all unrelated names and verifies remote metadata', async () => {
  const order = []; const names = ['RESEND_API_KEY', 'RESEND_FROM', 'UNRELATED_SERVICE_SETTING'];
  const output = [];
  const client = {
    async verify() { order.push('verify'); },
    async secretNames() { order.push('inventory'); return [...names]; },
    async putSecrets(rows) { order.push('put-off-gates'); assert.ok(rows.every(row => row.name.startsWith('INSTAGRAM_'))); for (const row of rows) if (!names.includes(row.name)) names.push(row.name); },
    async verifySecrets() { order.push('verify-off-gates'); return true; },
    async deploy(form) { order.push('deploy'); assert.equal(form.getAll('file').length, 4); return { slug: 'instagram-support' }; },
    async getFunction() { order.push('readback'); return { slug: 'instagram-support', status: 'ACTIVE', verify_jwt: false, version: 1 }; },
  };
  await main(['deploy', '--apply'], { client, output: item => output.push(item) });
  assert.deepEqual(order, ['verify', 'inventory', 'put-off-gates', 'inventory', 'verify-off-gates', 'deploy', 'readback']);
  assert.equal(output[0].action, 'deployed_off'); assert.ok(names.includes('UNRELATED_SERVICE_SETTING'));
});

test('Management API rejects the wrong project and does not expose response body', async () => {
  const wrong = managementClient('synthetic-pat', async () => new Response(JSON.stringify({ id: 'wrong-project', name: 'portal' })));
  await assert.rejects(() => wrong.verify(), /project_identity_mismatch/);
  const denied = managementClient('synthetic-pat', async () => new Response('SYNTHETIC_PRIVATE_RESPONSE', { status: 403 }));
  await assert.rejects(() => denied.verify(), error => error.message === 'management_http_403');
});

test('management token environment has precedence without echo or filesystem writes', async () => {
  assert.equal(await managementToken({ SUPABASE_ACCESS_TOKEN: 'synthetic-private-token' }), 'synthetic-private-token');
});

test('secret readback supports the Management API value field containing a SHA256 digest', async () => {
  const { createHash } = await import('node:crypto');
  const client = managementClient('synthetic-pat', async () => new Response(JSON.stringify([
    { name: 'INSTAGRAM_SUPPORT_MODE', value: createHash('sha256').update('off').digest('hex') },
  ])));
  assert.equal(await client.verifySecrets([{ name: 'INSTAGRAM_SUPPORT_MODE', value: 'off' }]), true);
  assert.equal(await client.verifySecrets([{ name: 'INSTAGRAM_SUPPORT_MODE', value: 'live' }]), false);
});
