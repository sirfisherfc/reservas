"""Confere gerador privado com guarda simulada; nenhuma API externa é chamada."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
GUARD = """
export async function requireStaff() {
  if (location.search.includes('fixture_denied')) return null;
  return { role:'admin', name:'Fixture Admin' };
}
export async function mountLayout() {
  document.getElementById('sidebar').textContent='Fixture Admin';
}
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
            context = browser.new_context()
            def route(request):
                if request.request.url.startswith(base + '/assets/js/adminGuard.js'):
                    request.fulfill(status=200, content_type='application/javascript', body=GUARD)
                elif request.request.url.startswith(base + '/'):
                    request.continue_()
                else:
                    request.abort()
            context.route('**/*', route)
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(base + '/admin/links-marketing.html?fixture_denied', wait_until='networkidle')
            expect(page.locator('#marketing-main')).to_be_hidden()
            for width in [390, 1440]:
                page.set_viewport_size({'width': width, 'height': 900})
                page.goto(base + '/admin/links-marketing.html', wait_until='networkidle')
                expect(page.locator('#marketing-main')).to_be_visible()
                page.locator('[name=campaign]').fill('novembro-2026')
                page.locator('[name=contentId]').fill('123456789')
                page.get_by_role('button', name='Gerar link', exact=True).click()
                expect(page.locator('#marketing-preview')).to_be_visible()
                assert 'utm_content=ig_123456789' in page.locator('#marketing-link').input_value()
                page.locator('[name=medium]').select_option('paid_social')
                expect(page.locator('#marketing-preview')).to_be_hidden()
                expect(page.locator('#ad-fields')).to_be_visible()
                for name, value in [('campaignId', '111'), ('adGroupId', '222'), ('adId', '333')]:
                    page.locator(f'[name={name}]').fill(value)
                page.get_by_role('button', name='Gerar link', exact=True).click()
                link = page.locator('#marketing-link').input_value()
                assert 'utm_id=111' in link and 'ad_id=333' in link
                expect(page.locator('#open-link')).to_have_attribute('href', link)
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                (ROOT / 'output').mkdir(exist_ok=True)
                page.screenshot(path=str(ROOT / 'output' / f'links-marketing-{width}.png'), full_page=True)
                page.locator('[name=destination]').fill('https://example.invalid/')
                page.get_by_role('button', name='Gerar link', exact=True).click()
                expect(page.locator('#marketing-preview')).to_be_hidden()
                expect(page.locator('#marketing-error')).to_contain_text('Use uma URL HTTPS')
            assert not errors, errors
            print('MARKETING_LINKS_PRIVATE_GUARD_AND_PT_MOBILE_DESKTOP_OK')
            print('MARKETING_LINKS_ORGANIC_PAID_PREVIEW_AND_VALIDATION_OK')
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    run()
