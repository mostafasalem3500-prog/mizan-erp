import sys, os, time, json, urllib.request; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
# ── 3.35 (associations edition, MIZAN_CHARITY=1): Salla donation store, receipt verification QR, batch authority ──
t=register('r335'); c=lambda *a,**k: call(*a,tok=t,**k)
c('/charity/settings',{'associationName':'جمعية الاختبار الخيرية','licenseNo':'1234'},m='PUT')
pr=c('/charity/projects',{'name':'سلة غذائية','code':'P-FOOD','budget':100000})
pz=c('/charity/projects',{'name':'كفالة يتيم','code':'P-ORPH'})
s0=c('/charity/store'); ok(not s0['connected'] and s0['stats']['receipts']==0,'store not connected at first')
s1=c('/charity/store',{'mode':'DONATIONS','map':{'defaultSource':'CASH_DONATION','rules':[{'match':'FOOD','projectId':pr['id']},{'match':'كفالة','projectId':pz['id'],'source':'SPONSORSHIP'},{'match':'زكاة','source':'ZAKAT'}]}},m='PUT')
tok=s1['connection']['token']; ok(s1['connected'] and s1['connection']['mode']=='DONATIONS' and len(s1['map']['rules'])==3,'store connected in donations mode with 3 routing rules')
try: c('/charity/store',{'map':{'rules':[{'match':'x','projectId':'00000000-0000-0000-0000-000000000000'}]}},m='PUT'); ok(False,'unknown project rejected')
except E as e: ok('404' in str(e) or '400' in str(e),'a rule pointing at another company’s / unknown project is rejected')
def hook(body):
    r=urllib.request.Request(B+'/hooks/salla/'+tok, data=json.dumps(body).encode(), method='POST', headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(r) as x: return json.loads(x.read())
order={'event':'order.created','data':{'id':777001,'reference_id':91001,'status':{'slug':'completed','name':'مكتمل'},'customer':{'first_name':'عبدالله','last_name':'الحربي','mobile':'555123456','mobile_code':'+966','email':'a@x.sa'},
  'items':[{'id':1,'name':'سلة غذائية','sku':'FOOD-1','quantity':2,'amounts':{'total':{'amount':300}}},{'id':2,'name':'كفالة يتيم شهرية','sku':'K1','quantity':1,'amounts':{'total':{'amount':500}}},{'id':3,'name':'تبرع عام','sku':'G','quantity':1,'amounts':{'total':{'amount':50}}}]}}
h1=hook(order); ok(h1['status']=='DONE','webhook order.created → recorded: '+str(h1.get('message')))
rc=[x for x in c('/charity/receipts')['rows' if isinstance(c('/charity/receipts'),dict) else 0]] if isinstance(c('/charity/receipts'),dict) else c('/charity/receipts')
mine=[x for x in rc if x.get('externalRef')=='salla:777001']
ok(len(mine)==3 and abs(sum(float(x['amount']) for x in mine)-850)<0.01,f'one receipt per project/source group, total 850 ({len(mine)})')
byp={x.get('projectId'):x for x in mine}
ok(float(byp[pr['id']]['amount'])==300 and byp[pz['id']]['source']=='SPONSORSHIP' and byp[None]['source']=='CASH_DONATION','food → food project, sponsorship → orphan project as SPONSORSHIP, rest → general donation')
ok(all(x['method']=='CARD' and x.get('journalId') for x in mine),'store receipts are card receipts with a posted entry')
dn=c('/charity/donors'); dn=dn['rows'] if isinstance(dn,dict) else dn
ok(any(d['name'].startswith('عبدالله') and (d.get('phone') or '').endswith('555123456') for d in dn),'the buyer is added to the donor register')
h2=hook(order); ok(h2['status']=='IGNORED','the same order again is ignored (no duplicate receipts)')
pend={'event':'order.created','data':{'id':777002,'reference_id':91002,'status':{'slug':'payment_pending','name':'بانتظار الدفع'},'customer':{'first_name':'سارة','mobile':'555000111'},'items':[{'id':1,'name':'تبرع','sku':'G','quantity':1,'amounts':{'total':{'amount':100}}}]}}
h3=hook(pend); ok(h3['status']=='IGNORED' and 'لم يُدفع' in h3['message'],'an unpaid order (bank transfer awaiting review) is not recorded yet')
pend2=json.loads(json.dumps(pend)); pend2['event']='order.status.updated'; pend2['data']['status']={'slug':'completed','name':'مكتمل'}
h4=hook(pend2); ok(h4['status']=='DONE','…and is recorded when the status moves to paid/completed')
ref={'event':'order.refunded','data':{**order['data']}}
h5=hook(ref); ok(h5['status']=='DONE','order.refunded cancels the order’s receipts')
rc2=c('/charity/receipts'); rc2=rc2['rows'] if isinstance(rc2,dict) else rc2
ok(all(x['status']=='CANCELLED' for x in rc2 if x.get('externalRef')=='salla:777001'),'all 3 receipts cancelled with reversing entries')
smp=c('/charity/store/sample',{}); ok(smp['status']=='DONE','sample donation order recorded')
ov=c('/charity/store'); ok(ov['stats']['receipts']>=2 and len(ov['events'])>=5,f"overview: {ov['stats']['receipts']} live receipts, {len(ov['events'])} events")
# ── public verification ──
live=[x for x in rc2 if x['status']=='POSTED' and x.get('verifyToken')]
ok(len(live)>0,'receipts carry a verification token')
v=call('/public/donation/'+live[0]['verifyToken'])
ok(v['number']==live[0]['number'] and abs(float(v['amount'])-float(live[0]['amount']))<0.01 and v['association']=='جمعية الاختبار الخيرية','public page shows number, amount and association')
ok('…' in (v.get('payer') or '') and 'سارة'!=v.get('payer'),f"payer name is masked ({v.get('payer')})")
for bad_ in ['short','x'*20]:
    try: call('/public/donation/'+bad_); ok(False,'bad token')
    except E as e: ok('404' in str(e),f'bad token «{bad_[:6]}» → 404')
# ── batch authority ──
c('/charity/authority',{'enabled':True,'separation':False,'directLimit':1000,'levels':[{'upTo':None,'title':'المجلس','approvals':1,'decision':True}]},m='PUT')
em=f'acc{time.time_ns()}@t.sa'; c('/users',{'email':em,'fullName':'محاسب','password':'Passw0rd!','role':'ACCOUNTANT'})
ta=call('/auth/login',{'email':em,'password':'Passw0rd!'})['token']
accs=c('/accounts'); accs=accs['rows'] if isinstance(accs,dict) else accs; bank=[x['id'] for x in accs if x.get('systemKey')=='BANK'][0]
b=c('/charity/batches',{'payAccountId':bank,'title':'مسير رمضان','projectId':pr['id'],'kind':'TRANSFER','lines':[{'name':'مستفيد 1','amount':1500,'iban':'SA0380000000608010167519'},{'name':'مستفيد 2','amount':700}]})
try: call(f"/charity/batches/{b['id']}/post",{},tok=ta); ok(False,'409 AUTHORITY')
except E as e: ok('409' in str(e) and 'AUTHORITY' in str(e),'a 2,200 batch over the 1,000 direct limit needs a board decision (409 AUTHORITY)')
d=c('/charity/decisions',{'text':'اعتماد مسير رمضان','category':'FINANCIAL','amount':2200})
r=call(f"/charity/batches/{b['id']}/post",{'decisionId':d['id']},tok=ta)
ok(r['status']=='POSTED','with the decision attached the accountant posts it')
bl=c('/charity/batches'); ok([x for x in bl if x['id']==b['id']][0].get('decisionId')==d['id'],'the decision is stored on the batch')
b2=c('/charity/batches',{'payAccountId':bank,'title':'مسير صغير','kind':'TRANSFER','lines':[{'name':'م','amount':400}]})
ok(call(f"/charity/batches/{b2['id']}/post",{},tok=ta)['status']=='POSTED','a batch under the limit posts directly')
# the supervising body's name and the authority matrix are separate fields (3.33 wrote one over the other)
c('/charity/settings',{'authority':'المركز الوطني لتنمية القطاع غير الربحي'},m='PUT')
c('/charity/authority',{'enabled':True,'directLimit':2500,'levels':[{'upTo':None,'title':'المجلس','approvals':1,'decision':True}]},m='PUT')
ok(c('/charity/settings')['authority']=='المركز الوطني لتنمية القطاع غير الربحي' and c('/charity/authority')['directLimit']==2500,'saving the authority matrix keeps the supervising body’s name, and the matrix reads back')
print('FAILS',len(fails)); sys.exit(1 if fails else 0)
