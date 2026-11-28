"""3.57: the last price with the same party under the price in the invoice editor, the restaurant reports in the
report centre, and the day close in the menu."""
import time, datetime
from playwright.sync_api import sync_playwright
from ui_lib import *
t = api.register('r357ui'); c = lambda *a, **k: api.call(*a, tok=t, **k)
D = lambda n=0: (datetime.date.today() + datetime.timedelta(days=n)).isoformat()
ADDR = {'street': 'طريق الملك فهد', 'buildingNo': '1234', 'district': 'العليا', 'city': 'الرياض', 'postalCode': '12211', 'phone': '0501234567'}
sup = c('/partners', {'name': 'مورد الدجاج', 'isSupplier': True, 'kind': 'COMPANY', 'vatNumber': '200000001' if PORT == '3200' else '300000000000003', **ADDR})
ck = c('/products', {'name': 'دجاج مبرد', 'sku': 'CK', 'buyRoles': ['STOCK', 'COMPONENT'], 'saleClass': 'STOCK', 'purchasePrice': 20, 'salePrice': 30, 'taxCode': 'S', 'unit': 'كجم'})
x = c('/invoices', {'direction': 'PURCHASE', 'kind': 'INVOICE', 'date': D(-2), 'partnerId': sup['id'], 'lines': [{'productId': ck['id'], 'qty': 50, 'unitPrice': 18.5, 'taxCode': 'S'}]}); c(f"/invoices/{x['id']}/post", {})
shw = c('/products', {'name': 'شاورما مطبوخة', 'sku': 'SHW', 'buyRoles': [], 'saleClass': 'RECIPE', 'unit': 'كجم', 'taxCode': 'S'})
c(f"/products/{shw['id']}/recipe", {'lines': [{'componentId': ck['id'], 'qty': 10}], 'outputQty': 6.5, 'method': 'BATCH'}, 'PUT')
c('/prep-batches', {'productId': shw['id'], 'inputQty': 10, 'date': D()})
L = c(f'/preps/leftovers?date={D()}'); c('/preps/leftovers/waste', {'date': D(), 'lines': [{'productId': shw['id'], 'warehouseId': L['rows'][0]['warehouseId'], 'qty': 2}]})
with sync_playwright() as pw:
    b = pw.chromium.launch(); pg, errs = signed_in(b, t)
    def pick(scope, ph, text):
        pg.fill(f'{scope} input[placeholder*="{ph}"]', text); o = pg.locator(f'{scope} .suggest div', has_text=text).first; o.wait_for(timeout=20000); o.dispatch_event('mousedown'); pg.wait_for_timeout(400)
    pg.goto(B + '/purchases/invoices?new=1'); pg.wait_for_selector('.modal input[placeholder="ابحث بالاسم أو الجوال أو الرقم الضريبي"]', timeout=90000)
    pick('.modal', 'ابحث بالاسم أو الجوال', 'مورد الدجاج')
    row = pg.locator('.modal table tbody tr').first; row.locator('input').first.fill('دجاج مبرد')
    o = pg.locator('.modal .suggest div', has_text='دجاج مبرد').first; o.wait_for(timeout=20000); o.dispatch_event('mousedown')
    pg.wait_for_selector('[data-last-price]', timeout=20000)
    ok('18.5' in pg.inner_text('[data-last-price]'), 'purchase invoice: the supplier\'s last price shows under the price')
    pg.click('[data-last-price]'); pg.wait_for_timeout(300)
    ok(pg.locator('[data-last-price]').count() == 0 and any(v in ('18.5', '18.50') for v in [i.input_value() for i in row.locator('input[type=number]').all()]), 'one click applies it, and the hint goes once the price matches')
    # report centre: the restaurant module
    pg.goto(B + '/reports-center?m=resto'); pg.wait_for_selector('text=الهالك من الإنتاج المسبق', timeout=60000)
    ok(pg.locator('text=الطبخات ونسبة الناتج').count() >= 1, 'report centre lists the restaurant reports')
    pg.click('text=الهالك من الإنتاج المسبق'); pg.wait_for_selector('table.tbl tbody tr', timeout=60000)
    ok('شاورما مطبوخة' in pg.inner_text('table.tbl'), 'the waste report opens with the preparation')
    pg.goto(B + '/reports-center?m=inventory'); pg.wait_for_selector('text=الأصناف حسب التصنيف', timeout=60000); pg.click('text=الأصناف حسب التصنيف'); pg.wait_for_selector('table.tbl tbody tr', timeout=60000)
    txt = pg.inner_text('table.tbl'); ok('له خلطة' in txt and 'مكوِّن' in txt, 'items by classification shows the purchase uses and the sale class')
    # the menu
    pg.goto(B + '/recipes'); pg.wait_for_selector('[data-nav-group=resto]', timeout=60000)
    pg.click('.sidebar a[href="/recipes?tab=close"]'); pg.wait_for_selector('[data-day-close]', timeout=30000)
    ok(True, 'day close opens from the restaurants menu')
    ok(not errs, 'no console errors ' + str(errs[:2]))
    b.close()
done()
