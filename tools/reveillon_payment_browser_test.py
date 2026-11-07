"""Confere o formulário real com RPC simulado e sem rede externa."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
DETAIL = {
    'id': 'fixture', 'table_id': 'fixture-table', 'table_type': 'Mesa lateral',
    'table_label': 'TESTE', 'public_code': 'TESTE', 'lot_name': 'Lote de teste',
    'customer_name': 'Cliente de teste', 'customer_phone': '85990000000',
    'adults': 8, 'children': 0, 'infants': 0, 'source': 'admin',
    'status': 'pre_reserva', 'hold_expires_at': '2026-12-31T18:00:00Z',
    'payments': [], 'history': [],
    'price': {'total': 2800, 'total_pix': 2660, 'paid_net': 0, 'paid_gross': 0,
              'balance': 2800, 'balance_pix': 2660, 'deposit_remaining': 840,
              'deposit_remaining_pix': 798, 'consumption_total': 800},
}
STUB = """
export const supabase = { async rpc(name, args) {
  if(name !== 'rv_admin_register_payment') throw new Error('RPC inesperado');
  window.fixtureCalls.push({name,args});
  const data = structuredClone(window.fixtureDetail);
  data.status = 'sinal_pago';
  data.price.paid_net = args.p_amount;
  data.price.paid_gross = args.p_amount;
  data.payments = [{ id:'fixture-payment', amount:args.p_amount, method:args.p_method,
    paid_at:'2026-11-07T18:00:00Z' }];
  return {data,error:null};
} };
"""


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def run():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    controller = (ROOT / 'assets/js/adminReveillon.js').read_text(encoding='utf-8')
    controller = controller.replace('\ninit();', """
      board = {event:{timezone:'America/Fortaleza', whatsapp_templates:{}}};
      drawMap = () => {};
      loadBoard = async () => {};
      window.fixtureCalls = [];
      window.fixtureRender = renderBookingSheet;
    """)
    output = ROOT / 'output/reveillon-payment'
    output.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='msedge', headless=True)
            for width, height in [(390, 844), (1366, 900)]:
                context = browser.new_context(viewport={'width': width, 'height': height},
                                              timezone_id='America/Fortaleza')
                def route(request):
                    url = request.request.url
                    if url.startswith(base + '/assets/js/supabaseClient.js'):
                        request.fulfill(content_type='application/javascript', body=STUB)
                    elif url.startswith(base + '/assets/js/adminGuard.js'):
                        request.fulfill(content_type='application/javascript', body='export const requireStaff=()=>{},mountLayout=()=>{};')
                    elif url.startswith(base + '/assets/js/adminReveillon.js'):
                        request.fulfill(content_type='application/javascript', body=controller)
                    elif url.startswith(base + '/'):
                        request.continue_()
                    else:
                        request.fulfill(status=204)
                context.route('**/*', route)
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
                page.goto(base + '/admin/reveillon.html', wait_until='networkidle')
                page.wait_for_function('typeof fixtureRender === "function"')
                page.evaluate('(d) => { window.fixtureDetail=d; fixtureRender(d); }', DETAIL)
                expect(page.locator('.rv-money')).to_contain_text('Falta p/ sinal')
                page.get_by_role('button', name='Registrar pagamento', exact=True).click()
                amount = page.locator('#pay-amount')
                expect(amount).to_have_value('798.00')
                expect(amount).to_have_attribute('min', '0.01')
                page.get_by_role('button', name='Débito', exact=True).click()
                expect(amount).to_have_value('840.00')
                page.get_by_role('button', name='Pix', exact=True).click()
                expect(amount).to_have_value('798.00')
                expect(page.locator('#sheet-form')).to_contain_text('R$ 0,01 confirmam o sinal')
                page.screenshot(path=str(output / f'form-{width}.png'))
                amount.fill('0.01')
                page.get_by_role('button', name='Salvar pagamento', exact=True).click()
                expect(page.locator('.rv-sheet .rv-status')).to_have_text('sinal pago')
                expect(page.locator('.rv-money')).not_to_contain_text('Falta p/ sinal')
                expect(page.locator('.rv-money')).to_contain_text('Pago')
                assert page.evaluate('fixtureCalls[0].args.p_amount') == 0.01
                assert page.evaluate('fixtureCalls.length') == 1
                assert page.locator('.rv-sheet').evaluate('(el)=>el.scrollWidth<=el.clientWidth'), 'Modal ultrapassou largura'
                page.screenshot(path=str(output / f'paid-{width}.png'))
                assert not errors, errors
                context.close()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    print('Formulário e retorno do pagamento passaram em 390px e 1366px; console sem erros.')


if __name__ == '__main__':
    run()
