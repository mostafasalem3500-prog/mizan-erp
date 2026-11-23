"""3.40 walkthrough: a fictional electronics shop (till + Salla store) runs the latest additions end to end; every journal
entry is read back from the database and compared with what accounting requires.
Usage: B=http://127.0.0.1:3100/api python3 tools/demo/walkthrough_340.py out.json   (local server + its PostgreSQL on 127.0.0.1:5433)
Steps: cashier sells an item with zero recorded stock · card sales with terminal references · a return posted by mistake and
its reversal · the bank's card deposit (by selection, then by statement file with an unknown transaction) · Salla orders, the
platform transfer with its commission, profit per order · books: trial balance, sub-ledgers, VAT return."""
import sys, os, json, time, datetime, subprocess
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'tests', 'api'))
from lib import *
import lib
EG = '3200' in B; R = 0.14 if EG else 0.15; DBN = 'mizan_eg' if EG else 'mizan'
OUT = {'edition': 'EG' if EG else 'SA', 'vat': R, 'steps': []}
def psql(q):
    r = subprocess.run(['psql', '-h', '127.0.0.1', '-p', '5433', '-U', 'postgres', '-d', DBN, '-AtF', '\t', '-c', q], capture_output=True, text=True)
    return [l.split('\t') for l in r.stdout.strip().split('\n') if l]
def entry(eid):
    return [{'code': a, 'account': b, 'debit': float(x), 'credit': float(y)} for a, b, x, y in psql(f"SELECT a.code, a.name_ar, l.debit, l.credit FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE l.entry_id='{eid}' ORDER BY l.sort")]
def net_by_key(lines):
    """debit − credit per system key (accounts without a key by their code)"""
    out = {}
    for l in lines:
        k = CODE.get(l['code'], l['code']); out[k] = round(out.get(k, 0) + l['debit'] - l['credit'], 2)
    return {k: v for k, v in out.items() if abs(v) > 0.004}
def same(lines, want):
    got = net_by_key(lines)
    return set(got) == set(k for k, v in want.items() if abs(v) > 0.004) and all(abs(got[k] - want[k]) < 0.011 for k in got) and abs(sum(l['debit'] - l['credit'] for l in lines)) < 0.005
def step(title, data=None, checks=None): OUT['steps'].append({'title': title, 'data': data, 'checks': checks or []})
def chk(cond, name): ok(cond, name); return {'ok': bool(cond), 'name': name}
d = datetime.date.today(); dt = d.isoformat(); D = lambda n: (d + datetime.timedelta(days=n)).isoformat()
st = str(time.time_ns()); email = f'owner{st}@demo.sa'
t = call('/auth/register', {'fullName': 'خالد الكاشير', 'companyName': 'متجر الريان للإلكترونيات (تجريبي)', 'email': email, 'password': 'Passw0rd!'})['token']
c = lambda *a, **k: call(*a, tok=t, **k)
K = {x.get('systemKey'): x for x in c('/accounts')['rows'] if x.get('systemKey')}; CODE = {v['code']: k for k, v in K.items()}
def bal(key):
    r = [x for x in c('/reports/trial-balance?from=2000-01-01&to=2099-12-31')['rows'] if x['id'] == K[key]['id']]
    return round(float(r[0]['closingDr']) - float(r[0]['closingCr']), 2) if r else 0.0
ADDR = {'street': 'طريق الملك عبدالعزيز', 'buildingNo': '2481', 'district': 'العزيزية', 'city': 'مكة المكرمة', 'postalCode': '24243', 'phone': '0551234567'}
VS = ['300000000000003', '310122393500003'] if not EG else ['200000001', '300000009']

# ── 0. opening ──
c('/journals', {'date': D(-20), 'memo': 'رأس المال المدفوع', 'lines': [{'accountId': K['BANK']['id'], 'debit': 200000, 'credit': 0}, {'accountId': K['CAPITAL']['id'], 'debit': 0, 'credit': 200000}]})
me = c('/users')[0]; c(f"/users/{me['id']}/staff-no", {'staffNo': '1042'}, m='PUT')
sup = c('/partners', {'name': 'شركة التقنية للتوريد', 'isSupplier': True, 'kind': 'COMPANY', 'vatNumber': VS[0], **ADDR})
cust = c('/partners', {'name': 'مؤسسة النور التجارية', 'isCustomer': True, 'kind': 'COMPANY', 'vatNumber': VS[1], **ADDR})
head = c('/products', {'name': 'سماعة لاسلكية', 'sku': 'HS-01', 'type': 'STOCK', 'salePrice': 150, 'purchasePrice': 80, 'taxCode': 'S'})
chg = c('/products', {'name': 'شاحن سريع', 'sku': 'CH-01', 'type': 'STOCK', 'salePrice': 45, 'purchasePrice': 20, 'taxCode': 'S'})
cab = c('/products', {'name': 'كيبل شحن', 'sku': 'CB-01', 'type': 'STOCK', 'salePrice': 15, 'purchasePrice': 6, 'taxCode': 'S'})
def buy(lines, ref):
    b = c('/invoices', {'direction': 'PURCHASE', 'kind': 'INVOICE', 'date': dt, 'partnerId': sup['id'], 'supplierRef': ref, 'lines': [{'productId': p['id'], 'qty': q, 'unitPrice': u, 'taxCode': 'S'} for p, q, u in lines]})
    return c(f"/invoices/{b['id']}/post", {})
buy([(head, 50, 80), (chg, 100, 20)], 'SUP-7001')
sess = c('/pos/session/open', {'openingCash': 500}); sid = sess['id']
def sale(lines, tenders=None, **k): return c('/pos/sale', {'sessionId': sid, 'lines': [{'productId': p['id'], 'qty': q, 'unitPrice': u} for p, q, u in lines], 'tenders': tenders or [{'method': 'CASH', 'amount': None}], **k})
step('0. تجهيز المنشأة', {'company': 'متجر الريان للإلكترونيات', 'staffNo': '1042', 'stock': 'سماعة 50 × 80 · شاحن 100 × 20 · كيبل شحن: لا رصيد'}, [chk(c('/users')[0]['staffNo'] == '1042', 'رقم الموظف 1042 محفوظ للكاشير')])

# ── 1. zero stock at the till ──
try: sale([(cab, 3, 15)]); blocked = None
except E as e: blocked = str(e)
o = sale([(cab, 3, 15)], allowOversell=True); je = entry(o['journalId'])
log = psql(f"SELECT user_name, details->>'number' FROM audit_logs WHERE action='OVERSELL' AND entity_id='{o['id']}'")
al = [a['text'] for a in c('/alerts')['items'] if 'بالسالب' in a['text']]
pb = buy([(cab, 40, 6)], 'SUP-7002')
val = [x for x in c('/inventory/valuation')['rows'] if x.get('sku') == 'CB-01']
step('1. الكاشير يبيع صنفاً رصيده صفر بعد التأكيد', {'refusal': blocked, 'invoice': o['number'], 'issuerNo': o.get('issuerNo'), 'entry': je, 'alert': al, 'afterReceipt': val[:1]},
     [chk(blocked and 'INSUFFICIENT_STOCK' in blocked, 'بلا تأكيد: البيع يتوقف برسالة «الكمية غير كافية»'),
      chk(o['oversold'] and o['issuerNo'] == '1042', 'بعد التأكيد: الفاتورة مرحّلة وموسومة «تخطي رصيد» وعليها رقم الموظف 1042'),
      chk(same(je, {'POS_CASH': float(o['total']), 'SALES': -float(o['taxable']), 'VAT_OUT': -float(o['vatTotal']), 'COGS': 18, 'INVENTORY': -18}), 'القيد: من ح/ الصندوق إلى ح/ المبيعات والضريبة، ومن ح/ تكلفة المبيعات 18.00 (3 × آخر سعر شراء 6) إلى ح/ المخزون'),
      chk(len(log) == 1 and log[0][0] == 'خالد الكاشير', 'سجل التدقيق يحفظ التخطي باسم الكاشير'),
      chk(len(al) == 1, 'لوحة التحكم تنبه: صنف رصيده بالسالب'),
      chk(val and abs(float(val[0]['qty']) - 37) < 0.001 and abs(float(val[0]['value']) - 222) < 0.011, 'بعد تسجيل الوارد (40 × 6): الرصيد 37 بقيمة 222.00 — الكمية والتكلفة صحيحتان'),
      chk(not [a for a in c('/alerts')['items'] if 'بالسالب' in a['text']], 'والتنبيه يختفي')])

# ── 2. card sales ──
cards = [sale([(head, 1, 150)], [{'method': 'CARD', 'amount': None, 'ref': 'RRN-481001'}]), sale([(chg, 2, 45)], [{'method': 'CARD', 'amount': None, 'ref': 'RRN-481002'}]),
         sale([(head, 2, 150), (cab, 1, 15)], [{'method': 'CARD', 'amount': None, 'ref': 'RRN-481003'}]), sale([(chg, 1, 45)], [{'method': 'CARD', 'amount': None}])]
tot = round(sum(float(x['total']) for x in cards), 2); je = entry(cards[0]['journalId']); v = c('/clearing/CARD')
step('2. مبيعات بالشبكة تدخل حساب التسوية', {'sales': [(x['number'], float(x['total'])) for x in cards], 'entry': je, 'ledger': v['ledger'], 'open': v['openTotal']},
     [chk(same(je, {'CARD_CLEARING': float(cards[0]['total']), 'SALES': -float(cards[0]['taxable']), 'VAT_OUT': -float(cards[0]['vatTotal']), 'COGS': 80, 'INVENTORY': -80}), 'قيد بيع الشبكة: من ح/ تسوية مدى والبطاقات (لا البنك) إلى ح/ المبيعات والضريبة، مع تكلفة 80.00'),
      chk(len(v['open']) == 4 and abs(v['openTotal'] - tot) < 0.011 and abs(v['ledger'] - tot) < 0.011 and abs(v['unexplained']) < 0.011, f'أربع عمليات مفتوحة بإجمالي {tot:,.2f} = رصيد حساب التسوية في الأستاذ'),
      chk(v['open'][0]['ref'] == 'RRN-481001', 'رقم العملية على الجهاز محفوظ على البيع')])

# ── 3. a return posted by mistake, then reversed ──
inv = c('/invoices', {'direction': 'SALE', 'kind': 'INVOICE', 'date': dt, 'partnerId': cust['id'], 'lines': [{'productId': head['id'], 'qty': 4, 'unitPrice': 150, 'taxCode': 'S'}]}); inv = c(f"/invoices/{inv['id']}/post", {})
b0 = {k: bal(k) for k in ['AR', 'SALES', 'SALES_RETURNS', 'VAT_OUT', 'INVENTORY', 'COGS']}
cn = c('/invoices', {'direction': 'SALE', 'kind': 'CREDIT_NOTE', 'date': dt, 'partnerId': cust['id'], 'originId': inv['id'], 'reason': 'إرجاع سماعتين', 'lines': [{'productId': head['id'], 'qty': 2, 'unitPrice': 150, 'taxCode': 'S'}]}); cn = c(f"/invoices/{cn['id']}/post", {})
jc = entry(cn['journalId'])
dn = c(f"/invoices/{cn['id']}/reverse-return", {'reason': 'سُجّل المرتجع على فاتورة عميل آخر بالخطأ'}); jd = entry(dn['journalId'])
b1 = {k: bal(k) for k in b0}; doc = c(f"/invoices/{cn['id']}")
try: c(f"/invoices/{cn['id']}/reverse-return", {'reason': 'مرة ثانية'}); twice = False
except E as e: twice = '409' in str(e)[:3]
lst = [r for r in c('/invoices?direction=SALE&kind=CREDIT_NOTE,DEBIT_NOTE')['rows']]
step('3. مرتجع رُحّل بالخطأ ثم أُلغي بإشعار مدين', {'invoice': inv['number'], 'return': cn['number'], 'returnEntry': jc, 'debitNote': dn['number'], 'debitEntry': jd, 'before': b0, 'after': b1, 'list': [(r['number'], r['kind'], r.get('createdBy'), r.get('issuerNo')) for r in lst]},
     [chk(same(jc, {'AR': -float(cn['total']), 'SALES_RETURNS': 300, 'VAT_OUT': float(cn['vatTotal']), 'INVENTORY': 160, 'COGS': -160}), 'قيد المرتجع: من ح/ مردودات المبيعات والضريبة إلى ح/ العميل، ومن ح/ المخزون إلى ح/ تكلفة المبيعات'),
      chk(dn['kind'] == 'DEBIT_NOTE' and abs(float(dn['total']) - float(cn['total'])) < 0.011, 'الإلغاء يصدر إشعاراً مديناً بالمبلغ نفسه — المرتجع نفسه لم يُحذف'),
      chk(same(jd, {'AR': float(cn['total']), 'SALES_RETURNS': -300, 'VAT_OUT': -float(cn['vatTotal']), 'INVENTORY': -160, 'COGS': 160}), 'قيد الإشعار المدين عكس قيد المرتجع تماماً: مردودات المبيعات تعود صفراً'),
      chk(all(abs(b0[k] - b1[k]) < 0.011 for k in b0), 'العميل، المبيعات، المردودات، ضريبة المخرجات، المخزون، التكلفة: كلها عادت كما كانت قبل المرتجع'),
      chk(doc['reversedBy'] == dn['id'] and doc['createdBy'] == 'خالد الكاشير', 'المرتجع يحمل اسم من أصدره وموسوم «أُلغي» مع رابط الإشعار المدين'),
      chk(twice, 'لا يُلغى المرتجع مرتين'),
      chk(all(r.get('createdBy') and r.get('issuerNo') == '1042' for r in lst), 'قائمة الإشعارات تعرض المستخدم ورقم الموظف لكل مستند')])

# ── 4. the bank's deposit: by selection ──
v = c('/clearing/CARD'); a, b_ = v['open'][0], v['open'][1]; two = round(a['open'] + b_['open'], 2)
fee_incl = round(two * 0.008 * (1 + R), 2); net = round(two - fee_incl, 2)
bank0 = bal('BANK')
bt = c('/clearing/CARD/batches', {'date': dt, 'bankAccountId': K['BANK']['id'], 'reference': 'DEP-20261', 'net': net, 'lines': [{'invoiceId': a['invoiceId'], 'gross': a['open']}, {'invoiceId': b_['invoiceId'], 'gross': b_['open']}]})
jb = entry(bt['journalId']); v2 = c('/clearing/CARD')
step('4. إيداع البنك لعمليتي شبكة (بالاختيار والمبلغ الواصل)', {'gross': two, 'received': net, 'batch': bt['number'], 'fees': bt['fees'], 'feeVat': bt['feeVat'], 'entry': jb},
     [chk(same(jb, {'BANK': net, 'BANK_FEES': float(bt['fees']), 'VAT_IN': float(bt['feeVat']), 'CARD_CLEARING': -two}), f'القيد: من ح/ البنك {net:,.2f} + ح/ عمولات بنكية + ح/ ضريبة المدخلات إلى ح/ التسوية {two:,.2f}'),
      chk(abs(float(bt['fees']) + float(bt['feeVat']) - fee_incl) < 0.011 and abs(float(bt['feeVat']) - (fee_incl - fee_incl / (1 + R))) < 0.02, 'العمولة = الفرق بين الإجمالي والواصل، وضريبتها مفصولة منها'),
      chk(len(v2['open']) == 2 and abs(v2['unexplained']) < 0.011 and abs(bal('BANK') - bank0 - net) < 0.011, 'العمليتان أُقفلتا، والباقي مفتوح يساوي رصيد الأستاذ')])

# ── 5. the bank's statement file: one known, one unknown, one wrong amount ──
o3 = [x for x in v2['open'] if x['ref'] == 'RRN-481003'][0]; o4 = [x for x in v2['open'] if not x['ref']][0]
bt2 = c('/clearing/CARD/batches', {'date': dt, 'bankAccountId': K['BANK']['id'], 'reference': 'STMT-1123', 'lines': [
    {'ref': 'RRN-481003', 'date': dt, 'gross': o3['open'], 'fee': round(o3['open'] * 0.008, 2)},
    {'ref': 'RRN-999777', 'date': dt, 'gross': 230.00, 'fee': 1.84},
    {'ref': o4['number'], 'date': dt, 'gross': round(o4['open'] + 10, 2), 'fee': 0.40}]})
jb2 = entry(bt2['journalId']); v3 = c('/clearing/CARD'); al = [a_['text'] for a_ in c('/alerts')['items'] if 'بلا بيع مسجل' in a_['text'] or 'لم تصل البنك' in a_['text']]
step('5. كشف تسوية من البنك: عملية معروفة، عملية بلا بيع، وعملية بمبلغ مختلف', {'batch': bt2['number'], 'matched': bt2['matched'], 'unmatched': v3['unmatched'], 'entry': jb2, 'alerts': al},
     [chk(bt2['matched'] == 1 and bt2['unmatched'] == 2, 'طوبقت العملية برقمها على الجهاز؛ والعمليتان الأخريان لم تُرحَّلا'),
      chk(same(jb2, {'BANK': round(o3['open'] - float(bt2['fees']) - float(bt2['feeVat']), 2), 'BANK_FEES': float(bt2['fees']), 'VAT_IN': float(bt2['feeVat']), 'CARD_CLEARING': -o3['open']}), 'القيد يشمل العملية المطابقة فقط، بعمولتها من الكشف وضريبتها'),
      chk(len(v3['unmatched']) == 2 and any('لا توجد عملية بيع' in u['note'] for u in v3['unmatched']) and any('لا يطابق' in u['note'] for u in v3['unmatched']), 'القائمة تذكر السبب: «لا توجد عملية بيع مطابقة» و«المبلغ لا يطابق المتبقي»'),
      chk(len(v3['open']) == 1 and abs(v3['unexplained']) < 0.011, 'العملية ذات المبلغ المختلف بقيت مفتوحة، والقائمة ما زالت تساوي الأستاذ'),
      chk(any('بلا بيع مسجل' in x for x in al), 'لوحة التحكم تنبه إلى ما في الكشف وليس في النظام')])

# ── 6. e-store (Saudi edition) ──
if not EG:
    c('/integrations/salla', {'storeName': 'متجر الريان على سلة'})
    for i in range(3): c('/integrations/salla/test', {'post': True})
    s0 = c('/clearing/SALLA'); a, b_, x3 = s0['open']
    fee0 = bal('ESTORE_FEES'); bank0 = bal('BANK')
    sb = c('/clearing/SALLA/batches', {'date': dt, 'bankAccountId': K['BANK']['id'], 'reference': 'SALLA-PAYOUT-47', 'lines': [
        {'ref': a['externalRef'].split(':')[-1], 'gross': a['open'], 'fee': round(a['open'] * 0.025 + 1, 2)}, {'ref': b_['number'], 'gross': b_['open'], 'fee': round(b_['open'] * 0.025 + 1, 2)}]})
    js = entry(sb['journalId']); s1 = c('/clearing/SALLA'); pr = c(f'/estore/profit?from={D(-30)}&to={dt}'); O = {x['id']: x for x in pr['orders']}
    pa, pc = O[a['invoiceId']], O[x3['invoiceId']]
    step('6. طلبات سلة: تحويل المنصة بعمولتها، وربحية كل طلب', {'orders': [(x['number'], x['open']) for x in s0['open']], 'batch': sb['number'], 'entry': js, 'profit': pr['orders'], 'totals': pr['totals']},
         [chk(len(s0['open']) == 3 and abs(s0['ledger'] - s0['openTotal']) < 0.011, 'ثلاثة طلبات مدفوعة مستحقة على المنصة = رصيد حساب تسوية المتاجر'),
          chk(same(js, {'BANK': float(sb['net']), 'ESTORE_FEES': float(sb['fees']), 'VAT_IN': float(sb['feeVat']), 'ESTORE_CLEARING': -float(sb['gross'])}), 'القيد: من ح/ البنك + ح/ عمولات منصات البيع (5304) + ح/ ضريبة المدخلات إلى ح/ تسوية المتاجر'),
          chk(sb['matched'] == 2 and len(s1['open']) == 1 and abs(s1['unexplained']) < 0.011, 'طوبق طلب برقم الطلب وآخر برقم الفاتورة؛ الثالث ما زال على المنصة'),
          chk(pa['feeActual'] and abs(pa['profit'] - (pa['revenue'] - pa['cogs'] - pa['fee'])) < 0.011 and abs(pa['profitPerUnit'] - pa['profit'] / pa['units']) < 0.011, f"ربح الطلب المسوّى = الإيراد {pa['revenue']:,.2f} − التكلفة {pa['cogs']:,.2f} − العمولة الفعلية {pa['fee']:,.2f} = {pa['profit']:,.2f}"),
          chk(not pc['feeActual'] and abs(pc['fee'] - (round(pc['total'] * 0.025, 2) + 1)) < 0.011, 'الطلب غير المسوّى: عمولة مقدَّرة بالقاعدة (2.5% + 1) ومكتوب أنها مقدَّرة'),
          chk(abs(pr['totals']['profit'] - sum(x['profit'] for x in pr['orders'])) < 0.011, 'إجمالي الربح = مجموع أرباح الطلبات')])

# ── 7. the assistant, with live figures ──
def ask(text):
    r = c('/ai/chat', {'text': text}); x = r['view'][-1]; return x.get('text') or x.get('content') or str(x)
a1 = ask('كم مبيعات الشبكة اللي ما وصلت البنك'); a2 = ask('كيف الغي مرتجع بعد الترحيل'); a3 = ask('كيف ابيع صنف رصيده صفر')
left = c('/clearing/CARD')['openTotal']
step('7. المساعد المدمج يجيب عن الأسئلة نفسها', {'q1': a1, 'q2': a2[:300], 'q3': a3[:300]},
     [chk(f'{left:,.2f}' in a1 and 'بلا بيع مسجل' in a1, f'«كم لم يصل من الشبكة؟» → الرقم الحي {left:,.2f} وتنبيه بعمليات الكشف غير المسجلة'),
      chk('إشعار مدين' in a2, '«كيف ألغي مرتجع بعد الترحيل» → يشرح الإشعار المدين'), chk('موافقة الكاشير' in a3, '«كيف أبيع صنف رصيده صفر» → يشرح التأكيد والتخطي')])

# ── 8. books ──
tb = c('/reports/trial-balance?from=2000-01-01&to=2099-12-31'); ig = c('/reports/integrity'); vr = c(f'/reports/vat?from={D(-60)}&to={dt}')
step('8. سلامة الدفاتر بعد كل ما سبق', {'trialBalanced': tb['balanced'], 'integrity': [(x['name'], x['ok']) for x in ig['checks']], 'vat': {'output': vr.get('outputVat'), 'input': vr.get('inputVat'), 'glOutput': vr.get('glOutputVat'), 'glInput': vr.get('glInputVat')}},
     [chk(tb['balanced'], 'ميزان المراجعة متوازن'),
      chk(ig['ok'], f"فحص تطابق الدفاتر المساعدة مع الأستاذ: {sum(1 for x in ig['checks'] if x['ok'])}/{len(ig['checks'])}"),
      chk(abs(vr['inputVat'] - vr['glInputVat']) < 0.011 and abs(vr['outputVat'] - vr['glOutputVat']) < 0.011, 'الإقرار الضريبي = حسابات الضريبة (يشمل ضريبة عمولات البنك والمنصة، والإشعار المدين)')])
OUT['fails'] = lib.fails; OUT['email'] = email
json.dump(OUT, open(sys.argv[1], 'w'), ensure_ascii=False, indent=1, default=str)
print('FAILS', len(lib.fails), lib.fails)
