"""3.50: from the screens — a rental asset, a contract with the live best-rate quote and conflict warning, deposit,
delivery, return with a damage charge, deposit settlement to closed; the occupancy calendar; a QC stage measured
against its limits; lot traceability."""
import time
from playwright.sync_api import sync_playwright
from ui_lib import *
EG = PORT == '3200'
t = api.call('/auth/register', {'fullName': 'مختبر', 'companyName': 'r350ui ' + str(time.time_ns()), 'email': f"r350ui{time.time_ns()}@t.sa", 'password': 'Passw0rd!'})['token']
call = lambda *a, **k: api.call(*a, tok=t, **k)
d = time.strftime('%Y-%m-%d'); y = time.strftime('%Y')
K = {x.get('systemKey'): x for x in call('/accounts')['rows'] if x.get('systemKey')}
call('/journals', {'date': f'{y}-01-01', 'memo': 'رأس المال', 'lines': [{'accountId': K['BANK']['id'], 'debit': 50000, 'credit': 0}, {'accountId': K['CAPITAL']['id'], 'debit': 0, 'credit': 50000}]})
cu = call('/partners', {'name': 'مقاولات النخبة', 'isCustomer': True, 'kind': 'INDIVIDUAL', 'phone': '0501234567'})
with sync_playwright() as pw:
    b = pw.chromium.launch()
    pg, errs = signed_in(b, t)
    pg.on('dialog', lambda dl: dl.accept())
    def pick(scope, ph, text):
        pg.fill(f'{scope} input[placeholder="{ph}"]', text); o = pg.locator(f'{scope} .suggest div', has_text=text).first; o.wait_for(timeout=15000); o.dispatch_event('mousedown'); pg.wait_for_timeout(300)
    pg.goto(B + '/rentals')
    try: pg.wait_for_selector('[data-rent-start]', timeout=45000)
    except Exception: pg.reload(); pg.wait_for_selector('[data-rent-start]', timeout=90000)
    ok('ابدأ التأجير' in pg.inner_text('[data-rent-start]'), 'rentals dashboard: getting started')
    # asset
    pg.goto(B + '/rentals/assets?new=1'); pg.wait_for_selector('[data-ra-name]', timeout=45000)
    pg.fill('[data-ra-name]', 'مولد 50 ك.ف'); pg.fill('[data-ra-day]', '100'); pg.fill('[data-ra-week]', '600'); pg.fill('[data-ra-deposit]', '1000'); pg.click('[data-ra-save]'); pg.wait_for_selector('[data-ra-row="RA-001"]', timeout=20000)
    ok('متاح' in pg.inner_text('[data-ra-row="RA-001"]'), 'asset saved from the screen, shown available')
    # contract with live quote
    pg.goto(B + '/rentals/contracts?new=1'); pg.wait_for_selector('[data-rc-add]', timeout=45000)
    pick('.modal', 'ابحث عن العميل', 'مقاولات النخبة')
    fr = time.strftime('%Y-%m-%d', time.localtime(time.time() - 12 * 86400)); to = time.strftime('%Y-%m-%d', time.localtime(time.time() - 3 * 86400))
    pg.fill('[data-rc-from]', fr); pg.fill('[data-rc-to]', to); pg.select_option('[data-rc-add]', index=1)
    pg.locator('[data-rc-total]', has_text='900').wait_for(timeout=15000)
    ok('900' in pg.inner_text('[data-rc-total]') and '1,000' in pg.inner_text('[data-rc-total]'), 'live quote: 10 days = 1 week + 3 days = 900; deposit 1,000')
    pg.click('[data-rc-save]'); pg.wait_for_selector('[data-rc-kpis]', timeout=30000)
    cid = pg.url.split('/rentals/contracts/')[1]
    ok(call(f'/rentals/contracts/{cid}')['status'] == 'RESERVED', 'contract saved and reserved')
    pg.goto(B + '/rentals/contracts?new=1'); pg.wait_for_selector('[data-rc-add]', timeout=45000)
    pick('.modal', 'ابحث عن العميل', 'مقاولات النخبة'); pg.fill('[data-rc-from]', fr); pg.fill('[data-rc-to]', fr); pg.select_option('[data-rc-add]', index=1)
    pg.wait_for_selector('[data-rc-conflict]', timeout=15000)
    ok(pg.locator('[data-rc-save]').is_disabled(), 'a clashing booking is shown and cannot be saved')
    pg.locator('.modal button', has_text='إلغاء').first.click(); pg.wait_for_timeout(300)
    # deposit, deliver, return, settle
    pg.goto(B + f'/rentals/contracts/{cid}'); pg.wait_for_selector('[data-rc-deposit]', timeout=30000)
    pg.click('[data-rc-deposit]'); pg.wait_for_selector('[data-dep-amount]'); pg.fill('[data-dep-amount]', '1000'); pg.click('[data-dep-save]'); pg.wait_for_timeout(1500)
    pg.click('[data-rc-deliver]'); pg.wait_for_selector('[data-deliver-save]')
    pg.locator('.modal input[type=date]').fill(fr); pg.click('[data-deliver-save]'); pg.wait_for_timeout(2000)
    c = call(f'/rentals/contracts/{cid}'); ok(c['status'] == 'ACTIVE' and len(c['invoices']) == 1 and abs(c['invoices'][0]['net'] - 900) < 0.01 and abs(c['depositHeld'] - 1000) < 0.01, 'deposit received and delivered: invoice 900')
    pg.click('[data-rc-return]'); pg.wait_for_selector('[data-return-date]'); pg.fill('[data-return-date]', d)
    pg.click('[data-charge-add]'); pg.fill('[data-charge-desc]', 'تنظيف'); pg.fill('[data-charge-amount]', '80'); pg.click('[data-return-save]'); pg.wait_for_timeout(2000)
    c = call(f'/rentals/contracts/{cid}'); ok(c['status'] == 'RETURNED' and abs(c['invoices'][-1]['net'] - (300 + 80)) < 0.01, f"returned 3 days late: 3 × 100 + cleaning 80 = 380 ({c['invoices'][-1]['net']})")
    pg.click('[data-rc-settle]'); pg.wait_for_selector('[data-dep-save]'); pg.click('[data-dep-save]'); pg.wait_for_timeout(2000)
    c = call(f'/rentals/contracts/{cid}'); ok(c['status'] == 'CLOSED' and abs(c['depositApplied'] - 1000) < 0.01, 'deposit applied to the invoices; contract closed')
    ok('مغلق' in pg.inner_text('[data-rc]'), 'the page shows it closed')
    pg.goto(B + '/rentals/calendar'); pg.wait_for_selector('[data-cal-asset]', timeout=45000); ok(pg.locator('[data-cal-asset] td').count() > 10, 'occupancy calendar drawn')
    pg.goto(B + '/rentals'); pg.wait_for_selector('[data-rent-deposits]', timeout=45000); ok('مطابقة' in pg.inner_text('[data-rent-deposits]'), 'dashboard: deposits match their account')
    # QC criteria on the screen
    leg = call('/products', {'name': 'لوح', 'sku': 'PL', 'type': 'STOCK', 'purchasePrice': 10, 'taxCode': 'S'}); box = call('/products', {'name': 'صندوق', 'sku': 'BX', 'type': 'STOCK', 'purchasePrice': 0, 'taxCode': 'S'})
    wc = call('/mfg/work-centers', {'name': 'نجارة', 'rateHour': 30})
    call('/mfg/boms', {'productId': box['id'], 'lines': [{'componentId': leg['id'], 'qty': 1}], 'ops': [{'seq': 10, 'name': 'قص', 'workCenterId': wc['id'], 'runMin': 10, 'checks': [{'name': 'العرض', 'min': 30, 'max': 31, 'unit': 'سم'}]}]})
    mo = call('/mfg/orders', {'productId': box['id'], 'qty': 1, 'confirm': True})
    pg.goto(B + f"/mfg/orders/{mo['id']}?tab=stages"); pg.wait_for_selector('[data-op="10"] [data-op-finish]', timeout=30000); pg.click('[data-op="10"] [data-op-finish]')
    pg.wait_for_selector('[data-op-criteria]'); pg.fill('[data-crit="العرض"]', '32'); pg.wait_for_timeout(300)
    ok('خارج حدوده' in pg.inner_text('[data-op-criteria]'), 'a measurement outside its limits is flagged before saving')
    pg.click('[data-op-save]'); pg.wait_for_timeout(1500)
    ok(call(f"/mfg/orders/{mo['id']}")['ops'][0]['status'] == 'FAILED', 'saved as failed QC')
    pg.goto(B + f"/mfg/trace?lot={mo['number']}"); pg.wait_for_selector('[data-trace-origin]', timeout=30000); ok(mo['number'] in pg.inner_text('[data-trace-origin]'), 'traceability page finds the order by its number')
    ok(not errs, 'no page errors ' + str(errs[:2]))
    b.close()
done()
