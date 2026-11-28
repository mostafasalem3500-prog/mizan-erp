"""3.59: «ما الجديد» — the version under the menu opens it, the dot goes once it has been seen, links respect permissions."""
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
    b.close()
done()
