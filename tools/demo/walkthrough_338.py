"""3.38 walkthrough: a fictional restaurant runs the new features end to end; every entry is read back and checked.
Usage: B=http://127.0.0.1:3100/api python3 tools/demo/walkthrough_338.py out.json   (local server + its PostgreSQL on 127.0.0.1:5433, read with psql)
Creates a fresh fictional establishment («مطعم ومقهى الواحة») on a local server, runs every 3.38 feature, reads each entry back from the database and checks it; writes the results to out.json."""
import sys, os, json, time, datetime, subprocess
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'tests', 'api'))
from urllib.parse import quote
from lib import *
import lib
EG = '3200' in B; R = 0.14 if EG else 0.15; DBN = 'mizan_eg' if EG else 'mizan'
OUT = {'edition': 'EG' if EG else 'SA', 'vat': R, 'steps': []}
def psql(q):
    r = subprocess.run(['psql', '-h', '127.0.0.1', '-p', '5433', '-U', 'postgres', '-d', DBN, '-AtF', '\t', '-c', q], capture_output=True, text=True)
    return [l.split('\t') for l in r.stdout.strip().split('\n') if l]
def entry(eid):
    return [{'code': a, 'account': b, 'debit': float(c), 'credit': float(d)} for a, b, c, d in psql(f"SELECT a.code, a.name_ar, l.debit, l.credit FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE l.entry_id='{eid}' ORDER BY l.debit DESC, l.sort")]
def step(title, data=None, checks=None):
    OUT['steps'].append({'title': title, 'data': data, 'checks': checks or []})
def chk(cond, name):
    ok(cond, name); return {'ok': bool(cond), 'name': name}
d = datetime.date.today(); dt = d.isoformat(); D = lambda n: (d + datetime.timedelta(days=n)).isoformat()
st = str(time.time_ns())
email = f'owner{st}@demo.sa'
t = call('/auth/register', {'fullName': 'سالم المالك', 'companyName': 'مطعم ومقهى الواحة (تجريبي)', 'email': email, 'password': 'Passw0rd!'})['token']
c = lambda *a, **k: call(*a, tok=t, **k)
OUT['token'] = t
me = c('/auth/me'); incl = bool(me['company'].get('pricesIncludeVat')); OUT['incl'] = incl
K = {x.get('systemKey'): x for x in c('/accounts')['rows'] if x.get('systemKey')}
def bal(key):
    r = [x for x in c(f'/reports/trial-balance?from=2000-01-01&to={dt}')['rows'] if x['id'] == K[key]['id']]
    return round(float(r[0]['closingDr']) - float(r[0]['closingCr']), 2) if r else 0.0
ADDR = {'street': 'طريق الملك عبدالعزيز', 'buildingNo': '2481', 'district': 'العزيزية', 'city': 'مكة المكرمة', 'postalCode': '24243', 'phone': '0551234567'}
VS = ['300000000000003', '300000000100003', '300000000200003', '310122393500003'] if not EG else ['200000001', '200000002', '200000003', '300000009']
c('/journals', {'date': dt, 'memo': 'رأس المال المدفوع', 'lines': [{'accountId': K['BANK']['id'], 'debit': 150000, 'credit': 0}, {'accountId': K['CAPITAL']['id'], 'debit': 0, 'credit': 150000}]})

# ── 1. modifiers ──
hot = c('/categories', {'name': 'مشروبات ساخنة'}); meals = c('/categories', {'name': 'وجبات'})
latte = c('/products', {'name': 'لاتيه', 'sku': 'LT1', 'type': 'SERVICE', 'salePrice': 14, 'taxCode': 'S', 'categoryId': hot['id']})
burger = c('/products', {'name': 'برجر لحم', 'sku': 'BG1', 'type': 'SERVICE', 'salePrice': 32, 'taxCode': 'S', 'categoryId': meals['id']})
water = c('/products', {'name': 'مياه معدنية', 'sku': 'WT1', 'type': 'STOCK', 'salePrice': 3, 'purchasePrice': 1, 'taxCode': 'S'})
size = c('/modifiers', {'name': 'حجم المشروب', 'minSelect': 1, 'maxSelect': 1, 'options': [{'name': 'صغير', 'price': 0}, {'name': 'وسط', 'price': 3}, {'name': 'كبير', 'price': 5}], 'categoryIds': [hot['id']]})
cof = c('/modifiers', {'name': 'إضافات القهوة', 'minSelect': 0, 'maxSelect': 2, 'options': [{'name': 'شوت إسبريسو', 'price': 4}, {'name': 'حليب شوفان', 'price': 3}], 'categoryIds': [hot['id']]})
bx = c('/modifiers', {'name': 'إضافات البرجر', 'minSelect': 0, 'maxSelect': 3, 'options': [{'name': 'جبن', 'price': 3}, {'name': 'لحم إضافي', 'price': 8}, {'name': 'بدون بصل', 'price': 0}], 'productIds': [burger['id']]})
O = lambda g, n: [o for o in g['options'] if o['name'] == n][0]['id']
cs = []
try: c('/pos/sale', {});
except E: pass
step('1. تعريف مجموعات الإضافات', {'groups': [{'name': g['name'], 'rule': f"{g['minSelect']}–{g['maxSelect']}", 'options': [f"{o['name']} +{o['price']}" for o in g['options']]} for g in (size, cof, bx)]},
     [chk(len(c('/modifiers/live')) == 3, 'ثلاث مجموعات فعّالة تقرؤها نقطة البيع')])
# ── 2. restaurant + service charge ──
c('/pos/restaurant/settings', {'mode': 'RESTAURANT', 'serviceCharge': {'pct': 10, 'types': ['DINE_IN'], 'label': 'رسوم الخدمة'}}, m='PUT')
sess = c('/pos/session/open', {'openingCash': 500}); sid = sess['id']
sale = lambda lines, **k: c('/pos/sale', {'sessionId': sid, 'lines': lines, 'tenders': [{'method': k.pop('method', 'CASH'), 'amount': None}], **k})
# rules refused
rej = []
for body, lab in [([{'productId': latte['id'], 'qty': 1}], 'لاتيه بلا اختيار الحجم (إلزامي)'), ([{'productId': latte['id'], 'qty': 1, 'modifiers': [O(size, 'صغير'), O(size, 'كبير')]}], 'حجمان لكوب واحد'), ([{'productId': burger['id'], 'qty': 1, 'modifiers': [O(size, 'كبير')]}], 'حجم مشروب على برجر')]:
    try: sale(body); rej.append({'case': lab, 'refused': False})
    except E as e: rej.append({'case': lab, 'refused': True, 'msg': str(e).split('"message":"')[-1].split('"')[0]})
step('2. قواعد الاختيار تُفرض في الخادم', {'cases': rej}, [chk(all(x['refused'] for x in rej), 'الحالات الثلاث مرفوضة برسالة واضحة')])
# ── 3. take-away sale with modifiers ──
# water is stock: bought first
sup_w = c('/partners', {'name': 'شركة المياه الصافية', 'isSupplier': True, 'kind': 'COMPANY', 'vatNumber': VS[2], **ADDR, 'paymentTerms': 30})
def bill(pid, lines, date, due, ref):
    i = c('/invoices', {'direction': 'PURCHASE', 'kind': 'INVOICE', 'date': date, 'dueDate': due, 'partnerId': pid, 'supplierRef': ref, 'lines': lines}); return c(f"/invoices/{i['id']}/post", {})
bw = bill(sup_w['id'], [{'productId': water['id'], 'qty': 200, 'unitPrice': 1}], D(-10), D(20), 'W-5531')
a = sale([{'productId': latte['id'], 'qty': 2, 'unitPrice': 14, 'modifiers': [O(size, 'كبير'), O(cof, 'شوت إسبريسو')]}, {'productId': water['id'], 'qty': 1, 'unitPrice': 3}])
la = [l for l in a['lines'] if 'لاتيه' in l['description']][0]
ea = entry(psql(f"SELECT journal_id FROM invoices WHERE id='{a['id']}'")[0][0])
step('3. طلب سفري: 2 لاتيه كبير + شوت إسبريسو، ومياه', {'invoice': a['number'], 'lines': [{'description': l['description'], 'qty': l['qty'], 'unitPrice': l['unitPrice'], 'net': l['netAmount'], 'vat': l['vatAmount'], 'total': l['total']} for l in a['lines']], 'total': a['total'], 'entry': ea},
     [chk(near(la['unitPrice'], 23), 'سعر اللاتيه = 14 + 5 (كبير) + 4 (شوت) = 23'), chk('كبير' in la['description'] and 'شوت' in la['description'], 'الإضافات مكتوبة على سطر الفاتورة'),
      chk(near(sum(x['debit'] for x in ea), sum(x['credit'] for x in ea)), 'القيد متوازن')])
# ── 4. dine-in order with service charge ──
T = c('/pos/restaurant')['floors'][0]['tables']
o = c('/pos/orders', {'tableId': T[2]['id'], 'guests': 4})
mods = lambda g, names: [{'optionId': O(g, n), 'name': n, 'price': [x for x in g['options'] if x['name'] == n][0]['price']} for n in names]
ol = [{'key': f"{burger['id']}::a", 'productId': burger['id'], 'name': 'برجر لحم', 'qty': 2, 'unitPrice': 43, 'discountPct': 0, 'mods': mods(bx, ['جبن', 'لحم إضافي'])},
      {'key': f"{burger['id']}::b", 'productId': burger['id'], 'name': 'برجر لحم', 'qty': 1, 'unitPrice': 32, 'discountPct': 0, 'mods': mods(bx, ['بدون بصل'])},
      {'key': f"{latte['id']}::c", 'productId': latte['id'], 'name': 'لاتيه', 'qty': 2, 'unitPrice': 17, 'discountPct': 0, 'mods': mods(size, ['وسط'])}]
c(f"/pos/orders/{o['id']}", {'lines': ol}, m='PUT')
tk = c(f"/pos/orders/{o['id']}/send", {})['ticket']
kit = c('/pos/kitchen')
b = sale([{'productId': burger['id'], 'qty': 2, 'unitPrice': 32, 'modifiers': [O(bx, 'جبن'), O(bx, 'لحم إضافي')]}, {'productId': burger['id'], 'qty': 1, 'unitPrice': 32, 'modifiers': [O(bx, 'بدون بصل')]}, {'productId': latte['id'], 'qty': 2, 'unitPrice': 14, 'modifiers': [O(size, 'وسط')]}], orderId=o['id'], method='CARD')
svc = [l for l in b['lines'] if 'رسوم الخدمة' in l['description']]
goods = round(sum(float(l['netAmount']) for l in b['lines'] if l not in svc), 2)
eb = entry(psql(f"SELECT journal_id FROM invoices WHERE id='{b['id']}'")[0][0])
step('4. طاولة 3 (4 ضيوف): برجر بإضافات، ولاتيه وسط، ورسوم خدمة 10%', {'ticket': tk['items'], 'invoice': b['number'], 'lines': [{'description': l['description'], 'qty': l['qty'], 'unitPrice': l['unitPrice'], 'net': l['netAmount'], 'vat': l['vatAmount'], 'total': l['total']} for l in b['lines']], 'total': b['total'], 'entry': eb, 'goodsNet': goods},
     [chk(any('جبن' in x['name'] and 'لحم إضافي' in x['name'] for x in tk['items']), 'تذكرة المطبخ تذكر الإضافات'), chk(len(kit) == 1, 'شاشة المطبخ تعرض الطلب'),
      chk(len(svc) == 1 and near(svc[0]['netAmount'], round(goods * 0.10, 2)), f'رسوم الخدمة = 10% من صافي الأصناف {goods} = {round(goods*0.1,2)}'),
      chk(len(svc) == 1 and near(svc[0]['vatAmount'], round(goods * 0.10 * R, 2)), f'رسوم الخدمة عليها ضريبة {int(R*100)}%'),
      chk(c(f"/pos/orders/{o['id']}")['status'] == 'PAID', 'الطلب أُغلق والطاولة تحررت'),
      chk(near(sum(x['debit'] for x in eb), sum(x['credit'] for x in eb)), 'القيد متوازن')])
# ── 5. waived + take-away ──
o2 = c('/pos/orders', {'tableId': T[4]['id'], 'guests': 2})
w = sale([{'productId': burger['id'], 'qty': 2, 'unitPrice': 32, 'modifiers': [O(bx, 'جبن')]}], orderId=o2['id'], waiveServiceCharge=True)
o3 = c('/pos/orders', {'type': 'TAKEAWAY'})
tw = sale([{'productId': latte['id'], 'qty': 1, 'unitPrice': 14, 'modifiers': [O(size, 'صغير')]}], orderId=o3['id'])
wn = c(f"/invoices/{w['id']}").get('notes')
step('5. طاولة 5 بإعفاء من رسوم الخدمة، وطلب سفري', {'waived': {'invoice': w['number'], 'notes': wn, 'total': w['total']}, 'takeaway': {'invoice': tw['number'], 'total': tw['total']}},
     [chk(not any('رسوم الخدمة' in l['description'] for l in w['lines']) and 'أُعفي' in (wn or ''), 'الإعفاء: لا سطر رسوم، والإعفاء واسم الكاشير مكتوبان على الفاتورة'),
      chk(not any('رسوم الخدمة' in l['description'] for l in tw['lines']), 'السفري بلا رسوم خدمة')])
# ── 6. return ──
ret = c('/pos/return', {'sessionId': sid, 'originId': b['id'], 'lines': [{'productId': burger['id'], 'qty': 1}], 'reason': 'الطلب وصل بارداً'})
step('6. مرتجع برجر من فاتورة الطاولة 3', {'creditNote': ret['number'], 'lines': [{'description': l['description'], 'unitPrice': l['unitPrice'], 'total': l['total']} for l in ret['lines']], 'total': ret['total']},
     [chk(near(ret['lines'][0]['unitPrice'], 43) and 'جبن' in ret['lines'][0]['description'], 'المرتجع بسعر البرجر مع إضافاته (43)')])
rp = c(f'/pos/restaurant/report?from={dt}&to={dt}')
step('7. تقرير المطعم: الإضافات المباعة ورسوم الخدمة', {'modifiers': rp['modifiers'], 'service': rp['service'], 'orders': rp['orders'], 'total': rp['total']},
     [chk(any(m['name'] == 'جبن' and near(m['qty'], 3) for m in rp['modifiers']), 'الجبن: 2 + 2 − 1 مرتجع = 3'), chk(near(rp['service']['net'], svc[0]['netAmount']), 'رسوم الخدمة المحصلة في التقرير = سطر الفاتورة')])
cash_sales = float(a['total']) + float(w['total']) + float(tw['total'])  # paid in cash; the dine-in bill was by card and its return refunded to the card
cl = c('/pos/session/close', {'sessionId': sid, 'countedCash': 500 + cash_sales})
step('7ب. إغلاق الوردية', {'expected': cl.get('expectedCash'), 'counted': cl.get('countedCash'), 'difference': cl.get('difference')}, [chk(abs(float(cl.get('difference') or 0)) < 0.01, 'الصندوق مطابق: لا عجز ولا زيادة (المرتجع رُدّ على البطاقة)')])

# ── 8. suppliers and payment run ──
sup_m = c('/partners', {'name': 'مؤسسة اللحوم الطازجة', 'isSupplier': True, 'kind': 'COMPANY', 'vatNumber': VS[0], **ADDR, 'paymentTerms': 15})
sup_b = c('/partners', {'name': 'محمصة البن الذهبي', 'isSupplier': True, 'kind': 'COMPANY', 'vatNumber': VS[1], **ADDR, 'paymentTerms': 30})
supply = c('/products', {'name': 'لحم مفروم (كجم)', 'sku': 'MT1', 'type': 'STOCK', 'salePrice': 0, 'purchasePrice': 38, 'taxCode': 'S'})
beans = c('/products', {'name': 'بن مختص (كجم)', 'sku': 'BN1', 'type': 'STOCK', 'salePrice': 0, 'purchasePrice': 90, 'taxCode': 'S'})
b1 = bill(sup_m['id'], [{'productId': supply['id'], 'qty': 100, 'unitPrice': 38}], D(-25), D(-10), 'LH-1201')
b2 = bill(sup_m['id'], [{'productId': supply['id'], 'qty': 80, 'unitPrice': 38}], D(-8), D(5), 'LH-1235')
b3 = bill(sup_b['id'], [{'productId': beans['id'], 'qty': 30, 'unitPrice': 90}], D(-12), D(3), 'GB-77')
b4 = bill(sup_b['id'], [{'productId': beans['id'], 'qty': 20, 'unitPrice': 90}], D(-2), D(28), 'GB-81')
pp = c(f'/payment-runs/propose?dueUntil={D(7)}')
lines = [{'invoiceId': i['invoiceId'], 'amount': i['amount']} for s in pp['suppliers'] for i in s['invoices']]
gb = [l for l in lines if l['invoiceId'] == b3['id']][0]; gb['amount'] = round(gb['amount'] / 2, 2)  # half of the coffee bill now
run = c('/payment-runs', {'accountId': K['BANK']['id'], 'payDate': dt, 'dueUntil': D(7), 'lines': lines, 'notes': 'سداد أسبوعي'})
st2 = str(time.time_ns()); c('/users', {'email': f'fm{st2}@demo.sa', 'fullName': 'نورة المديرة المالية', 'password': 'Passw0rd!', 'role': 'ADMIN'})
t2 = call('/auth/login', {'email': f'fm{st2}@demo.sa', 'password': 'Passw0rd!'})['token']
try: c(f"/payment-runs/{run['id']}/approve", {}); own = 'قُبل'
except E as e: own = str(e).split('"message":"')[-1].split('"')[0]
ap0, bk0 = bal('AP'), bal('BANK')
call(f"/payment-runs/{run['id']}/approve", {}, tok=t2)
pr = c(f"/payment-runs/{run['id']}/post", {})
ents = [{'supplier': s['partnerName'], 'voucher': s['paymentNumber'], 'amount': s['total'], 'entry': entry(psql(f"SELECT journal_id FROM payments WHERE number='{s['paymentNumber']}' AND company_id=(SELECT company_id FROM payment_runs WHERE id='{run['id']}')")[0][0])} for s in pr['suppliers']]
inv3 = c(f"/invoices/{b3['id']}")
ig = c('/reports/integrity')
step('8. مقترح سداد الموردين: اقتراح ← حفظ ← اعتماد بشخص ثانٍ ← ترحيل', {'proposal': [{'supplier': s['partnerName'], 'invoices': [{'number': i['number'], 'ref': i['supplierRef'], 'due': i['dueDate'], 'overdue': i['overdueDays'], 'amount': i['amount']} for i in s['invoices']], 'total': s['total']} for s in pp['suppliers']],
     'run': run['number'], 'total': run['total'], 'ownerApprove': own, 'approvedBy': pr['approvedBy'], 'vouchers': ents, 'leftOut': 'GB-81 (يستحق بعد 28 يوماً)'},
     [chk(pp['count'] == 3 and all(i['invoiceId'] != b4['id'] for s in pp['suppliers'] for i in s['invoices']), 'المقترح: 3 فواتير مستحقة خلال أسبوع، والفاتورة المستحقة بعد 28 يوماً خارجه'),
      chk('فصل المهام' in own, 'المالك الذي أعدّ الدفعة لا يعتمدها لوجود مديرة أخرى'),
      chk(len(ents) == 2, 'سندا صرف: واحد لكل مورد'), chk(near(bal('AP') - ap0, run['total']) and near(bal('BANK') - bk0, -run['total']), f"من ح/ الموردين إلى ح/ البنك بمبلغ الدفعة {run['total']}"),
      chk(near(inv3['amountPaid'], round(inv3['total'] / 2, 2)), 'فاتورة البن سُدد نصفها كما حُدد'), chk(ig['ok'], 'فحص التطابق سليم بعد الدفعة')])

# ── 9. cash forecast ──
cus = c('/partners', {'name': 'شركة الفعاليات المتحدة', 'isCustomer': True, 'kind': 'COMPANY', 'vatNumber': VS[3], **ADDR})
cat_ = c('/products', {'name': 'تموين فعالية', 'sku': 'CT1', 'type': 'SERVICE', 'salePrice': 12000, 'taxCode': 'S'})
ci = c('/invoices', {'direction': 'SALE', 'kind': 'INVOICE', 'date': D(-3), 'dueDate': D(11), 'partnerId': cus['id'], 'lines': [{'productId': cat_['id'], 'qty': 1, 'unitPrice': 12000}]}); ci = c(f"/invoices/{ci['id']}/post", {})
co = c('/invoices', {'direction': 'SALE', 'kind': 'INVOICE', 'date': D(-40), 'dueDate': D(-10), 'partnerId': cus['id'], 'lines': [{'productId': cat_['id'], 'qty': 1, 'unitPrice': 5000}]}); co = c(f"/invoices/{co['id']}/post", {})
c('/recurring', {'kind': 'EXPENSE', 'name': 'إيجار المحل', 'frequency': 'MONTHLY', 'nextDate': D(11), 'payload': {'accountId': K['RENT']['id'], 'amount': 8000, 'taxCode': 'S', 'description': 'إيجار المحل', 'payAccountId': K['BANK']['id']}})
fc = c('/reports/cash-forecast?weeks=13&overdueRate=60')
vatnet = -(bal('VAT_OUT') + bal('VAT_IN') + (bal('VAT_PAYABLE') if 'VAT_PAYABLE' in K else 0))
step('9. توقع التدفق النقدي (13 أسبوعاً، تحصيل المتأخر 60%)', {'vatNet': vatnet, 'opening': fc['opening'], 'closing': fc['closing'], 'lowest': fc['lowest'], 'totals': fc['totals'], 'warnings': fc['warnings'], 'weeks': [{'week': x['week'], 'from': x['from'], 'in': x['inflow'], 'out': x['outflow'], 'closing': x['closing'], 'items': [(i['dir'], i['label'], i['amount']) for i in x['items']]} for x in fc['buckets'][:6]]},
     [chk(near(fc['buckets'][0]['in']['ar'], round(co['total'] * 0.6, 2)), f"الأسبوع 1: 60% من فاتورة العميل المتأخرة ({round(co['total']*0.6,2)})"),
      chk(any('تموين' in i['label'] or cus['name'] in i['label'] for i in fc['buckets'][1]['items']), 'فاتورة التموين المستحقة بعد 11 يوماً في الأسبوع 2'),
      chk(any(i['kind'] == 'RECURRING' for x in fc['buckets'] for i in x['items']), 'الإيجار الدوري يظهر كل شهر'),
      chk((vatnet > 0) == any(i['kind'] == 'VAT' for x in fc['buckets'] for i in x['items']), f"الضريبة: صافيها {'مستحق للهيئة فيظهر سداده' if vatnet > 0 else 'لصالح المنشأة (المدخلات أكبر) فلا يظهر سداد'} ({round(vatnet, 2)})"),
      chk(all(near(x['closing'], x['opening'] + x['net']) for x in fc['buckets']), 'كل أسبوع: آخره = أوله + الداخل − الخارج')])

# ── 10. smart auditor with planted anomalies ──
dup = bill(sup_m['id'], [{'productId': supply['id'], 'qty': 80, 'unitPrice': 38}], D(-6), D(9), 'LH-1235')  # same supplier invoice number again
e1 = c('/expenses', {'date': D(-4), 'accountId': K['UTILITIES']['id'], 'description': 'فاتورة الكهرباء أكتوبر', 'payee': 'الشركة السعودية للكهرباء', 'amount': 1850, 'taxCode': 'S', 'payAccountId': K['BANK']['id']})
e2 = c('/expenses', {'date': D(-3), 'accountId': K['UTILITIES']['id'], 'description': 'فاتورة الكهرباء أكتوبر', 'payee': 'الشركة السعودية للكهرباء', 'amount': 1850, 'taxCode': 'S', 'payAccountId': K['BANK']['id']})
fri = d - datetime.timedelta(days=(d.weekday() - 4) % 7 or 7)
j1 = c('/journals', {'date': fri.isoformat(), 'memo': 'تسوية رصيد عميل', 'lines': [{'accountId': K['AR']['id'], 'debit': 20000, 'credit': 0}, {'accountId': K['OTHER_INCOME']['id'], 'debit': 0, 'credit': 20000}]})
j2 = c('/journals', {'date': D(-50), 'memo': 'قيد تصحيح متأخر', 'lines': [{'accountId': K['GENERAL_EXPENSE']['id'] if 'GENERAL_EXPENSE' in K else K['RENT']['id'], 'debit': 750, 'credit': 0}, {'accountId': K['BANK']['id'], 'debit': 0, 'credit': 750}]})
pd = [i for g in c(f'/payment-runs/propose?dueUntil={D(30)}')['suppliers'] for i in g['invoices'] if i['invoiceId'] == dup['id']]
au = c(f'/auditor?from={D(-90)}&to={dt}')
kinds = sorted({f['kind'] for f in au['findings']})
db_ = [f for f in au['findings'] if f['kind'] == 'DUP_BILL'][0]
cap = [f for f in au['findings'] if f['kind'] == 'ROUND' and 'رأس المال' in f['detail']][0]
c('/auditor/dismiss', {'kind': 'ROUND', 'ref': cap['ref'], 'note': 'رأس المال المدفوع وفق عقد التأسيس وإشعار البنك'})
au2 = c(f'/auditor?from={D(-90)}&to={dt}')
step('10. المدقق الذكي بعد زرع أخطاء متعمدة', {'score': au['score'], 'counts': au['counts'], 'findings': [{'severity': f['severity'], 'title': f['title'], 'detail': f['detail']} for f in au['findings']], 'afterDismiss': {'score': au2['score'], 'counts': au2['counts'], 'dismissed': cap['detail']}},
     [chk('DUP_BILL' in kinds and 'LH-1235' in db_['detail'] and db_['severity'] == 'high', 'فاتورة اللحوم المكررة (LH-1235) — أهمية عالية'),
      chk(pd and pd[0]['duplicateOf'] == b2['number'], f"ومقترح السداد يعلّمها «مكررة محتملة — نفس الرقم في {b2['number']}» ولا يحددها للسداد"),
      chk('DUP_EXPENSE' in kinds, 'فاتورة الكهرباء المسجلة مرتين'), chk('WEEKEND' in kinds, 'القيد اليدوي يوم الجمعة'), chk('ROUND' in kinds, 'مبلغ مقرَّب 20,000'),
      chk('CONTROL' in kinds, 'قيد يدوي على حساب العملاء (له دفتر مساعد)'), chk('BACKDATED' in kinds, 'قيد بتاريخ أقدم من إدخاله بـ50 يوماً'),
      chk(au2['counts']['dismissed'] == 1 and au2['score'] >= au['score'], 'ملاحظة «مبرَّرة» تختفي ويتحسن المؤشر')])
# ── 11. account suggestion + assistant ──
sg1 = c('/expenses/suggest-account?payee=' + quote('الشركة السعودية للكهرباء'))['suggestions']
sg2 = c('/expenses/suggest-account?description=' + quote('سداد كهرباء الفرع الجديد'))['suggestions']
v1 = c('/ai/chat', {'text': 'هل توجد فواتير مكررة؟'})['view'][-1].get('text', '')
v2 = c('/ai/chat', {'text': 'توقع السيولة للأسابيع القادمة'})['view'][-1].get('text', '')
step('11. اقتراح حساب المصروف والمساعد الذكي', {'byPayee': sg1[:2], 'byDescription': sg2[:2], 'askDuplicates': v1[:900], 'askForecast': v2[:900]},
     [chk(sg1 and sg1[0]['accountId'] == K['UTILITIES']['id'], 'المستفيد «الشركة السعودية للكهرباء» ← حساب الكهرباء والمياه'), chk(sg2 and sg2[0]['accountId'] == K['UTILITIES']['id'], 'بيان مشابه «كهرباء الفرع» ← الحساب نفسه'),
      chk('LH-1235' in v1, 'المساعد يجيب عن المكرر من المدقق'), chk('/cash-forecast' in v2, 'المساعد يعرض توقع السيولة برابط التفاصيل')])
# ── 12. books ──
tb = c(f'/reports/trial-balance?from=2000-01-01&to={D(40)}'); ig0 = c('/reports/integrity'); vr = c(f'/reports/vat?from={D(-60)}&to={dt}')
bad0 = [x['name'] for x in ig0['checks'] if not x['ok']]
c(f"/journals/{j1['id']}/reverse", {'date': dt})  # the fix the auditor pointed to: the manual entry on the customers account is reversed
ig = c('/reports/integrity'); au3 = c(f'/auditor?from={D(-90)}&to={dt}')
step('12. سلامة الدفاتر: الخطأ المزروع ثم تصحيحه', {'trialBalanced': tb['balanced'], 'beforeFix': bad0, 'integrity': [(x['name'], x['ok']) for x in ig['checks']], 'vat': {'output': vr.get('outputVat'), 'input': vr.get('inputVat'), 'reconciled': vr.get('reconciled')}, 'auditorAfterFix': {'score': au3['score'], 'counts': au3['counts']}},
     [chk(tb['balanced'], 'ميزان المراجعة متوازن'), chk(len(bad0) == 1 and 'العملاء' in bad0[0], 'قبل التصحيح: فحص التطابق يكشف أن حساب العملاء لا يطابق فواتيرهم — بسبب القيد اليدوي المزروع'),
      chk(ig['ok'], f"بعد عكس القيد: فحص التطابق {sum(1 for x in ig['checks'] if x['ok'])}/{len(ig['checks'])}"), chk(not any(f['kind'] in ('CONTROL', 'WEEKEND') for f in au3['findings']), 'والمدقق لم يعد يذكر القيد المعكوس'),
      chk(vr.get('reconciled'), 'الإقرار الضريبي يطابق حسابات الضريبة (يشمل رسوم الخدمة والإضافات)')])
OUT['fails'] = lib.fails; OUT['email'] = email
json.dump(OUT, open(sys.argv[1], 'w'), ensure_ascii=False, indent=1, default=str)
print('FAILS', len(lib.fails), lib.fails)
