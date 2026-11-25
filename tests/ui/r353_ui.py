"""3.53: from the screens — the HR officer's home (his screens and alerts, no cash or profit), the employee's link opened
on a phone (ID digits, payslip, balance, a leave request with its quote), the request reaching HR marked «from the
portal» and approved there; the cashier's home without the company's figures; no sideways scrolling on the phone."""
import time
from playwright.sync_api import sync_playwright
from ui_lib import *
EG = PORT == '3200'
st = str(time.time_ns())
t = api.call('/auth/register', {'fullName': 'المالك', 'companyName': 'r353ui ' + st, 'email': f"r353ui{st}@t.sa", 'password': 'Passw0rd!'})['token']
call = lambda *a, **k: api.call(*a, tok=t, **k)
def mkiban(bban, cc='SA'):
    s = ''.join(str(ord(ch) - 55) if ch.isalpha() else ch for ch in bban + cc + '00'); return cc + str(98 - int(s) % 97).zfill(2) + bban
IB = mkiban('80000123456789012345') if not EG else mkiban('0019' + '0' * 21, 'EG')
P = time.strftime('%Y-%m')
e = call('/employees', {'name': 'سلمان العمري', 'hireDate': '2023-03-01', 'basic': 7000, 'housing': 1750, 'nationality': 'SAUDI' if not EG else 'EGYPTIAN', 'iban': IB, 'idType': 'NATIONAL_ID', 'idNumber': '1055512345' if not EG else None, 'gender': 'M', 'phone': '0551234567'})
r = call('/payroll', {'period': P}); call(f"/payroll/{r['id']}/post", {})
for role, nm in [('HR', 'hr'), ('CASHIER', 'cash')]: call('/users', {'email': f'{nm}{st}@t.sa', 'fullName': nm, 'password': 'Passw0rd!', 'role': role})
th = api.call('/auth/login', {'email': f'hr{st}@t.sa', 'password': 'Passw0rd!'})['token']
tc = api.call('/auth/login', {'email': f'cash{st}@t.sa', 'password': 'Passw0rd!'})['token']
call('/hr/documents', {'employeeId': e['id'], 'kind': 'PASSPORT', 'number': 'K5500', 'expiryDate': time.strftime('%Y-%m-%d', time.localtime(time.time() + 12 * 86400))})
with sync_playwright() as pw:
    b = pw.chromium.launch()
    # the HR officer: his home, no money figures; issues the employee's link from the file
    pg, errs = signed_in(b, th)
    pg.goto(B + '/'); pg.wait_for_selector('[data-role-home]', timeout=45000); pg.wait_for_timeout(1200)
    body = pg.inner_text('body')
    ok('النقدية والبنوك' not in body and 'ذمم العملاء' not in body, 'HR home shows no cash or receivables')
    ok('وثيقة موظف تنتهي خلال 30 يوماً' in body, 'HR home carries the expiring passport alert')
    ok(pg.query_selector('[data-hr-kpis]') is not None, 'HR home shows the HR dashboard')
    side = pg.inner_text('.sidebar')
    ok('الموارد البشرية والرواتب' in side and 'المبيعات' not in side and 'دفتر اليومية' not in side, 'menu: HR only')
    pg.goto(B + f"/hr/employees/{e['id']}"); pg.wait_for_selector('[data-emp-portal-make]', timeout=45000); pg.click('[data-emp-portal-make]')
    pg.wait_for_selector('[data-emp-portal-link]', timeout=15000); link = pg.get_attribute('[data-emp-portal-link]', 'data-emp-portal-link')
    ok('/e/' in link, 'link issued from the employee file')
    # the employee on his phone
    ph = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True); pp = ph.new_page(); perr = []
    pp.on('pageerror', lambda x: perr.append(str(x)))
    pp.goto(B + link[link.index('/e/'):])
    if not EG:
        pp.wait_for_selector('[data-emp-pin-input]', timeout=30000); pp.fill('[data-emp-pin-input]', '9999'); pp.keyboard.press('Enter'); pp.wait_for_timeout(800)
        ok('غير صحيحة' in pp.inner_text('body'), 'wrong digits refused')
        pp.fill('[data-emp-pin-input]', '2345'); pp.keyboard.press('Enter')
    pp.wait_for_selector('[data-emp-portal]', timeout=30000)
    ok('سلمان العمري' in pp.inner_text('body') and 'يوم' in pp.inner_text('[data-emp-balance]'), 'portal home: name and leave balance')
    pp.click('[data-emp-tab=slips]'); pp.wait_for_selector(f'[data-emp-slip="{P}"]'); ok('الصافي' in pp.inner_text(f'[data-emp-slip="{P}"]'), 'the posted month\'s payslip')
    pp.click('[data-emp-tab=docs]'); pp.wait_for_timeout(300); ok('تنتهي قريباً' in pp.inner_text('body') and 'K5500' not in pp.inner_text('body'), 'documents: expiring soon, number masked')
    pp.click('[data-emp-tab=leave]'); pp.wait_for_selector('[data-emp-leave-type]')
    types = {x['code']: x['id'] for x in call('/hr/leave-types')}
    d1 = time.strftime('%Y-%m-%d', time.localtime(time.time() + 30 * 86400)); d2 = time.strftime('%Y-%m-%d', time.localtime(time.time() + 33 * 86400))
    pp.select_option('[data-emp-leave-type]', types['ANNUAL']); pp.fill('[data-emp-leave-from]', d1); pp.fill('[data-emp-leave-to]', d2)
    pp.wait_for_selector('[data-emp-leave-quote]', timeout=15000); ok('4 يوم' in pp.inner_text('[data-emp-leave-quote]'), 'live quote: 4 days')
    pp.click('[data-emp-leave-send]'); pp.wait_for_selector('[data-emp-leave-sent]', timeout=15000); pp.wait_for_selector('[data-emp-leave-row=PENDING]', timeout=15000)
    ok(True, 'request sent from the phone, waiting')
    ow = pp.evaluate('document.documentElement.scrollWidth > innerWidth + 1'); ok(not ow, 'no sideways scrolling on the phone')
    ok(not perr, 'no page errors on the portal ' + str(perr[:2]))
    # back at HR: the request is marked and approved
    pg.goto(B + '/hr/leaves'); pg.wait_for_selector('[data-leave-row=PENDING]', timeout=45000)
    ok('من البوابة' in pg.inner_text('[data-leave-row=PENDING]'), 'HR sees it came from the portal')
    pg.click('[data-leave-row=PENDING] [data-leave-approve]'); pg.wait_for_timeout(1200)
    pp.reload(); 
    if not EG: pp.wait_for_selector('[data-emp-portal], [data-emp-pin-input]', timeout=30000)
    if pp.query_selector('[data-emp-pin-input]'): pp.fill('[data-emp-pin-input]', '2345'); pp.keyboard.press('Enter')
    pp.wait_for_selector('[data-emp-tab=leave]', timeout=30000); pp.click('[data-emp-tab=leave]'); pp.wait_for_selector('[data-emp-leave-row=APPROVED]', timeout=15000); ok(True, 'the employee sees it approved')
    ok(not errs, 'no page errors for HR ' + str(errs[:2]))
    # the cashier's home
    pc, cerr = signed_in(b, tc); pc.goto(B + '/'); pc.wait_for_selector('[data-role-home]', timeout=45000); pc.wait_for_timeout(800)
    cb = pc.inner_text('body'); ok('النقدية والبنوك' not in cb and 'صافي الضريبة' not in cb and 'نقطة البيع' in cb, 'cashier home: point of sale, no company figures')
    ok(not cerr, 'no page errors for the cashier ' + str(cerr[:2]))
    b.close()
done()
