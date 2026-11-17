"""Posting audit: every kind of document in a fresh company; after each one the entry's effect on the key accounts is
compared with what accounting requires, and the books are checked against the sub-ledgers."""
import sys, os, time; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B; R=0.14 if EG else 0.15
t=register('post'); c=lambda *a,**k: call(*a,tok=t,**k)
A=c('/accounts')['rows']; acc={x.get('systemKey'):x for x in A if x.get('systemKey')}; y=time.strftime('%Y'); today=time.strftime('%Y-%m-%d')
D=lambda n: f'{y}-{n}'
def bals():
    tb=c(f'/reports/trial-balance?from={y}-01-01&to={y}-12-31'); by={r['id']:round(float(r['closingDr'])-float(r['closingCr']),2) for r in tb['rows']}
    out={k:by.get(a['id'],0.0) for k,a in acc.items()}; out['_bal']=tb['balanced']; return out
prev=None
def step(name, expect):
    """expect: {key: delta (debit positive)}; every other key account must not move."""
    global prev
    now=bals(); moved={k:round(now[k]-prev[k],2) for k in acc if abs(now[k]-prev[k])>0.004}
    good=now['_bal'] and set(moved)==set(expect) and all(near(moved[k],v,0.011) for k,v in expect.items())
    ok(good, name+('' if good else f'  got {moved}  want {expect}'))
    it=c('/reports/integrity'); bad=[x['name'] for x in (it.get('checks') or it) if not x['ok']]
    ok(not bad, '   books tie to sub-ledgers after: '+name+(' ✗ '+'; '.join(bad) if bad else ''))
    prev=now
def refused(fn,name):
    try: fn(); ok(False,name)
    except E as e: ok(str(e)[:3] in ('400','409','403'), name+' → refused')
ADDR={'street':'طريق الملك فهد','buildingNo':'1234','district':'العليا','city':'الرياض','postalCode':'12211','phone':'0501234567'}
VS='300000000000003' if not EG else '200000001'; VC='310122393500003' if not EG else '300000002'
c('/journals',{'date':D('01-01'),'memo':'رأس المال','lines':[{'accountId':acc['BANK']['id'],'debit':500000,'credit':0},{'accountId':acc['CAPITAL']['id'],'debit':0,'credit':500000}]})
prev=bals(); ok(prev['BANK']==500000 and prev['CAPITAL']==-500000,'capital entry')
sup=c('/partners',{'name':'مورد','isSupplier':True,'kind':'COMPANY','vatNumber':VS,**ADDR})
cus=c('/partners',{'name':'عميل منشأة','isCustomer':True,'kind':'COMPANY','vatNumber':VC,**ADDR})
P=c('/products',{'name':'صنف','sku':'A1','type':'STOCK','salePrice':100,'purchasePrice':50,'taxCode':'S'})
SV=c('/products',{'name':'خدمة','sku':'S1','type':'SERVICE','salePrice':200,'taxCode':'S'})
def inv(direction, pid, lines, date, kind='INVOICE', **k):
    i=c('/invoices',{'direction':direction,'kind':kind,'date':date,'partnerId':pid,'lines':lines,**k}); return c(f"/invoices/{i['id']}/post",{})
L=lambda p,q,u: {'productId':p['id'],'qty':q,'unitPrice':u,'taxCode':'S'}
# 1 purchase
pu=inv('PURCHASE',sup['id'],[L(P,100,50)],D('02-01'),supplierRef='S-1'); step('purchase invoice: Dr inventory + input VAT / Cr payables',{'INVENTORY':5000,'VAT_IN':5000*R,'AP':-5000*(1+R)})
# 2 credit sale (stock + service)
sa=inv('SALE',cus['id'],[L(P,10,100),L(SV,1,200)],D('02-05')); step('credit sale: Dr receivables / Cr sales, service revenue, output VAT; Dr COGS / Cr inventory',{'AR':1200*(1+R),'SALES':-1000,'SERVICE_REVENUE':-200,'VAT_OUT':-1200*R,'COGS':500,'INVENTORY':-500})
# 3 sales credit note (2 units)
cn=inv('SALE',cus['id'],[L(P,2,100)],D('02-06'),kind='CREDIT_NOTE',originId=sa['id'],reason='مرتجع')
step('sales credit note: reverses revenue, VAT and cost, stock back',{'AR':-200*(1+R),'SALES_RETURNS':200,'VAT_OUT':200*R,'COGS':-100,'INVENTORY':100})
# 4 receipt
due=round(1000*(1+R),2); rc=c('/payments',{'direction':'IN','partnerId':cus['id'],'date':D('02-10'),'amount':due,'accountId':acc['BANK']['id']}); step('customer receipt: Dr bank / Cr receivables',{'BANK':due,'AR':-due})
ok(near(prev['AR'],0),'customer balance is zero after invoice − credit note − receipt')
# 5 purchase return
pr=inv('PURCHASE',sup['id'],[L(P,10,50)],D('02-11'),kind='CREDIT_NOTE',originId=pu['id'],reason='مرتجع'); step('purchase return: Cr inventory + input VAT / Dr payables',{'INVENTORY':-500,'VAT_IN':-500*R,'AP':500*(1+R)})
# 6 supplier payment, then cancel and redo
due=round(4500*(1+R),2); pm=c('/payments',{'direction':'OUT','partnerId':sup['id'],'date':D('02-12'),'amount':due,'accountId':acc['BANK']['id']}); step('supplier payment: Dr payables / Cr bank',{'AP':due,'BANK':-due})
c(f"/payments/{pm['id']}/cancel",{}); step('cancel supplier payment: fully reversed',{'AP':-due,'BANK':due})
pm=c('/payments',{'direction':'OUT','partnerId':sup['id'],'date':D('02-12'),'amount':due,'accountId':acc['BANK']['id']}); step('supplier payment again',{'AP':due,'BANK':-due}); ok(near(prev['AP'],0),'supplier balance is zero')
# 7 expense + cancel
ex=c('/expenses',{'date':D('02-15'),'accountId':acc['RENT']['id'],'description':'إيجار','amount':1000,'taxCode':'S','amountIncludesVat':False,'payAccountId':acc['BANK']['id']}); step('expense voucher: Dr expense + input VAT / Cr bank',{'RENT':1000,'VAT_IN':1000*R,'BANK':-1000*(1+R)})
c(f"/expenses/{ex['id']}/cancel",{}); step('cancel expense: fully reversed',{'RENT':-1000,'VAT_IN':-1000*R,'BANK':1000*(1+R)})
# 8 POS
s=c('/pos/session/open',{'openingCash':0}); sess=s.get('session') or s
ps=c('/pos/sale',{'sessionId':sess['id'],'lines':[{'productId':P['id'],'qty':3}],'tenders':[{'method':'CASH','amount':None}]}); cashkey=[k for k in ('POS_CASH','CASH') if abs(bals()[k]-prev[k])>0.004][0]
step('POS cash sale',{cashkey:300*(1+R),'SALES':-300,'VAT_OUT':-300*R,'COGS':150,'INVENTORY':-150})
c('/pos/return',{'sessionId':sess['id'],'originId':ps['id'],'reason':'مرتجع','lines':[{'productId':P['id'],'qty':1}]}); step('POS return',{cashkey:-100*(1+R),'SALES_RETURNS':100,'VAT_OUT':100*R,'COGS':-50,'INVENTORY':50})
# 9 stock: damage, count gain, transfer
c('/inventory/adjustments',{'date':D('02-20'),'kind':'DAMAGE','lines':[{'productId':P['id'],'qty':2}]}); step('damaged stock: Dr inventory loss / Cr inventory',{'INV_LOSS':100,'INVENTORY':-100})
onhand=100-10+2-10-3+1-2
c('/inventory/adjustments',{'date':D('02-21'),'kind':'COUNT','lines':[{'productId':P['id'],'qty':onhand+4}]}); step('stock count surplus: Dr inventory / Cr inventory gain',{'INVENTORY':200,'INV_GAIN':-200})
wh2=c('/warehouses',{'name':'مستودع 2','code':'W2'}); c('/inventory/adjustments',{'date':D('02-22'),'kind':'TRANSFER','toWarehouse':wh2['id'],'lines':[{'productId':P['id'],'qty':20}]}); step('warehouse transfer: no effect on the ledger',{})
# 10 asset + depreciation
c('/assets',{'name':'حاسب','acquisitionDate':D('01-01'),'cost':12000,'usefulLifeMonths':12,'payAccountId':acc['BANK']['id']}); step('asset purchase: Dr fixed asset / Cr bank',{'FIXED_ASSET':12000,'BANK':-12000}) if True else None
c('/assets/depreciate',{'through':D('03-31')}); step('3 months depreciation: Dr depreciation / Cr accumulated',{'DEPRECIATION':3000,'ACC_DEP':-3000})
# 11 manual journal + reversal
j=c('/journals/post',{'date':D('03-05'),'memo':'قيد يدوي','lines':[{'accountId':acc['UTILITIES']['id'],'debit':400,'credit':0},{'accountId':acc['BANK']['id'],'debit':0,'credit':400}]}); step('manual journal',{'UTILITIES':400,'BANK':-400})
c(f"/journals/{j['id']}/reverse",{}); step('journal reversal: net zero',{'UTILITIES':-400,'BANK':400})
refused(lambda: c('/journals/post',{'date':D('03-05'),'memo':'غير متوازن','lines':[{'accountId':acc['UTILITIES']['id'],'debit':400,'credit':0},{'accountId':acc['BANK']['id'],'debit':0,'credit':399}]}),'unbalanced journal')
# 12 payroll
e=c('/employees',{'name':'سالم','nationality':'NON_SAUDI','hireDate':D('01-01'),'basic':3000,'housing':0,'transport':0,'otherAllow':0,'gosi':False})
run=c('/payroll',{'period':f'{y}-03'}); net=float(run['totalNet']); c(f"/payroll/{run['id']}/post",{}); now=bals()
ok(near(now['SALARIES_PAYABLE']-prev['SALARIES_PAYABLE'],-net) and now['_bal'] and near(sum(now[k]-prev[k] for k in acc),0,0.02),f'payroll posted: net {net} credited to salaries payable, entry balanced'); prev=now
c(f"/payroll/{run['id']}/pay",{'accountId':acc['BANK']['id'],'date':D('03-28')}); step('payroll payment: Dr salaries payable / Cr bank',{'SALARIES_PAYABLE':net,'BANK':-net})
# 13 closed period refuses postings
fy=c('/fiscal-years'); jan=[p for p in fy['periods'] if p['startDate'][:7]==f'{y}-01'][0]; c(f"/periods/{jan['id']}",{'status':'LOCKED'},m='PUT')
refused(lambda: c('/journals/post',{'date':D('01-15'),'memo':'في فترة مقفلة','lines':[{'accountId':acc['UTILITIES']['id'],'debit':10,'credit':0},{'accountId':acc['BANK']['id'],'debit':0,'credit':10}]}),'journal in a closed period')
refused(lambda: inv('SALE',cus['id'],[L(SV,1,200)],D('01-20')),'invoice in a closed period')
refused(lambda: c(f"/invoices/{sa['id']}",m='DELETE'),'deleting a posted invoice')
# statements
bs=c(f'/reports/balance-sheet?to={y}-12-31'); ok(bs['balanced'],f"balance sheet balanced {bs['totalAssets']}")
print('FAILS',lib.fails)
