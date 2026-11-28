"""3.58: the till shows what is left of an item sold from bulk production, and a recipe item on raw materials is
sold with no stock warning."""
import time
from playwright.sync_api import sync_playwright
from ui_lib import *
t = api.register('r358ui'); c = lambda *a, **k: api.call(*a, tok=t, **k)
d = time.strftime('%Y-%m-%d')
sup = c('/partners', {'name': 'مورد', 'isSupplier': True, 'kind': 'COMPANY', 'vatNumber': '200000001' if PORT == '3200' else '300000000000003', 'street': 'طريق الملك فهد', 'buildingNo': '1234', 'district': 'العليا', 'city': 'الرياض', 'postalCode': '12211', 'phone': '0501234567'})
ck = c('/products', {'name': 'دجاج', 'sku': 'CK', 'buyRoles': ['COMPONENT'], 'saleClass': None, 'purchasePrice': 20, 'taxCode': 'S', 'unit': 'كجم'})
x = c('/invoices', {'direction': 'PURCHASE', 'kind': 'INVOICE', 'date': d, 'partnerId': sup['id'], 'lines': [{'productId': ck['id'], 'qty': 100, 'unitPrice': 20, 'taxCode': 'S'}]}); c(f"/invoices/{x['id']}/post", {})
item = lambda n, s, price, u='حبة': c('/products', {'name': n, 'sku': s, 'buyRoles': [], 'saleClass': 'RECIPE', 'salePrice': price, 'taxCode': 'S', 'unit': u})
faj = item('ساندوتش فاهيتا', 'FJ', 15); c(f"/products/{faj['id']}/recipe", {'lines': [{'componentId': ck['id'], 'qty': 0.1}], 'outputQty': 1, 'method': 'DIRECT'}, 'PUT')
shw = item('شاورما مطبوخة', 'SHW', 0, 'كجم'); c(f"/products/{shw['id']}/recipe", {'lines': [{'componentId': ck['id'], 'qty': 10}], 'outputQty': 6.5, 'method': 'BATCH'}, 'PUT')
ssw = item('ساندوتش شاورما', 'SSW', 12); c(f"/products/{ssw['id']}/recipe", {'lines': [{'componentId': shw['id'], 'qty': 0.12}], 'outputQty': 1, 'method': 'DIRECT'}, 'PUT')
with sync_playwright() as pw:
    b = pw.chromium.launch(); pg, errs = signed_in(b, t)
    dialogs = []; pg.on('dialog', lambda dl: (dialogs.append(dl.message), dl.dismiss()))
    def open_pos():
        pg.goto(B + '/pos'); pg.wait_for_selector('.auth, .pos .items', timeout=90000)
        if pg.locator('.auth').count(): pg.fill('.auth input[type=number]', '0'); pg.click('.auth .btn.primary')
        pg.wait_for_selector('[data-pos-item=SSW]', timeout=60000); pg.wait_for_selector('[data-pos-left]', timeout=30000)
    open_pos()
    ok('out' not in (pg.get_attribute('[data-pos-item=FJ]', 'class') or '') and pg.locator('[data-pos-item=FJ] [data-pos-left]').count() == 0, 'a recipe item on raw materials is not shown as out of stock')
    pg.click('[data-pos-item=FJ]'); pg.wait_for_timeout(400)
    ok(not dialogs and 'ساندوتش فاهيتا' in pg.inner_text('.pos'), 'it goes to the cart with no stock warning')
    ok(pg.inner_text('[data-pos-item=SSW] [data-pos-left]') == 'نفد' and 'out' in pg.get_attribute('[data-pos-item=SSW]', 'class'), 'the item sold from bulk production shows «نفد» before anything is produced')
    pg.click('[data-pos-item=SSW]'); pg.wait_for_timeout(400)
    ok(len(dialogs) == 1 and 'شاورما مطبوخة' in dialogs[0], 'selling it asks first and names the preparation that ran out')
    c('/prep-batches', {'productId': shw['id'], 'inputQty': 10, 'outputQty': 6, 'date': d})
    open_pos()
    ok(pg.inner_text('[data-pos-item=SSW] [data-pos-left]') == 'باقي 50' and 'out' not in pg.get_attribute('[data-pos-item=SSW]', 'class'), 'after production the tile shows 50 left')
    ok(not errs, 'no console errors ' + str(errs[:2]))
    b.close()
done()
