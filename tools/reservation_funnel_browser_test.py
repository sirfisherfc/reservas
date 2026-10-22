"""Teste local real do formulario; bloqueia rede externa e simula todo RPC."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
STUB = """
window.fixtureCalls = [];
window.fixtureAvailability = 'available';
window.fixtureBooking = 'success';
export const supabase = {
  from() { return { select() { return { async eq() { return { data: [
    {key:'min_party_size',value:1},{key:'max_party_size',value:10},
    {key:'same_day_cutoff_time',value:'15:30'},{key:'advance_booking_days',value:60}
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
    if(name !== 'fn_create_reservation') throw new Error('Unexpected RPC');
    if(window.fixtureBooking === 'network') throw new Error('fixture network');
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
            page = context.new_page()
            page.goto(base + '/?sf_cta=topo', wait_until='networkidle')
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
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    run()
