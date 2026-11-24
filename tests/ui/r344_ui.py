"""3.44: recipe waste and the price for a target margin, the menu-engineering tab, and the ISO 20022 bank file — from the screens."""
import time
from playwright.sync_api import sync_playwright
from ui_lib import *
EG = PORT == '3200'; R = 0.14 if EG else 0.15
t = api.call('/auth/register', {'fullName': 'مختبر', 'companyName': 'r344ui ' + str(time.time_ns()), 'email': f"r344ui{time.time_ns()}@t.sa", 'password': 'Passw0rd!'})['token']
call = lambda *a, **k: api.call(*a, tok=t, **k)
d = time.strftime('%Y-%m-%d'); y = time.strftime('%Y')
K = {x.get('systemKey'): x for x in call('/accounts')['rows'] if x.get('systemKey')}
ADDR = {'street': 'طريق الملك فهد', 'buildingNo': '1234', 'district': 'العليا', 'city': 'الرياض', 'postalCode': '12211', 'phone': '0501234567'}
call('/journals', {'date': f'{y}-01-01', 'memo': 'رأس المال', 'lines': [{'accountId': K['BANK']['id'], 'debit': 300000, 'credit': 0}, {'accountId': K['CAPITAL']['id'], 'debit': 0, 'credit': 300000}]})
sup = call('/partners', {'name': 'مورد الأغذية', 'isSupplier': True, 'kind': 'COMPANY', 'vatNumber': '300000000000003' if not EG else '200000001', **ADDR})
cu = call('/partners', {'name': 'زبون', 'isCustomer': True, 'kind': 'INDIVIDUAL', 'phone': '0501234567'})
potato = call('/products', {'name': 'بطاطس خام', 'sku': 'PT', 'type': 'STOCK', 'salePrice': 0, 'purchasePrice': 5, 'taxCode': 'S', 'unit': 'كجم'})
meat = call('/products', {'name': 'لحم مفروم', 'sku': 'MT', 'type': 'STOCK', 'salePrice': 0, 'purchasePrice': 40, 'taxCode': 'S', 'unit': 'كجم'})
fries = call('/products', {'name': 'بطاطس مقلية', 'sku': 'D1', 'type': 'SERVICE', 'salePrice': 10, 'taxCode': 'S'})
burger = call('/products', {'name': 'برجر لحم', 'sku': 'D2', 'type': 'SERVICE', 'salePrice': 30, 'taxCode': 'S'})
def inv(direction, pid, lines):
    x = call('/invoices', {'direction': direction, 'kind': 'INVOICE', 'date': d, 'partnerId': pid, 'lines': lines}); return call(f"/invoices/{x['id']}/post", {})
inv('PURCHASE', sup['id'], [{'productId': potato['id'], 'qty': 200, 'unitPrice': 5, 'taxCode': 'S'}, {'productId': meat['id'], 'qty': 100, 'unitPrice': 40, 'taxCode': 'S'}])
call(f"/products/{burger['id']}/recipe", {'lines': [{'componentId': meat['id'], 'qty': 0.15}]}, 'PUT')
with sync_playwright() as pw:
    b = pw.chromium.launch()
    pg, errs = signed_in(b, t)
    pg.on('dialog', lambda dl: dl.accept())
    pg.goto(B + '/recipes'); pg.wait_for_selector('[data-recipes]', timeout=90000)
    def pick(scope, ph, text):
        pg.fill(f'{scope} input[placeholder="{ph}"]', text); o = pg.locator(f'{scope} .suggest div', has_text=text).first; o.wait_for(timeout=15000); o.dispatch_event('mousedown'); pg.wait_for_timeout(300)
    pick('[data-recipes]', 'ابحث عن الطبق أو الباقة', 'بطاطس مقلية'); pg.click('[data-recipe-new]'); pg.wait_for_selector('.modal')
    pick('.modal', 'ابحث عن المكوّن', 'بطاطس خام')
    pg.locator('[data-recipe-qty]').first.fill('0.2'); pg.locator('[data-recipe-waste]').first.fill('25'); pg.wait_for_timeout(200)
    ok('1.25' in pg.inner_text('[data-recipe-cost]'), 'recipe window: 0.2 kg with 25% waste costs 1.25')
    pg.fill('[data-recipe-target]', '75'); pg.wait_for_timeout(200)
    ok('5.00' in pg.inner_text('[data-recipe-price]'), 'for a 75% target margin the suggested price is 5.00')
    pg.click('[data-recipe-save]'); pg.wait_for_selector('[data-recipe-list]', timeout=20000)
    ok(abs(call(f"/products/{fries['id']}/recipe")['lines'][0]['wastePct'] - 25) < 0.001, 'the waste is saved with the recipe')
    inv('SALE', cu['id'], [{'productId': fries['id'], 'qty': 100, 'unitPrice': 10, 'taxCode': 'S'}, {'productId': burger['id'], 'qty': 60, 'unitPrice': 30, 'taxCode': 'S'}])
    pg.locator('.tabs button, .tabs a, [role=tab]', has_text='هندسة القائمة').first.click(); pg.wait_for_selector('[data-menu-eng-table]', timeout=20000)
    tx = pg.inner_text('[data-menu-eng-table]')
    ok(pg.locator('[data-klass="STAR"]').count() == 1 and pg.locator('[data-klass="PLOWHORSE"]').count() == 1 and 'برجر لحم' in tx, 'menu engineering tab: the burger is the star, the fries sell with a thin margin')
    ok('ارفع السعر' in tx, 'each dish carries a recommendation')
    # ISO 20022 file from the run window
    IB = 'EG380019000500000000263180002' if EG else 'SA0380000000608010167519'
    call(f"/partners/{sup['id']}/bank", {'iban': IB}, 'PUT')
    pr = call('/payment-runs/propose?dueUntil=2100-12-31'); lines = [{'invoiceId': i['invoiceId'], 'amount': i['amount']} for s in pr['suppliers'] for i in s['invoices']]
    run = call('/payment-runs', {'accountId': K['BANK']['id'], 'payDate': d, 'dueUntil': d, 'lines': lines}); call(f"/payment-runs/{run['id']}/approve", {})
    pg.goto(B + '/payment-runs'); pg.wait_for_selector('[data-runs] tbody tr', timeout=60000); pg.locator('[data-runs] tbody tr').first.click(); pg.wait_for_selector('[data-run-bankxml]', timeout=20000)
    with pg.expect_download(timeout=20000) as dl: pg.click('[data-run-bankxml]')
    txt = open(dl.value.path(), encoding='utf-8').read()
    ok(dl.value.suggested_filename.endswith('pain001.xml') and 'pain.001.001.03' in txt and IB in txt and f"{5000 * (1 + R):.2f}" in txt, 'ISO 20022 file downloaded with the IBAN and the amount')
    # dashboard alerts and the assistant
    pg.goto(B + '/ai'); pg.wait_for_timeout(2500)
    box = pg.locator('textarea, input[type=text]').last; box.fill('هندسة القائمة'); box.press('Enter'); pg.wait_for_timeout(4000)
    ok('نجم' in pg.inner_text('body') and 'برجر لحم' in pg.inner_text('body'), 'assistant screen answers «هندسة القائمة» with the table')
    integ = call('/reports/integrity'); ok(integ['ok'], 'books check after all of it')
    ok(not errs, 'no page errors ' + str(errs[:2]))
    b.close()
done()
