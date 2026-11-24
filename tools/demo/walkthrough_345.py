"""3.45 walkthrough: practical shawarma trials on a fictional restaurant. Every cost is traced to the stock card: the
movements each operation wrote in the warehouse are read back from the database and compared with what the recipe requires,
then with cost of sales and the inventory account.
Usage: B=http://127.0.0.1:3100/api python3 tools/demo/walkthrough_345.py   (local server + its PostgreSQL on 127.0.0.1:5433)"""
import sys, os, time, subprocess
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'tests', 'api'))
from lib import *
import lib
EG = '3200' in B; R = 0.14 if EG else 0.15; DBN = 'mizan_eg' if EG else 'mizan'
def psql(q):
    r = subprocess.run(['psql', '-h', '127.0.0.1', '-p', '5433', '-U', 'postgres', '-d', DBN, '-AtF', '\t', '-c', q], capture_output=True, text=True)
    return [l.split('\t') for l in r.stdout.strip().split('\n') if l]
t = register('w345'); c = lambda *a, **k: call(*a, tok=t, **k)
CID = c('/auth/me')['company']['id']
A = c('/accounts')['rows']; acc = {x.get('systemKey'): x for x in A if x.get('systemKey')}; d = time.strftime('%Y-%m-%d'); y = time.strftime('%Y')
def bal(key): return round(sum(float(x['debit']) - float(x['credit']) for x in c(f'/reports/trial-balance?from={y}-01-01&to={y}-12-31')['rows'] if x['code'] == acc[key]['code']), 2)
def moves(where):
    """sku → (signed qty, signed value) of the stock movements matching `where`; issues are negative"""
    out = {}
    for sku, q, v in psql(f"SELECT p.sku, SUM(m.qty), SUM(m.value) FROM stock_moves m JOIN products p ON p.id=m.product_id WHERE m.company_id='{CID}' AND {where} GROUP BY p.sku"):
        out[sku] = (round(float(q), 4), round(float(v), 2))
    return out
def show(title, mv):
    print(f'\n── {title}')
    for sku in sorted(mv): print(f'   {NAME.get(sku, sku):<34} {mv[sku][0]:>10.3f}   {mv[sku][1]:>10.2f}')
def qtys(mv): return {k: v[0] for k, v in mv.items()}
def eq(a, b, e=0.0015): return set(a) == set(b) and all(abs(a[k] - b[k]) < e for k in a)
c('/journals', {'date': f'{y}-01-01', 'memo': 'رأس المال', 'lines': [{'accountId': acc['BANK']['id'], 'debit': 200000, 'credit': 0}, {'accountId': acc['CAPITAL']['id'], 'debit': 0, 'credit': 200000}]})

# 1 ── the example: purchase of raw materials and a first batch
c('/preps/example', {})
P = {p['sku']: p for p in c('/products')}; NAME = {k: v['name'].replace(' (مثال)', '') for k, v in P.items()}
pid = lambda s: P[s]['id']
buy = moves("m.source_type='PURCHASE'")
show('1) الشراء: ما دخل المخزن', buy)
ok(eq(qtys(buy), {'EX-CK': 100, 'EX-SP': 10, 'EX-YG': 20, 'EX-OL': 30, 'EX-GR': 10, 'EX-BD': 500, 'EX-PK': 10}) and near(sum(v[1] for v in buy.values()), 3290), 'purchase: 7 raw materials enter the warehouse, worth 3,290')
ok(near(bal('INVENTORY'), 3290), 'inventory account = 3,290')
b0 = moves("m.source_type='PRODUCTION'")
show('1) طبخة المثال (24 كجم مدخلات ← 15 كجم مطبوخة)', b0)
ok(eq(qtys(b0), {'EX-CK': -20, 'EX-SP': -1, 'EX-YG': -2, 'EX-OL': -1, 'EX-CKD': 15}) and near(b0['EX-CKD'][1], 466) and near(sum(v[1] for v in b0.values()), 0), 'sample batch: raw materials worth 466 leave the warehouse and 15 kg of cooked meat enter at 466 — value neither created nor lost')

# 2 ── a new batch: 12 kg in, 7.5 kg out
iv = bal('INVENTORY')
bt = c('/prep-batches', {'productId': pid('EX-CKD'), 'inputQty': 12, 'outputQty': 7.5, 'date': d})
m = moves(f"m.source_id='{bt['id']}'")
show(f"2) طبخة {bt['number']}: 12 كجم مدخلات ← 7.5 كجم", m)
ok(eq(qtys(m), {'EX-CK': -10, 'EX-SP': -0.5, 'EX-YG': -1, 'EX-OL': -0.5, 'EX-CKD': 7.5}) and near(m['EX-CKD'][1], 233) and near(-m['EX-CK'][1], 200), 'batch: 10 kg chicken (200), 0.5 spice (20), 1 yogurt (8), 0.5 oil (5) drawn; cooked meat enters at 233')
ok(near(bal('INVENTORY'), iv) and near(bt['unitCost'], 233 / 7.5, 0.001), 'no journal entry: inventory account unchanged; unit cost of this batch 31.0667')
avg = (466 + 233) / 22.5
ok(near(float({p['sku']: p for p in c('/products')}['EX-CKD']['avgCost']), avg, 0.001), f'cooked meat in the warehouse: 22.5 kg at an average of {avg:.4f}')

# 3 ── an invoice for 20 sandwiches
cu = c('/partners', {'name': 'زبون', 'isCustomer': True, 'kind': 'INDIVIDUAL', 'phone': '0501234567'})
def sell(prod, n, price=15):
    x = c('/invoices', {'direction': 'SALE', 'kind': 'INVOICE', 'date': d, 'partnerId': cu['id'], 'lines': [{'productId': prod, 'qty': n, 'unitPrice': price, 'taxCode': 'S'}]}); return c(f"/invoices/{x['id']}/post", {})
iv, cg = bal('INVENTORY'), bal('COGS')
s = sell(pid('EX-SW'), 20); m = moves(f"m.source_id='{s['id']}'")
show(f"3) فاتورة {s['number']}: 20 ساندوتش", m)
ok(eq(qtys(m), {'EX-CKD': -2.4, 'EX-GR': -0.2, 'EX-OL': -0.4, 'EX-BD': -20, 'EX-PK': -0.4}), '20 sandwiches draw 2.4 kg cooked meat, 20 breads, 0.4 kg pickles — and 0.2 kg garlic + 0.4 kg oil through the garlic sauce')
drawn = -sum(v[1] for v in m.values()); want = 2.4 * avg + 0.2 * 12 + 0.4 * 10 + 20 * 0.5 + 0.4 * 6
ok(near(drawn, want, 0.02) and near(float(c(f"/invoices/{s['id']}")['costTotal']), drawn), f'value drawn from the warehouse {drawn:.2f} = worked by hand {want:.2f} = the cost on the invoice')
ok(near(bal('COGS') - cg, drawn) and near(iv - bal('INVENTORY'), drawn), 'cost of sales +%.2f and inventory −%.2f: the same amount' % (drawn, drawn))

# 4 ── the till
sess = c('/pos/session/open', {'openingCash': 0}); iv, cg = bal('INVENTORY'), bal('COGS')
ps = c('/pos/sale', {'sessionId': sess['id'], 'lines': [{'productId': pid('EX-SW'), 'qty': 3, 'unitPrice': 15}], 'tenders': [{'method': 'CASH', 'amount': None}]})
m = moves(f"m.source_id='{ps['id']}'")
show('4) نقطة البيع: 3 ساندوتش نقداً', m)
ok(eq(qtys(m), {'EX-CKD': -0.36, 'EX-GR': -0.03, 'EX-OL': -0.06, 'EX-BD': -3, 'EX-PK': -0.06}) and near(bal('COGS') - cg, -sum(v[1] for v in m.values())) and near(iv - bal('INVENTORY'), bal('COGS') - cg), 'till sale: the same draw per sandwich, cost of sales = what left the warehouse')

# 5 ── direct deduction: a plate whose cooked meat is never stocked
dm = c('/products', {'name': 'شاورما مطبوخة — خصم مباشر', 'sku': 'W-CKD2', 'type': 'STOCK', 'salePrice': 0, 'purchasePrice': 0, 'taxCode': 'S', 'unit': 'كجم'})
c(f"/products/{dm['id']}/recipe", {'outputQty': 7.8, 'method': 'DIRECT', 'lines': [{'componentId': pid('EX-MR'), 'qty': 12}]}, 'PUT')
plate = c('/products', {'name': 'صحن شاورما عربي', 'sku': 'W-PL', 'type': 'SERVICE', 'salePrice': 28, 'taxCode': 'S'})
c(f"/products/{plate['id']}/recipe", {'lines': [{'componentId': dm['id'], 'qty': 0.2}, {'componentId': pid('EX-BD'), 'qty': 2}]}, 'PUT')
NAME['W-CKD2'] = 'شاورما مطبوخة — خصم مباشر'
iv, cg = bal('INVENTORY'), bal('COGS')
s = sell(plate['id'], 39, 28); m = moves(f"m.source_id='{s['id']}'")
show('5) الخصم المباشر: 39 صحن (39 × 200 جم = 7.8 كجم مطبوخة = طبخة كاملة)', m)
ok(eq(qtys(m), {'EX-CK': -10, 'EX-SP': -0.5, 'EX-YG': -1, 'EX-OL': -0.5, 'EX-BD': -78}), 'direct deduction: 39 plates draw exactly one batch of raw materials — 10 kg chicken, 0.5 spice, 1 yogurt, 0.5 oil — and 78 breads; no cooked meat moves')
drawn = -sum(v[1] for v in m.values())
ok(near(drawn, 233 + 39, 0.02) and near(bal('COGS') - cg, drawn) and near(iv - bal('INVENTORY'), drawn), f'value drawn {drawn:.2f} = 233 (the batch) + 39 (bread) = cost of sales')

# 6 ── a credit note for a prepared dish moves no stock
iv, cg = bal('INVENTORY'), bal('COGS'); n0 = int(psql(f"SELECT COUNT(*) FROM stock_moves WHERE company_id='{CID}'")[0][0])
cn = c(f"/invoices/{s['id']}/credit-note", {}); c(f"/invoices/{cn['id']}/post", {})
ok(int(psql(f"SELECT COUNT(*) FROM stock_moves WHERE company_id='{CID}'")[0][0]) == n0 and bal('COGS') == cg and bal('INVENTORY') == iv, 'credit note for the plates: no stock movement and no change in cost of sales (the food was consumed)')

# 7 ── selling past the cooked stock, then a batch covers it
left = float({p['sku']: p for p in c('/products')}['EX-CKD']['qty'])
n = int(left / 0.12) + 10
s = sell(pid('EX-SW'), n); after = float({p['sku']: p for p in c('/products')}['EX-CKD']['qty'])
print(f'\n── 7) بيع {n} ساندوتش والمتاح من المطبوخة {left:.2f} كجم ← الرصيد {after:.2f}')
al = ' '.join(a['text'] for a in c('/alerts')['items'])
ok(after < 0 and ('بالسالب' in al or 'سالب' in al), f'selling past the cooked stock: the sale goes through, the balance shows {after:.2f} kg and the negative-stock alert appears')
bt = c('/prep-batches', {'productId': pid('EX-CKD'), 'inputQty': 12})
ok(float({p['sku']: p for p in c('/products')}['EX-CKD']['qty']) > 0, 'the next batch brings the cooked meat back above zero')

# 8 ── the warehouse against the books
rows = psql(f"SELECT p.sku, COALESCE(SUM(b.qty),0), COALESCE(SUM(b.value),0), (SELECT COALESCE(SUM(m.qty),0) FROM stock_moves m WHERE m.product_id=p.id), (SELECT COALESCE(SUM(m.value),0) FROM stock_moves m WHERE m.product_id=p.id) FROM products p LEFT JOIN stock_balances b ON b.product_id=p.id WHERE p.company_id='{CID}' AND p.type='STOCK' GROUP BY p.id, p.sku ORDER BY p.sku")
print('\n── 8) أرصدة المخزن في النهاية (الكمية، القيمة)')
for sku, q, v, mq, mv in rows: print(f'   {NAME.get(sku, sku):<34} {float(q):>10.3f}   {float(v):>10.2f}')
ok(all(abs(float(q) - float(mq)) < 0.0015 and abs(float(v) - float(mv)) < 0.011 for _, q, v, mq, mv in rows), 'every item: warehouse balance = the sum of its stock-card movements, in quantity and in value')
ok(near(bal('INVENTORY'), sum(float(v) for _, _, v, _, _ in rows), 0.011), 'inventory account in the ledger = the value of the warehouse')
purchases = 3290; ok(near(purchases - bal('INVENTORY'), bal('COGS'), 0.011), 'purchases 3,290 − what is still in the warehouse = cost of sales: every riyal of cost came out of stock')
ok(c('/reports/integrity')['ok'] and c('/reports/trial-balance?from=2000-01-01&to=2099-12-31')['balanced'], 'books check passes and the trial balance is balanced')
print('\nFAILS', len(lib.fails)); sys.exit(1 if lib.fails else 0)
