"""3.59: «ما الجديد» — the version under the menu opens it and the dot goes once seen; and a server that does not
answer no longer signs the user out."""
from playwright.sync_api import sync_playwright
from ui_lib import *
t = api.register('r359ui')
with sync_playwright() as pw:
    b = pw.chromium.launch(); pg, errs = signed_in(b, t)
    pg.goto(B + '/'); pg.wait_for_selector('[data-version-link]', timeout=90000)
    ok(pg.locator('[data-version-dot]').count() == 1 and 'ما الجديد' in pg.inner_text('[data-version-link]'), 'the version under the menu links to what is new, with a dot while unseen')
    pg.click('[data-version-link]'); pg.wait_for_selector('[data-whats-new]', timeout=30000)
    ver = pg.evaluate('window.MIZAN_VERSION')
    ok(pg.locator('[data-release]').count() >= 6 and pg.locator('[data-release]').first.get_attribute('data-release') == ver, 'releases listed newest first, starting with the running version ' + str(ver))
    pg.wait_for_timeout(300); ok(pg.locator('[data-version-dot]').count() == 0, 'the dot goes once the page has been opened')
    pg.locator('[data-release="3.56.0"] a').first.click(); pg.wait_for_url('**/products'); ok(True, 'an item opens its screen')
    pg.goto(B + '/'); pg.wait_for_selector('[data-version-link]', timeout=60000); pg.wait_for_timeout(300); ok(pg.locator('[data-version-dot]').count() == 0, 'and stays gone on the next visit')
    ok(not errs, 'no console errors ' + str(errs[:2]))
    # a server that does not answer keeps the session; only a refused session signs out
    p2, e2 = signed_in(b, t, service_workers='block'); n = {'c': 0}
    def flaky(route):
        n['c'] += 1
        route.abort() if n['c'] <= 2 else route.continue_()
    p2.route('**/api/auth/me', flaky)
    p2.goto(B + '/'); p2.wait_for_selector('[data-server-wait]', timeout=30000)
    ok('جلستك محفوظة' in p2.inner_text('[data-server-wait]') and p2.evaluate("!!localStorage.getItem('mz_token')"), 'the server not answering: a waiting screen, and the session is kept')
    p2.wait_for_selector('[data-version-link]', timeout=60000); ok(n['c'] >= 3, 'it tries again by itself and the program opens once the server answers')
    p3, e3 = signed_in(b, 'not-a-real-token', service_workers='block'); p3.goto(B + '/'); p3.wait_for_selector('input[type=password]', timeout=30000)
    ok(not p3.evaluate("!!localStorage.getItem('mz_token')"), 'a refused session still goes to the login page')
    b.close()
done()
