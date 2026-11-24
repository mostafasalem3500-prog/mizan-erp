"""3.43: customer/supplier set-off entry, recipes consumed on sale, supplier bank details and the payment-run bank file —
each followed to the trial balance, the income statement and the final accounts."""
import sys, os, time; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B; R=0.14 if EG else 0.15
t=register('r343'); c=lambda *a,**k: call(*a,tok=t,**k)
A=c('/accounts')['rows']; acc={x.get('systemKey'):x for x in A if x.get('systemKey')}; d=time.strftime('%Y-%m-%d'); y=time.strftime('%Y')
ADDR={'street':'طريق الملك فهد','buildingNo':'1234','district':'العليا','city':'الرياض','postalCode':'12211','phone':'0501234567'}
def refused(code, fn, name, has=None):
    try: fn(); ok(False,name)
    except E as e: ok(str(code) in str(e) and (has is None or has in str(e)), name+' → refused')
def bal(key):
    r=[x for x in c(f'/reports/trial-balance?from={y}-01-01&to={y}-12-31')['rows'] if x['code']==acc[key]['code']]
    return round(sum(float(x['debit'])-float(x['credit']) for x in r),2)
c('/journals',{'date':f'{y}-01-01','memo':'رأس المال','lines':[{'accountId':acc['BANK']['id'],'debit':500000,'credit':0},{'accountId':acc['CAPITAL']['id'],'debit':0,'credit':500000}]})
both=c('/partners',{'name':'الرواد العامة','isCustomer':True,'isSupplier':True,'kind':'COMPANY','vatNumber':'310122393500003' if not EG else '300000002',**ADDR})
S=c('/products',{'name':'خدمة','sku':'SV','type':'SERVICE','salePrice':100,'taxCode':'S'})
def inv(direction,gross,pid=None,lines=None):
    x=c('/invoices',{'direction':direction,'kind':'INVOICE','date':d,'partnerId':pid or both['id'],'lines':lines or [{'productId':S['id'],'qty':1,'unitPrice':round(gross/(1+R),2),'taxCode':'S'}]})
    return c(f"/invoices/{x['id']}/post",{})
# ── set-off ──
s1=inv('SALE',30000); s2=inv('SALE',10000); p1=inv('PURCHASE',23000)
cand=c('/setoffs/candidates')['rows']
ok(len(cand)==1 and near(cand[0]['receivable'],40000,0.05) and near(cand[0]['payable'],23000,0.05) and near(cand[0]['max'],23000,0.05),'candidates: owes 40,000, is owed 23,000, most that can be set off 23,000')
pv=c('/setoffs/preview',{'partnerId':both['id']}); ok(near(pv['amount'],23000,0.05) and near(pv['after']['receivable'],17000,0.05) and near(pv['after']['payable'],0,0.05),'preview: after the set-off 17,000 is left on the customer and nothing is owed')
refused(400,lambda: c('/setoffs',{'partnerId':both['id'],'amount':23500,'date':d}),'more than the smaller side','يتجاوز')
ar0,ap0,bk0=bal('AR'),bal('AP'),bal('BANK')
so=c('/setoffs',{'partnerId':both['id'],'date':d,'memo':'تسوية نهاية الشهر'})
ok(near(so['amount'],23000,0.05) and so['journalNumber'],'set-off posted with its entry '+str(so['number']))
ok(near(bal('AR'),ar0-so['amount']) and near(bal('AP'),ap0+so['amount']) and near(bal('BANK'),bk0),'entry: Dr payables / Cr receivables by the amount — no cash moved')
g1=c(f"/invoices/{s1['id']}"); g2=c(f"/invoices/{s2['id']}"); gp=c(f"/invoices/{p1['id']}")
ok(near(g1['amountPaid'],so['amount'],0.05) and near(g2['amountPaid'],0) and gp['paymentStatus']=='PAID','allocation: the oldest sales invoice is reduced, the purchase invoice is settled in full')
ok(c('/reports/integrity')['ok'],'sub-ledgers still tied to the ledger after the set-off')
refused(409,lambda: c(f"/journals/{so['journalId']}/reverse",{}),'reversing the set-off entry from the journal','مقاصة')
refused(400,lambda: c('/setoffs',{'partnerId':both['id'],'date':d}),'a second set-off with nothing owed to them','لا مقاصة')
x=c(f"/setoffs/{so['id']}/cancel",{}); ok(x['status']=='CANCELLED' and near(bal('AR'),ar0) and near(bal('AP'),ap0),'cancel: entry reversed, both balances back')
ok(near(c(f"/invoices/{s1['id']}")['amountPaid'],0) and c(f"/invoices/{p1['id']}")['paymentStatus']=='UNPAID' and c('/reports/integrity')['ok'],'cancel: invoices reopened and books tied')
so=c('/setoffs',{'partnerId':both['id'],'date':d,'amount':10000}); ok(near(bal('AP'),ap0+10000) and len(c('/setoffs')['rows'])==2,'partial set-off of 10,000 posted')
# ── recipes ──
flour=c('/products',{'name':'دقيق','sku':'FL','type':'STOCK','salePrice':0,'purchasePrice':4,'taxCode':'S','unit':'كجم'})
cheese=c('/products',{'name':'جبن','sku':'CH','type':'STOCK','salePrice':0,'purchasePrice':30,'taxCode':'S','unit':'كجم'})
pizza=c('/products',{'name':'بيتزا','sku':'PZ','type':'SERVICE','salePrice':40,'taxCode':'S'})
sup=c('/partners',{'name':'مورد الأغذية','isSupplier':True,'kind':'COMPANY','vatNumber':'300000000000003' if not EG else '200000001',**ADDR})
inv('PURCHASE',0,sup['id'],[{'productId':flour['id'],'qty':100,'unitPrice':4,'taxCode':'S'},{'productId':cheese['id'],'qty':10,'unitPrice':30,'taxCode':'S'}])
refused(400,lambda: c(f"/products/{flour['id']}/recipe",{'lines':[{'componentId':cheese['id'],'qty':1}]},'PUT'),'a recipe on a stock item without its batch output','ناتج')
refused(400,lambda: c(f"/products/{pizza['id']}/recipe",{'lines':[{'componentId':S['id'],'qty':1}]},'PUT'),'a service as an ingredient','ليس صنفاً مخزنياً')
rc=c(f"/products/{pizza['id']}/recipe",{'lines':[{'componentId':flour['id'],'qty':0.25},{'componentId':cheese['id'],'qty':0.1}]},'PUT')
ok(near(rc['cost'],4.0) and near(rc['margin'],36) and rc['canMake']==100,'recipe: cost 0.25×4 + 0.1×30 = 4.00, margin 36, 100 can be made from stock')
cg0,iv0=bal('COGS'),bal('INVENTORY')
cu=c('/partners',{'name':'عميل نقدي مسمى','isCustomer':True,'kind':'INDIVIDUAL','phone':'0501234567'})
sp=inv('SALE',0,cu['id'],[{'productId':pizza['id'],'qty':10,'unitPrice':40,'taxCode':'S'}])
ok(near(bal('COGS'),cg0+40) and near(bal('INVENTORY'),iv0-40),'selling 10: cost of sales +40 and inventory −40 (2.5 kg flour + 1 kg cheese)')
st={r['sku']:r for r in c('/products')}
ok(near(st['FL']['qty'],97.5,0.001) and near(st['CH']['qty'],9,0.001),'stock: flour 97.5, cheese 9')
ok(near(c(f"/invoices/{sp['id']}")['costTotal'],40),'the invoice carries its cost 40 → profit per sale is real')
# POS sale of the recipe item (cash)
sess=c('/pos/session/open',{'openingCash':0})
ps=c('/pos/sale',{'sessionId':sess['id'],'lines':[{'productId':pizza['id'],'qty':2,'unitPrice':40}],'tenders':[{'method':'CASH','amount':None}]})
ok(near(bal('COGS'),cg0+48) and near({r['sku']:r for r in c('/products')}['CH']['qty'],8.8,0.001),'POS sale of 2: cost of sales +8 more, cheese 8.8')
# a credit note of a prepared item does not put ingredients back (they were consumed)
cn=c(f"/invoices/{sp['id']}/credit-note",{}); c(f"/invoices/{cn['id']}/post",{})
ok(near(bal('COGS'),cg0+48) and near({r['sku']:r for r in c('/products')}['FL']['qty'],97,0.001),'credit note of the dish: revenue reversed, the consumed ingredients stay consumed')
ok(c('/reports/integrity')['ok'],'inventory account = stock valuation after recipe sales')
# ── supplier bank details and bank file ──
refused(400,lambda: c(f"/partners/{sup['id']}/bank",{'iban':'SA0380000000608010167518'},'PUT'),'an IBAN with wrong check digits','الآيبان')
IB='EG380019000500000000263180002' if EG else 'SA0380000000608010167519'
bk=c(f"/partners/{sup['id']}/bank",{'iban':IB[:4]+' '+IB[4:],'bankName':'البنك الأهلي','bankBeneficiary':'مؤسسة مورد الأغذية'},'PUT'); ok(bk['iban']==IB,'valid IBAN saved (spaces removed)')
pr=c(f'/payment-runs/propose?dueUntil=2100-12-31'); lines=[{'invoiceId':i['invoiceId'],'amount':i['amount']} for s in pr['suppliers'] for i in s['invoices']]
run=c('/payment-runs',{'accountId':acc['BANK']['id'],'payDate':d,'dueUntil':d,'lines':lines})
refused(409,lambda: c(f"/payment-runs/{run['id']}/bank-file"),'bank file before approval','اعتماد')
c(f"/payment-runs/{run['id']}/approve",{})
bf=c(f"/payment-runs/{run['id']}/bank-file")
ok(bf['count']==1 and bf['rows'][0]['iban']==IB and near(bf['rows'][0]['amount'],(400+300)*(1+R)) and 'الرواد العامة' in bf['missing'],'bank file: one transfer to the supplier with an IBAN; the one without is listed as missing')
ok(IB in bf['csv'] and bf['csv'].startswith('﻿') and 'Beneficiary' in bf['csv'],'CSV carries the IBAN, amount and reference')
c(f"/payment-runs/{run['id']}/post",{})
ok(c('/setoffs/candidates')['rows']==[],'after the run paid the supplier side nothing is left to set off')
# ── to the final statements ──
tb=c('/reports/trial-balance?from=2000-01-01&to=2099-12-31'); ok(tb['balanced'] and c('/reports/integrity')['ok'],'trial balance balanced and sub-ledgers tied')
fy=[x for x in c('/fiscal-years')['years'] if x['name']==y][0]
fa=c('/reports/final-accounts?fiscalYearId='+fy['id']); ok(fa['ok'],'final accounts: every linkage check holds '+str([x['name'] for x in fa['checks'] if not x['ok']]))
inc=c(f'/reports/income?from={y}-01-01&to={y}-12-31')
ok(near(fa['balanceSheet']['totals']['currentResult'][0],inc['net'],0.02) and near([i['amount'] for x in inc['cogs']['sections'] for i in x['items'] if i['code']==acc['COGS']['code']][0],48,0.02),'the year result in the balance sheet = the income statement result; cost of sales there is the ingredients consumed (48)')
print('FAILS', len(lib.fails)); sys.exit(1 if lib.fails else 0)
