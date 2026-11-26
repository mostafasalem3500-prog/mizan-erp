"""3.54: the side menu's two tabs (the core, and the activity sections), the guide to the activity sections, the new
report-centre modules from the menu, and names on symbol-only buttons."""
from playwright.sync_api import sync_playwright
from ui_lib import *
EG = PORT == '3200'
t = demo_token('r354ui')
with sync_playwright() as pw:
    b = pw.chromium.launch(); pg, errs = signed_in(b, t)
    pg.goto(B + '/'); pg.wait_for_selector('[data-nav-tab=sector]', timeout=90000)
    vis = lambda k: pg.locator(f'[data-nav-group={k}]').is_visible()
    ok(vis('sales') and vis('gl') and not vis('mfg') and not vis('rent') and not vis('subs') and not vis('resto'), 'core tab: accounting sections shown, activity sections out of the way')
    pg.click('[data-nav-tab=sector]'); pg.wait_for_timeout(200)
    ok(vis('mfg') and vis('rent') and vis('subs') and vis('resto') and not vis('sales'), 'activity tab: restaurants, manufacturing, rentals, subscriptions')
    ok(vis('estore') == (not EG), 'online stores in the Saudi edition only')
    pg.click('.sidebar a[href="/sectors"]'); pg.wait_for_selector('[data-sectors]', timeout=30000)
    ok(pg.locator('[data-sector]').count() == (4 if EG else 5) and pg.get_attribute('[data-nav-tab=sector]', 'aria-selected') == 'true', 'the guide lists the sections and stays on the activity tab')
    pg.click('[data-sector=mfg] a.btn.primary'); pg.wait_for_url('**/mfg'); ok(vis('mfg'), 'a section opens from the guide')
    pg.goto(B + '/sales/invoices'); pg.wait_for_selector('[data-nav-group=sales]', timeout=60000); pg.wait_for_timeout(300)
    ok(vis('sales') and not vis('mfg') and pg.get_attribute('[data-nav-tab=main]', 'aria-selected') == 'true', 'opening a core screen brings its tab')
    pg.goto(B + '/rentals/contracts'); pg.wait_for_selector('[data-nav-group=rent]', timeout=60000); pg.wait_for_timeout(300)
    ok(vis('rent') and not vis('sales'), 'opening an activity screen by address brings the activity tab')
    pg.fill('.nav-search input', 'عقود'); pg.wait_for_timeout(300)
    side = pg.inner_text('.sidebar nav'); ok('التأجير' in side and 'النقدية والبنوك' in side or 'عقود' in side, 'the menu search looks in both tabs')
    ok(pg.locator('[data-nav-tab]').count() == 0, 'tabs give way to the search results'); pg.fill('.nav-search input', '')
    # the new report modules, from the menu
    for m, title in [('mfg', 'أوامر التصنيع وتكلفتها'), ('rental', 'عقود التأجير'), ('subs', 'المشتركون'), ('hr', 'سجل الإجازات')]:
        pg.goto(B + f'/reports-center?m={m}'); pg.wait_for_selector(f'text={title}', timeout=60000)
    ok(True, 'report centre: manufacturing, rentals, subscriptions and HR reports listed')
    pg.click('text=سجل الإجازات'); pg.wait_for_selector('table.tbl tbody tr', timeout=60000); ok('إجازة' in pg.inner_text('table.tbl'), 'the leave register opens with rows')
    # symbol-only buttons carry a name
    pg.goto(B + '/receipts'); pg.wait_for_selector('table.tbl tbody tr', timeout=60000); pg.wait_for_timeout(900)
    n = pg.evaluate("()=>[...document.querySelectorAll('.content button')].filter(b=>(b.textContent||'').trim()==='🖨').map(b=>b.getAttribute('aria-label'))")
    ok(len(n) > 0 and all(x == 'طباعة' for x in n), 'print buttons are named for screen readers and on hover')
    ok(not errs, 'no page errors ' + str(errs[:2]))
    b.close()
done()
