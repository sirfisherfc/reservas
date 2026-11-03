"""Teste local real do formulario; bloqueia rede externa e simula todo RPC."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
from threading import Thread

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
STUB = """
window.fixtureCalls = [];
window.fixtureAvailability = 'available';
window.fixtureBooking = 'success';
window.fixtureParams = new URLSearchParams(location.search);
window.fixtureSettings = fixtureParams.get('fixture_settings');
export const supabase = {
  from() { return { select() { return { async eq() {
    if(window.fixtureSettings === 'network') throw new Error('fixture settings network');
    if(window.fixtureSettings === 'error') return { data:null,error:{message:'fixture settings error'} };
    return { data: [
    {key:'min_party_size',value:1},{key:'max_party_size',value:Number(fixtureParams.get('fixture_max')) || 10},
    {key:'same_day_cutoff_time',value:fixtureParams.get('fixture_cutoff') || '15:30'},
    {key:'advance_booking_days',value:60}
  ], error:null }; } }; } }; },
  async rpc(name, args) {
    window.fixtureCalls.push({name,args});
    if(name === 'get_available_time_slots') {
      if(window.fixtureAvailability === 'late_network') await new Promise((resolve,reject) => {
        window.fixtureReject = () => reject(new Error('old fixture request'));
      });
      if(window.fixtureAvailability === 'network') throw new Error('fixture network');
      if(window.fixtureAvailability === 'cutoff') return { data:null,error:{message:'SAME_DAY_CUTOFF: fixture'} };
      if(window.fixtureAvailability === 'full') return { data:[{time_slot:'18:00:00',is_available:false}],error:null };
      return { data:[{time_slot:'18:00:00',is_available:true}],error:null };
    }
    if(name === 'fn_cancel_reservation_public') {
      if(window.fixtureBooking === 'network') throw new Error('fixture network');
      if(window.fixtureBooking === 'error') return {data:null,error:{message:'UNKNOWN: fixture'}};
      return {data:[{public_code:'FIXTURE',reservation_date:'2026-10-26',
        reservation_time:'18:00:00',status:'cancelada_cliente',already_cancelled:false}],error:null};
    }
    if(name !== 'fn_create_reservation') throw new Error('Unexpected RPC');
    if(window.fixtureBooking === 'network') throw new Error('fixture network');
    if(window.fixtureBooking === 'cutoff') return { data:null,error:{message:'SAME_DAY_CUTOFF: fixture'} };
    if(window.fixtureBooking === 'full') return { data:null,error:{message:'SLOT_FULL_PEOPLE: fixture'} };
    return { data:[{id:'fixture',public_code:'FIXTURE',reservation_date:args.p_date,
      reservation_time:args.p_time,party_size:args.p_party_size,cancellation_token:'fixture-not-real'}],error:null };
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
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='msedge', headless=True)
            context = browser.new_context(viewport={'width':390,'height':844}, is_mobile=True,
                                          has_touch=True, timezone_id='America/Fortaleza')
            def route(request):
                if request.request.url.startswith(base + '/assets/js/supabaseClient.js'):
                    request.fulfill(status=200, content_type='application/javascript', body=STUB)
                elif request.request.url.startswith(base + '/'):
                    request.continue_()
                else:
                    request.abort()
            context.route('**/*', route)
            # A escolha de publicidade tem suite propria; o funil usa uma visita
            # que recusou cookies Google, com SDKs externos bloqueados.
            context.add_init_script("document.cookie='sf_google_ads_v1=denied; Path=/'")
            page = context.new_page()
            page.goto(base + '/?sf_cta=topo&utm_source=instagram&utm_medium=paid_social&utm_campaign=fixture-novembro&utm_content=ig_123&utm_id=111&ad_group_id=222&ad_id=333', wait_until='networkidle')
            page.wait_for_function("dataLayer.some(e => e[1] === 'reservation_form_view')")
            events = lambda: page.evaluate("dataLayer.filter(e => e[0] === 'event').map(e => [e[1],e[2]])")
            has_reason = lambda reason: page.wait_for_function(
                "reason => dataLayer.some(e => e[2]?.reservation_reason === reason)", arg=reason)
            page.locator('#submit-btn').click()
            has_reason('required_fields')
            page.locator('#name').fill('Fixture Guest')
            page.locator('#email').fill('fixture@example.invalid')
            page.locator('#phone').fill('85999999999')
            page.locator('#party_size').fill('2')
            tomorrow = page.evaluate("() => { const d=new Date(); d.setDate(d.getDate()+1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }")
            page.locator('#date').fill(tomorrow)
            expect(page.locator('.slot-btn:not([disabled])')).to_have_count(1)
            page.locator('.slot-btn').click()
            page.locator('#accept_policy').check()
            page.evaluate("fixtureAvailability='cutoff'")
            page.locator('#party_size').fill('3')
            has_reason('same_day_cutoff')
            page.evaluate("fixtureAvailability='full'")
            page.locator('#party_size').fill('4')
            has_reason('no_slots')
            page.evaluate("fixtureAvailability='network'")
            page.locator('#party_size').fill('5')
            has_reason('network_error')
            page.evaluate("fixtureAvailability='late_network'")
            page.locator('#party_size').fill('6')
            page.wait_for_function("typeof fixtureReject === 'function'")
            page.evaluate("fixtureAvailability='available'")
            page.locator('#party_size').fill('2')
            expect(page.locator('.slot-btn:not([disabled])')).to_have_count(1)
            old_error_count = sum(event[1].get('reservation_reason')=='network_error' for event in events())
            page.evaluate("async () => { fixtureReject(); await new Promise(resolve => setTimeout(resolve, 50)); }")
            expect(page.locator('.slot-btn:not([disabled])')).to_have_count(1)
            assert sum(event[1].get('reservation_reason')=='network_error' for event in events()) == old_error_count
            page.locator('.slot-btn').click()
            page.evaluate("fixtureBooking='network'")
            page.locator('#submit-btn').click()
            expect(page.locator('#submit-btn')).to_be_enabled()
            page.evaluate("fixtureBooking='full'")
            page.locator('#submit-btn').click()
            has_reason('slot_full')
            page.evaluate("fixtureBooking='success'")
            page.locator('#submit-btn').click()
            expect(page.locator('#success-panel')).to_be_visible()
            collected = events()
            names = [event[0] for event in collected]
            assert names.count('reservation_form_view') == names.count('reservation_form_start') == 1
            assert names.count('reservation_confirmed') == 1
            assert all(event[1]['cta_position']=='topo' for event in collected if event[0].startswith('reservation_'))
            assert not any('fixture@example.invalid' in str(event) or 'Fixture Guest' in str(event) for event in collected)
            attribution = page.evaluate("fixtureCalls.filter(c => c.name==='fn_create_reservation').at(-1).args.p_attribution")
            assert attribution['utm_content'] == 'ig_123' and attribution['utm_campaign'] == 'fixture-novembro'
            assert attribution['campaign_id'] == '111' and attribution['ad_id'] == '333'
            print('CONTENT_AND_CAMPAIGN_REACH_RESERVATION_RPC_OK')
            print('MOBILE_FUNNEL_AND_ERROR_FLOWS_OK')
            print('STALE_AVAILABILITY_FAILURE_IGNORED_OK')
            # Analytics defeituoso nao esconde sucesso nem impede nova reserva.
            page.goto(base + '/?lang=en&sf_cta=abertura', wait_until='networkidle')
            page.wait_for_function("dataLayer.some(e => e[1] === 'reservation_form_view')")
            page.locator('#name').fill('Fixture Guest')
            page.locator('#email').fill('fixture@example.invalid')
            page.locator('#phone').fill('+441234567890')
            page.locator('#party_size').fill('2')
            page.locator('#date').fill(tomorrow)
            expect(page.locator('.slot-btn:not([disabled])')).to_have_count(1)
            page.locator('.slot-btn').click()
            page.locator('#accept_policy').check()
            page.evaluate("() => { window.gtag=window.fbq=window.oaiq=()=>{throw new Error('blocked tracking')}; }")
            page.locator('#submit-btn').click()
            expect(page.locator('#success-panel')).to_be_visible()
            assert page.evaluate("fixtureCalls.filter(c => c.name==='fn_create_reservation').length") == 1
            print('ENGLISH_BOOKING_WITH_BROKEN_ANALYTICS_OK')
            page.add_init_script("window.oaiq=()=>{throw new Error('fixture broken pixel during init')}")
            for mode, lang, width in [('network', 'pt', 390), ('error', 'en', 1440)]:
                page.set_viewport_size({'width': width, 'height': 900})
                page.goto(base + f'/?lang={lang}&fixture_settings={mode}', wait_until='networkidle')
                expect(page.locator('#footer-whatsapp')).to_have_attribute('href', re.compile(r'https://wa.me/5585988544274.*'))
                expect(page.locator('#party_size')).to_have_attribute('min', '1')
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                page.locator('#name').fill('Fixture Guest')
                page.locator('#email').fill('fixture@example.invalid')
                page.locator('#phone').fill('+441234567890')
                page.locator('#party_size').fill('1')
                page.locator('#date').fill(tomorrow)
                expect(page.locator('.slot-btn:not([disabled])')).to_have_count(1)
                page.locator('.slot-btn').click()
                page.locator('#accept_policy').check()
                # Trocar a seleção e enviar no mesmo tick antecede o debounce.
                # O horário antigo deve ser invalidado antes da próxima consulta.
                page.evaluate("""() => {
                    const field = document.querySelector('#party_size');
                    field.value = '2';
                    field.dispatchEvent(new Event('input', {bubbles:true}));
                    document.querySelector('#reservation-form').requestSubmit();
                }""")
                assert page.evaluate("fixtureCalls.filter(c => c.name==='fn_create_reservation').length") == 0
                has_reason('time_required')
                expect(page.locator('.slot-btn:not([disabled])')).to_have_count(1)
                page.locator('.slot-btn').click()
                if lang == 'en':
                    (ROOT / 'output').mkdir(exist_ok=True)
                    page.screenshot(path=str(ROOT / 'output' / 'reserva-en-desktop.png'), full_page=True)
                else:
                    (ROOT / 'output').mkdir(exist_ok=True)
                    page.screenshot(path=str(ROOT / 'output' / 'reserva-pt-mobile.png'), full_page=True)
                page.locator('#submit-btn').click()
                expect(page.locator('#success-panel')).to_be_visible()
                assert page.evaluate("fixtureCalls.filter(c => c.name==='fn_create_reservation').length") == 1
            print('SETTINGS_FAILURE_RECOVERY_PT_EN_AND_FRESH_SELECTION_OK')
            # Os caminhos de grupos e visita respeitam limites, idioma e tela.
            for lang in ['pt', 'en']:
                for width in [390, 1440]:
                    page.set_viewport_size({'width': width, 'height': 900})
                    page.goto(base + f'/?lang={lang}', wait_until='networkidle')
                    expect(page.locator('#party_size')).to_have_attribute('max', '10')
                    for size in [11, 29, 30, 100, 101]:
                        page.locator('#party_size').fill(str(size))
                        expect(page.locator('#whatsapp-cta')).to_be_visible()
                        expect(page.locator('#submit-btn')).to_be_disabled()
                        if 30 <= size <= 100:
                            expect(page.locator('#event-cta-link')).to_be_visible()
                            expect(page.locator('#event-cta-link')).to_have_attribute(
                                'href', 'https://www.sirfisher.com.br/eventos/')
                            expect(page.locator('#whatsapp-cta-link')).to_be_hidden()
                            expect(page.locator('#party-limit-help')).to_contain_text(
                                '30 a 100' if lang == 'pt' else '30 to 100')
                        else:
                            expect(page.locator('#whatsapp-cta-link')).to_be_visible()
                            expect(page.locator('#whatsapp-cta-link')).to_have_attribute(
                                'href', re.compile(r'https://wa.me/5585988544274.*'))
                            expect(page.locator('#event-cta-link')).to_be_hidden()
                            expect(page.locator('#party-limit-help')).to_contain_text(
                                '100' if size > 100 else '29')
                        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                        if size == 30:
                            page.screenshot(path=str(ROOT / 'output' / f'grupo-{lang}-{width}.png'), full_page=True)
                    page.locator('#party_size').fill('10')
                    expect(page.locator('#whatsapp-cta')).to_be_hidden()
                    expect(page.locator('#submit-btn')).to_be_enabled()
                    page.evaluate("fixtureAvailability='cutoff'")
                    page.locator('#date').fill(page.locator('#date').get_attribute('min'))
                    expect(page.locator('#slots-container')).to_contain_text(
                        'disponibilidade de mesas' if lang == 'pt' else 'table availability')
                    expect(page.locator('#slots-container .btn--outline')).to_have_attribute(
                        'href', 'https://www.sirfisher.com.br/como-chegar/')
                    expect(page.locator('#slots-container .btn--outline')).to_have_text(
                        'Como chegar' if lang == 'pt' else 'How to get here')
                    expect(page.locator('#slots-container .btn--whatsapp')).to_have_text(
                        'Tirar dúvidas pelo WhatsApp' if lang == 'pt' else 'Ask a question on WhatsApp')
                    assert page.evaluate("fixtureCalls.every(c => c.name==='get_available_time_slots')")
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                    page.screenshot(path=str(ROOT / 'output' / f'corte-{lang}-{width}.png'), full_page=True)
            print('GROUP_BOUNDARIES_AND_CUTOFF_GUIDANCE_PT_EN_MOBILE_DESKTOP_OK')
            # A configuração recebida continua sendo a fonte do máximo e corte.
            page.goto(base + '/?lang=pt&fixture_max=12&fixture_cutoff=16:00', wait_until='networkidle')
            page.locator('#party_size').fill('12')
            expect(page.locator('#whatsapp-cta')).to_be_hidden()
            page.locator('#party_size').fill('13')
            expect(page.locator('#whatsapp-cta')).to_be_visible()
            expect(page.locator('#whatsapp-cta .max-party-label')).to_have_text('12')
            page.locator('#party_size').fill('2')
            page.locator('#date').fill(page.locator('#date').get_attribute('min'))
            expect(page.locator('.slot-btn:not([disabled])')).to_have_count(1)
            page.locator('.slot-btn').click()
            page.locator('#name').fill('Fixture Guest')
            page.locator('#email').fill('fixture@example.invalid')
            page.locator('#phone').fill('85999999999')
            page.locator('#accept_policy').check()
            page.evaluate("fixtureBooking='cutoff'")
            page.locator('#submit-btn').click()
            expect(page.locator('#slots-container')).to_contain_text('16:00')
            expect(page.locator('#slots-container .btn--outline')).to_be_visible()
            expect(page.locator('.slot-btn')).to_have_count(0)
            expect(page.locator('#form-alert-area')).to_be_empty()
            assert page.evaluate("dataLayer.filter(e => e[2]?.reservation_reason==='same_day_cutoff').length") == 1
            assert page.evaluate("fixtureCalls.filter(c => c.name==='fn_create_reservation').length") == 1
            print('CONFIGURED_LIMITS_AND_CUTOFF_ON_SUBMIT_OK')
            page.set_viewport_size({'width':390, 'height':844})
            page.goto(base + '/cancelar.html?t=fixture-not-real&lang=en', wait_until='networkidle')
            for mode in ['network', 'error']:
                page.evaluate(f"fixtureBooking='{mode}'")
                page.locator('#confirm-cancel-btn').click()
                expect(page.locator('#confirm-cancel-btn')).to_be_enabled()
                expect(page.locator('#cancel-card [role=alert]')).to_contain_text('could not process')
            page.screenshot(path=str(ROOT / 'output' / 'cancelamento-en-mobile.png'), full_page=True)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.set_viewport_size({'width':1440, 'height':900})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.evaluate("fixtureBooking='success'")
            page.locator('#confirm-cancel-btn').click()
            expect(page.locator('#cancel-card')).to_contain_text('Your booking has been cancelled.')
            print('CANCELLATION_FAILURE_RETRY_WITH_MOCK_RPC_OK')
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    run()
