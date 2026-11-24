"""3.45: restaurant costing from the screens — the shawarma example loaded from its guide, the preparations and their two
methods, a production batch with its real yield, a sale from the POS, then the books; and report headings that stay in view."""
import time
from playwright.sync_api import sync_playwright
from ui_lib import *
EG = PORT == '3200'
t = api.call('/auth/register', {'fullName': 'مختبر', 'companyName': 'r345ui ' + str(time.time_ns()), 'email': f"r345ui{time.time_ns()}@t.sa", 'password': 'Passw0rd!'})['token']
call = lambda *a, **k: api.call(*a, tok=t, **k)
y = time.strftime('%Y')
K = {x.get('systemKey'): x for x in call('/accounts')['rows'] if x.get('systemKey')}
def bal(key): return round(sum(float(x['debit']) - float(x['credit']) for x in call(f'/reports/trial-balance?from={y}-01-01&to={y}-12-31')['rows'] if x['code'] == K[key]['code']), 2)
qty = lambda sku: float({p['sku']: p for p in call('/products')}[sku]['qty'])
with sync_playwright() as pw:
    b = pw.chromium.launch()
    pg, errs = signed_in(b, t)
    pg.on('dialog', lambda dl: dl.accept())
    pg.goto(B + '/'); pg.wait_for_selector('.sidebar', timeout=90000)
    ok(pg.locator('.sidebar', has_text='المطاعم والمقاهي').count() >= 1, 'the menu has a «المطاعم والمقاهي» section')
    pg.goto(B + '/recipes?tab=guide'); pg.wait_for_selector('[data-cost-guide]', timeout=60000)
    g = pg.inner_text('[data-cost-guide]')
    ok('الوصفة الأولية' in g and 'الوصفة النهائية' in g and 'طريقة الطبخة' in g and 'الخصم المباشر' in g, 'guide: the three stages and the two methods explained with the shawarma figures')
    pg.click('[data-load-example]'); pg.wait_for_selector('[data-prep-list]', timeout=60000)
    tx = pg.inner_text('[data-prep-list]')
    ok(pg.locator('[data-prep-method="BATCH"]').count() == 1 and pg.locator('[data-prep-method="DIRECT"]').count() == 2 and '65%' in tx, 'example loaded: three preparations — the cooked meat by batch (65% yield), the marinade and the garlic sauce by direct deduction')
    ck0, ch0 = qty('EX-CKD'), qty('EX-CK')
    ok(abs(ck0 - (15 - 6.864)) < 0.001 and abs(ch0 - 80) < 0.001, 'its sample batch (15 kg cooked from 20 kg of chicken) is in stock, less the 6.864 kg its sample sales took')
    # the preparation window
    pg.locator('[data-prep-list] tbody tr', has_text='مطبوخة').first.click(); pg.wait_for_selector('[data-prep-head]', timeout=20000)
    ok(pg.input_value('[data-prep-output]') in ('7.8', '7.8000') and pg.input_value('[data-prep-yield]') == '65' and pg.input_value('[data-prep-method-select]') == 'BATCH', 'preparation window: output 7.8 kg, yield 65%, batch method')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    if pg.locator('.modal').count(): pg.locator('.modal button', has_text='إغلاق').first.click()
    # a new batch: 12 kg in, 7.5 kg out
    iv0 = bal('INVENTORY')
    pg.click('[data-prep-cook]'); pg.wait_for_selector('[data-batch-input]')
    pg.fill('[data-batch-input]', '12'); pg.fill('[data-batch-output]', '7.5'); pg.wait_for_selector('[data-batch-summary]', timeout=20000); pg.wait_for_timeout(600)
    sm = pg.inner_text('[data-batch-summary]')
    ok('62.5%' in sm and '65%' in sm and pg.locator('[data-batch-lines] tbody tr').count() == 4, 'batch window: four raw materials leave stock; yield 62.5% against the standard 65%')
    pg.click('[data-batch-post]'); pg.wait_for_selector('[data-batch-list]', timeout=20000)
    ok('PRD-' in pg.inner_text('[data-batch-list]') and abs(qty('EX-CKD') - (ck0 + 7.5)) < 0.001 and abs(qty('EX-CK') - 70) < 0.001 and bal('INVENTORY') == iv0, 'batch posted from the screen: cooked +7.5 kg, chicken 70 kg, inventory value unchanged')
    # sell the sandwich from the POS
    cg0 = bal('COGS'); c0 = qty('EX-CKD'); g0 = qty('EX-GR')
    pg.goto(B + '/pos'); pg.wait_for_selector('.auth, .pos .items', timeout=60000)
    if pg.locator('.auth').count(): pg.fill('.auth input[type=number]', '0'); pg.click('.auth .btn.primary')
    pg.wait_for_selector('.pos .items .item')
    pg.wait_for_timeout(1500); pg.fill('.pos .search input', 'ساندوتش'); pg.wait_for_timeout(500)
    it = pg.locator('.pos .items .item', has_text='ساندوتش').first
    it.click(); pg.wait_for_selector('[data-mod-picker]'); pg.locator('[data-mod-picker] .chip', has_text='دبل').click(); pg.click('[data-mod-add]'); pg.wait_for_timeout(200)
    it.click(); pg.wait_for_selector('[data-mod-picker]'); pg.locator('[data-mod-picker] .chip', has_text='ثومية إضافية').click(); pg.click('[data-mod-add]'); pg.wait_for_timeout(200)
    pg.click('button:has-text("الدفع")'); pg.wait_for_selector('.modal'); pg.locator('.modal .m-f .btn.primary, .modal button:has-text("تأكيد")').last.click(); pg.wait_for_selector('.modal button:has-text("بيع جديد")', timeout=20000)
    ok(abs(qty('EX-CKD') - (c0 - 0.192 - 0.12)) < 0.001 and abs(qty('EX-GR') - (g0 - (0.048 + 0.03 + 0.02) / 3)) < 0.001, 'POS: a double takes 192 g of cooked meat (1.6 × the recipe), a regular 120 g; garlic leaves for the sauce in both and for the extra sauce')
    ok(bal('COGS') > cg0 + 10 and abs((bal('COGS') - cg0) - (iv0 - bal('INVENTORY'))) < 0.011, 'cost of sales rises by exactly what left inventory')
    integ = call('/reports/integrity'); ok(integ['ok'], 'books check: inventory tied to its valuation ' + str([c['name'] for c in integ['checks'] if not c['ok']][:2]))
    # report headings stay in view
    pg.goto(B + '/reports?tab=trial'); pg.wait_for_timeout(1500)
    pg.goto(B + '/inventory'); pg.wait_for_selector('.table-wrap .tbl', timeout=60000)
    st = pg.evaluate("""() => { const w = document.querySelector('.table-wrap'), th = w.querySelector('th'); const cs = getComputedStyle(w), ts = getComputedStyle(th); return [cs.maxHeight, cs.overflowY, ts.position, ts.top]; }""")
    ok(st[0] != 'none' and st[1] == 'auto' and st[2] == 'sticky' and st[3] == '0px', 'tables: the frame scrolls inside the window and the heading row is frozen at its top ' + str(st))
    ok(not errs, 'no page errors ' + str(errs[:2]))
    b.close()
done()
