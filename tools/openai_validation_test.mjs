const path = new URL('../supabase/functions/send-openai-ads-conversions/index.ts', import.meta.url);
const helper = new URL('../supabase/functions/send-openai-ads-conversions/openai-event.ts', import.meta.url).href;
const source = (await Deno.readTextFile(path))
  .replace('import { createClient } from "https://esm.sh/@supabase/supabase-js@2";',
    'const createClient = () => globalThis.__adsTest.client;')
  .replace('"./openai-event.ts"', JSON.stringify(helper));

Deno.test('validacao autenticada envia somente validate_only sem reivindicar fila ou expor segredos', async () => {
  const original = { serve: Deno.serve, envGet: Deno.env.get, fetch: globalThis.fetch };
  const calls = [];
  let handler;
  globalThis.__adsTest = { client: { rpc() { throw new Error('Validation claimed a production queue'); } } };
  try {
    Deno.env.get = (key) => key === 'OPENAI_ADS_TRIGGER_SECRET' ? 'test-trigger'
      : key === 'SUPABASE_URL' ? 'https://example.invalid' : 'test-configuration';
    Deno.serve = (callback) => { handler = callback; };
    globalThis.fetch = async (url, options) => { calls.push(JSON.parse(options.body)); return new Response('{}', { status: 200 }); };
    await import('data:application/typescript;base64,' + btoa(unescape(encodeURIComponent(source))));
    const unauthorized = await handler(new Request('https://example.invalid', { method: 'POST', body: '{"validate_only":true}' }));
    if (unauthorized.status !== 401 || calls.length) throw new Error('Diagnostic bypassed authentication');
    const response = await handler(new Request('https://example.invalid', { method: 'POST',
      headers: { 'x-openai-ads-secret': 'test-trigger' }, body: '{"validate_only":true}' }));
    const result = await response.json();
    if (!result.valid || !result.validate_only || result.event_count !== 2) throw new Error('Contract validation failed');
    if (calls.length !== 1 || calls[0].validate_only !== true || calls[0].events.length !== 2) throw new Error('Saved diagnostic events');
    if (calls[0].events.some((event) => event.oppref || event.data.amount || event.user.cities)) throw new Error('Invented attribution');
    if (JSON.stringify(result).includes('test-configuration')) throw new Error('Exposed configuration');
  } finally {
    Deno.serve = original.serve; Deno.env.get = original.envGet; globalThis.fetch = original.fetch;
    delete globalThis.__adsTest;
  }
});
