"""3.55: the item card's classification (bought as stock / service / ingredient; sold as stock / with a recipe / service
/ not sold), the recipe opened straight after a recipe item is saved with ingredient items only, and the day-close
tab that writes off what is left of a bulk preparation."""
import time
from playwright.sync_api import sync_playwright
from ui_lib import *
t = api.register('r355ui'); c = lambda *a, **k: api.call(*a, tok=t, **k)
d = time.strftime('%Y-%m-%d')
with sync_playwright() as pw:
    b = pw.chromium.launch(); pg, errs = signed_in(b, t)
    pg.on('dialog', lambda dl: dl.accept())
    new = lambda: (pg.goto(B + '/products?new=1'), pg.wait_for_selector('[data-prod-buy]', timeout=90000))
    new()
    ok(pg.locator('[data-buy-role]').count() == 3 and pg.locator('[data-prod-sale] option').count() == 4, 'item card: three purchase uses and four sale classes')
    ok(pg.is_checked('[data-buy-role=STOCK]') and pg.input_value('[data-prod-sale]') == 'STOCK', 'a new item starts as an ordinary stock item')
    # an ingredient that is not sold
    pg.fill('.modal input >> nth=0', 'دجاج مبرد'); pg.uncheck('[data-buy-role=STOCK]'); pg.check('[data-buy-role=COMPONENT]'); pg.select_option('[data-prod-sale]', '')
    pg.click('[data-prod-save]'); pg.wait_for_selector('[data-class-badge=COMPONENT]', timeout=30000)
    row = pg.locator('table.tbl tbody tr', has_text='دجاج مبرد').first.inner_text()
    ok('مكوِّن' in row and 'لا يُباع' in row, 'the ingredient shows as «مكوِّن» and «لا يُباع» in the list')
    # the contradiction is caught on the card
    new(); pg.fill('.modal input >> nth=0', 'متعارض'); pg.check('[data-buy-role=COMPONENT]'); pg.select_option('[data-prod-sale]', 'SERVICE'); pg.wait_for_timeout(200)
    ok(pg.is_visible('[data-prod-clash]') and pg.is_disabled('[data-prod-save]'), 'sold as a service and an ingredient at once: explained and not saved')
    # an item with a recipe: saved, then its recipe opens
    new(); pg.fill('.modal input >> nth=0', 'فاهيتا دجاج'); pg.uncheck('[data-buy-role=STOCK]'); pg.select_option('[data-prod-sale]', 'RECIPE'); pg.wait_for_timeout(200)
    ok('الخلطة' in pg.inner_text('[data-prod-save]'), 'the save button says the recipe comes next')
    pg.click('[data-prod-save]'); pg.wait_for_selector('[data-prep-head]', timeout=30000)
    c('/products', {'name': 'بيبسي', 'sku': 'PEPUI', 'type': 'STOCK', 'salePrice': 3, 'purchasePrice': 1.5, 'taxCode': 'S'})
    box = '.modal input[placeholder="ابحث عن المكوّن"]'
    pg.fill(box, 'بيبسي'); pg.wait_for_timeout(1500); ok(pg.locator('.modal .suggest div', has_text='بيبسي').count() == 0, 'the recipe editor does not offer an item that is not an ingredient')
    pg.fill(box, 'دجاج'); o = pg.locator('.modal .suggest div', has_text='دجاج مبرد').first; o.wait_for(timeout=15000); o.dispatch_event('mousedown'); pg.wait_for_timeout(300)
    pg.locator('[data-recipe-qty]').first.fill('0.1'); pg.fill('[data-prep-output]', '0.15'); pg.wait_for_timeout(200)
    ok(pg.input_value('[data-prep-method-select]') == 'DIRECT', 'a new recipe starts on «taken on sale»')
    pg.click('[data-recipe-save]'); pg.wait_for_selector('[data-class-badge=RECIPE]', timeout=30000)
    ok('له خلطة' in pg.locator('table.tbl tbody tr', has_text='فاهيتا دجاج').first.inner_text(), 'the recipe item is back in the list as «له خلطة»')
    pg.select_option('[data-prod-type-filter]', 'COMPONENT'); pg.wait_for_timeout(300)
    ok(pg.locator('table.tbl tbody tr').count() == 1 and 'دجاج مبرد' in pg.inner_text('table.tbl tbody'), 'the list filters the ingredient items')
    # the recipe opens again from the item card
    pg.select_option('[data-prod-type-filter]', 'RECIPE'); pg.wait_for_timeout(300); pg.locator('table.tbl tbody tr', has_text='فاهيتا دجاج').first.locator('button', has_text='تعديل').click()
    pg.wait_for_selector('[data-prod-recipe]', timeout=15000); pg.click('[data-prod-recipe]'); pg.wait_for_selector('[data-recipe-lines]', timeout=15000)
    ok('دجاج مبرد' in pg.inner_text('[data-recipe-lines]'), 'the item card opens its recipe')
    # bulk production and the day close
    P = {p['name']: p for p in c('/products?limit=100&active=all')}
    sup = c('/partners', {'name': 'مورد', 'isSupplier': True, 'kind': 'COMPANY', 'vatNumber': '200000001' if PORT == '3200' else '300000000000003', 'street': 'طريق الملك فهد', 'buildingNo': '1234', 'district': 'العليا', 'city': 'الرياض', 'postalCode': '12211', 'phone': '0501234567'})
    x = c('/invoices', {'direction': 'PURCHASE', 'kind': 'INVOICE', 'date': d, 'partnerId': sup['id'], 'lines': [{'productId': P['دجاج مبرد']['id'], 'qty': 50, 'unitPrice': 20, 'taxCode': 'S'}]}); c(f"/invoices/{x['id']}/post", {})
    shw = c('/products', {'name': 'شاورما مطبوخة', 'sku': 'SHWUI', 'buyRoles': [], 'saleClass': 'RECIPE', 'unit': 'كجم', 'taxCode': 'S'})
    c(f"/products/{shw['id']}/recipe", {'lines': [{'componentId': P['دجاج مبرد']['id'], 'qty': 10}], 'outputQty': 6.5, 'method': 'BATCH', 'minBatch': 6.5}, 'PUT')
    pg.goto(B + '/recipes?tab=preps'); pg.wait_for_selector('[data-prep-cook]', timeout=60000); pg.click('[data-prep-cook]'); pg.wait_for_selector('[data-batch-input]')
    pg.fill('[data-batch-input]', '5'); pg.wait_for_selector('[data-batch-error]', timeout=15000)
    ok('الحد الأدنى' in pg.inner_text('[data-batch-error]') and pg.is_disabled('[data-batch-post]'), 'a run under the minimum is refused with the reason')
    pg.fill('[data-batch-input]', '10'); pg.fill('[data-batch-output]', '6'); pg.wait_for_selector('[data-batch-summary]', timeout=15000); pg.wait_for_timeout(500); pg.click('[data-batch-post]'); pg.wait_for_selector('[data-batch-list]', timeout=30000)
    pg.goto(B + '/recipes?tab=close'); pg.wait_for_selector('[data-close-list]', timeout=60000)
    ok('شاورما مطبوخة' in pg.inner_text('[data-close-list]') and pg.inner_text('[data-close-left]').startswith('6'), 'day close lists the bulk preparation with what is left')
    pg.fill('[data-close-qty]', '9'); pg.wait_for_timeout(200); ok(pg.is_disabled('[data-close-waste]'), 'more than is left cannot be written off')
    pg.fill('[data-close-qty]', '6'); pg.wait_for_timeout(200); pg.click('[data-close-waste]'); pg.wait_for_selector('[data-close-done]', timeout=30000)
    ok(float({p['sku']: p for p in c('/products?limit=100&active=all')}['SHWUI']['qty']) == 0, 'the rest is written off and the day is closed at zero')
    ok(not errs, 'no console errors ' + str(errs[:2]))
    b.close()
done()
