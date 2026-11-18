"""Associations edition (MIZAN_ASSOC=1): a month of dummy operations through every association screen and the
accounting screens beside them. After each operation the ledger movement of the accounts involved is compared
with the textbook entry; at the end the integration audit, the trial balance and the integrity checks must be
clean, cancellations must net to zero, and deliberate corruption must be caught by the audit."""
import sys, os, time, json, subprocess, datetime, urllib.request; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
PG = os.environ.get('TEST_PG', 'postgres://postgres:pg@127.0.0.1:5432') + '/' + os.environ.get('DBN', 'assoc')
def sql(q): return subprocess.run(['psql', PG, '-qtAc', q], check=True, capture_output=True, text=True).stdout.strip()
t = register('ops'); c = lambda *a, **k: call(*a, tok=t, **k)
cid = c('/auth/me')['companyId'] if 'companyId' in c('/auth/me') else sql("SELECT id FROM companies ORDER BY created_at DESC LIMIT 1")
D = datetime.date.today(); d = lambda n: (D - datetime.timedelta(days=n)).isoformat()
c('/charity/settings', {'associationName': 'جمعية العمليات التجريبية', 'licenseNo': '9999', 'authority': 'المركز الوطني لتنمية القطاع غير الربحي'}, m='PUT')
def accs(): a = c('/accounts'); return {x['systemKey']: x for x in (a['rows'] if isinstance(a, dict) else a) if x.get('systemKey')}
A = accs()
ok(all(k in A for k in ['CASH', 'BANK', 'DON_GENERAL', 'DON_ZAKAT', 'DON_RESTRICTED', 'CH_CUSTODY', 'CH_INKIND_STOCK', 'DON_INKIND', 'ESTORE_CLEARING']), 'association chart of accounts present')
SIGN = None
def bal(): return {k: float(v['balance'] or 0) for k, v in accs().items()}
def step(name, fn, exp):
    """exp: expected debit-positive movement per system key; every other account must not move"""
    global SIGN
    b0 = bal(); r = fn(); b1 = bal()
    mv = {k: round(b1.get(k, 0) - b0.get(k, 0), 2) for k in set(b0) | set(b1) if abs(b1.get(k, 0) - b0.get(k, 0)) > 0.004}
    if SIGN is None: SIGN = 1 if mv.get('CASH', 0) > 0 else -1  # first step is a cash receipt
    mv = {k: round(v * SIGN, 2) for k, v in mv.items()}
    want = {k: round(v, 2) for k, v in exp.items() if abs(v) > 0.004}
    good = mv == want
    ok(good, f'{name}: {"" if good else "moved " + json.dumps(mv, ensure_ascii=False) + " expected " + json.dumps(want, ensure_ascii=False)}')
    return r
P1 = c('/charity/projects', {'name': 'سلة رمضان', 'code': 'P-RMD', 'restricted': True, 'budget': 50000})
P2 = c('/charity/projects', {'name': 'كفالة الأيتام', 'code': 'P-ORP'})
donor = c('/charity/donors', {'name': 'محمد العتيبي', 'phone': '0551112233', 'donorType': 'INDIVIDUAL'})
ben = c('/charity/beneficiaries', {'name': 'أسرة رقم 12', 'phone': '0553334444'})

# ── receipts ──
r1 = step('cash general donation 3,000', lambda: c('/charity/receipts', {'date': d(20), 'payerName': 'فاعل خير', 'amount': 3000, 'source': 'CASH_DONATION', 'method': 'CASH'}), {'CASH': 3000, 'DON_GENERAL': -3000})
r2 = step('bank zakat 6,000', lambda: c('/charity/receipts', {'date': d(19), 'partnerId': donor['id'], 'amount': 6000, 'source': 'ZAKAT', 'method': 'TRANSFER', 'refNo': 'TRX-1'}), {'BANK': 6000, 'DON_ZAKAT': -6000})
r3 = step('restricted project donation 4,000 (P1) by cheque', lambda: c('/charity/receipts', {'date': d(18), 'payerName': 'شركة الخير', 'payerType': 'COMPANY', 'amount': 4000, 'source': 'CASH_DONATION', 'method': 'CHEQUE', 'refNo': 'CHQ-77', 'projectId': P1['id']}), {'BANK': 4000, 'DON_RESTRICTED': -4000})
r4 = step('membership fee 200 cash', lambda: c('/charity/receipts', {'date': d(17), 'payerName': 'عضو', 'amount': 200, 'source': 'MEMBERSHIP', 'method': 'CASH', 'feeYear': D.year}), {'CASH': 200, 'DON_MEMBERSHIP': -200})
r5 = step('cash donation 300 (to be cancelled)', lambda: c('/charity/receipts', {'date': d(16), 'payerName': 'خطأ إدخال', 'amount': 300, 'source': 'CASH_DONATION', 'method': 'CASH'}), {'CASH': 300, 'DON_GENERAL': -300})
step('cancel the 300 receipt → reversing entry', lambda: c(f"/charity/receipts/{r5['id']}/cancel", {'reason': 'خطأ'}), {'CASH': -300, 'DON_GENERAL': 300})
je5 = sql(f"SELECT reversed_by IS NOT NULL FROM journal_entries WHERE id='{r5['journalId']}'")
ok(je5 == 't', 'cancelled receipt: original entry marked reversed')

# ── disbursements ──
x1 = step('cash aid 400 from P1 to a beneficiary', lambda: c('/charity/disbursements', {'date': d(15), 'kind': 'CASH', 'partnerId': ben['id'], 'beneficiaryName': 'أسرة رقم 12', 'capacity': 'BENEFICIARY', 'amount': 400, 'reason': 'سلة غذائية', 'projectId': P1['id'], 'payAccountId': A['CASH']['id']}), {'CH_AID': 400, 'CASH': -400})
x2 = step('zakat transfer 1,500 (fuqara)', lambda: c('/charity/disbursements', {'date': d(14), 'kind': 'TRANSFER', 'beneficiaryName': 'مستفيد زكاة', 'capacity': 'BENEFICIARY', 'amount': 1500, 'reason': 'زكاة', 'fund': 'ZAKAT', 'zakatCategory': 'FUQARA', 'refNo': 'TR-9', 'payAccountId': A['BANK']['id'], 'eligibilityOverride': 'اعتماد لجنة المساعدات'}), {'CH_AID': 1500, 'BANK': -1500})
try: c('/charity/disbursements', {'date': d(14), 'kind': 'TRANSFER', 'beneficiaryName': 'x', 'capacity': 'BENEFICIARY', 'amount': 99999, 'reason': 'زكاة', 'fund': 'ZAKAT', 'zakatCategory': 'FUQARA', 'refNo': 'T', 'payAccountId': A['BANK']['id'], 'eligibilityOverride': 'اعتماد لجنة'}); ok(False, 'zakat over-spend blocked')
except E as e: ok('409' in str(e), 'zakat fund cannot pay more than it collected (409)')
try: c('/charity/disbursements', {'date': d(14), 'kind': 'CASH', 'beneficiaryName': 'x', 'capacity': 'BENEFICIARY', 'amount': 6000, 'reason': 'كبير', 'payAccountId': A['CASH']['id']}); ok(False, 'direct limit')
except E as e: ok('AUTHORITY' in str(e) or '409' in str(e), 'a direct payment above 5,000 needs a request (authority matrix)')

# ── request → approval → payment ──
em = f'acc{time.time_ns()}@t.sa'; c('/users', {'email': em, 'fullName': 'المحاسب', 'password': 'Passw0rd!', 'role': 'ACCOUNTANT'})
ta = call('/auth/login', {'email': em, 'password': 'Passw0rd!'})['token']
rq = c('/charity/requests', {'date': d(13), 'purpose': 'إيجار مقر الجمعية', 'requester': 'المدير التنفيذي', 'beneficiaryName': 'مكتب العقار', 'amount': 2500, 'method': 'TRANSFER', 'justification': 'إيجار شهر'})
call(f"/charity/requests/{rq['id']}/review", {}, tok=ta)
try: ap = call(f"/charity/requests/{rq['id']}/approve", {}, tok=ta)
except E as e: ap = {'status': str(e)}
ok(ap.get('status') == 'APPROVED', f"request approved by the accountant (separation of duties: not the one who entered it) → {ap.get('status')}")
x3 = step('pay the approved request 2,500 by transfer', lambda: c('/charity/disbursements', {'date': d(12), 'kind': 'TRANSFER', 'requestId': rq['id'], 'beneficiaryName': 'مكتب العقار', 'capacity': 'SUPPLIER', 'amount': 2500, 'reason': 'إيجار', 'refNo': 'TR-10', 'payAccountId': A['BANK']['id']}), {'CH_PROGRAMS': 2500, 'BANK': -2500})

# ── batch ──
bt = c('/charity/batches', {'date': d(11), 'title': 'مسير مساعدات', 'projectId': P1['id'], 'kind': 'TRANSFER', 'payAccountId': A['BANK']['id'], 'lines': [{'name': 'أسرة 1', 'amount': 600, 'iban': 'SA0380000000608010167519'}, {'name': 'أسرة 2', 'amount': 400, 'iban': 'SA0380000000608010167519'}]})
step('post a 2-line expense run 1,000 from P1', lambda: c(f"/charity/batches/{bt['id']}/post", {}), {'CH_AID': 1000, 'BANK': -1000})

# ── custody ──
cu = c('/charity/custody', {'holderName': 'سعد', 'amount': 1000, 'purpose': 'مشتريات فعالية', 'method': 'CASH', 'projectId': P2['id']})
c(f"/charity/custody/{cu['id']}/approve", {})
step('disburse custody 1,000 cash', lambda: c(f"/charity/custody/{cu['id']}/disburse", {'payAccountId': A['CASH']['id']}), {'CH_CUSTODY': 1000, 'CASH': -1000})
step('settle custody: 700 spent, 300 returned', lambda: c(f"/charity/custody/{cu['id']}/settle", {'date': d(9), 'lines': [{'description': 'ضيافة', 'amount': 450}, {'description': 'مطبوعات', 'amount': 250}], 'returnAccountId': A['CASH']['id']}), {'CH_PROGRAMS': 700, 'CASH': 300, 'CH_CUSTODY': -1000})
cu2 = c('/charity/custody', {'holderName': 'خالد', 'amount': 500, 'purpose': 'نقل', 'method': 'CASH'}); c(f"/charity/custody/{cu2['id']}/approve", {})
step('second custody 500 left open', lambda: c(f"/charity/custody/{cu2['id']}/disburse", {'payAccountId': A['CASH']['id']}), {'CH_CUSTODY': 500, 'CASH': -500})

# ── sponsorship ──
sp = c('/charity/sponsorships', {'sponsorId': donor['id'], 'beneficiaryId': ben['id'], 'kind': 'ORPHAN', 'amount': 300, 'frequency': 1, 'startDate': d(60), 'projectId': P2['id']})
step('collect 2 months of sponsorship 600 by bank', lambda: c(f"/charity/sponsorships/{sp['id']}/collect", {'count': 2, 'date': d(8), 'method': 'TRANSFER', 'refNo': 'SP-1', 'cashAccountId': A['BANK']['id']}), {'BANK': 600, 'DON_SPONSOR': -600})

# ── in-kind ──
ik = step('receive in-kind: 10 bags × 50', lambda: c('/charity/inkind/docs', {'kind': 'IN', 'date': d(7), 'partyName': 'متجر الإحسان', 'lines': [{'name': 'سلة أرز', 'unit': 'كيس', 'qty': 10, 'unitValue': 50}]}), {'CH_INKIND_STOCK': 500, 'DON_INKIND': -500})
item = [x for x in c('/charity/inkind/items') if x['name'] == 'سلة أرز'][0] if isinstance(c('/charity/inkind/items'), list) else [x for x in c('/charity/inkind/items')['rows'] if x['name'] == 'سلة أرز'][0]
io = step('distribute 4 bags (value 200)', lambda: c('/charity/inkind/docs', {'kind': 'OUT', 'date': d(6), 'partyName': 'أسرة رقم 12', 'projectId': P1['id'], 'lines': [{'itemId': item['id'], 'qty': 4}]}), {'CH_INKIND_DIST': 200, 'CH_INKIND_STOCK': -200})
step('cancel the distribution → stock back', lambda: c(f"/charity/inkind/docs/{io['id']}/cancel", {}), {'CH_INKIND_DIST': -200, 'CH_INKIND_STOCK': 200})

# ── Salla donation store ──
s = c('/charity/store', {'mode': 'DONATIONS', 'map': {'defaultSource': 'CASH_DONATION', 'rules': [{'match': 'RMD', 'projectId': P1['id']}]}}, m='PUT')
def hook(body):
    r = urllib.request.Request(B + '/hooks/salla/' + s['connection']['token'], data=json.dumps(body).encode(), method='POST', headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(r) as x: return json.loads(x.read())
step('store order 250 for P1 → clearing account', lambda: hook({'event': 'order.created', 'data': {'id': 55501, 'reference_id': 1, 'status': {'slug': 'completed'}, 'customer': {'first_name': 'نورة', 'mobile': '555000222'}, 'items': [{'name': 'سلة رمضان', 'sku': 'RMD-1', 'quantity': 1, 'amounts': {'total': {'amount': 250}}}]}}), {'ESTORE_CLEARING': 250, 'DON_RESTRICTED': -250})

step('Salla pays out: 230 to the bank, commission 17.39 + VAT 2.61', lambda: c('/integrations/salla/payouts', {'date': d(5), 'net': 230, 'fees': 17.39, 'bankAccountId': A['BANK']['id'], 'reference': 'SALLA-PO-1'}), {'BANK': 230, 'ESTORE_FEES': 17.39, 'VAT_IN': 2.61, 'ESTORE_CLEARING': -250})
ov = c('/charity/store'); ok(near(ov['clearing']['balance'], 0) and len(ov['payouts']) == 1, f"store page: clearing balance {ov['clearing']['balance']} after the payout, payout listed")

# ── the accounting side, same books ──
step('core expense voucher: stationery 100 + VAT cash', lambda: c('/expenses', {'date': d(5), 'accountId': A['CH_EVENTS']['id'], 'description': 'قرطاسية', 'amount': 100, 'taxCode': 'S', 'amountIncludesVat': False, 'payAccountId': A['CASH']['id']}), {'CH_EVENTS': 100, 'VAT_IN': 15, 'CASH': -115})
step('manual journal: cash → bank deposit 500', lambda: c('/journals', {'date': d(4), 'memo': 'إيداع نقدية الصندوق في البنك', 'lines': [{'accountId': A['BANK']['id'], 'debit': 500, 'credit': 0}, {'accountId': A['CASH']['id'], 'debit': 0, 'credit': 500}]}), {'BANK': 500, 'CASH': -500})

# ── the books after the month ──
au = c('/charity/integration-audit')
bad = [f"{x['title']}: {[i['number'] + ' ' + i['issue'] for i in x['items']][:3]} {x.get('expected')}/{x.get('actual')}" for x in au['checks'] if not x['ok']]
ok(au['ok'] and not au['warnings'], f"integration audit clean: {len(au['checks'])} checks over {au['docs']} documents / {au['entries']} entries {bad}")
tb = c(f'/reports/trial-balance?from={D.year}-01-01&to={D.isoformat()}'); ok(tb['balanced'], 'trial balance balanced')
ig = c('/reports/integrity'); ok(all(x['ok'] for x in ig['checks']), f"core integrity checks pass {[x.get('name') for x in ig['checks'] if not x['ok']]}")
B1 = bal()
ok(near(B1['CASH'] * SIGN, 3000 + 200 - 400 - 1000 + 300 - 500 - 115 - 500), f"cash box = {B1['CASH']*SIGN} (3,000 + 200 − 400 − 1,000 + 300 − 500 − 115 − 500 = 985)")
ok(near(B1['BANK'] * SIGN, 6000 + 4000 - 1500 - 2500 - 1000 + 600 + 230 + 500), f"bank = {B1['BANK']*SIGN} (6,000 + 4,000 − 1,500 − 2,500 − 1,000 + 600 + 230 + 500 = 6,330)")
ok(near(-B1['DON_ZAKAT'] * SIGN, 6000), 'zakat revenue in the ledger = zakat collected (6,000)')
ok(near(B1['CH_CUSTODY'] * SIGN, 500), 'custody account = the one open custody (500)')
vr = c(f'/charity/vouchers?from={D.year}-01-01&to={D.isoformat()}'); ok(vr['mismatches'] == 0, f"unified voucher register: {len(vr['rows'])} vouchers from both systems, 0 mismatches")
ok(any(r['src'] == 'CORE_EXP' for r in vr['rows']) and any(r['src'] == 'CH_RCPT' for r in vr['rows']), 'the register shows the accounting-side expense next to the association receipts')

# ── deliberate corruption is caught, then restored ──
def flagged(key):
    a = c('/charity/integration-audit'); return [x for x in a['checks'] if x['key'] == key and not x['ok']]
jid = r1['journalId']
sql(f"UPDATE charity_receipts SET journal_id=NULL WHERE id='{r1['id']}'")
f1 = flagged('doc-CH_RCPT'); ok(f1 and r1['number'] in json.dumps(f1, ensure_ascii=False) and f1[0]['items'][0]['issue'] == 'مرحّل بلا قيد', 'receipt that lost its entry is flagged with its number')
ok(flagged('orphans'), '…and its entry shows as an orphan')
sql(f"UPDATE charity_receipts SET journal_id='{jid}' WHERE id='{r1['id']}'")
sql(f"UPDATE charity_receipts SET amount=amount+10 WHERE id='{r2['id']}'")
ok(flagged('doc-CH_RCPT') and flagged('vouchers'), 'receipt amount edited behind the entry: flagged by document and voucher checks')
sql(f"UPDATE charity_receipts SET amount=amount-10 WHERE id='{r2['id']}'")
sql(f"UPDATE charity_inkind_items SET value=value+1 WHERE id='{item['id']}'")
ok(flagged('inkind'), 'in-kind stock register out of step with the ledger: flagged')
sql(f"UPDATE charity_inkind_items SET value=value-1 WHERE id='{item['id']}'")
ok(c('/charity/integration-audit')['ok'], 'clean again after restoring')
print('FAILS', len(fails)); sys.exit(1 if fails else 0)
