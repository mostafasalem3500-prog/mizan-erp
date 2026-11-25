"""3.49: manufacturing from the screens — a work centre, a BOM with components and a stage (cost shown), an order
from its form, issuing, a stage finished with its minutes, the output received, then disassembly, the shop floor,
planning, scheduling and the reports."""
import time
from playwright.sync_api import sync_playwright
from ui_lib import *
EG = PORT == '3200'
t = api.call('/auth/register', {'fullName': 'مختبر', 'companyName': 'r349ui ' + str(time.time_ns()), 'email': f"r349ui{time.time_ns()}@t.sa", 'password': 'Passw0rd!'})['token']
call = lambda *a, **k: api.call(*a, tok=t, **k)
d = time.strftime('%Y-%m-%d'); y = time.strftime('%Y')
K = {x.get('systemKey'): x for x in call('/accounts')['rows'] if x.get('systemKey')}
ADDR = {'street': 'طريق الملك فهد', 'buildingNo': '1234', 'district': 'العليا', 'city': 'الرياض', 'postalCode': '12211', 'phone': '0501234567'}
call('/journals', {'date': f'{y}-01-01', 'memo': 'رأس المال', 'lines': [{'accountId': K['BANK']['id'], 'debit': 50000, 'credit': 0}, {'accountId': K['CAPITAL']['id'], 'debit': 0, 'credit': 50000}]})
mk = lambda n, s, pp, u='حبة': call('/products', {'name': n, 'sku': s, 'type': 'STOCK', 'salePrice': 0, 'purchasePrice': pp, 'taxCode': 'S', 'unit': u})
board = mk('لوح خشب', 'BRD', 80, 'لوح'); leg = mk('رجل معدنية', 'LEG', 15); table = mk('طاولة مكتب', 'DSK', 0)
sup = call('/partners', {'name': 'مورد', 'isSupplier': True, 'kind': 'COMPANY', 'vatNumber': '300000000000003' if not EG else '200000001', **ADDR})
x = call('/invoices', {'direction': 'PURCHASE', 'kind': 'INVOICE', 'date': d, 'partnerId': sup['id'], 'lines': [{'productId': board['id'], 'qty': 10, 'unitPrice': 80, 'taxCode': 'S'}, {'productId': leg['id'], 'qty': 40, 'unitPrice': 15, 'taxCode': 'S'}]}); call(f"/invoices/{x['id']}/post", {})
def bal(key):
    a = {x.get('systemKey'): x for x in call('/accounts')['rows'] if x.get('systemKey')}.get(key)
    return round(sum(float(r['debit']) - float(r['credit']) for r in call('/reports/trial-balance?from=2000-01-01&to=2099-12-31')['rows'] if a and r['code'] == a['code']), 2)
qty = lambda sku: float({p['sku']: p for p in (lambda r: r['rows'] if isinstance(r, dict) else r)(call('/products?limit=200'))}[sku]['qty'])
with sync_playwright() as pw:
    b = pw.chromium.launch()
    pg, errs = signed_in(b, t)
    pg.on('dialog', lambda dl: dl.accept())
    def pick(scope, ph, text):
        pg.fill(f'{scope} input[placeholder="{ph}"]', text); o = pg.locator(f'{scope} .suggest div', has_text=text).first; o.wait_for(timeout=15000); o.dispatch_event('mousedown'); pg.wait_for_timeout(300)
    # ── dashboard empty state ──
    pg.goto(B + '/mfg')
    try: pg.wait_for_selector('[data-mfg-start]', timeout=45000)
    except Exception: pg.reload(); pg.wait_for_selector('[data-mfg-start]', timeout=90000)
    ok('ابدأ التصنيع' in pg.inner_text('[data-mfg-start]'), 'manufacturing dashboard: the three starting steps')
    # ── work centre ──
    pg.goto(B + '/mfg/work-centers'); pg.wait_for_selector('[data-wc-new]', timeout=45000); pg.click('[data-wc-new]')
    pg.fill('[data-wc-name]', 'ورشة التجميع'); pg.fill('[data-wc-rate]', '40'); pg.fill('[data-wc-overhead]', '20'); pg.click('[data-wc-save]'); pg.wait_for_selector('[data-wc-row="WC-01"]', timeout=20000)
    W = call('/mfg/work-centers'); ok(len(W) == 1 and W[0]['costHour'] == 60, 'work centre saved from the screen: 60 an hour')
    # ── bill of materials ──
    pg.goto(B + '/mfg/boms?new=1'); pg.wait_for_selector('.modal [data-bom-lines]', timeout=45000)
    pick('.modal', 'المنتج التام أو نصف المصنّع', 'طاولة مكتب')
    pick('[data-bom-line="0"]', 'مادة خام، مكوّن أو نصف مصنّع', 'لوح خشب'); pg.locator('[data-bom-line="0"] [data-bom-qty]').fill('1')
    pg.click('[data-bom-add-line]'); pick('[data-bom-line="1"]', 'مادة خام، مكوّن أو نصف مصنّع', 'رجل معدنية'); pg.locator('[data-bom-line="1"] [data-bom-qty]').fill('4')
    pg.locator('.modal .tabs button', has_text='المراحل').click(); pg.click('[data-bom-add-op]'); pg.fill('[data-op-name]', 'تجميع'); pg.fill('[data-op-run]', '30')
    pg.click('[data-bom-save]'); pg.wait_for_timeout(2500)
    bl = call('/mfg/boms'); ok(len(bl) == 1 and abs(bl[0]['unitCost'] - 170) < 0.01, f"BOM saved from the screen: 80 + 4 × 15 + 30 min × 60/h = 170 ({bl[0]['unitCost'] if bl else None})")
    pg.locator('.modal .tabs button', has_text='التكلفة والهيكل').click(); pg.wait_for_selector('[data-bom-unit]')
    ok('170' in pg.inner_text('[data-bom-unit]'), 'the cost tab shows 170 a desk')
    pg.locator('.modal button', has_text='إغلاق').click(); pg.wait_for_timeout(400)
    # ── an order from its form ──
    pg.goto(B + '/mfg/orders?new=1'); pg.wait_for_selector('.modal [data-mo-qty]', timeout=45000)
    pick('.modal', 'ابحث عن المنتج المطلوب تصنيعه', 'طاولة مكتب'); pg.fill('[data-mo-qty]', '2'); pg.wait_for_selector('[data-mo-preview]', timeout=20000)
    try: pg.locator('[data-mo-preview]', has_text='340').wait_for(timeout=15000)
    except Exception: pass
    ok('رجل معدنية' in pg.inner_text('[data-mo-preview]') and '340' in pg.inner_text('[data-mo-preview]'), 'the form shows what the order needs and its standard cost 340')
    pg.click('[data-mo-save]'); pg.wait_for_selector('[data-mo-materials]', timeout=30000)
    oid = pg.url.split('/mfg/orders/')[1].split('?')[0]
    pg.click('[data-mo-issue-all]'); pg.wait_for_timeout(2000)
    o = call(f'/mfg/orders/{oid}'); ok(o['status'] == 'IN_PROGRESS' and abs(o['wip'] - 280) < 0.01 and abs(bal('WIP') - 280) < 0.01, 'materials issued from the screen: 2 boards + 8 legs = 280 in WIP')
    pg.goto(B + f'/mfg/orders/{oid}?tab=stages'); pg.wait_for_selector('[data-op="10"] [data-op-start]', timeout=30000)
    pg.click('[data-op="10"] [data-op-start]'); pg.wait_for_timeout(1500)
    ok('قيد العمل' in pg.inner_text('[data-op="10"]'), 'stage started')
    pg.click('[data-op="10"] [data-op-finish]'); pg.wait_for_selector('[data-op-minutes]'); pg.fill('[data-op-minutes]', '70'); pg.click('[data-op-save]'); pg.wait_for_timeout(2000)
    o = call(f'/mfg/orders/{oid}'); ok(o['ops'][0]['status'] == 'DONE' and abs(o['wip'] - 350) < 0.01, 'stage finished with 70 minutes: +70 → WIP 350')
    pg.click('[data-mo-produce]'); pg.wait_for_selector('[data-produce-qty]'); pg.click('[data-produce-save]'); pg.wait_for_timeout(2500)
    o = call(f'/mfg/orders/{oid}'); ok(o['status'] == 'DONE' and abs(o['sheet']['actualUnitCost'] - 175) < 0.001 and qty('DSK') == 2 and abs(bal('WIP')) < 0.01, 'output received: 2 desks at 175 each, order done, WIP 0')
    ok('175' in pg.inner_text('[data-mo-kpis]'), 'the order shows the actual unit cost')
    pg.goto(B + f'/mfg/orders/{oid}?tab=moves'); pg.wait_for_selector('[data-mo-moves]')
    ok(pg.locator('[data-mo-moves] a').count() >= 3, 'moves list links each one to its journal entry')
    # ── disassembly ──
    pg.goto(B + '/mfg/unbuild'); pg.wait_for_selector('[data-unbuild]', timeout=45000)
    pick('[data-unbuild]', 'ابحث عن المنتج', 'طاولة مكتب'); pg.fill('[data-unbuild-qty]', '1'); pg.wait_for_timeout(800); pg.click('[data-unbuild-save]'); pg.wait_for_selector('[data-unbuild-table]', timeout=20000)
    ok(qty('DSK') == 1 and qty('LEG') == 36 and 'طاولة مكتب' in pg.inner_text('[data-unbuild-table]'), 'one desk taken apart: its 4 legs back in stock')
    # ── the other screens ──
    call(f"/mfg/orders", {'productId': table['id'], 'qty': 3, 'confirm': True})
    pg.goto(B + '/mfg/floor'); pg.wait_for_selector('[data-floor-op]', timeout=45000); ok('تجميع' in pg.inner_text('[data-floor]'), 'shop floor shows the assembly stage of the new order')
    pg.goto(B + '/mfg/plan'); pg.wait_for_selector('[data-plan-mfg]', timeout=45000); pg.wait_for_timeout(1500); ok(pg.locator('[data-mrp-table]').count() == 1, 'requirements planning screen')
    pg.goto(B + '/mfg/schedule'); pg.wait_for_selector('[data-sched-wc="ورشة التجميع"]', timeout=45000); ok('%' in pg.inner_text('[data-sched-wc="ورشة التجميع"]'), 'capacity schedule shows the assembly load')
    pg.goto(B + '/mfg/reports'); pg.wait_for_selector('[data-rep-orders]', timeout=45000); ok(o['number'] in pg.inner_text('[data-rep-orders]'), 'reports list the finished order')
    pg.goto(B + '/mfg'); pg.wait_for_selector('[data-mfg-wip]', timeout=45000); ok('مطابق' in pg.inner_text('[data-mfg-wip]'), 'dashboard: WIP matches the ledger')
    ok(not errs, 'no page errors ' + str(errs[:2]))
    b.close()
done()
