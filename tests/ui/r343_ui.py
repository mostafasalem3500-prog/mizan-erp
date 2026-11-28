"""3.43: from the screens to the final accounts — a set-off posted from its screen, a recipe built in its screen and sold
from the POS, a supplier IBAN and the bank file of a payment run; then the ledgers, the income statement and the final
accounts are checked."""
import time
from playwright.sync_api import sync_playwright
from ui_lib import *
EG = PORT == '3200'; R = 0.14 if EG else 0.15
t = api.call('/auth/register', {'fullName': 'مختبر', 'companyName': 'r343ui ' + str(time.time_ns()), 'email': f"r343ui{time.time_ns()}@t.sa", 'password': 'Passw0rd!'})['token']
call = lambda *a, **k: api.call(*a, tok=t, **k)
d = time.strftime('%Y-%m-%d'); y = time.strftime('%Y')
K = {x.get('systemKey'): x for x in call('/accounts')['rows'] if x.get('systemKey')}
ADDR = {'street': 'طريق الملك فهد', 'buildingNo': '1234', 'district': 'العليا', 'city': 'الرياض', 'postalCode': '12211', 'phone': '0501234567'}
def bal(key):
    return round(sum(float(x['debit']) - float(x['credit']) for x in call(f'/reports/trial-balance?from={y}-01-01&to={y}-12-31')['rows'] if x['code'] == K[key]['code']), 2)
call('/journals', {'date': f'{y}-01-01', 'memo': 'رأس المال', 'lines': [{'accountId': K['BANK']['id'], 'debit': 300000, 'credit': 0}, {'accountId': K['CAPITAL']['id'], 'debit': 0, 'credit': 300000}]})
both = call('/partners', {'name': 'الرواد العامة', 'isCustomer': True, 'isSupplier': True, 'kind': 'COMPANY', 'vatNumber': '310122393500003' if not EG else '300000002', **ADDR})
sup = call('/partners', {'name': 'مورد الأغذية', 'isSupplier': True, 'kind': 'COMPANY', 'vatNumber': '300000000000003' if not EG else '200000001', **ADDR})
S = call('/products', {'name': 'خدمة توريد', 'sku': 'SV', 'type': 'SERVICE', 'salePrice': 100, 'taxCode': 'S'})
flour = call('/products', {'name': 'دقيق فاخر', 'sku': 'FL', 'type': 'STOCK', 'salePrice': 0, 'purchasePrice': 4, 'taxCode': 'S', 'unit': 'كجم'})
cheese = call('/products', {'name': 'جبن موزاريلا', 'sku': 'CH', 'type': 'STOCK', 'salePrice': 0, 'purchasePrice': 30, 'taxCode': 'S', 'unit': 'كجم'})
pizza = call('/products', {'name': 'بيتزا مارغريتا', 'sku': 'PZ', 'type': 'SERVICE', 'salePrice': 40, 'taxCode': 'S'})
def inv(direction, pid, lines):
    x = call('/invoices', {'direction': direction, 'kind': 'INVOICE', 'date': d, 'partnerId': pid, 'lines': lines})
    return call(f"/invoices/{x['id']}/post", {})
one = lambda gross: [{'productId': S['id'], 'qty': 1, 'unitPrice': round(gross / (1 + R), 2), 'taxCode': 'S'}]
inv('SALE', both['id'], one(30000)); inv('PURCHASE', both['id'], one(23000))
inv('PURCHASE', sup['id'], [{'productId': flour['id'], 'qty': 100, 'unitPrice': 4, 'taxCode': 'S'}, {'productId': cheese['id'], 'qty': 10, 'unitPrice': 30, 'taxCode': 'S'}])
with sync_playwright() as pw:
    b = pw.chromium.launch()
    pg, errs = signed_in(b, t)
    pg.on('dialog', lambda dl: dl.accept())
    # ── set-off from its screen ──
    ar0, ap0, bk0 = bal('AR'), bal('AP'), bal('BANK')
    pg.goto(B + '/setoffs')
    try: pg.wait_for_selector('[data-setoff-cand]', timeout=45000)
    except Exception: pg.reload(); pg.wait_for_selector('[data-setoff-cand]', timeout=90000)
    row = pg.inner_text('[data-setoff-cand] tbody tr')
    ok('الرواد العامة' in row and '23,000' in row and '30,000' in row, 'set-off screen: the party is listed with 30,000 owed by it and 23,000 owed to it')
    pg.click('[data-setoff-open]'); pg.wait_for_selector('[data-setoff-entry]', timeout=20000)
    ok('الموردون' in pg.inner_text('[data-setoff-entry]') and '7,000' in pg.inner_text('[data-setoff-after]'), 'the window shows the entry and that 7,000 is left on the customer')
    pg.click('[data-setoff-post]'); pg.wait_for_selector('[data-setoff-list]', timeout=20000)
    ok('SET-' in pg.inner_text('[data-setoff-list]'), 'posted: it appears in the posted set-offs with its entry')
    ok(abs(bal('AR') - (ar0 - 23000)) < 0.05 and abs(bal('AP') - (ap0 + 23000)) < 0.05 and bal('BANK') == bk0, 'ledger: receivables −23,000, payables −23,000, bank untouched')
    # ── recipe from its screen ──
    pg.goto(B + '/recipes'); pg.wait_for_selector('[data-recipes]', timeout=60000)
    def pick(scope, ph, text):
        pg.fill(f'{scope} input[placeholder="{ph}"]', text); o = pg.locator(f'{scope} .suggest div', has_text=text).first; o.wait_for(timeout=15000); o.dispatch_event('mousedown'); pg.wait_for_timeout(300)
    pick('[data-recipes]', 'ابحث عن الطبق أو الباقة', 'بيتزا'); pg.click('[data-recipe-new]'); pg.wait_for_selector('.modal')
    pg.check('[data-recipe-all]'); pick('.modal', 'ابحث عن المكوّن', 'دقيق'); pick('.modal', 'ابحث عن المكوّن', 'جبن')
    qs = pg.locator('[data-recipe-qty]'); qs.nth(0).fill('0.25'); qs.nth(1).fill('0.1'); pg.wait_for_timeout(200)
    ok('4.00' in pg.inner_text('[data-recipe-cost]'), 'recipe window: cost 0.25×4 + 0.1×30 = 4.00')
    pg.click('[data-recipe-save]'); pg.wait_for_selector('[data-recipe-list]', timeout=20000)
    r = pg.inner_text('[data-recipe-list] tbody tr')
    ok('بيتزا' in r and '36.00' in r and '90' in r, 'list: the dish with its cost, margin 36 (90%) and how many the stock can make')
    # ── sold from the POS ──
    cg0, iv0 = bal('COGS'), bal('INVENTORY')
    pg.goto(B + '/pos'); pg.wait_for_selector('.auth, .pos .items', timeout=60000)
    if pg.locator('.auth').count(): pg.fill('.auth input[type=number]', '0'); pg.click('.auth .btn.primary')
    pg.wait_for_selector('.pos .items .item')
    pg.fill('.pos .search input', 'بيتزا'); pg.wait_for_timeout(500)
    it = pg.locator('.pos .items .item', has_text='بيتزا').first; it.click(); pg.wait_for_timeout(200); it.click(); pg.wait_for_timeout(300)
    pg.click('button:has-text("الدفع")'); pg.wait_for_selector('.modal'); pg.locator('.modal .m-f .btn.primary, .modal button:has-text("تأكيد")').last.click(); pg.wait_for_selector('.modal button:has-text("بيع جديد")', timeout=20000)
    P = {p['sku']: p for p in call('/products')}
    ok(abs(float(P['FL']['qty']) - 99.5) < 0.001 and abs(float(P['CH']['qty']) - 9.8) < 0.001, 'POS sale of 2 pizzas: flour 99.5 and cheese 9.8 left in stock')
    ok(abs(bal('COGS') - (cg0 + 8)) < 0.011 and abs(bal('INVENTORY') - (iv0 - 8)) < 0.011, 'ledger: cost of sales +8, inventory −8')
    # ── supplier IBAN from the partner form, bank file from the run ──
    IB = 'EG380019000500000000263180002' if EG else 'SA0380000000608010167519'
    pg.goto(B + f"/suppliers/{sup['id']}"); pg.wait_for_timeout(2500)
    pg.locator('button', has_text='تعديل').first.click(); pg.wait_for_selector('[data-partner-iban]', timeout=20000)
    pg.fill('[data-partner-iban]', IB[:-1] + ('8' if IB[-1] != '8' else '7')); pg.locator('.modal button', has_text='حفظ').last.click(); pg.wait_for_timeout(1500)
    ok(not call(f"/partners/{sup['id']}").get('iban'), 'a mistyped IBAN is refused')
    pg.fill('[data-partner-iban]', IB); pg.locator('.modal button', has_text='حفظ').last.click(); pg.wait_for_timeout(2000)
    ok(call(f"/partners/{sup['id']}").get('iban') == IB, 'the correct IBAN is saved from the supplier form')
    pr = call('/payment-runs/propose?dueUntil=2100-12-31'); lines = [{'invoiceId': i['invoiceId'], 'amount': i['amount']} for s in pr['suppliers'] for i in s['invoices']]
    run = call('/payment-runs', {'accountId': K['BANK']['id'], 'payDate': d, 'dueUntil': d, 'lines': lines}); call(f"/payment-runs/{run['id']}/approve", {})
    pg.goto(B + '/payment-runs'); pg.wait_for_selector('[data-runs] tbody tr', timeout=60000); pg.locator('[data-runs] tbody tr').first.click(); pg.wait_for_selector('[data-run-bankfile]', timeout=20000)
    with pg.expect_download(timeout=20000) as dl: pg.click('[data-run-bankfile]')
    txt = open(dl.value.path(), encoding='utf-8-sig').read()
    ok(IB in txt and run['number'] in txt and f"{700 * (1 + R):.2f}" in txt, 'bank file downloaded: the supplier IBAN, the amount and the run number')
    pg.click('[data-run-post]'); pg.wait_for_timeout(2500)
    ok(call(f"/payment-runs/{run['id']}")['status'] == 'POSTED', 'the run is posted from its window')
    # ── to the final accounts ──
    integ = call('/reports/integrity'); ok(integ['ok'], 'books check: every sub-ledger ties to the ledger ' + str([c['name'] for c in integ['checks'] if not c['ok']][:2]))
    fy = [x for x in call('/fiscal-years')['years'] if x['name'] == y][0]
    fa = call('/reports/final-accounts?fiscalYearId=' + fy['id']); inc = call(f'/reports/income?from={y}-01-01&to={y}-12-31')
    ok(fa['ok'] and abs(fa['balanceSheet']['totals']['currentResult'][0] - inc['net']) < 0.02, 'final accounts: all linkage checks hold and the year result = the income statement')
    pg.goto(B + '/final-accounts'); pg.wait_for_timeout(4000)
    body = pg.inner_text('body')
    ok('المركز المالي' in body and f"{abs(inc['net']):,.2f}" in body, 'final accounts screen shows the statements with the same result')
    ok(not errs, 'no page errors ' + str(errs[:2]))
    b.close()
done()
