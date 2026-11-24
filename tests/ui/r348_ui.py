"""3.48: from the screens — kitchen stations set up in «النشاط والطاولات», the kitchen screen by station with «ready»,
the ingredient purchase plan making the purchase order, and the kitchen performance report."""
import time
from playwright.sync_api import sync_playwright
from ui_lib import *
EG = PORT == '3200'
t = api.call('/auth/register', {'fullName': 'مختبر', 'companyName': 'r348ui ' + str(time.time_ns()), 'email': f"r348ui{time.time_ns()}@t.sa", 'password': 'Passw0rd!'})['token']
call = lambda *a, **k: api.call(*a, tok=t, **k)
d = time.strftime('%Y-%m-%d'); y = time.strftime('%Y')
K = {x.get('systemKey'): x for x in call('/accounts')['rows'] if x.get('systemKey')}
ADDR = {'street': 'طريق الملك فهد', 'buildingNo': '1234', 'district': 'العليا', 'city': 'الرياض', 'postalCode': '12211', 'phone': '0501234567'}
call('/journals', {'date': f'{y}-01-01', 'memo': 'رأس المال', 'lines': [{'accountId': K['BANK']['id'], 'debit': 50000, 'credit': 0}, {'accountId': K['CAPITAL']['id'], 'debit': 0, 'credit': 50000}]})
food = call('/categories', {'name': 'مشويات'}); drinks = call('/categories', {'name': 'عصائر'})
raw = lambda n, s, pp, u='كجم': call('/products', {'name': n, 'sku': s, 'type': 'STOCK', 'salePrice': 0, 'purchasePrice': pp, 'taxCode': 'S', 'unit': u})
beef = raw('لحم مفروم', 'BF', 40); bun = raw('خبز برجر', 'BN', 1, 'حبة'); orange = raw('برتقال', 'OR', 5)
burger = call('/products', {'name': 'برجر لحم', 'sku': 'BG', 'type': 'SERVICE', 'salePrice': 25, 'taxCode': 'S', 'categoryId': food['id']})
juice = call('/products', {'name': 'عصير برتقال', 'sku': 'JC', 'type': 'SERVICE', 'salePrice': 12, 'taxCode': 'S', 'categoryId': drinks['id']})
call(f"/products/{burger['id']}/recipe", {'lines': [{'componentId': beef['id'], 'qty': 0.15}, {'componentId': bun['id'], 'qty': 1}]}, 'PUT')
call(f"/products/{juice['id']}/recipe", {'lines': [{'componentId': orange['id'], 'qty': 0.3}]}, 'PUT')
sup = call('/partners', {'name': 'مورد اللحوم', 'isSupplier': True, 'kind': 'COMPANY', 'vatNumber': '300000000000003' if not EG else '200000001', **ADDR})
x = call('/invoices', {'direction': 'PURCHASE', 'kind': 'INVOICE', 'date': d, 'partnerId': sup['id'], 'lines': [{'productId': p['id'], 'qty': q, 'unitPrice': pr, 'taxCode': 'S'} for p, q, pr in [(beef, 7, 40), (bun, 42, 1), (orange, 10, 5)]]}); call(f"/invoices/{x['id']}/post", {})
sess = call('/pos/session/open', {'openingCash': 0})
call('/pos/sale', {'sessionId': sess['id'], 'lines': [{'productId': burger['id'], 'qty': 40, 'unitPrice': 25}, {'productId': juice['id'], 'qty': 10, 'unitPrice': 12}], 'tenders': [{'method': 'CASH', 'amount': None}]})
call('/pos/restaurant/settings', {'mode': 'RESTAURANT'}, m='PUT')
with sync_playwright() as pw:
    b = pw.chromium.launch()
    pg, errs = signed_in(b, t)
    pg.on('dialog', lambda dl: dl.accept())
    # ── stations ──
    pg.goto(B + '/pos/setup')
    try: pg.wait_for_selector('[data-stations] [data-station-add]', timeout=45000)
    except Exception: pg.reload(); pg.wait_for_selector('[data-stations] [data-station-add]', timeout=90000)
    pg.click('[data-station-add]'); pg.locator('[data-station-row="0"] [data-station-name]').fill('الشواية'); pg.locator('[data-station-row="0"] [data-station-cat="مشويات"]').click()
    pg.click('[data-station-add]'); pg.locator('[data-station-row="1"] [data-station-name]').fill('البار'); pg.locator('[data-station-row="1"] [data-station-cat="عصائر"]').click()
    ok(pg.locator('[data-station-row="1"] [data-station-cat="مشويات"]').is_disabled(), 'a category already in a station cannot be picked for another')
    pg.click('[data-stations-save]'); pg.wait_for_timeout(1500)
    S = call('/pos/stations'); ok([s['name'] for s in S] == ['الشواية', 'البار'] and S[0]['categoryIds'] == [food['id']], 'two stations saved from the screen')
    # ── a table order goes to the kitchen ──
    T = call('/pos/restaurant')['floors'][0]['tables']
    o = call('/pos/orders', {'tableId': T[0]['id'], 'guests': 2})
    call(f"/pos/orders/{o['id']}", {'lines': [{'key': p['id'], 'productId': p['id'], 'name': p['name'], 'qty': q, 'unitPrice': pr, 'discountPct': 0} for p, q, pr in [(burger, 2, 25), (juice, 1, 12)]]}, m='PUT')
    call(f"/pos/orders/{o['id']}/send", {})
    pg.goto(B + '/pos/kitchen'); pg.wait_for_selector('[data-kds-stations]', timeout=45000); pg.wait_for_selector('[data-kds-order]', timeout=30000)
    ok('برجر لحم' in pg.inner_text('[data-kds-order]') and 'عصير برتقال' in pg.inner_text('[data-kds-order]'), 'kitchen screen: all stations show the burger and the juice')
    pg.click('[data-kds-station="الشواية"]'); pg.wait_for_timeout(1500)
    txt = pg.inner_text('[data-kds-order]'); ok('برجر لحم' in txt and 'عصير برتقال' not in txt, 'grill tab: only the burger')
    pg.click('[data-kds-ready]'); pg.wait_for_timeout(1500)
    ok(pg.locator('[data-kds-order]').count() == 0 and len(call('/pos/kitchen?v=2')['orders'][0]['items']) == 1, '«ready» at the grill: the burger leaves, the juice still waits at the bar')
    pg.click('[data-kds-station="البار"]'); pg.wait_for_timeout(1500)
    ok('عصير برتقال' in pg.inner_text('[data-kds-order]'), 'bar tab shows the juice')
    # ── purchase plan ──
    pg.goto(B + '/recipes?tab=buy'); pg.wait_for_selector('[data-plan-table]', timeout=45000)
    ok(pg.locator('[data-plan-row="BN"].plan-critical').count() == 1 and pg.locator('[data-plan-row="BF"].plan-low').count() == 1, 'plan: buns critical, beef low')
    ok(pg.locator('[data-plan-row="BN"] [data-plan-qty]').input_value() == '11', 'suggested 11 buns')
    pg.locator('[data-plan-row="BN"] [data-plan-qty]').fill('20'); pg.wait_for_timeout(300)
    pg.click('[data-plan-orders]'); pg.wait_for_url('**/purchases/orders**', timeout=30000); pg.wait_for_timeout(1200)
    pl = {r['sku']: r for r in call('/inventory/purchase-plan?cover=7&lead=2&history=28&onlyRecipe=1')['rows']}
    ok(pl['BN']['onOrder'] == 20 and pl['BF']['onOrder'] > 0, f"purchase order made from the plan with the edited quantity (buns on the way {pl['BN']['onOrder']})")
    # ── kitchen performance ──
    pg.goto(B + '/recipes?tab=kitchen'); pg.wait_for_selector('[data-kperf-kpis]', timeout=45000)
    ok('الشواية' in pg.inner_text('[data-kperf-st]') and '1' in pg.inner_text('[data-kperf-kpis]'), 'kitchen performance: the grill line timed')
    ok(not errs, 'no page errors ' + str(errs[:2]))
    b.close()
done()
