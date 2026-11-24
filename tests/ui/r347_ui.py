"""3.47: from the screens — the home screen (pulse with period switch, ask box to the assistant, smart observations, peak
hours, hiding a section), the categories page (main and sub categories with icon, move, merge), the POS following the tree,
a new category from inside the item form, and an unsaved invoice offered back."""
import time
from playwright.sync_api import sync_playwright
from ui_lib import *
EG = PORT == '3200'
t = api.call('/auth/register', {'fullName': 'مختبر', 'companyName': 'r347ui ' + str(time.time_ns()), 'email': f"r347ui{time.time_ns()}@t.sa", 'password': 'Passw0rd!'})['token']
call = lambda *a, **k: api.call(*a, tok=t, **k)
d = time.strftime('%Y-%m-%d'); y = time.strftime('%Y')
K = {x.get('systemKey'): x for x in call('/accounts')['rows'] if x.get('systemKey')}
ADDR = {'street': 'طريق الملك فهد', 'buildingNo': '1234', 'district': 'العليا', 'city': 'الرياض', 'postalCode': '12211', 'phone': '0501234567'}
call('/journals', {'date': f'{y}-01-01', 'memo': 'رأس المال', 'lines': [{'accountId': K['BANK']['id'], 'debit': 50000, 'credit': 0}, {'accountId': K['CAPITAL']['id'], 'debit': 0, 'credit': 50000}]})
sup = call('/partners', {'name': 'مورد', 'isSupplier': True, 'kind': 'COMPANY', 'vatNumber': '300000000000003' if not EG else '200000001', **ADDR})
tea = call('/products', {'name': 'شاي كرك', 'sku': 'T1', 'type': 'STOCK', 'salePrice': 5, 'purchasePrice': 1, 'taxCode': 'S'})
juice = call('/products', {'name': 'عصير برتقال', 'sku': 'J1', 'type': 'STOCK', 'salePrice': 8, 'purchasePrice': 3, 'taxCode': 'S'})
x = call('/invoices', {'direction': 'PURCHASE', 'kind': 'INVOICE', 'date': d, 'partnerId': sup['id'], 'lines': [{'productId': tea['id'], 'qty': 50, 'unitPrice': 1, 'taxCode': 'S'}, {'productId': juice['id'], 'qty': 50, 'unitPrice': 3, 'taxCode': 'S'}]}); call(f"/invoices/{x['id']}/post", {})
sess = call('/pos/session/open', {'openingCash': 0})
call('/pos/sale', {'sessionId': sess['id'], 'lines': [{'productId': tea['id'], 'qty': 4, 'unitPrice': 5}, {'productId': juice['id'], 'qty': 2, 'unitPrice': 8}], 'tenders': [{'method': 'CASH', 'amount': None}]})
with sync_playwright() as pw:
    b = pw.chromium.launch()
    pg, errs = signed_in(b, t)
    pg.on('dialog', lambda dl: dl.accept())
    # ── home screen ──
    pg.goto(B + '/')
    try: pg.wait_for_selector('[data-pulse] [data-kpi="sales"]', timeout=45000)
    except Exception: pg.reload(); pg.wait_for_selector('[data-pulse] [data-kpi="sales"]', timeout=90000)
    ok(pg.locator('[data-pulse] [data-kpi]').count() == 8 and pg.locator('[data-kpi="sales"] .spark').count() == 1, 'pulse: eight indicators, the sales one with its line')
    pg.click('[data-pulse-period="today"]'); pg.wait_for_timeout(1200)
    ok('اليوم' in pg.inner_text('[data-pulse]') and 'نفس اليوم الأسبوع الماضي' in pg.inner_text('[data-pulse]'), 'switching to «اليوم» compares with the same day last week')
    ok(pg.locator('[data-insights]').count() == 1 and pg.locator('[data-peak] [data-heat] .hc').count() >= 7 * 15, 'smart observations and the peak-hours grid are on the home screen')
    ok('الأزحم' in pg.inner_text('[data-peak]'), 'peak hours name the busiest slot')
    pg.click('[data-home-customize] button'); pg.click('[data-home-sec="peak"]'); pg.wait_for_timeout(300)
    ok(pg.locator('[data-peak]').count() == 0, 'customise: hiding «أوقات الذروة» removes it')
    pg.reload(); pg.wait_for_selector('[data-pulse]', timeout=60000); pg.wait_for_timeout(800)
    ok(pg.locator('[data-peak]').count() == 0, 'and the choice is remembered')
    pg.fill('[data-ask-box] input', 'المبيعات حسب الصنف اليوم'); pg.click('[data-ask-box] button[type=submit]')
    pg.wait_for_url('**/ai**', timeout=20000); pg.wait_for_selector('.ai-bars', timeout=60000)
    ok('شاي كرك' in pg.inner_text('.ai-bars') and pg.locator('.ai-bars .ai-bar i').count() >= 2, 'the question goes to the assistant, which answers with a table of bars')
    # ── categories page ──
    pg.goto(B + '/categories'); pg.wait_for_selector('[data-categories]', timeout=60000)
    pg.click('[data-cat-new]'); pg.fill('[data-cat-name]', 'مشروبات'); pg.locator('[data-cat-icons] button', has_text='🥤').click(); pg.click('[data-cat-save]'); pg.wait_for_selector('[data-cat-row="مشروبات"]', timeout=20000)
    pg.locator('[data-cat-row="مشروبات"] [data-cat-sub]').click(); pg.fill('[data-cat-name]', 'ساخنة'); pg.click('[data-cat-save]'); pg.wait_for_timeout(1200)
    pg.locator('[data-cat-row="مشروبات"] [data-cat-sub]').click(); pg.fill('[data-cat-name]', 'باردة'); pg.click('[data-cat-save]'); pg.wait_for_timeout(1200)
    ok(pg.locator('[data-cat-row="ساخنة"]').count() == 1 and pg.locator('[data-cat-row="باردة"]').count() == 1 and '2 فرعي' in pg.inner_text('[data-cat-row="مشروبات"]'), 'a main category with two sub categories, shown open under it')
    C = {c['name']: c for c in call('/categories')}
    ok(C['ساخنة']['parentId'] == C['مشروبات']['id'] and C['مشروبات']['icon'] == '🥤', 'saved as a tree with its icon')
    call('/categories/move-products', {'productIds': [tea['id']], 'categoryId': C['ساخنة']['id']})
    pg.reload(); pg.wait_for_selector('[data-cat-tree]', timeout=60000); pg.wait_for_timeout(600)
    ok('1' in pg.inner_text('[data-cat-row="مشروبات"]'), 'the main category counts the item moved into its sub category')
    # ── a new category from inside the item form ──
    pg.goto(B + '/products'); pg.wait_for_timeout(2500)
    pg.locator('tr', has_text='عصير برتقال').first.locator('button', has_text='تعديل').click(); pg.wait_for_selector('[data-prod-cat]', timeout=20000)
    pg.click('[data-prod-cat-new]'); pg.wait_for_selector('[data-cat-name]'); pg.fill('[data-cat-name]', 'عصائر طازجة'); pg.select_option('[data-cat-parent]', C['مشروبات']['id']); pg.click('[data-cat-save]'); pg.wait_for_timeout(1200)
    ok('عصائر طازجة' in pg.locator('[data-prod-cat] option:checked').inner_text(), 'item form: «＋» adds a category and selects it')
    pg.locator('.modal button.primary', has_text='حفظ').last.click(); pg.wait_for_timeout(1500)
    C = {c['name']: c for c in call('/categories')}
    ok([p for p in call('/products') if p['sku'] == 'J1'][0]['categoryId'] == C['عصائر طازجة']['id'], 'the item is saved in the new sub category')
    # ── the till follows the tree ──
    pg.goto(B + '/pos'); pg.wait_for_selector('.auth, .pos .items', timeout=60000)
    if pg.locator('.auth').count(): pg.fill('.auth input[type=number]', '0'); pg.click('.auth .btn.primary')
    pg.wait_for_selector('.pos .items .item'); pg.wait_for_timeout(800)
    ok(pg.locator('[data-pos-cat="مشروبات"]').count() == 1 and pg.locator('[data-pos-cat="ساخنة"]').count() == 0 and '🥤' in pg.inner_text('[data-pos-cat="مشروبات"]'), 'POS: only the main category with its icon in the bar')
    pg.click('[data-pos-cat="مشروبات"]'); pg.wait_for_selector('[data-pos-subcats]', timeout=10000)
    ok(pg.locator('.pos .items .item').count() == 2 and pg.locator('[data-pos-subcat]').count() == 3, 'choosing it shows both drinks and its sub categories')
    pg.click('[data-pos-subcat="ساخنة"]'); pg.wait_for_timeout(300)
    ok(pg.locator('.pos .items .item').count() == 1 and 'شاي كرك' in pg.inner_text('.pos .items'), 'a sub category narrows to its items')
    # ── an unsaved invoice is offered back ──
    pg.goto(B + '/sales/invoices?new=INVOICE'); pg.wait_for_selector('.modal table tbody tr', timeout=60000)
    ins = pg.locator('.modal table tbody tr').first.locator('input'); ins.nth(1).fill('خدمة تركيب'); ins.nth(3).fill('250'); pg.wait_for_timeout(1500)
    pg.goto(B + '/'); pg.wait_for_timeout(800)
    pg.goto(B + '/sales/invoices?new=INVOICE'); pg.wait_for_selector('[data-restore-draft]', timeout=30000)
    ok('1 بند' in pg.inner_text('[data-restore-draft]'), 'reopening the form offers the unsaved invoice back')
    pg.click('[data-restore-yes]'); pg.wait_for_timeout(500)
    v = pg.locator('.modal table tbody tr').first.locator('input')
    ok(v.nth(1).input_value() == 'خدمة تركيب' and v.nth(3).input_value() == '250', 'restored with its line')
    ok(not errs, 'no page errors ' + str(errs[:2]))
    b.close()
done()
