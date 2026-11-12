"""Ficha real, RPCs simuladas e PDF real; nenhum acesso a dados de clientes."""
import re
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

import fitz
from pypdf import PdfReader
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
STUB = """
export const supabase = {
  async rpc(name,args) {
    if(name !== 'rv_booking_detail') throw new Error('RPC inesperada: '+name);
    window.fixtureCalls.push({name,args});
    const data=structuredClone(window.fixtureBooking);
    if(window.fixtureFreshStatus) data.status=window.fixtureFreshStatus;
    return {data,error:null};
  },
  from(table) {
    if(!['rv_events','rv_terms'].includes(table)) throw new Error('Tabela inesperada');
    const q={select(){return q},eq(){return q},order(){return q},limit(){return q},
      async single(){return window.fixtureReadError ? {error:{message:'fixture failure'}} :
        {data:structuredClone(table==='rv_events'?window.fixtureEvent:window.fixtureTerms)};}};
    return q;
  }
};
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
      isAdmin=true;
      board={event:{timezone:'America/Fortaleza',whatsapp_templates:{}}};
      drawMap=()=>{};
      loadBoard=async()=>{};
      window.fixtureCalls=[];
      window.fixtureRender=renderBookingSheet;
    """)
    # Mesmas regras públicas de instalação, sem consultar o banco nem clientes.
    seed = (ROOT / 'supabase/reveillon-seed.sql').read_text(encoding='utf-8')
    terms_body = re.search(r'\$terms\$(.*?)\$terms\$', seed, re.S).group(1)
    output = ROOT / 'output/pdf/reveillon-confirmation'
    output.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='msedge', headless=True)
            for width, height in [(390, 844), (1366, 900)]:
                context = browser.new_context(viewport={'width': width, 'height': height},
                                              timezone_id='America/Fortaleza', accept_downloads=True)
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
                page.evaluate('''async (body)=>{
                  const f=await import('../tools/reveillon_confirmation_fixture.mjs');
                  window.fixtureBooking=structuredClone(f.booking);
                  window.fixtureEvent=structuredClone(f.event);
                  window.fixtureTerms={...f.terms,body};
                  fixtureRender({...fixtureBooking,status:'pre_reserva'});
                }''', terms_body)
                expect(page.locator('#confirmation-pdf-btn')).to_have_count(0)
                page.evaluate('fixtureRender(fixtureBooking)')
                button = page.get_by_role('button', name='Baixar PDF completo', exact=True)
                expect(button).to_be_visible()
                page.screenshot(path=str(output / f'button-{width}.png'))
                downloads = []
                page.on('download', lambda download: downloads.append(download))
                with page.expect_download() as download_info:
                    button.click()
                    # Repetir clique no botão desabilitado não reconsulta nem baixa outro PDF.
                    page.locator('#confirmation-pdf-btn').evaluate('(b)=>b.click()')
                download = download_info.value
                assert download.suggested_filename == 'reveillon-RV-EXEMPLO.pdf'
                pdf_path = output / f'reveillon-example-{width}.pdf'
                download.save_as(str(pdf_path))
                expect(button).to_be_enabled()
                assert len(downloads) == 1
                assert page.evaluate('fixtureCalls.length') == 1
                reader = PdfReader(pdf_path)
                text = '\n'.join(page.extract_text() for page in reader.pages)
                for required in ['Cliente de Exemplo', 'RV-EXEMPLO', 'B09', '515,20', '220,80',
                                 '20/12/2026', '31/12/2026', '01/01/2027', 'CONSUMAÇÃO', 'FORO']:
                    assert required in text, f'Conteúdo ausente: {required}'
                assert 'PRIVAD' not in text, 'Campo interno vazou para o PDF'
                assert '{child_' not in text
                with fitz.open(pdf_path) as doc:
                    for i, pdf_page in enumerate(doc):
                        pdf_page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(output / f'page-{width}-{i+1}.png')
                        for block in pdf_page.get_text('dict')['blocks']:
                            for line in block.get('lines', []):
                                for span in line['spans']:
                                    x0, y0, x1, y1 = span['bbox']
                                    assert x0 >= 35 and x1 < 565, f'Texto fora da largura: {span["text"]}'
                                    assert y0 > 8 and y1 < 823, f'Texto fora da página: {span["text"]}'

                # Reserva cancelada desde a abertura: nenhum segundo download.
                page.evaluate("window.fixtureFreshStatus='cancelada'")
                button.click()
                expect(page.locator('.toast').last).to_contain_text('depois que o sinal')
                expect(button).to_be_enabled()
                assert len(downloads) == 1
                page.evaluate("window.fixtureFreshStatus=null; window.fixtureReadError=true")
                button.click()
                expect(page.locator('.toast').last).to_contain_text('Não foi possível carregar')
                expect(button).to_be_enabled()
                assert len(downloads) == 1
                assert page.locator('.rv-sheet').evaluate('(el)=>el.scrollWidth<=el.clientWidth')
                assert not errors, errors
                context.close()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    print('PDF real e fluxo passaram em 390px e 1366px; regras, valores, privacidade e recusas conferidos.')


if __name__ == '__main__':
    run()
