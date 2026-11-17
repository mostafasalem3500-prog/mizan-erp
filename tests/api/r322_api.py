import sys, os, time; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B; R=0.14 if EG else 0.15
t=register('r322'); c=lambda *a,**k: call(*a,tok=t,**k)
A=c('/accounts')['rows']; acc={x.get('systemKey'):x for x in A if x.get('systemKey')}; y=time.strftime('%Y'); d=time.strftime('%Y-%m-%d')
ADDR={'street':'طريق الملك فهد','buildingNo':'1234','district':'العليا','city':'الرياض','postalCode':'12211','phone':'0501234567'}
sup=c('/partners',{'name':'مورد','isSupplier':True,'kind':'COMPANY','vatNumber':'300000000000003' if not EG else '200000001',**ADDR})
cus=c('/partners',{'name':'عميل','isCustomer':True,'kind':'COMPANY','vatNumber':'310122393500003' if not EG else '300000002','creditLimit':100,**ADDR})
P=c('/products',{'name':'صنف','sku':'A1','type':'STOCK','salePrice':100,'purchasePrice':50,'taxCode':'S'})
prj=c('/projects',{'name':'مشروع','kind':'PROJECT'})
tbsum=lambda: c(f'/reports/trial-balance?from={y}-01-01&to={y}-12-31')['totals']['debit']
draft=lambda direction,pid,q,**k: c('/invoices',{'direction':direction,'kind':'INVOICE','date':d,'partnerId':pid,'lines':[{'productId':P['id'],'qty':q,'unitPrice':50 if direction=='PURCHASE' else 100,'taxCode':'S'}],**k})
pu=draft('PURCHASE',sup['id'],10); before=tbsum()
pv=c(f"/invoices/{pu['id']}/preview-entry",{})
k={l['code']:l for l in pv['lines']}
ok(len(pv['lines'])==3 and near(pv['debit'],pv['credit']) and near(pv['debit'],500*(1+R)),f"purchase preview: 3 lines, balanced {pv['debit']}")
ok(any(near(l['debit'],500) and l['code']==acc['INVENTORY']['code'] for l in pv['lines']) and any(near(l['debit'],500*R) and l['code']==acc['VAT_IN']['code'] for l in pv['lines']) and any(near(l['credit'],500*(1+R)) and l['code']==acc['AP']['code'] for l in pv['lines']),'purchase preview: Dr inventory + input VAT / Cr payables')
g=c(f"/invoices/{pu['id']}"); ok(g['status']=='DRAFT' and not g.get('journalId') and near(tbsum(),before),'preview posts nothing: invoice still a draft, ledger unchanged')
ok(float([x for x in c('/products')['rows'] if x['id']==P['id']][0].get('qty',0) or 0)==0 if isinstance(c('/products'),dict) else True,'preview leaves stock untouched')
r=c(f"/invoices/{pu['id']}/post",{}); n1=r['number']
pu2=draft('PURCHASE',sup['id'],1); c(f"/invoices/{pu2['id']}/preview-entry",{}); c(f"/invoices/{pu2['id']}/preview-entry",{}); n2=c(f"/invoices/{pu2['id']}/post",{})['number']
ok(int(n2.split('-')[-1])==int(n1.split('-')[-1])+1,f'previews do not consume document numbers ({n1} → {n2})')
# sale preview: cost line, project tag, credit limit does not block a preview
sa=draft('SALE',cus['id'],4,costCenterId=prj['id']); pv=c(f"/invoices/{sa['id']}/preview-entry",{})
ok(near(pv['debit'],pv['credit']) and near(pv['costTotal'],200) and len(pv['lines'])==5,f"sale preview: 5 lines, balanced, cost {pv['costTotal']}")
tagged=[l['code'] for l in pv['lines'] if l.get('costCenter')]; ok({acc['SALES']['code'],acc['COGS']['code']}<=set(tagged) and acc['AR']['code'] not in tagged and acc['VAT_OUT']['code'] not in tagged,'sale preview shows the project on revenue and cost lines, not on receivables or VAT')
# what would stop posting is reported by the preview
big=draft('SALE',cus['id'],500)
try: c(f"/invoices/{big['id']}/preview-entry",{}); ok(False,'preview of a sale beyond stock')
except E as e: ok('400' in str(e) or '409' in str(e),'preview of a sale beyond available stock reports the same error posting would')
try: c(f"/invoices/{r['id']}/preview-entry",{}); ok(False,'preview of a posted invoice')
except E as e: ok('409' in str(e),'preview of an already posted invoice → refused')
# period status must be explicit
fy=c('/fiscal-years'); per=fy['periods'][0]
try: c(f"/periods/{per['id']}",{'status':'CLOSED'},m='PUT'); ok(False,'unknown period status')
except E as e: ok('400' in str(e),'unknown period status → refused (was silently treated as open)')
c(f"/periods/{per['id']}",{'status':'LOCKED'},m='PUT'); ok([p for p in c('/fiscal-years')['periods'] if p['id']==per['id']][0]['status']=='LOCKED','period locked'); c(f"/periods/{per['id']}",{'status':'OPEN'},m='PUT')
print('FAILS',lib.fails)
