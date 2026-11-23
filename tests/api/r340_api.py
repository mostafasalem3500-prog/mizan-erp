import sys, os, datetime, base64; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B; R=0.14 if EG else 0.15
# ── 3.40: cashier oversell with confirmation, reversing a posted return, staff number, clearing reconciliation for
#          card terminals and e-store platforms (per transaction, with fees), e-store order profit, evidence on auditor notes ──
t=register('r340'); c=lambda *a,**k: call(*a,tok=t,**k)
A=c('/accounts')['rows']; K={x.get('systemKey'):x for x in A if x.get('systemKey')}
d=datetime.date.today(); dt=d.isoformat(); D=lambda n: (d-datetime.timedelta(days=n)).isoformat()
def refused(code, fn, name):
    try: fn(); ok(False,name)
    except E as e: ok(str(code) in str(e)[:3], name+' → '+str(e)[:90])
def bal(key):
    r=[x for x in c(f'/reports/trial-balance?from=2000-01-01&to=2099-12-31')['rows'] if x['id']==K[key]['id']]
    return round(float(r[0]['closingDr'])-float(r[0]['closingCr']),2) if r else 0.0
def balanced():
    tb=c('/reports/trial-balance?from=2000-01-01&to=2099-12-31'); return near(sum(float(x['closingDr']) for x in tb['rows']),sum(float(x['closingCr']) for x in tb['rows']))
ADDR={'street':'طريق الملك فهد','buildingNo':'1234','district':'العليا','city':'الرياض','postalCode':'12211','phone':'0501234567'}
c('/journals',{'date':D(30),'memo':'رأس المال','lines':[{'accountId':K['BANK']['id'],'debit':100000,'credit':0},{'accountId':K['CAPITAL']['id'],'debit':0,'credit':100000}]})
sup=c('/partners',{'name':'مورد','isSupplier':True,'kind':'COMPANY','vatNumber':'300000000000003' if not EG else '200000001',**ADDR})
cust=c('/partners',{'name':'عميل آجل','isCustomer':True,'kind':'COMPANY','vatNumber':'310122393500003' if not EG else '300000009',**ADDR})
P=c('/products',{'name':'صنف مخزني','sku':'ST1','type':'STOCK','salePrice':100,'purchasePrice':60,'taxCode':'S'})
Z=c('/products',{'name':'صنف بلا رصيد','sku':'ST0','type':'STOCK','salePrice':50,'purchasePrice':30,'taxCode':'S'})
def buy(prod,qty,price):
    b=c('/invoices',{'direction':'PURCHASE','kind':'INVOICE','date':dt,'partnerId':sup['id'],'supplierRef':f'S{qty}{price}{prod["sku"]}','lines':[{'productId':prod['id'],'qty':qty,'unitPrice':price,'taxCode':'S'}]}); return c(f"/invoices/{b['id']}/post",{})
buy(P,20,60)
incl=bool(c('/auth/me')['company'].get('pricesIncludeVat'))
sess=c('/pos/session/open',{'openingCash':0}); sid=sess['id']
sale=lambda lines,tenders=None,**k: c('/pos/sale',{'sessionId':sid,'lines':lines,'tenders':tenders or [{'method':'CASH','amount':None}],**k})

# ── staff number on the document ──
me=[u for u in c('/users')][0]
c(f"/users/{me['id']}/staff-no",{'staffNo':'1007'},m='PUT')
ok([u for u in c('/users')][0]['staffNo']=='1007','staff number saved on the user')
refused(400,lambda: c(f"/users/{me['id']}/staff-no",{'staffNo':'1 0;7'},m='PUT'),'a staff number with symbols is refused')

# ── oversell: refused, then sold after the cashier confirms ──
try: sale([{'productId':Z['id'],'qty':2,'unitPrice':50}]); ok(False,'zero stock blocks the sale')
except E as e: ok('409' in str(e)[:3] and 'INSUFFICIENT_STOCK' in str(e),'zero stock: the sale stops with a clear reason')
cogs0=bal('COGS'); inv0=bal('INVENTORY')
o=sale([{'productId':Z['id'],'qty':2,'unitPrice':50}],allowOversell=True)
ok(o['status']=='POSTED' and o['oversold'] is True,'after confirmation the sale goes through and is flagged')
ok(o['issuerNo']=='1007','the invoice carries the staff number of who issued it')
ok(near(bal('COGS')-cogs0,60) and near(bal('INVENTORY')-inv0,-60),'cost taken at the last purchase price (2 × 30) — never a sale with no cost')
al=[a for a in c('/alerts')['items'] if 'بالسالب' in a['text']]; ok(len(al)==1,'dashboard: an item is below zero until its receipt is recorded')
lg=c('/audit?limit=50') if False else None
buy(Z,10,30)
vr=c('/inventory/valuation'); val=[x for x in vr['rows'] if Z['id'] in (x.get('productId'),x.get('id')) or x.get('sku')=='ST0']; print(val[:1]) if not val else None
ok(near(val[0]['qty'],8) and near(val[0]['value'],240) and vr['matches'],'the receipt brings the item back: 8 on hand at 30 = 240')
ok(not [a for a in c('/alerts')['items'] if 'بالسالب' in a['text']],'the alert clears')
c('/pos/oversell',{'mode':'BLOCK'},m='PUT')
refused(409,lambda: sale([{'productId':Z['id'],'qty':99,'unitPrice':50}],allowOversell=True),'the establishment can forbid the override altogether')
c('/pos/oversell',{'mode':'ASK'},m='PUT')
ok(sale([{'productId':P['id'],'qty':1,'unitPrice':100}])['oversold'] is False,'a normal sale is not flagged')

# ── reversing a posted sales return ──
inv=c('/invoices',{'direction':'SALE','kind':'INVOICE','date':dt,'partnerId':cust['id'],'lines':[{'productId':P['id'],'qty':3,'unitPrice':100,'taxCode':'S'}]}); inv=c(f"/invoices/{inv['id']}/post",{})
ar0=bal('AR'); st0=bal('INVENTORY'); vat0=bal('VAT_OUT'); ret0=bal('SALES_RETURNS'); sales0=bal('SALES'); cg0=bal('COGS')
cn=c('/invoices',{'direction':'SALE','kind':'CREDIT_NOTE','date':dt,'partnerId':cust['id'],'originId':inv['id'],'reason':'إرجاع','lines':[{'productId':P['id'],'qty':2,'unitPrice':100,'taxCode':'S'}]}); cn=c(f"/invoices/{cn['id']}/post",{})
ok(near(bal('AR')-ar0,-200*(1+R)) and near(bal('SALES_RETURNS')-ret0,200),'return posted: receivable down, returns account up')
refused(400,lambda: c(f"/invoices/{cn['id']}/reverse-return",{'reason':''}),'a reason is required')
refused(400,lambda: c(f"/invoices/{inv['id']}/reverse-return",{'reason':'خطأ'}),'only a return can be reversed')
dn=c(f"/invoices/{cn['id']}/reverse-return",{'reason':'سُجّل على فاتورة خطأ'})
ok(dn['kind']=='DEBIT_NOTE' and dn['status']=='POSTED' and near(dn['total'],cn['total']),'reversal issues a debit note for the same amount (the return is not deleted)')
ok(near(bal('AR'),ar0) and near(bal('SALES_RETURNS'),ret0) and near(bal('VAT_OUT'),vat0) and near(bal('SALES'),sales0),'receivable, returns account, output VAT and sales are back where they were')
ok(near(bal('INVENTORY'),st0) and near(bal('COGS'),cg0),'the goods left stock again at cost: inventory and cost of sales restored')
doc=c(f"/invoices/{cn['id']}"); ok(doc['reversedBy']==dn['id'] and doc['reversal']['number']==dn['number'] and doc['createdBy'],'the return shows who made it and the note that reversed it')
refused(409,lambda: c(f"/invoices/{cn['id']}/reverse-return",{'reason':'مرة ثانية'}),'a return is reversed once')
cn2=c('/invoices',{'direction':'SALE','kind':'CREDIT_NOTE','date':dt,'partnerId':cust['id'],'originId':inv['id'],'reason':'إرجاع صحيح','lines':[{'productId':P['id'],'qty':3,'unitPrice':100,'taxCode':'S'}]}); cn2=c(f"/invoices/{cn2['id']}/post",{})
ok(cn2['status']=='POSTED','after the reversal the full quantity can be returned again (the reversed return no longer counts)')
# a till refund reversed: the customer pays again in cash
s1=sale([{'productId':P['id'],'qty':1,'unitPrice':100}]); pr=c('/pos/return',{'sessionId':sid,'originId':s1['id'],'lines':[{'productId':P['id'],'qty':1}],'reason':'تجربة'})
refused(400,lambda: c(f"/invoices/{pr['id']}/reverse-return",{'reason':'خطأ كاشير','collect':'AR'}),'the walk-in customer has no account: on-credit is refused')
cash0=bal('CASH'); d2=c(f"/invoices/{pr['id']}/reverse-return",{'reason':'خطأ كاشير','collect':'CASH'})
ok(near(bal('CASH')-cash0,d2['total']),'till refund reversed: the amount is collected again into the cash account')
rows=c(f"/invoices?direction=SALE&kind=CREDIT_NOTE")['rows']; ok(all(r.get('createdBy') for r in rows) and any(r.get('reversedBy') for r in rows),'the list names the user behind every return')
ok(balanced(),'trial balance balanced after the reversals')

# ── card terminal reconciliation ──
price=lambda v: v
g=[]
for v,ref in [(100,'RRN1001'),(200,'RRN1002'),(300,'')]:
    x=sale([{'productId':P['id'],'qty':1,'unitPrice':v}],[{'method':'CARD','amount':None,**({'ref':ref} if ref else {})}]); g.append(x)
v=c('/clearing/CARD'); tot=round(sum(float(x['total']) for x in g),2)
ok(len(v['open'])==3 and near(v['openTotal'],tot) and near(v['ledger'],tot) and near(v['unexplained'],0),'three card sales sit in clearing; the open list equals the ledger balance')
ok(v['open'][0]['ref']=='RRN1001','the terminal approval number typed at the till is kept on the sale')
refused(400,lambda: c('/clearing/CARD/batches',{'bankAccountId':K['BANK']['id'],'lines':[]}),'a deposit needs its transactions')
refused(404,lambda: c('/clearing/CARD/batches',{'bankAccountId':K['CAPITAL']['id'],'lines':[{'invoiceId':g[0]['id'],'gross':float(g[0]['total'])}]}),'the deposit account must be a bank')
two=round(float(g[0]['total'])+float(g[1]['total']),2); net=round(two-5.75,2)
bank0=bal('BANK'); fee0=bal('BANK_FEES'); vin0=bal('VAT_IN')
b1=c('/clearing/CARD/batches',{'date':dt,'bankAccountId':K['BANK']['id'],'reference':'DEP-1','net':net,'lines':[{'invoiceId':g[0]['id'],'gross':float(g[0]['total'])},{'invoiceId':g[1]['id'],'gross':float(g[1]['total'])}]})
ok(near(b1['gross'],two) and near(b1['net'],net) and near(b1['fees']+b1['feeVat'],5.75) and near(b1['feeVat'],round(5.75-5.75/(1+R),2),0.02),'deposit: gross, bank fee and the VAT inside it derived from what reached the bank')
ok(near(bal('BANK')-bank0,net) and near(bal('BANK_FEES')-fee0,b1['fees']) and near(bal('VAT_IN')-vin0,b1['feeVat']) and near(bal('CARD_CLEARING'),float(g[2]['total'])),'entry: Dr bank + fee + input VAT / Cr clearing — only the unpaid sale stays in clearing')
v=c('/clearing/CARD'); ok(len(v['open'])==1 and near(v['unexplained'],0) and v['batches'][0]['lines']==2,'the two sales are closed one by one; one still open')
det=c(f"/clearing-batches/{b1['id']}"); ok(len(det['lines'])==2 and near(sum(float(l['fee'])+float(l['feeVat']) for l in det['lines']),5.75),'each transaction carries its share of the fee')
refused(400,lambda: c('/clearing/CARD/batches',{'bankAccountId':K['BANK']['id'],'lines':[{'invoiceId':g[0]['id'],'gross':float(g[0]['total'])}]}),'a settled sale is not settled twice')
c(f"/clearing-batches/{b1['id']}/cancel",{}); v=c('/clearing/CARD')
ok(len(v['open'])==3 and near(bal('BANK'),bank0) and near(bal('CARD_CLEARING'),tot),'cancelling the deposit reopens its sales and reverses the entry')
# the bank's statement file: per-transaction fees, a wrong amount, and a transaction the books do not have
f1=round(float(g[0]['total'])*0.008,2)
b2=c('/clearing/CARD/batches',{'date':dt,'bankAccountId':K['BANK']['id'],'reference':'STMT','lines':[
  {'ref':'RRN1001','date':dt,'gross':float(g[0]['total']),'fee':f1},
  {'ref':g[2]['number'],'gross':float(g[2]['total']),'fee':2.76,'feeVat':0.41},
  {'ref':'RRN1002','gross':999},
  {'ref':'RRN9999','date':dt,'gross':57.5,'fee':0.46}]})
ok(b2['matched']==2 and b2['unmatched']==2,'statement file: matched by terminal reference and by invoice number; two lines not matched')
ok(near(b2['fees'],f1+2.76) and near(b2['feeVat'],round(f1*R,2)+0.41) and near(b2['gross'],float(g[0]['total'])+float(g[2]['total'])),'fees taken from the statement per transaction (VAT added when the file has none)')
v=c('/clearing/CARD'); ok(len(v['unmatched'])==2 and len(v['open'])==1 and near(v['unexplained'],0),'what the bank paid without a sale in the books is listed, not posted')
ok(any('بلا بيع مسجل' in a['text'] for a in c('/alerts')['items']),'and raised on the dashboard')
for u in v['unmatched']: c(f"/clearing-lines/{u['id']}/resolve",{'note':'سُجلت الفاتورة الناقصة'})
ok(not c('/clearing/CARD')['unmatched'],'explained lines leave the list')
# a lump transfer recorded the old way is applied to the oldest open sale
c('/treasury/transfers',{'fromAccountId':K['CARD_CLEARING']['id'],'toAccountId':K['BANK']['id'],'amount':float(g[1]['total']),'date':dt})
v=c('/clearing/CARD'); ok(len(v['open'])==0 and near(v['ledger'],0) and near(v['unexplained'],0),'a plain transfer out of clearing closes the oldest open sale — list and ledger still agree')
rule=c('/clearing/CARD/rule',{'pct':1.5,'fixed':0.5,'cap':0,'vat':True},m='PUT'); ok(rule['pct']==1.5 and c('/clearing/CARD')['rule']['fixed']==0.5,'fee rule saved')
ok(balanced(),'trial balance balanced after the card settlements')
vr=c(f'/reports/vat?from={D(40)}&to={dt}'); ok(near(vr['inputVat'],vr['glInputVat']) and near(vr['outputVat'],vr['glOutputVat']),'the VAT return counts the input VAT on the bank fees: documents = ledger')

# ── evidence on a justified auditor note ──
r=c('/auditor/dismiss',{'kind':'NEGATIVE_CASH','ref':'x-1','note':'راجعت كشف البنك'}); ok(bool(r.get('id')),'justifying a note returns its record')
png='data:image/png;base64,'+base64.b64encode(bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082')).decode()
a1=c(f"/attachments/audit/{r['id']}",{'name':'proof.png','mime':'image/png','data':png}); ok(len(c(f"/attachments/audit/{r['id']}"))==1,'a supporting file can be attached to the justification (optional)')

# ── the built-in assistant answers what accountants ask about these ──
def ask(text):
    r=c('/ai/chat',{'text':text}); v=r['view'][-1]; return v.get('text') or v.get('content') or str(v)
for qn,must in [('كيف الغي مرتجع بعد الترحيل','إشعار مدين'),('مين اللي عمل المرتجع','المستخدم'),('كيف ابيع صنف رصيده صفر','موافقة الكاشير'),('كيف اطابق مدى مع البنك','تسوية أجهزة الشبكة'),('كم مبيعات الشبكة اللي ما وصلت البنك','الشبكة والبطاقات'),('وش الاصناف اللي خلصت',''),('فرق الصندوق كيف اسجله','إغلاق الوردية'),('ليه الميزان مو متوازن','فلتر')]:
    a_=ask(qn); ok(must in a_ and 'لم أجد إجابة' not in a_,f'assistant: «{qn}» answered')

if EG:
    refused(400,lambda: c('/clearing/SALLA'),'e-store platforms are not part of the Egyptian edition')
    print('FAILS', len(lib.fails)); sys.exit(1 if lib.fails else 0)

# ── e-store: Salla orders → platform transfer with commission → profit per order and per unit ──
c('/integrations/salla',{'storeName':'متجري'})
for i in range(3): c('/integrations/salla/test',{'post':True})
v=c('/clearing/SALLA')
ok(len(v['open'])==3 and near(v['ledger'],v['openTotal']) and near(v['unexplained'],0),'three paid Salla orders are owed by the platform; equal to the clearing ledger')
o1,o2,o3=v['open']; ord_no=o1['externalRef'].split(':')[-1]
fee0=bal('ESTORE_FEES'); bank0=bal('BANK')
b=c('/clearing/SALLA/batches',{'date':dt,'bankAccountId':K['BANK']['id'],'reference':'SALLA-W1','lines':[{'ref':ord_no,'gross':o1['open'],'fee':10},{'ref':o2['number'],'gross':o2['open'],'fee':12,'feeVat':1.8}]})
ok(b['matched']==2 and near(b['fees'],22) and near(b['feeVat'],3.3) and near(bal('ESTORE_FEES')-fee0,22) and near(bal('BANK')-bank0,b['net']),'platform statement matched by order number and by invoice number; commission to 5304 and its VAT to input VAT')
v=c('/clearing/SALLA'); ok(len(v['open'])==1 and near(v['unexplained'],0),'one order still owed by the platform')
pr=c(f'/estore/profit?from={D(40)}&to={dt}'); O={x['id']:x for x in pr['orders']}
x=O[o1['invoiceId']]; ok(x['feeActual'] and near(x['fee'],10) and near(x['profit'],x['revenue']-x['cogs']-10) and near(x['profitPerUnit'],x['profit']/x['units'],0.01),'order profit = revenue − cost of goods − the actual commission; and per unit')
y=O[o3['invoiceId']]; ok(not y['feeActual'] and near(y['fee'],round(y['total']*0.025,2)+1),'an order not yet settled uses the commission rule (2.5% + 1) and says so')
ok(near(pr['totals']['profit'],sum(z['profit'] for z in pr['orders'])) and near(sum(p['profit'] for p in pr['products'])+pr['totals']['shippingNet'],pr['totals']['profit'],0.06),'totals: per-product profit plus the shipping charged equals the per-order profit')
# a payout recorded the older way (no orders) still closes the oldest open order
c('/integrations/salla/payouts',{'net':round(o3['open']-5.75,2),'fees':5,'feeVat':0.75,'bankAccountId':K['BANK']['id']})
v=c('/clearing/SALLA'); ok(len(v['open'])==0 and near(v['ledger'],0) and near(v['unexplained'],0),'an old-style lump payout closes the remaining order; list and ledger agree')
ok(balanced(),'trial balance balanced after the e-store settlements')
print('FAILS', len(lib.fails)); sys.exit(1 if lib.fails else 0)
