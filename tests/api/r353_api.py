"""3.53: the HR officer role — keeps employee files, leave, documents and attendance, prepares and approves payroll,
but cannot post the run's entry, pay it, read the books or change the approval policy. Under the approval policy the
run is approved by someone other than whoever prepared it. The accountant keeps every HR screen it had."""
import sys, os, time; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
EG = '3200' in B
t = register('r353'); c = lambda *a, **k: call(*a, tok=t, **k)
st = str(time.time_ns()); P = time.strftime('%Y-%m')
def iban(bban, cc):
    s = ''.join(str(ord(ch) - 55) if ch.isalpha() else ch for ch in bban + cc + '00'); return cc + str(98 - int(s) % 97).zfill(2) + bban
IB = iban('80000123456789012345', 'SA') if not EG else iban('0019' + '0' * 21, 'EG')
roles = c('/auth/me')['roles']; ok(roles.get('HR') == 'مسؤول الموارد البشرية', 'the role is offered when adding a user')
c('/users', {'email': f'hr{st}@t.sa', 'fullName': 'مسؤول الموارد', 'password': 'Passw0rd!', 'role': 'HR'})
c('/users', {'email': f'acc{st}@t.sa', 'fullName': 'المحاسب', 'password': 'Passw0rd!', 'role': 'ACCOUNTANT'})
th = call('/auth/login', {'email': f'hr{st}@t.sa', 'password': 'Passw0rd!'})['token']; h = lambda *a, **k: call(*a, tok=th, **k)
ta = call('/auth/login', {'email': f'acc{st}@t.sa', 'password': 'Passw0rd!'})['token']; a = lambda *a_, **k: call(*a_, tok=ta, **k)
def denied(f, *args, **kw):
    try: f(*args, **kw); return False
    except E as e: return str(e).startswith('403')
# HR keeps the file
e = h('/employees', {'name': 'موظف الموارد', 'hireDate': '2024-01-01', 'basic': 5000, 'housing': 1250, 'nationality': 'SAUDI' if not EG else 'EGYPTIAN', 'iban': IB, 'idType': 'NATIONAL_ID', 'idNumber': '1098765432' if not EG else None, 'gender': 'M'})
ok(e['id'] and h(f"/hr/employees/{e['id']}/profile")['employee']['name'] == 'موظف الموارد', 'HR adds an employee and opens the file')
lv = h('/hr/leave-requests', {'employeeId': e['id'], 'type': 'UNPAID', 'fromDate': P + '-05', 'toDate': P + '-05'})
ok(h(f"/hr/leave-requests/{lv['id']}/approve", {})['status'] == 'APPROVED', 'HR decides leave')
ok(h('/hr/documents', {'employeeId': e['id'], 'kind': 'PASSPORT', 'number': 'P1', 'expiryDate': '2030-01-01'})['id'], 'HR records documents')
ok(isinstance(h(f'/attendance?period={P}'), (dict, list)), 'HR sees attendance')
ok(h('/hr/dashboard')['headcount']['active'] >= 1, 'HR dashboard')
# HR cannot touch the books or the policy
ok(denied(h, '/accounts'), 'HR does not read the chart of accounts')
ok(denied(h, '/journals', {'date': time.strftime('%Y-%m-%d'), 'memo': 'x', 'lines': []}), 'HR cannot write journal entries')
ok(denied(h, '/hr/settings', {'requireApproval': False}, m='PUT'), 'HR cannot switch the approval policy')
ok(denied(h, '/invoices'), 'HR does not see sales invoices')
# policy on: prepare (HR) → approve (someone else) → post (accountant)
c('/hr/settings', {'requireApproval': True}, m='PUT')
run = h('/payroll', {'period': P}); ok(run['status'] == 'DRAFT', 'HR prepares the run')
ok(denied(h, f"/payroll/{run['id']}/post", {}), 'HR cannot post the run entry')
try: h(f"/payroll/{run['id']}/approve", {}); ok(False, 'self approval')
except E as x: ok('غير من أعدّه' in str(x), 'the preparer cannot approve his own run')
try: a(f"/payroll/{run['id']}/post", {}); ok(False, 'post unapproved')
except E as x: ok('يُعتمد المسير قبل ترحيله' in str(x), 'the accountant cannot post it before approval')
ok(a(f"/payroll/{run['id']}/approve", {})['status'] == 'APPROVED', 'another user approves')
ok(a(f"/payroll/{run['id']}/post", {})['status'] == 'POSTED', 'the accountant posts')
# the accountant still keeps every HR screen it had
ok(a('/hr/dashboard')['headcount']['active'] >= 1 and len(a('/employees')) >= 1 and a(f"/hr/employees/{e['id']}/profile"), 'accountant keeps HR access')
# the home figures and the alerts follow the role
t3 = register('r353c'); c3 = lambda *a_, **kw: call(*a_, tok=t3, **kw)   # the trial allows three users: the cashier gets his own establishment
c3('/users', {'email': f'cash{st}@t.sa', 'fullName': 'الكاشير', 'password': 'Passw0rd!', 'role': 'CASHIER'})
tc = call('/auth/login', {'email': f'cash{st}@t.sa', 'password': 'Passw0rd!'})['token']; k = lambda *a_, **kw: call(*a_, tok=tc, **kw)
e3 = c3('/employees', {'name': 'موظف', 'hireDate': '2024-01-01', 'basic': 4000, 'housing': 0, 'nationality': 'SAUDI' if not EG else 'EGYPTIAN', 'iban': IB})
c3('/hr/documents', {'employeeId': e3['id'], 'kind': 'IQAMA', 'number': 'I8', 'expiryDate': time.strftime('%Y-%m-%d', time.localtime(time.time() + 9 * 86400))})
ok('/hr/documents' in [x['to'] for x in c3('/alerts')['items']] and '/hr/documents' not in [x['to'] for x in k('/alerts')['items']], 'the owner gets the HR alert, the cashier does not')
ok(denied(k, '/dashboard') and denied(h, '/dashboard') and denied(k, '/brief') and denied(k, '/dashboard/pulse?period=month'), 'cashier and HR officer do not get cash, receivables or profit')
ok(isinstance(c('/dashboard')['salesMonth'], (int, float)), 'the owner still gets the full home')
h('/hr/documents', {'employeeId': e['id'], 'kind': 'IQAMA', 'number': 'I9', 'expiryDate': time.strftime('%Y-%m-%d', time.localtime(time.time() + 10 * 86400))})
ha = [x['to'] for x in h('/alerts')['items']]; ka = [x['to'] for x in k('/alerts')['items']]; oa = [x['to'] for x in c('/alerts')['items']]
ok('/hr/documents' in ha and '/hr/documents' in oa, 'the expiring iqama reaches the HR officer and the owner ' + str(ha))
ok(all(not str(x).startswith(('/hr', '/vat', '/reports', '/sales', '/purchases', '/cheques', '/zatca')) for x in ka), 'the cashier sees no HR or finance alerts ' + str(ka))
ok(all(str(x).startswith(('/hr', '/payroll')) for x in ha), 'the HR officer sees only HR alerts ' + str(ha))
# employee self-service link: ID check, payslips of posted runs only, leave request waiting for HR, lock after 5 wrong tries
pl = h(f"/hr/employees/{e['id']}/portal", {}); tok = pl['token']
ok(pl['path'] == f'/e/{tok}' and pl['pinRequired'] == (not EG), 'HR issues the link (ID digits asked when an ID is on file)')
pub = lambda path, body: call(f'/public/emp/{tok}{path}', body)
if not EG:
    try: pub('', {}); ok(False, 'no pin')
    except E as x: ok('PIN_REQUIRED' in str(x), 'the link asks for the ID digits')
PIN = None if EG else '5432'
v = pub('', {'pin': PIN})
ok(v['employee']['name'] == 'موظف الموارد' and 'iban' not in v['employee'] and v['employee']['ibanTail'] == IB[-4:], 'the employee sees his file, the IBAN only by its last four digits')
ok([x['period'] for x in v['payslips']] == [P] and abs(float(v['payslips'][0]['net']) - float([l for l in run['lines'] if l['employeeId'] == e['id']][0]['net'])) < 0.01, 'payslip of the posted run, same net as the run')
ok(all('•' in (d['number'] or '•') for d in v['documents']), 'document numbers are masked')
ann = [x for x in v['leaveTypes'] if x['code'] == 'ANNUAL'][0]
nd = time.strftime('%Y-%m-%d', time.localtime(time.time() + 40 * 86400)); nd2 = time.strftime('%Y-%m-%d', time.localtime(time.time() + 42 * 86400))
q = pub('/quote', {'pin': PIN, 'typeId': ann['id'], 'fromDate': nd, 'toDate': nd2}); ok(q['days'] == 3, 'quote from the link: 3 days')
rq = pub('/leave', {'pin': PIN, 'typeId': ann['id'], 'fromDate': nd, 'toDate': nd2, 'reason': 'سفر'})
mine = [l for l in h(f"/hr/leave-requests?employeeId={e['id']}") if l['id'] == rq['id']][0]
ok(rq['status'] == 'PENDING' and mine['via'] == 'PORTAL' and mine['status'] == 'PENDING', 'the request waits for HR, marked as from the portal')
ok(h(f"/hr/leave-requests/{rq['id']}/approve", {})['status'] == 'APPROVED', 'HR approves it')
ok([l for l in pub('', {'pin': PIN})['leaves'] if l['id'] == rq['id']][0]['status'] == 'APPROVED', 'the employee sees the decision')
try: pub('/cancel', {'pin': PIN, 'id': rq['id']}); ok(False, 'cancel approved')
except E as x: ok('لم يُقرَّر' in str(x), 'an approved leave is not cancelled from the link')
other = h('/employees', {'name': 'آخر', 'hireDate': '2024-01-01', 'basic': 4000, 'housing': 0, 'nationality': 'SAUDI' if not EG else 'EGYPTIAN', 'iban': IB, 'idType': 'NATIONAL_ID', 'idNumber': '1023456789' if not EG else None})
try: pub('/quote', {'pin': PIN, 'typeId': ann['id'], 'fromDate': nd, 'toDate': nd2, 'employeeId': other['id']})
except E: pass
ok(not [l for l in h(f"/hr/leave-requests?employeeId={other['id']}")], 'the link cannot act for another employee')
h(f"/hr/employees/{e['id']}/portal", None, m='DELETE')
try: call(f'/public/emp/{tok}', {'pin': PIN}); ok(False, 'revoked')
except E as x: ok(str(x).startswith('404'), 'a withdrawn link stops working')
try: call('/public/emp/not-a-token', {}); ok(False, 'bad')
except E as x: ok(str(x).startswith('404'), 'a malformed link is refused')
if not EG:
    t2 = h(f"/hr/employees/{other['id']}/portal", {})['token']
    for i in range(5):
        try: call(f'/public/emp/{t2}', {'pin': '0000'})
        except E: pass
    try: call(f'/public/emp/{t2}', {'pin': '6789'}); ok(False, 'locked')
    except E as x: ok('LOCKED' in str(x), 'five wrong tries lock the link, even with the right digits after')
# a one-person establishment approves its own run
t1 = register('r353s'); c1 = lambda *a_, **k: call(*a_, tok=t1, **k)
c1('/hr/settings', {'requireApproval': True}, m='PUT')
c1('/employees', {'name': 'وحيد', 'hireDate': '2024-01-01', 'basic': 4000, 'housing': 1000, 'nationality': 'SAUDI' if not EG else 'EGYPTIAN', 'iban': IB})
r1 = c1('/payroll', {'period': P}); ok(c1(f"/payroll/{r1['id']}/approve", {})['status'] == 'APPROVED', 'a sole user approves his own run')
# a sick leave across two months: 30 days at full pay then 10 at three quarters; the 75% days straddle the month start,
# so each month carries its own days' share (5 × 0.25 = 1.25 each), not the whole 2.5 in the last month
import datetime as dt
m0 = dt.date.today().replace(day=1); f0 = m0 - dt.timedelta(days=35); t0 = m0 + dt.timedelta(days=4); pm = (m0 - dt.timedelta(days=1)).strftime('%Y-%m')
w = c('/employees', {'name': 'مريض الشهرين', 'hireDate': '2020-01-01', 'basic': 3000, 'housing': 0, 'nationality': 'SAUDI' if not EG else 'EGYPTIAN', 'iban': IB, 'gender': 'M'})
sk = c('/hr/leave-requests', {'employeeId': w['id'], 'type': 'SICK', 'fromDate': f0.isoformat(), 'toDate': t0.isoformat(), 'approve': True})
if not EG:
    ok(sk['status'] == 'APPROVED' and [round(float(x['pct'])) for x in sk['pay']] == [100, 75], 'sick leave tiers: full then three quarters ' + str(sk.get('pay')))
    def ld(per): l = [x for x in c(f'/payroll/preview?period={per}') if x['employeeId'] == w['id']][0]; return (l.get('leaveDeduction') or {}).get('days', 0)
    ok(abs(ld(pm) - 1.25) < 0.001 and abs(ld(P) - 1.25) < 0.001, f'each month carries its own share: {ld(pm)} and {ld(P)} days')
print('FAILS', fails); sys.exit(1 if fails else 0)
