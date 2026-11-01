// Safe installer for this function only. No secret values in argv, files or output.
// Default: plan. --apply is required for a Management API mutation.
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT = 'lucpxoynpvogkvzepagi';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = 'instagram-support';
const FILES = ['index.ts', 'core.mjs', 'policy.mjs', 'transport.mjs'];
const SAFE_GATES = Object.freeze({ INSTAGRAM_SUPPORT_MODE: 'off', INSTAGRAM_AI_DATA_APPROVED: 'false', INSTAGRAM_ALERTS_ENABLED: 'false' });
const OWNED_SECRETS = new Set(['INSTAGRAM_APP_SECRET', 'INSTAGRAM_VERIFY_TOKEN',
  'INSTAGRAM_PAGE_ACCESS_TOKEN', 'INSTAGRAM_DRAIN_SECRET', 'INSTAGRAM_TEST_SENDER_IDS',
  'GEMINI_API_KEY', ...Object.keys(SAFE_GATES)]);

function fail(code) { throw new Error(code); }
export function secretPlan(input, existing = [], replaceOwned = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('stdin_json_object_required');
  const entries = { ...input, ...SAFE_GATES };
  for (const [name, value] of Object.entries(input)) {
    if (!OWNED_SECRETS.has(name) || typeof value !== 'string' || !value || value.length > 20_000) fail('secret_not_allowed');
    if (Object.hasOwn(SAFE_GATES, name) && value !== SAFE_GATES[name]) fail('activation_not_supported');
  }
  const previous = new Set(existing);
  const updated = [], preserved = [];
  for (const [name, value] of Object.entries(entries)) {
    const gate = Object.hasOwn(SAFE_GATES, name);
    const replace = replaceOwned && name.startsWith('INSTAGRAM_');
    if (previous.has(name) && !gate && !replace) preserved.push(name);
    else updated.push({ name, value });
  }
  return { updated, preserved };
}

export async function bundle(root = ROOT) {
  const directory = await realpath(join(root, 'supabase/functions', SLUG));
  const metadata = { name: SLUG, entrypoint_path: 'index.ts', verify_jwt: false };
  const form = new FormData(); form.append('metadata', JSON.stringify(metadata));
  const manifest = [];
  for (const name of FILES) {
    const path = await realpath(join(directory, name));
    if (relative(directory, path).replaceAll('\\', '/') !== name) fail('source_path_outside_function');
    const bytes = await readFile(path);
    if (bytes.length > 250_000 || /(?:sb_secret_|sbp_|AIza)[a-zA-Z0-9_-]{24,}/.test(bytes.toString('utf8'))) fail('source_not_safe_to_upload');
    form.append('file', new Blob([bytes], { type: name.endsWith('.ts') ? 'application/typescript' : 'application/javascript' }), name);
    manifest.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return { form, metadata, manifest };
}

export async function managementToken(environment = process.env, root = ROOT) {
  if (environment.SUPABASE_ACCESS_TOKEN) return environment.SUPABASE_ACCESS_TOKEN;
  let text;
  try { text = await readFile(join(root, '.env.local'), 'utf8'); } catch { fail('management_credential_absent'); }
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (line.startsWith('SUPABASE_ACCESS_TOKEN=')) {
      const value = line.slice('SUPABASE_ACCESS_TOKEN='.length).trim().replace(/^['"]|['"]$/g, '');
      if (value) return value;
    }
  }
  fail('management_credential_absent');
}

export function managementClient(token, fetcher = fetch) {
  async function api(path, method = 'GET', body = null) {
    const options = { method, headers: { Authorization: 'Bearer ' + token },
      redirect: 'error', signal: AbortSignal.timeout(60_000) };
    if (body instanceof FormData) options.body = body;
    else if (body != null) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
    let response;
    try { response = await fetcher('https://api.supabase.com/v1/projects/' + PROJECT + path, options); }
    catch { fail('management_transport_failed'); }
    if (!response.ok) fail('management_http_' + response.status);
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > 1_000_000) fail('management_response_too_large');
    const text = await response.text();
    if (text.length > 1_000_000) fail('management_response_too_large');
    if (!text) return null;
    try { return JSON.parse(text); } catch { fail('management_response_invalid'); }
  }
  return {
    async verify() {
      const project = await api('');
      if ((project?.id ?? project?.ref) !== PROJECT || project?.name !== 'portal') fail('project_identity_mismatch');
      return true;
    },
    async secretNames() { const rows = await api('/secrets'); if (!Array.isArray(rows)) fail('secret_inventory_invalid'); return rows.map(row => row.name); },
    putSecrets: entries => api('/secrets', 'POST', entries),
    deploy: form => api('/functions/deploy?slug=' + SLUG, 'POST', form),
    getFunction: () => api('/functions/' + SLUG),
  };
}

async function readInput() {
  if (process.stdin.isTTY) fail('secrets_require_stdin');
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; if (input.length > 128_000) fail('stdin_too_large'); }
  try { return JSON.parse(input); } catch { fail('stdin_json_invalid'); }
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const [command = 'plan', ...flags] = argv;
  if (!['plan', 'deploy', 'secrets', 'inspect'].includes(command)
    || flags.some(flag => !['--apply', '--replace-owned'].includes(flag))) fail('arguments_invalid');
  const apply = flags.includes('--apply');
  const pack = await bundle(dependencies.root ?? ROOT);
  const output = dependencies.output ?? (data => console.log(JSON.stringify(data)));
  if (command === 'plan' || (!apply && command === 'deploy')) {
    output({ action: 'plan', project: PROJECT, function: SLUG, files: pack.manifest, install_mode: 'off' }); return;
  }
  const input = command === 'secrets' ? await (dependencies.readInput ?? readInput)() : {};
  // Validate stdin before any network; plan never prints values.
  secretPlan(input);
  if (command === 'secrets' && !apply) { output({ action: 'plan_secrets', names: Object.keys({ ...input, ...SAFE_GATES }), install_mode: 'off' }); return; }
  const client = dependencies.client ?? managementClient(await managementToken());
  await client.verify();
  const existing = await client.secretNames();
  if (command === 'inspect') {
    output({ action: 'inspect', project: PROJECT, owned_secret_names: existing.filter(name => OWNED_SECRETS.has(name)),
      existing_email_config: { api_key: existing.includes('RESEND_API_KEY'), from: existing.includes('RESEND_FROM') } }); return;
  }
  const planned = secretPlan(input, existing, flags.includes('--replace-owned'));
  await client.putSecrets(planned.updated);
  const after = await client.secretNames();
  if (planned.updated.some(row => !after.includes(row.name)) || existing.some(name => !after.includes(name))) fail('secret_readback_failed');
  if (command === 'secrets') { output({ action: 'secrets_updated', names: planned.updated.map(row => row.name), preserved_names: planned.preserved, install_mode: 'off' }); return; }
  const deployed = await client.deploy(pack.form);
  if (deployed?.slug !== SLUG) fail('deploy_identity_mismatch');
  const verified = await client.getFunction();
  if (verified?.slug !== SLUG || verified?.status !== 'ACTIVE' || verified?.verify_jwt !== false) fail('deploy_readback_failed');
  output({ action: 'deployed_off', project: PROJECT, function: SLUG, version: verified.version,
    status: verified.status, files: pack.manifest, other_secret_names_preserved: existing.length });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const code = /^[a-z0-9_]+$/.test(error?.message ?? '') ? error.message : 'operation_failed';
    console.error(JSON.stringify({ error: code })); process.exitCode = 1;
  });
}
