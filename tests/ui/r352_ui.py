"""3.52: from the screens — the employee file with ID, IBAN and GOSI registration; a leave request with its live quote,
approved from the list; a document about to lapse; a raise with an effective date from the profile; the payroll run
approved then posted with the WPS check; the GOSI rates page; the HR dashboard."""
import time
from playwright.sync_api import sync_playwright
from ui_lib import *
EG = PORT == '3200'
t = api.call('/auth/register', {'fullName': 'مختبر', 'companyName': 'r352ui ' + str(time.time_ns()), 'email': f"r352ui{time.time_ns()}@t.sa", 'password': 'Passw0rd!'})['token']
call = lambda *a, **k: api.call(*a, tok=t, **k)
def mkiban(bban, cc='SA'):
    s=''.join(str(ord(ch)-55) if ch.isalpha() else ch for ch in bban+cc+'00'); return cc+str(98-int(s)%97).zfill(2)+bban
P = time.strftime('%Y-%m'); d = time.strftime('%Y-%m-%d')
with sync_playwright() as pw:
    b = pw.chromium.launch()
    pg, errs = signed_in(b, t)
    pg.on('dialog', lambda dl: dl.accept('ضغط العمل') if dl.type == 'prompt' else dl.accept())
    # employee from the form
    pg.goto(B + '/payroll/employees'); pg.wait_for_selector('text=＋ موظف', timeout=45000); pg.click('text=＋ موظف'); pg.wait_for_selector('.modal')
    pg.fill('.modal input[autofocus], .modal .form-grid input >> nth=0', 'فهد الحربي')
    pg.select_option('[data-emp-idtype]', 'NATIONAL_ID'); pg.fill('[data-emp-id]', '1012345678'); pg.select_option('[data-emp-gender]', 'M')
    if not EG: pg.fill('[data-emp-gosireg]', '2025-02-01')
    pg.locator('.modal').get_by_label('تاريخ التعيين', exact=True).fill('2024-01-01')
    pg.locator('.modal').get_by_label('الراتب الأساسي', exact=True).fill('6000')
    pg.locator('.modal').get_by_label('بدل السكن', exact=True).fill('1500')
    pg.locator('.modal').get_by_label('IBAN', exact=True).fill('SA0380000000608010167518')
    pg.locator('.modal button', has_text='حفظ').click(); pg.wait_for_timeout(800)
    ok('IBAN' in pg.inner_text('body'), 'a wrong IBAN is refused with its reason')
    pg.locator('.modal').get_by_label('IBAN', exact=True).fill(mkiban('80000000608010167519' if False else '80000123456789012345'))
    pg.locator('.modal button', has_text='حفظ').click(); pg.wait_for_timeout(1200)
    e = [x for x in call('/employees') if x['name'] == 'فهد الحربي'][0]
    ok(e['idNumber'] == '1012345678' and e['gender'] == 'M' and (EG or str(e['gosiRegDate'])[:10] == '2025-02-01'), 'saved with ID, gender and GOSI registration date')
    # leave request with its quote, approved from the list
    pg.goto(B + '/hr/leaves?new=1'); pg.wait_for_selector('[data-leave-emp]', timeout=45000)
    pg.select_option('[data-leave-emp]', e['id'])
    types = {x['code']: x['id'] for x in call('/hr/leave-types')}
    pg.select_option('[data-leave-type]', types['UNPAID'])
    pg.fill('[data-leave-from]', P + '-03'); pg.fill('[data-leave-to]', P + '-04'); pg.wait_for_selector('[data-leave-quote]', timeout=15000)
    ok('2 يوم' in pg.inner_text('[data-leave-quote]') and 'يُخصم' in pg.inner_text('[data-leave-quote]'), 'live quote: 2 days, deducted from the pay')
    pg.click('[data-leave-save]'); pg.wait_for_selector('[data-leave-row=PENDING]', timeout=15000)
    pg.click('[data-leave-row=PENDING] [data-leave-approve]'); pg.wait_for_timeout(1200)
    ok(call(f"/hr/leave-requests?employeeId={e['id']}")[0]['status'] == 'APPROVED', 'approved from the pending list')
    # a document about to lapse
    pg.goto(B + '/hr/documents'); pg.wait_for_selector('[data-doc-new]', timeout=45000); pg.click('[data-doc-new]')
    pg.select_option('[data-doc-emp]', e['id']); pg.select_option('[data-doc-kind]', 'PASSPORT'); pg.fill('[data-doc-number]', 'K123'); 
    exp = time.strftime('%Y-%m-%d', time.localtime(time.time() + 20 * 86400)); pg.fill('[data-doc-expiry]', exp); pg.click('[data-doc-save]')
    pg.wait_for_selector('[data-doc-state=SOON]', timeout=15000); ok('بعد 20 يوم' in pg.inner_text('[data-doc-table]'), 'the passport shows «in 20 days»')
    # raise from the profile, from next month
    pg.goto(B + f"/hr/employees/{e['id']}"); pg.wait_for_selector('[data-emp-raise]', timeout=45000); pg.click('[data-emp-raise]')
    nm = time.strftime('%Y-%m', time.localtime(time.time() + 40 * 86400)) + '-01'; pg.fill('[data-raise-date]', nm); pg.fill('[data-raise-basic]', '6600'); pg.wait_for_timeout(200)
    ok('تلقائياً في تاريخه' in pg.inner_text('.modal'), 'a future raise waits for its date'); pg.click('[data-raise-save]'); pg.wait_for_timeout(1200)
    pg.click('text=الراتب وتاريخه'); pg.wait_for_selector('[data-emp-history]'); ok('ينتظر تاريخه' in pg.inner_text('[data-emp-history]'), 'history shows the pending raise')
    # payroll: approve, then post, with the WPS check
    run = call('/payroll', {'period': P})
    line = [l for l in run['lines'] if l['employeeId'] == e['id']][0]
    ok(abs(line['absence'] - round(7500 / 30 * 2, 2)) < 0.01 and line.get('leaveDeduction'), 'the 2 unpaid days are in the run (500)')
    pg.goto(B + '/payroll'); pg.wait_for_selector('[data-run-approve]', timeout=45000); pg.click('[data-run-approve]'); pg.wait_for_timeout(1200)
    ok(call('/payroll')['runs'][0]['status'] == 'APPROVED', 'run approved from the list')
    pg.click('text=عرض'); pg.wait_for_selector('[data-wps-ok], [data-wps-problems]', timeout=20000); ok(pg.query_selector('[data-wps-ok]') is not None, 'WPS check: ready'); pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    pg.click('[data-run-post]'); pg.wait_for_timeout(1500); ok(call('/payroll')['runs'][0]['status'] == 'POSTED', 'then posted')
    # GOSI page and dashboard
    pg.goto(B + '/hr/gosi'); pg.wait_for_selector('[data-hr-approval]', timeout=45000)
    if not EG: ok('10.75%' in pg.inner_text('[data-gosi-now]') or '11.25%' in pg.inner_text('[data-gosi-now]') or '10.25%' in pg.inner_text('[data-gosi-now]'), 'GOSI rates today shown, the new law separately')
    pg.goto(B + '/hr'); pg.wait_for_selector('[data-hr-kpis]', timeout=45000); ok('1' in pg.inner_text('[data-hr-docs]'), 'dashboard counts the document about to lapse')
    ok(not errs, 'no page errors ' + str(errs[:2]))
    b.close()
done()
