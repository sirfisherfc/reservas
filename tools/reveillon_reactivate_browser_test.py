"""Confere a reativação de reserva expirada e a ordenação da lista de reservas
no painel real, com RPC simulado e sem rede externa (390px e 1366px)."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
DETAIL = {
    'id': 'fixture', 'table_id': 'fixture-table', 'table_type': 'Mesa lateral',
    'table_label': '01', 'public_code': 'TESTE', 'lot_name': 'Lote de teste',
    'customer_name': 'Cliente de teste', 'customer_phone': '85990000000',
    'adults': 8, 'children': 0, 'infants': 0, 'source': 'public_site',
    'status': 'expirada', 'hold_expires_at': '2026-11-22T16:39:00Z',
    'payments': [], 'history': [],
    'price': {'total': 3200, 'total_pix': 3040, 'paid_net': 0, 'paid_gross': 0,
              'balance': 3200, 'balance_pix': 2944, 'deposit_remaining': 960,
              'deposit_remaining_pix': 883.2, 'consumption_total': 800},
}
ROWS = [
    {'id': 'a', 'table_id': 't1', 'mesa': '01', 'codigo': 'RV-A', 'responsavel': 'Bruna',
     'adultos': 8, 'criancas': 0, 'status': 'expirada', 'criada_em': '2026-10-12T18:33:00Z',
     'total': 5300, 'total_pix': 4876, 'recebido': 0, 'abatido': 0, 'saldo': 5300, 'saldo_pix': 4876},
    # quitada no Pix: recebeu 3.680 e abateu os 4.000 do total
    {'id': 'b', 'table_id': 't2', 'mesa': '02', 'codigo': 'RV-B', 'responsavel': 'Ana',
     'adultos': 4, 'criancas': 0, 'status': 'quitada', 'criada_em': '2026-11-20T16:39:00Z',
     'total': 4000, 'total_pix': 3680, 'recebido': 3680, 'abatido': 4000, 'saldo': 0, 'saldo_pix': 0},
    {'id': 'c', 'table_id': 't3', 'mesa': '10', 'codigo': 'RV-C', 'responsavel': 'Carla',
     'adultos': 9, 'criancas': 0, 'status': 'sinal_pago', 'criada_em': '2026-11-01T12:00:00Z',
     'total': 3150, 'total_pix': 2898, 'recebido': 869.4, 'abatido': 945, 'saldo': 2205, 'saldo_pix': 2028.6},
]
STUB = """
export const supabase = { async rpc(name, args) {
  if(name !== 'rv_admin_reactivate') throw new Error('RPC inesperado: ' + name);
  window.fixtureCalls.push({name,args});
  const data = structuredClone(window.fixtureDetail);
  data.status = 'pre_reserva';
  data.hold_expires_at = args.p_until;
  return {data,error:null};
} };
"""


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def first_column(page):
    return page.locator('#list-tbody tr td:first-child strong').all_inner_texts()


def run():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    controller = (ROOT / 'assets/js/adminReveillon.js').read_text(encoding='utf-8')
    controller = controller.replace('\ninit();', """
      board = {event:{timezone:'America/Fortaleza', whatsapp_templates:{}, starts_at:'2026-12-31T22:00:00Z'},
               tables:[{id:'fixture-table', label:'01', active:true, blocked:true, block_reason:null, negotiating:false}],
               types:[]};
      drawMap = () => {};
      loadBoard = async () => {};
      window.fixtureCalls = [];
      window.fixtureRender = renderBookingSheet;
      window.fixtureList = (rows) => {
        exportRows = rows.map((r, i) => ({ ...r, ordem: i }));
        qs('#list-status').value = '';
        renderList();
      };
      wireSummary();
    """)
    assert '\ninit();' in (ROOT / 'assets/js/adminReveillon.js').read_text(encoding='utf-8')
    output = ROOT / 'output/reveillon-reactivate'
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

                # --- reativação ---
                page.evaluate('(d) => { window.fixtureDetail=d; fixtureRender(d); }', DETAIL)
                expect(page.locator('.rv-sheet .rv-status')).to_have_text('expirada')
                # cartões: valor cheio em destaque e o Pix como alternativa, sempre nessa ordem
                money_cards = page.locator('.rv-money > div')
                expect(money_cards.nth(0)).to_contain_text('R$ 3.200,00ou R$ 3.040,00 no Pix')
                expect(money_cards.nth(2)).to_contain_text('R$ 960,00ou R$ 883,20 no Pix')
                expect(money_cards.nth(3)).to_contain_text('R$ 3.200,00ou R$ 2.944,00 no Pix')
                expect(page.locator('.rv-money')).not_to_contain_text('Pix · cartão')
                expect(money_cards.nth(1)).not_to_contain_text('abateu')
                expect(page.get_by_role('button', name='Registrar pagamento', exact=True)).to_have_count(0)
                page.get_by_role('button', name='Reativar reserva', exact=True).click()
                form = page.locator('#sheet-form')
                expect(form).to_contain_text('está bloqueada')
                expect(form).to_contain_text('R$ 3.200,00')
                expect(page.locator('#re-until')).not_to_have_value('')
                page.get_by_role('button', name='+48h', exact=True).click()
                page.screenshot(path=str(output / f'form-{width}.png'))
                page.get_by_role('button', name='Reativar reserva', exact=True).click()
                expect(page.locator('.rv-sheet .rv-status')).to_have_text('pré-reserva')
                expect(page.get_by_role('button', name='Registrar pagamento', exact=True)).to_be_visible()
                call = page.evaluate('fixtureCalls[0].args')
                assert call['p_booking_id'] == 'fixture' and call['p_unblock'] is True, call
                assert call['p_until'].endswith('-03:00'), call
                assert page.evaluate('fixtureCalls.length') == 1
                assert page.locator('.rv-sheet').evaluate('(el)=>el.scrollWidth<=el.clientWidth'), 'Modal ultrapassou largura'
                page.screenshot(path=str(output / f'reactivated-{width}.png'))
                page.evaluate('document.querySelector(".js-sheet-close, .rv-sheet-backdrop")?.click()')

                # --- lista: data e ordenação pelo título ---
                page.evaluate("document.querySelectorAll('.rv-panel').forEach((p) => p.classList.toggle('hidden', p.id !== 'tab-resumo'))")
                page.evaluate('(rows) => fixtureList(rows)', ROWS)
                expect(page.locator('#list-head th').nth(2)).to_have_text('Data')
                assert first_column(page) == ['01', '02', '10'], first_column(page)
                expect(page.locator('#list-tbody tr').nth(1)).to_contain_text('20/11/2026')
                expect(page.locator('#list-tbody tr').nth(1)).to_contain_text('13:39')
                # quitada no Pix: a conta fecha (4.000 − 4.000 abatidos = 0)
                quitada = page.locator('#list-tbody tr').nth(1).locator('td')
                expect(quitada.nth(4)).to_contain_text('ou R$ 3.680,00 no Pix')
                expect(quitada.nth(5)).to_contain_text('abateu R$ 4.000,00 do total')
                expect(quitada.nth(6)).to_have_text('R$ 0,00')
                expect(page.locator('#list-tbody tr').nth(2).locator('td').nth(6)).to_contain_text('ou R$ 2.028,60 no Pix')
                head = page.locator('#list-head')
                head.get_by_role('button', name='Data').click()
                assert first_column(page) == ['02', '10', '01'], first_column(page)
                expect(head.locator('th').nth(2)).to_have_attribute('aria-sort', 'descending')
                head.get_by_role('button', name='Data').click()
                assert first_column(page) == ['01', '10', '02'], first_column(page)
                expect(head.locator('th').nth(2)).to_have_attribute('aria-sort', 'ascending')
                expect(head.locator('th').nth(0)).to_have_attribute('aria-sort', 'none')
                head.get_by_role('button', name='Responsável').click()
                assert first_column(page) == ['02', '01', '10'], first_column(page)
                head.get_by_role('button', name='Saldo').click()
                assert first_column(page) == ['01', '10', '02'], first_column(page)
                head.get_by_role('button', name='Data').click()
                page.screenshot(path=str(output / f'list-{width}.png'), full_page=True)
                # a escolha fica no navegador para a próxima visita
                page.reload(wait_until='networkidle')
                page.wait_for_function('typeof fixtureList === "function"')
                page.evaluate("document.querySelectorAll('.rv-panel').forEach((p) => p.classList.toggle('hidden', p.id !== 'tab-resumo'))")
                page.evaluate('(rows) => fixtureList(rows)', ROWS)
                assert first_column(page) == ['02', '10', '01'], first_column(page)
                assert not errors, errors
                context.close()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    print('Reativação e ordenação da lista passaram em 390px e 1366px; console sem erros.')


if __name__ == '__main__':
    run()
