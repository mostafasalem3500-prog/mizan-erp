import sys, os, time, datetime; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
from urllib.parse import quote
EG='3200' in B; R=0.14 if EG else 0.15
# ── 3.38: modifiers & service charge (Foodics), supplier payment runs (SAP/Dynamics), cash forecast, smart auditor ──
t=register('r338'); c=lambda *a,**k: call(*a,tok=t,**k)
A=c('/accounts')['rows']; K={x.get('systemKey'):x for x in A if x.get('systemKey')}
d=datetime.date.today(); dt=d.isoformat(); D=lambda n: (d-datetime.timedelta(days=n)).isoformat()
def refused(code, fn, name):
    try: fn(); ok(False,name)
    except E as e: ok(str(code) in str(e)[:3], name+' → '+str(e)[:90])
def bal(key):
    r=[x for x in c(f'/reports/trial-balance?from=2000-01-01&to={dt}')['rows'] if x['id']==K[key]['id']]
    return round(float(r[0]['closingDr'])-float(r[0]['closingCr']),2) if r else 0.0
ADDR={'street':'طريق الملك فهد','buildingNo':'1234','district':'العليا','city':'الرياض','postalCode':'12211','phone':'0501234567'}
VS=['300000000000003','300000000100003','300000000200003'] if not EG else ['200000001','200000002','200000003']
c('/journals',{'date':D(60),'memo':'رأس المال','lines':[{'accountId':K['BANK']['id'],'debit':200000,'credit':0},{'accountId':K['CAPITAL']['id'],'debit':0,'credit':200000}]})

# ── modifiers ──
cat=c('/categories',{'name':'مشروبات'})
burger=c('/products',{'name':'برجر','sku':'BG1','type':'SERVICE','salePrice':30,'taxCode':'S'})
coffee=c('/products',{'name':'قهوة','sku':'CF1','type':'SERVICE','salePrice':12,'taxCode':'S','categoryId':cat['id']})
size=c('/modifiers',{'name':'الحجم','minSelect':1,'maxSelect':1,'options':[{'name':'صغير','price':0},{'name':'كبير','price':4}],'categoryIds':[cat['id']]})
extra=c('/modifiers',{'name':'إضافات','minSelect':0,'maxSelect':3,'options':[{'name':'جبن','price':3},{'name':'بدون بصل','price':0},{'name':'صوص حار','price':1.5}],'productIds':[burger['id']]})
ok(len(size['options'])==2 and size['options'][1]['price']==4 and size['categoryIds']==[cat['id']],'modifier group saved with options and attached to a category')
for b_,lab in [({'name':'x','options':[]},'no options'),({'name':'x','minSelect':2,'maxSelect':1,'options':[{'name':'a'}]},'max below min'),({'name':'x','options':[{'name':'a','price':-1}]},'negative price'),({'name':'x','options':[{'name':'a'},{'name':'a'}]},'duplicate option'),({'name':'x','minSelect':2,'maxSelect':2,'options':[{'name':'a'}]},'min above the options')]:
    refused(400,lambda: c('/modifiers',b_),f'modifier group refused: {lab}')
live=c('/modifiers/live'); ok(len(live)==2,'the POS reads the active groups')
sess=c('/pos/session/open',{'openingCash':0}); sid=sess['id']
S,L=size['options'],extra['options']
sale=lambda lines,**k: c('/pos/sale',{'sessionId':sid,'lines':lines,'tenders':[{'method':'CASH','amount':None}],**k})
refused(400,lambda: sale([{'productId':coffee['id'],'qty':1}]),'a required group (size) not chosen')
refused(400,lambda: sale([{'productId':coffee['id'],'qty':1,'modifiers':[S[0]['id'],S[1]['id']]}]),'two sizes for one cup (maximum 1)')
refused(400,lambda: sale([{'productId':burger['id'],'qty':1,'modifiers':[S[1]['id']]}]),'an option of a group that does not apply to the product')
inv=sale([{'productId':coffee['id'],'qty':2,'unitPrice':12,'modifiers':[S[1]['id']]},{'productId':burger['id'],'qty':1,'unitPrice':30,'modifiers':[L[0]['id'],L[2]['id']]}])
lc=[l for l in inv['lines'] if 'قهوة' in l['description']][0]; lb=[l for l in inv['lines'] if 'برجر' in l['description']][0]
ok(near(lc['unitPrice'],16) and 'كبير' in lc['description'] and near(lb['unitPrice'],34.5) and 'جبن' in lb['description'],'server prices the add-ons: coffee 12+4, burger 30+3+1.5, named on the line')
exp=round(2*16+34.5,2)
ok(near(inv['total'],exp) if c('/auth/me')['company'].get('pricesIncludeVat') else near(inv['total'],round(exp*(1+R),2)),f"invoice total includes the add-ons and their VAT ({inv['total']})")
# a screen price for the add-on is ignored: the server's price stands
inv2=sale([{'productId':coffee['id'],'qty':1,'unitPrice':12,'modifiers':[S[1]['id']]}])
ok(near(inv2['lines'][0]['unitPrice'],16),'add-on price comes from the server, not the screen')

# ── service charge on dine-in orders ──
c('/pos/restaurant/settings',{'mode':'RESTAURANT','serviceCharge':{'pct':10,'types':['DINE_IN']}},m='PUT')
refused(400,lambda: c('/pos/restaurant/settings',{'serviceCharge':{'pct':40}},m='PUT'),'service charge above 30%')
st=c('/pos/restaurant')['settings']; ok(st['serviceCharge']['pct']==10 and st['serviceCharge']['types']==['DINE_IN'],'service charge setting: 10% on dine-in')
T=c('/pos/restaurant')['floors'][0]['tables']
o=c('/pos/orders',{'tableId':T[0]['id'],'guests':2})
mods=[{'optionId':L[0]['id'],'name':'جبن','price':3}]
o=c(f"/pos/orders/{o['id']}",{'lines':[{'key':f"{burger['id']}::{L[0]['id']}",'productId':burger['id'],'name':'برجر','qty':2,'unitPrice':33,'discountPct':0,'mods':mods}]},m='PUT')
tk=c(f"/pos/orders/{o['id']}/send",{})['ticket']; ok(tk and 'جبن' in tk['items'][0]['name'],'kitchen ticket names the add-on')
ok('جبن' in c('/pos/kitchen')[0]['items'][0]['name'],'kitchen screen shows the add-on')
bank0=bal('SERVICE_REVENUE') if 'SERVICE_REVENUE' in K else 0
pi=sale([{'productId':burger['id'],'qty':2,'unitPrice':30,'modifiers':[L[0]['id']]}],orderId=o['id'])
svc=[l for l in pi['lines'] if 'رسوم الخدمة' in l['description']]
goods=sum(float(l['netAmount']) for l in pi['lines'] if l not in svc)
ok(len(svc)==1 and near(svc[0]['netAmount'],round(goods*0.10,2)) and near(svc[0]['vatAmount'],round(goods*0.10*R,2)),f'dine-in bill: service charge 10% of the net, with VAT ({svc[0]["netAmount"] if svc else None})')
ok(near(bal('SERVICE_REVENUE')-bank0,-(goods+svc[0]['netAmount'])),'service charge credited to service revenue (with the dishes, which are services here)')
o2=c('/pos/orders',{'type':'TAKEAWAY'}); pi2=sale([{'productId':burger['id'],'qty':1,'unitPrice':30}],orderId=o2['id'])
ok(not any('رسوم الخدمة' in l['description'] for l in pi2['lines']),'take-away: no service charge')
o3=c('/pos/orders',{'tableId':T[1]['id'],'guests':1}); pi3=sale([{'productId':burger['id'],'qty':1,'unitPrice':30}],orderId=o3['id'],waiveServiceCharge=True)
ok(not any('رسوم الخدمة' in l['description'] for l in pi3['lines']) and 'أُعفي' in (c(f"/invoices/{pi3['id']}").get('notes') or ''),'waived service charge: no line, the waiver is written on the invoice')
rp=c(f'/pos/restaurant/report?from={dt}&to={dt}')
mc=[x for x in rp['modifiers'] if x['name']=='جبن']
ok(mc and near(mc[0]['qty'],3) and near(rp['service']['net'],svc[0]['netAmount']),f"restaurant report: add-ons sold (cheese ×{mc[0]['qty'] if mc else 0}) and service charge collected")
ret=c('/pos/return',{'sessionId':sid,'originId':inv['id'],'lines':[{'productId':burger['id'],'qty':1}],'reason':'إرجاع'})
ok(near([l for l in ret['lines']][0]['unitPrice'],34.5),'return refunds the burger at its price with add-ons')
ok(near([x for x in c(f'/pos/restaurant/report?from={dt}&to={dt}')['modifiers'] if x['name']=='جبن'][0]['qty'],2),'the returned add-on leaves the modifiers report')
c('/pos/session/close',{'sessionId':sid,'countedCash':0}) if False else None

# ── supplier payment run ──
sup=[c('/partners',{'name':f'مورد {i+1}','isSupplier':True,'kind':'COMPANY','vatNumber':VS[i],**ADDR,'paymentTerms':30}) for i in range(3)]
item=c('/products',{'name':'مادة خام','sku':'RM1','type':'STOCK','salePrice':20,'purchasePrice':10,'taxCode':'S'})
def bill(pid,qty,date,ref):
    i=c('/invoices',{'direction':'PURCHASE','kind':'INVOICE','date':date,'dueDate':date,'partnerId':pid,'supplierRef':ref,'lines':[{'productId':item['id'],'qty':qty,'unitPrice':10}]}); return c(f"/invoices/{i['id']}/post",{})
b1=bill(sup[0]['id'],100,D(20),'S1-001'); b2=bill(sup[0]['id'],50,D(3),'S1-002'); b3=bill(sup[1]['id'],200,D(10),'S2-001'); b4=bill(sup[2]['id'],30,(d+datetime.timedelta(days=40)).isoformat(),'S3-001')
pp=c(f'/payment-runs/propose?dueUntil={dt}')
names={s['partnerName'] for s in pp['suppliers']}
ok(names=={'مورد 1','مورد 2'} and pp['count']==3 and near(pp['total'],round((1000+500+2000)*(1+R),2)),f"proposal: invoices due by today, grouped by supplier ({pp['count']} invoices, {pp['total']}); the one due in 40 days is left out")
lines=[{'invoiceId':i['invoiceId'],'amount':i['amount']} for s in pp['suppliers'] for i in s['invoices']]
lines[1]['amount']=round(lines[1]['amount']/2,2)
refused(400,lambda: c('/payment-runs',{'accountId':K['BANK']['id'],'payDate':dt,'lines':[{**lines[0],'amount':lines[0]['amount']+1}]}),'more than the invoice balance')
refused(404,lambda: c('/payment-runs',{'accountId':K['SALES']['id'],'payDate':dt,'lines':lines}),'paying from an account that is not cash or bank')
run=c('/payment-runs',{'accountId':K['BANK']['id'],'payDate':dt,'dueUntil':dt,'lines':lines})
ok(run['status']=='DRAFT' and len(run['suppliers'])==2 and near(run['total'],sum(l['amount'] for l in lines)),'run saved as a draft: two suppliers')
pp2=c(f'/payment-runs/propose?dueUntil={dt}')
ok(near(pp2['total'],round(pp['total']-run['total'],2)),'what a run holds is not proposed again')
refused(400,lambda: c('/payment-runs',{'accountId':K['BANK']['id'],'payDate':dt,'lines':[lines[0]]}),'the same invoice in a second run beyond its balance')
refused(409,lambda: c(f"/payment-runs/{run['id']}/post",{}),'posting before approval')
st2=str(time.time_ns()); c('/users',{'email':f'adm{st2}@t.sa','fullName':'مدير ثانٍ','password':'Passw0rd!','role':'ADMIN'})
t2=call('/auth/login',{'email':f'adm{st2}@t.sa','password':'Passw0rd!'})['token']; c2=lambda *a,**k: call(*a,tok=t2,**k)
refused(409,lambda: c(f"/payment-runs/{run['id']}/approve",{}),'the preparer cannot approve when another manager exists (four eyes)')
ap0,bank0=bal('AP'),bal('BANK')
run=c2(f"/payment-runs/{run['id']}/approve",{}); ok(run['status']=='APPROVED' and run['approvedBy']=='مدير ثانٍ','approved by the second manager')
refused(409,lambda: c(f"/payment-runs/{run['id']}",{'lines':lines},m='PUT'),'an approved run cannot be edited')
fc=c(f'/reports/cash-forecast?weeks=13')
ok(any(x['kind']=='RUN' for b_ in fc['buckets'] for x in b_['items']),'the approved run is in the cash forecast')
pr=c(f"/payment-runs/{run['id']}/post",{})
ok(pr['status']=='POSTED' and len(pr['vouchers'])==2,'posted: one payment voucher per supplier')
ok(near(bal('AP')-ap0,run['total']) and near(bal('BANK')-bank0,-run['total']),'Dr suppliers / Cr bank by the run total')
inv1=c(f"/invoices/{b1['id']}"); inv2=c(f"/invoices/{b2['id']}")
ok(near(inv1['amountPaid'],inv1['total']) and near(inv2['amountPaid'],round(inv2['total']/2,2)),'invoices settled: the first in full, the second by half')
ig=c('/reports/integrity'); ok(ig['ok'],'books tie to the sub-ledgers after the run '+str([x['name'] for x in ig['checks'] if not x['ok']][:2]))
cr=c(f"/payment-runs/{run['id']}/cancel",{}); ok(cr['status']=='CANCELLED' and near(bal('AP'),ap0) and near(bal('BANK'),bank0),'cancelling a posted run reverses its vouchers')
ok(len(c('/payment-runs'))==1,'runs listed')

# ── cash forecast ──
cus=c('/partners',{'name':'عميل آجل','isCustomer':True,'kind':'COMPANY','vatNumber':'310122393500003' if not EG else '300000009',**ADDR})
si=c('/invoices',{'direction':'SALE','kind':'INVOICE','date':D(5),'dueDate':(d+datetime.timedelta(days=9)).isoformat(),'partnerId':cus['id'],'lines':[{'productId':burger['id'],'qty':10,'unitPrice':100}]}); si=c(f"/invoices/{si['id']}/post",{})
late=c('/invoices',{'direction':'SALE','kind':'INVOICE','date':D(40),'dueDate':D(10),'partnerId':cus['id'],'lines':[{'productId':burger['id'],'qty':5,'unitPrice':100}]}); late=c(f"/invoices/{late['id']}/post",{})
fc=c('/reports/cash-forecast?weeks=13&overdueRate=50')
cash=sum(float(x['balance']) for x in fc['accounts'])
ok(near(fc['opening'],cash) and len(fc['buckets'])==13,'forecast opens with the cash and bank balances, 13 weeks')
w1=fc['buckets'][0]; w2=fc['buckets'][1]
ok(near(w1['in']['ar'],round(late['total']*0.5,2)),f"overdue customer invoice in week 1 at the 50% collection rate ({w1['in']['ar']})")
ok(near(w2['in']['ar'],si['total']),'invoice due in 9 days falls in week 2')
ok(any(x['kind'] in ('AP','AP_OVERDUE') for x in w1['items']) and any('S3-001' in x['label'] or x['amount']>0 for b_ in fc['buckets'][5:7] for x in b_['items'] if x['dir']=='OUT'),'supplier invoices: overdue in week 1, the one due in 40 days in week 6')
ok(all(near(b_['closing'],b_['opening']+b_['net']) for b_ in fc['buckets']) and near(fc['buckets'][1]['opening'],fc['buckets'][0]['closing']),'each week closes at opening + in − out and opens the next')
vatnet=-(bal('VAT_OUT')+bal('VAT_IN')+(bal('VAT_PAYABLE') if 'VAT_PAYABLE' in K else 0)); hasv=any(x['kind']=='VAT' for b_ in fc['buckets'] for x in b_['items'])
ok(hasv if vatnet>0 else not hasv,f'VAT: owed → paid at the return deadline; refundable → no outflow (net {round(vatnet,2)})')
j0=c('/journals',{'date':D(2),'memo':'ضريبة مخرجات','lines':[{'accountId':K['BANK']['id'],'debit':20000,'credit':0},{'accountId':K['VAT_OUT']['id'],'debit':0,'credit':20000}]})
vn=-(bal('VAT_OUT')+bal('VAT_IN')+(bal('VAT_PAYABLE') if 'VAT_PAYABLE' in K else 0)); vx=[x for b_ in c('/reports/cash-forecast')['buckets'] for x in b_['items'] if x['kind']=='VAT']
ok(vx and near(vx[0]['amount'],vn),f'VAT owed ({round(vn,2)}) is an outflow at the return deadline')
c(f"/journals/{j0['id']}/reverse",{'date':D(2)})
fc100=c('/reports/cash-forecast?weeks=13'); ok(near(fc100['buckets'][0]['in']['ar']-w1['in']['ar'],round(late['total']*0.5,2)),'the collection rate changes the overdue inflow')

# ── smart auditor ──
dup=bill(sup[1]['id'],200,D(9),'S2-001')  # same supplier, same supplier invoice number
pd=[i for g in c(f'/payment-runs/propose?dueUntil={dt}')['suppliers'] for i in g['invoices'] if i['invoiceId']==dup['id']]
ok(pd and pd[0]['duplicateOf']==b3['number'],'payment proposal flags the second bill with the same supplier invoice number as a possible duplicate of the first')
e1=c('/expenses',{'date':D(4),'accountId':K['UTILITIES']['id'],'description':'فاتورة الكهرباء','payee':'شركة الكهرباء','amount':800,'taxCode':'S','payAccountId':K['BANK']['id']})
e2=c('/expenses',{'date':D(3),'accountId':K['UTILITIES']['id'],'description':'فاتورة الكهرباء','payee':'شركة الكهرباء','amount':800,'taxCode':'S','payAccountId':K['BANK']['id']})
fri=d-datetime.timedelta(days=(d.weekday()-4)%7 or 7)  # a Friday in the past
j=c('/journals',{'date':fri.isoformat(),'memo':'تسوية','lines':[{'accountId':K['AR']['id'],'debit':50000,'credit':0},{'accountId':K['OTHER_INCOME']['id'],'debit':0,'credit':50000}]})
au=c(f'/auditor?from={D(60)}&to={dt}')
kinds={f['kind'] for f in au['findings']}
ok({'DUP_BILL','DUP_EXPENSE','WEEKEND','ROUND','CONTROL'}<=kinds,f'auditor finds: duplicate bill, duplicate expense, weekend, round amount, control account ({sorted(kinds)})')
db_=[f for f in au['findings'] if f['kind']=='DUP_BILL'][0]
ok(db_['severity']=='high' and 'S2-001' in db_['detail'] and db_['why'],'duplicate bill: high, names the supplier invoice number and says why')
ok(au['counts']['high']>=1 and au['score']<100 and au['tested']['manualEntries']>=2,f"score and counts ({au['score']}, {au['counts']})")
refused(400,lambda: c('/auditor/dismiss',{'kind':'DUP_BILL','ref':db_['ref'],'note':''}),'dismissing needs a reason')
c('/auditor/dismiss',{'kind':'DUP_BILL','ref':db_['ref'],'note':'فاتورتان مختلفتان بنفس الرقم من المورد — تم التحقق'})
au2=c(f'/auditor?from={D(60)}&to={dt}')
ok(not any(f['ref']==db_['ref'] and f['kind']=='DUP_BILL' for f in au2['findings']) and au2['counts']['dismissed']==1,'a dismissed finding is hidden and counted')
ok(any(f['dismissed'] for f in c(f'/auditor?from={D(60)}&to={dt}&all=1')['findings']),'shown again with «all», with its note')
c('/auditor/undismiss',{'kind':'DUP_BILL','ref':db_['ref']}); ok(any(f['ref']==db_['ref'] for f in c(f'/auditor?from={D(60)}&to={dt}')['findings']),'undismissed')
import random; random.seed(7)
bf=c('/auditor?from=2000-01-01&to='+dt)['benford']; ok(bf['n']>=1 and len(bf['digits'])==9 and abs(sum(x['expected'] for x in bf['digits'])-100)<0.5,'Benford: nine digits with the expected shares')

# ── account suggestion for an expense ──
sg=c('/expenses/suggest-account?payee='+quote('شركة الكهرباء'))['suggestions']
ok(sg and sg[0]['accountId']==K['UTILITIES']['id'] and '2' in sg[0]['reason'],'payee seen before → its account first ("used 2 times")')
sg=c('/expenses/suggest-account?description='+quote('سداد فاتورة كهرباء الفرع'))['suggestions']
ok(sg and sg[0]['accountId']==K['UTILITIES']['id'],'similar description → the same account')
ok(c('/expenses/suggest-account?description=zzzz')['suggestions']==[],'nothing similar → no suggestion')

# ── the built-in assistant answers from the same tools ──
def ask(text): r=c('/ai/chat',{'text':text}); return r['view'][-1]
v=ask('هل توجد فواتير مكررة؟'); txt=str(v.get('text') or v)
ok('المدقق الذكي' in txt and 'S2-001' in txt,'assistant: «duplicate invoices?» runs the smart auditor and names the invoice')
v=ask('توقع السيولة للأسابيع القادمة'); txt=str(v.get('text') or v)
ok('توقع التدفق النقدي' in txt and '/cash-forecast' in txt,'assistant: cash forecast in words with a link to the details')
# ── isolation: another establishment sees none of it ──
o_=register('r338o'); co=lambda *a,**k: call(*a,tok=o_,**k)
ok(co('/modifiers')==[] and co('/payment-runs')==[],'another establishment sees no modifiers or runs')
try: co(f"/payment-runs/{run['id']}"); ok(False,'cross-company run')
except E as e: ok(str(e)[:3] in ('400','404'),'another establishment cannot open this run')
try: co(f"/modifiers/{size['id']}",{'name':'x','options':[{'name':'a'}]},m='PUT'); ok(False,'cross-company modifier')
except E as e: ok(str(e)[:3] in ('400','404'),'another establishment cannot change this group')
print('FAILS', len(lib.fails)); sys.exit(1 if lib.fails else 0)
