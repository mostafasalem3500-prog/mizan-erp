import sys, os, time; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B; R=0.14 if EG else 0.15
t=register('r323'); c=lambda *a,**k: call(*a,tok=t,**k)
A=c('/accounts')['rows']; acc={x.get('systemKey'):x for x in A if x.get('systemKey')}; y=time.strftime('%Y'); d=time.strftime('%Y-%m-%d')
c('/journals',{'date':d,'memo':'رأس المال','lines':[{'accountId':acc['BANK']['id'],'debit':50000,'credit':0},{'accountId':acc['CAPITAL']['id'],'debit':0,'credit':50000}]})
tbsum=lambda: c(f'/reports/trial-balance?from={y}-01-01&to={y}-12-31')['totals']['debit']
p1=c('/projects',{'name':'مشروع أ','kind':'PROJECT'}); p2=c('/projects',{'name':'مشروع ب','kind':'PROJECT'})
body={'date':d,'accountId':acc['RENT']['id'],'description':'إيجار','amount':1000,'taxCode':'S','amountIncludesVat':False,'payAccountId':acc['BANK']['id'],'allocations':[{'costCenterId':p1['id'],'amount':600},{'costCenterId':p2['id'],'amount':300}]}
before=tbsum(); n0=len((lambda e: e.get('rows') if isinstance(e,dict) else e)(c('/expenses')))
pv=c('/expenses/preview-entry',body)
ok(near(pv['debit'],pv['credit']) and near(pv['debit'],1000*(1+R)) and len(pv['lines'])==5,f"expense preview: 5 lines (3 expense shares, VAT, bank), balanced {pv['debit']}")
ok(sorted(l['costCenter'] for l in pv['lines'] if l.get('costCenter'))==['مشروع أ','مشروع ب'] and any(near(l['debit'],100) and not l.get('costCenter') and l['code']==acc['RENT']['code'] for l in pv['lines']),'expense preview shows each share with its project and the undistributed 100 as general')
ok(near(tbsum(),before) and len((lambda e: e.get('rows') if isinstance(e,dict) else e)(c('/expenses')))==n0,'expense preview records nothing')
e1=c('/expenses',body); pv2=c('/expenses/preview-entry',body); e2=c('/expenses',body); ok(int(e2['number'].split('-')[-1])==int(e1['number'].split('-')[-1])+1,'expense preview does not consume a voucher number')
try: c('/expenses/preview-entry',{**body,'allocations':[{'costCenterId':p1['id'],'amount':5000}]}); ok(False,'preview with shares above net')
except E as e: ok('400' in str(e),'expense preview reports the same validation error as saving')
# payment voucher
ADDR={'street':'طريق الملك فهد','buildingNo':'1234','district':'العليا','city':'الرياض','postalCode':'12211','phone':'0501234567'}
cus=c('/partners',{'name':'عميل','isCustomer':True,'kind':'COMPANY','vatNumber':'310122393500003' if not EG else '300000002',**ADDR})
SV=c('/products',{'name':'خدمة','sku':'S1','type':'SERVICE','salePrice':200,'taxCode':'S'})
i=c('/invoices',{'direction':'SALE','kind':'INVOICE','date':d,'partnerId':cus['id'],'lines':[{'productId':SV['id'],'qty':1,'unitPrice':200,'taxCode':'S'}]}); inv=c(f"/invoices/{i['id']}/post",{})
pb={'direction':'IN','partnerId':cus['id'],'date':d,'amount':float(inv['total']),'accountId':acc['BANK']['id']}; before=tbsum()
pv=c('/payments/preview-entry',pb); ok(len(pv['lines'])==2 and near(pv['debit'],float(inv['total'])) and {l['code'] for l in pv['lines']}=={acc['BANK']['code'],acc['AR']['code']},'receipt preview: Dr bank / Cr receivables')
g=c(f"/invoices/{inv['id']}"); ok(near(tbsum(),before) and g['paymentStatus']=='UNPAID' and float(g['amountPaid'])==0,'receipt preview records nothing: invoice still unpaid')
c('/payments',pb); ok(c(f"/invoices/{inv['id']}")['paymentStatus']=='PAID','the real receipt then settles the invoice')
print('FAILS',lib.fails)
