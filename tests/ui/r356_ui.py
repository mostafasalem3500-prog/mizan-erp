"""3.56: classifying the selected items from the list, entering production from the day-close tab, and the waste log."""
import time
from playwright.sync_api import sync_playwright
from ui_lib import *
t = api.register('r356ui'); c = lambda *a, **k: api.call(*a, tok=t, **k)
d = time.strftime('%Y-%m-%d')
old = lambda n, s, pp=10: c('/products', {'name': n, 'sku': s, 'type': 'STOCK', 'purchasePrice': pp, 'salePrice': 0, 'taxCode': 'S', 'unit': 'كجم'})
ck = old('دجاج خام', 'CK', 20); sp = old('بهارات خام', 'SP', 40); pep = old('بيبسي', 'PEP', 1.5)
sup = c('/partners', {'name': 'مورد', 'isSupplier': True, 'kind': 'COMPANY', 'vatNumber': '200000001' if PORT == '3200' else '300000000000003', 'street': 'طريق الملك فهد', 'buildingNo': '1234', 'district': 'العليا', 'city': 'الرياض', 'postalCode': '12211', 'phone': '0501234567'})
x = c('/invoices', {'direction': 'PURCHASE', 'kind': 'INVOICE', 'date': d, 'partnerId': sup['id'], 'lines': [{'productId': ck['id'], 'qty': 50, 'unitPrice': 20, 'taxCode': 'S'}]}); c(f"/invoices/{x['id']}/post", {})
with sync_playwright() as pw:
    b = pw.chromium.launch(); pg, errs = signed_in(b, t)
    pg.on('dialog', lambda dl: dl.accept())
    pg.goto(B + '/products'); pg.wait_for_selector('table.tbl tbody tr', timeout=90000)
    for name in ('دجاج خام', 'بهارات خام'): pg.locator('table.tbl tbody tr', has_text=name).first.locator('input[type=checkbox]').check()
    pg.click('[data-bulk-classify]'); pg.wait_for_selector('[data-classify-sale]')
    ok(pg.is_disabled('[data-classify-apply]'), 'nothing chosen yet: apply is off')
    pg.select_option('[data-classify-sale]', ''); pg.select_option('[data-classify-comp]', 'ADD'); pg.click('[data-classify-apply]'); pg.wait_for_selector('[data-classify-result]', timeout=20000)
    ok('2' in pg.inner_text('[data-classify-result]'), 'two items classified in one step')
    pg.click('.modal .btn:has-text("إغلاق")'); pg.wait_for_timeout(800)
    row = pg.locator('table.tbl tbody tr', has_text='دجاج خام').first.inner_text()
    ok('مكوِّن' in row and 'لا يُباع' in row and 'لا يُباع' not in pg.locator('table.tbl tbody tr', has_text='بيبسي').first.inner_text(), 'the list shows the new classes; the unselected item is untouched')
    # an item that cannot take the change is listed with the reason
    pg.locator('table.tbl tbody tr', has_text='دجاج خام').first.locator('input[type=checkbox]').check(); pg.click('[data-bulk-classify]'); pg.wait_for_selector('[data-classify-sale]')
    pg.select_option('[data-classify-sale]', 'SERVICE'); pg.click('[data-classify-apply]'); pg.wait_for_selector('[data-classify-result]', timeout=20000)
    ok('دجاج خام' in pg.inner_text('[data-classify-result]') and 'تُرك 1' in pg.inner_text('[data-classify-result]'), 'what cannot change is listed with its reason')
    pg.click('.modal .btn:has-text("إغلاق")')
    # the reminder's link opens the list filtered
    shw = c('/products', {'name': 'شاورما مطبوخة', 'sku': 'SHW', 'buyRoles': [], 'saleClass': 'RECIPE', 'unit': 'كجم', 'taxCode': 'S'})
    pg.goto(B + '/products?type=RECIPE'); pg.wait_for_selector('table.tbl tbody tr', timeout=60000); pg.wait_for_timeout(400)
    ok(pg.input_value('[data-prod-type-filter]') == 'RECIPE' and pg.locator('table.tbl tbody tr').count() == 1, 'the list opens filtered to the items with a recipe')
    # production from the day-close tab, then the write-off and the log
    c(f"/products/{shw['id']}/recipe", {'lines': [{'componentId': ck['id'], 'qty': 10}], 'outputQty': 6.5, 'method': 'BATCH'}, 'PUT')
    pg.goto(B + '/recipes?tab=close'); pg.wait_for_selector('[data-close-prep]', timeout=60000)
    ok(pg.is_disabled('[data-close-cook]'), 'production needs a preparation chosen')
    pg.select_option('[data-close-prep]', shw['id']); pg.click('[data-close-cook]'); pg.wait_for_selector('[data-batch-summary]', timeout=20000); pg.wait_for_timeout(500)
    pg.click('[data-batch-post]'); pg.wait_for_selector('[data-close-list]', timeout=30000)
    ok(pg.inner_text('[data-close-left]').startswith('6.5'), 'production entered from the day-close tab shows as what is left')
    pg.click('[data-close-waste]'); pg.wait_for_selector('[data-close-done]', timeout=30000); pg.wait_for_selector('[data-waste-log]', timeout=30000)
    log = pg.inner_text('[data-waste-log]')
    ok('شاورما مطبوخة' in log and '200' in pg.inner_text('[data-waste-total]') and '100%' in log.replace(' ', ''), 'the waste log shows the preparation, its value and its share of production')
    ok(not errs, 'no console errors ' + str(errs[:2]))
    b.close()
done()
