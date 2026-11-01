// Controlled owner test only. Default is an offline plan; no live/customer mode.
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { managementClient, managementToken, PROJECT } from './deploy_instagram_support.mjs';
import { ASSETS, MODEL, LIMITS } from '../supabase/functions/instagram-support/policy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OFF = Object.freeze({ INSTAGRAM_SUPPORT_MODE: 'off', INSTAGRAM_AI_DATA_APPROVED: 'false', INSTAGRAM_ALERTS_ENABLED: 'false' });
const ENTRIES = object => Object.entries(object).map(([name, value]) => ({ name, value }));
function fail(code) { throw new Error(code); }

export function activationPlan(input) {
  const sender = input?.INSTAGRAM_TEST_SENDER_IDS;
  if (!/^[0-9]{5,30}$/.test(sender ?? '') || [ASSETS.pageId, ASSETS.instagramId].includes(sender)) fail('exactly_one_private_sender_required');
  if (typeof input.INSTAGRAM_PAGE_ACCESS_TOKEN !== 'string' || input.INSTAGRAM_PAGE_ACCESS_TOKEN.length < 20) fail('canonical_page_token_required');
  if (!/^[A-Za-z0-9._]{1,30}$/.test(input.INSTAGRAM_TEST_USERNAME ?? '')) fail('private_expected_username_required');
  if (typeof input.INSTAGRAM_DRAIN_SECRET !== 'string' || input.INSTAGRAM_DRAIN_SECRET.length < 32) fail('private_worker_secret_required');
  return { sender, expectedUsername: input.INSTAGRAM_TEST_USERNAME.toLowerCase(), secrets: ENTRIES({ INSTAGRAM_SUPPORT_MODE: 'test', INSTAGRAM_AI_DATA_APPROVED: 'true',
    INSTAGRAM_ALERTS_ENABLED: 'false', INSTAGRAM_TEST_SENDER_IDS: sender }) };
}

export async function privateInput(root = ROOT, environment = process.env) {
  const input = {};
  const allowed = new Set(['INSTAGRAM_TEST_SENDER_IDS', 'INSTAGRAM_TEST_USERNAME', 'INSTAGRAM_PAGE_ACCESS_TOKEN', 'INSTAGRAM_DRAIN_SECRET']);
  let content;
  try { content = await readFile(join(root, '.env.local'), 'utf8'); } catch { fail('private_config_absent'); }
  for (const line of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const split = line.indexOf('=');
    const key = line.slice(0, split);
    if (split > 0 && allowed.has(key)) input[key] = line.slice(split + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  for (const key of allowed) if (environment[key]) input[key] = environment[key];
  return input;
}

// IDs enter these statements only after strict numeric validation. Nothing prints SQL.
export function queries(sender) {
  if (!/^[0-9]{5,30}$/.test(sender ?? '')) fail('private_sender_invalid');
  const guards = `mode='off' and paused and not model_usage_allowed and not billing_verified
    and not alerts_enabled and manager_auth_user_id is null and not cron_enabled
    and app_id='${ASSETS.appId}' and page_id='${ASSETS.pageId}' and ig_user_id='${ASSETS.instagramId}'
    and model='${MODEL}' and max_input_tokens=${LIMITS.inputTokens} and max_output_tokens=${LIMITS.outputTokens}
    and monthly_budget_cents=4500 and monthly_generation_limit=2000 and request_reserve_cents=2
    and global_per_minute=10 and thread_per_ten_minutes=3`;
  const source = `exists(select 1 from instagram_support.events e join instagram_support.threads t on t.id=e.thread_id
    where t.sender_id='${sender}' and e.kind='incoming' and e.mode_at_ingest='off' and e.text=''
      and e.received_at>=now()-interval '24 hours')`;
  const idle = `not exists(select 1 from instagram_support.outbox where status='sending')
    and not exists(select 1 from instagram_support.budget_reservations where status='reserved')
    and not exists(select 1 from instagram_support.threads where sender_id='${sender}' and (human_paused or lease_until>now()))
    and not exists(select 1 from instagram_support.outbox o join instagram_support.threads t on t.id=o.thread_id
      where t.sender_id='${sender}' and o.status='uncertain')
    and not exists(select 1 from instagram_support.events e join instagram_support.threads t on t.id=e.thread_id
      where t.sender_id='${sender}' and e.lease_until>now() and e.status in ('processing','completed','sending'))`;
  const schema = `exists(select 1 from information_schema.columns where table_schema='instagram_support'
    and table_name='cases' and column_name='handoff_notice_event_id')`;
  return {
    preflight: `select (${guards}) as off_ready, (${source}) as signed_inbound_known,
      (${idle}) as idle, (${schema}) as notice_schema_ready from instagram_support.settings where singleton;`,
    activate: `begin; set local lock_timeout='2s';
      do $activation$ begin
        perform 1 from instagram_support.settings where singleton for update;
        if not exists(select 1 from instagram_support.settings where singleton and (${guards}))
          or not (${source}) or not (${idle}) or not (${schema}) then
          raise exception 'activation_guard_failed'; end if;
        -- Bootstrap messages remain terminal; only a fresh TEST inbound can reply.
        update instagram_support.events e set status='superseded',text='',allow_handoff_ack=false,
          lease=null,worker=null,lease_until=null,reason='test_activation_requires_new_message',updated_at=now()
          from instagram_support.threads t where e.thread_id=t.id and t.sender_id='${sender}'
            and e.status in ('pending','processing','completed');
        update instagram_support.threads set version=version+1,lease=null,worker=null,lease_until=null
          where sender_id='${sender}';
        update instagram_support.settings set mode='test',paused=false,test_sender_ids=array['${sender}'],
          model_usage_allowed=true,billing_verified=true,pricing_valid_until=now()+interval '30 days',
          monthly_budget_cents=4500,monthly_generation_limit=2000,request_reserve_cents=2,
          global_per_minute=10,thread_per_ten_minutes=3,manager_auth_user_id=null,
          alerts_enabled=false,alerts_activation_after=null,cron_enabled=false,updated_at=now() where singleton;
      end $activation$; commit;
      select mode='test' and not paused and test_sender_ids=array['${sender}'] as test_ready from instagram_support.settings where singleton;`,
    readback: `select mode='test' and not paused and test_sender_ids=array['${sender}'] and model_usage_allowed
      and billing_verified and pricing_valid_until>now() and pricing_valid_until<=now()+interval '30 days'
      and monthly_budget_cents=4500 and monthly_generation_limit=2000 and request_reserve_cents=2
      and thread_per_ten_minutes=3 and global_per_minute=10 and not alerts_enabled
      and manager_auth_user_id is null and not cron_enabled as test_ready,
      cardinality(test_sender_ids) as sender_count,
      (select count(*)::int from instagram_support.events where status in ('pending','processing','completed') and mode_at_ingest='off') as bootstrap_pending
      from instagram_support.settings where singleton;`,
    rollback: `begin; set local lock_timeout='2s';
      update instagram_support.settings set mode='off',paused=true,model_usage_allowed=false,billing_verified=false,
        manager_auth_user_id=null,alerts_enabled=false,alerts_activation_after=null,cron_enabled=false,updated_at=now() where singleton;
      update instagram_support.events set status='superseded',text='',allow_handoff_ack=false,
        lease=null,worker=null,lease_until=null,reason='test_activation_rollback',updated_at=now()
        where status in ('pending','processing','completed') and not exists(select 1 from instagram_support.outbox o where o.event_id=instagram_support.events.id);
      commit; select mode='off' and paused and not model_usage_allowed and not billing_verified as off_ready from instagram_support.settings where singleton;`,
  };
}

export function activationServices(token, fetcher = fetch) {
  const client = managementClient(token, fetcher);
  async function request(url, options) {
    let response;
    try { response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15_000) }); }
    catch { fail('activation_transport_failed'); }
    if (!response.ok) fail('activation_http_' + response.status);
    const content = await response.text();
    if (content.length > 20_000) fail('activation_response_too_large');
    try { return JSON.parse(content); } catch { fail('activation_response_invalid'); }
  }
  return { client,
    query: (query, readOnly = true) => request('https://api.supabase.com/v1/projects/' + PROJECT + '/database/query' + (readOnly ? '/read-only' : ''),
      { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) }),
    async verifyUsername(sender, pageToken, expectedUsername) {
      if (!/^[0-9]{5,30}$/.test(sender ?? '')) fail('private_sender_invalid');
      if (!/^[A-Za-z0-9._]{1,30}$/.test(expectedUsername ?? '')) fail('private_expected_username_required');
      const data = await request('https://graph.facebook.com/v26.0/' + sender + '?fields=username',
        { headers: { Authorization: 'Bearer ' + pageToken } });
      return typeof data?.username === 'string' && /^[A-Za-z0-9._]{1,30}$/.test(data.username)
        && data.username.toLowerCase() === expectedUsername.toLowerCase();
    },
    health: workerSecret => request('https://' + ASSETS.projectHost + '/functions/v1/instagram-support/health',
      { headers: { 'x-instagram-drain-secret': workerSecret } }),
  };
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  if (argv.length > 1 || argv.some(flag => !['--check', '--apply'].includes(flag))) fail('arguments_invalid');
  const output = dependencies.output ?? (value => console.log(JSON.stringify(value)));
  if (argv.length === 0) {
    output({ action: 'plan', mode: 'test', sender_count: 1, monthly_cap_brl: 45, cron: false, alerts: false,
      bootstrap: 'discard', fresh_message_required: true, live_supported: false }); return;
  }
  const input = await (dependencies.readInput ?? privateInput)();
  const plan = activationPlan(input); const sql = queries(plan.sender);
  const services = dependencies.services ?? activationServices(await managementToken());
  const { client, query, verifyUsername, health } = services;
  await client.verify();
  const names = await client.secretNames();
  const required = ['INSTAGRAM_APP_SECRET', 'INSTAGRAM_VERIFY_TOKEN', 'INSTAGRAM_PAGE_ACCESS_TOKEN', 'INSTAGRAM_DRAIN_SECRET', 'GEMINI_API_KEY'];
  if (!required.every(name => names.includes(name))) fail('required_cloud_secret_absent');
  const fn = await client.getFunction();
  if (fn?.slug !== 'instagram-support' || fn.status !== 'ACTIVE' || fn.verify_jwt !== false
    || !Number.isInteger(fn.version) || fn.version < 6) fail('function_not_ready');
  if (!await client.verifySecrets([...ENTRIES(OFF), { name: 'INSTAGRAM_PAGE_ACCESS_TOKEN', value: input.INSTAGRAM_PAGE_ACCESS_TOKEN },
    { name: 'INSTAGRAM_DRAIN_SECRET', value: input.INSTAGRAM_DRAIN_SECRET }])) fail('canonical_off_secrets_mismatch');
  const before = (await query(sql.preflight))?.[0];
  if (!before?.off_ready || !before.signed_inbound_known || !before.idle || !before.notice_schema_ready) fail('database_preflight_failed');
  if (!await verifyUsername(plan.sender, input.INSTAGRAM_PAGE_ACCESS_TOKEN, plan.expectedUsername)) fail('owner_username_mismatch');
  if (argv[0] === '--check') { output({ action: 'checked_off', ready: true, matched: true, sender_count: 1 }); return; }
  // User approved this single owner test with Paid Gemini; no customer expansion.
  // Runtime TEST first while Postgres remains OFF; Postgres switches atomically last.
  let changed = false;
  try {
    changed = true;
    await client.putSecrets(plan.secrets);
    if (!await client.verifySecrets(plan.secrets)) fail('runtime_test_readback_failed');
    const afterNames = await client.secretNames();
    if (names.some(name => !afterNames.includes(name))) fail('unrelated_secret_missing');
    if ((await query(sql.activate, false))?.[0]?.test_ready !== true) fail('database_activation_failed');
    const after = (await query(sql.readback))?.[0];
    if (!after?.test_ready || after.sender_count !== 1 || after.bootstrap_pending !== 0) fail('database_test_readback_failed');
    const runtime = await health(input.INSTAGRAM_DRAIN_SECRET);
    if (runtime?.runtime_mode !== 'test' || runtime.effective_mode !== 'test' || runtime.paused !== false || runtime.ai_data_approved !== true
      || runtime.alerts_enabled !== false || runtime.runtime_test_senders !== 1 || runtime.database_test_senders !== 1
      || runtime.matched_test_senders !== 1) fail('runtime_health_readback_failed');
    output({ action: 'restricted_test_ready', matched: true, sender_count: 1, bootstrap_pending: 0,
      runtime_verified: true, database_verified: true, cron: false, alerts: false, fresh_message_required: true });
  } catch {
    let off = false;
    if (changed) {
      try { off = (await query(sql.rollback, false))?.[0]?.off_ready === true; } catch { /* runtime gate below also closes */ }
      try { await client.putSecrets(ENTRIES(OFF)); off = await client.verifySecrets(ENTRIES(OFF)) && off; } catch { off = false; }
    }
    fail(off ? 'activation_failed_restored_off' : 'activation_failed_check_off_required');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { const code = /^[a-z0-9_]+$/.test(error?.message ?? '') ? error.message : 'activation_failed';
    console.error(JSON.stringify({ error: code })); process.exitCode = 1; });
}
