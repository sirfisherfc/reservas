// Public Meta webhook, authenticated worker, and admin-only control endpoint.
// Default mode is OFF. No credentials or customer text are written to logs.
import { createHandler, loadConfig } from './core.mjs';
import { createTransports } from './transport.mjs';

const config = loadConfig((name: string) => Deno.env.get(name));
const transport = createTransports(config);
const runtime = (globalThis as typeof globalThis & {
  EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void };
}).EdgeRuntime;
const { handler } = createHandler({ config, ...transport,
  waitUntil: runtime ? (promise: Promise<unknown>) => runtime.waitUntil(promise) : null,
  metric: (name: string, count: number) => console.log(JSON.stringify({ component: 'instagram-support', name, count })),
});
Deno.serve(handler);
