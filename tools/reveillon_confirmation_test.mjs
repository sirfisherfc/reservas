import { canDownloadConfirmation, loadReveillonConfirmation } from '../assets/js/reveillonConfirmation.js';
import { confirmationData, buildReveillonConfirmationPdf } from '../assets/js/reveillonConfirmationPdf.js';
import { PDFDocument } from '../assets/vendor/pdf-lib-1.17.1/pdf-lib.esm.min.js';
import { booking, event, terms } from './reveillon_confirmation_fixture.mjs';

function assert(condition, message = 'Falha na verificação') {
  if (!condition) throw new Error(message);
}
function throws(fn) {
  let caught = false;
  try { fn(); } catch { caught = true; }
  assert(caught, 'Entrada inválida aceita');
}

Deno.test('PDF exige status confirmado e pagamento ativo, inclusive sinal abaixo do sugerido', () => {
  assert(canDownloadConfirmation(booking));
  assert(canDownloadConfirmation({ ...booking, payments: [{ amount: .01 }] }));
  for (const status of ['pre_reserva', 'cancelada', 'expirada']) {
    assert(!canDownloadConfirmation({ ...booking, status }));
  }
  for (const payments of [[], [{ amount: 0 }], [{ amount: Infinity }], [{ amount: 20, voided_at: '2026-11-12' }]]) {
    assert(!canDownloadConfirmation({ ...booking, status: 'quitada', payments }));
  }
});

Deno.test('valores contratados, pagamentos mistos e estornados; nenhum campo privado no documento', () => {
  const d = confirmationData(booking, event, terms);
  assert(d.balancePix === 515.20 && d.received === 220.80 && d.pixDiscount === 8);
  assert(d.totalPix === 736, 'Usou desconto atual do evento em lugar do contratado');
  assert(!JSON.stringify(d).includes('PRIVAD'));
  const changed = structuredClone(booking);
  changed.payments.push({ amount: 100, method: 'debito' }, { amount: 999, method: 'pix', voided_at: '2026-11-12' });
  changed.price.paid_net = 320.80;
  const mixed = confirmationData(changed, event, terms);
  assert(mixed.received === 320.80 && mixed.payments.length === 2);
  throws(() => confirmationData(changed, event, { ...terms, id: 'terms-new' }));
  throws(() => confirmationData(changed, { ...event, id: 'other-event' }, terms));
  throws(() => confirmationData({ ...booking, price: {} }, event, terms));
  throws(() => confirmationData({ ...booking, payments: [{ amount: 900 }] }, event, terms));
});

Deno.test('reconsulta a reserva antes de baixar e usa os termos vinculados', async () => {
  const calls = [];
  const client = {
    async rpc(name, args) { calls.push([name, args]); return { data: booking }; },
    from(table) {
      const q = {
        select(fields) { calls.push([table, fields]); return q; },
        eq(key, value) { calls.push([table, key, value]); return q; },
        async single() { return { data: table === 'rv_events' ? event : terms }; },
      };
      return q;
    },
  };
  const loaded = await loadReveillonConfirmation(client, booking.id);
  assert(loaded.terms.id === booking.terms_id);
  assert(calls.some((x) => x[0] === 'rv_terms' && x[1] === 'id' && x[2] === booking.terms_id));
  client.rpc = async () => ({ data: { ...booking, status: 'cancelada' } });
  let rejected = false;
  try { await loadReveillonConfirmation(client, booking.id); } catch { rejected = true; }
  assert(rejected, 'Reserva cancelada depois de abrir a ficha não foi recusada');
  client.rpc = async () => ({ error: { message: 'forbidden' } });
  rejected = false;
  try { await loadReveillonConfirmation(client, booking.id); } catch { rejected = true; }
  assert(rejected, 'Falha de autenticação não foi recusada');
});

Deno.test('PDF permanece completo sem imagem e pagina regras longas sem cortar palavras', async () => {
  const bytes = await buildReveillonConfirmationPdf(booking, event,
    { ...terms, body: terms.body + '\n\n' + ('Regra longa com acentuação e palavra'.repeat(20) + '\n').repeat(35) },
    { loadImage: async () => { throw new Error('foto offline'); }, now: '2026-11-12T13:00:00Z' });
  const doc = await PDFDocument.load(bytes);
  assert(doc.getPageCount() > 2);
  assert(doc.getTitle().includes(booking.public_code));
  assert(doc.getPages().every((page) => page.getWidth() > 590));
});
