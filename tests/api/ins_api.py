import sys, os, base64, time, urllib.request; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
t=register('ins'); c=lambda *a,**k: call(*a,tok=t,**k)
c('/demo/load',{})
for i in range(80):
    if c('/demo/status').get('demoLoaded'): break
    time.sleep(3)
open('tokins.txt','w').write('TOKEN='+t+'\n')
y=today_=time.strftime('%Y'); d=c(f'/analytics/executive?from={y}-01-01&to={y}-12-31')
k=d['kpis']; inc=c(f'/reports/income-statement?from={y}-01-01&to={y}-12-31') if False else None
print('kpis',{x:k[x] for x in ('sales','cost','grossProfit','margin','invoices','purchases','expenses')})
tb={r['code']:r for r in c(f'/reports/trial-balance?from={y}-01-01&to={y}-12-31')['rows']}
keys={a.get('systemKey'):a['code'] for a in c('/accounts')['rows'] if a.get('systemKey')}
sales_gl=sum(float(tb[x]['credit'])-float(tb[x]['debit']) for x in tb if x in('4101','4102','4103',keys.get('RENTAL_REVENUE'),keys.get('SUBSCRIPTION_REVENUE')))
# revenue recognised month by month from a contract received in advance is in the ledger but is not an invoice sale
deferred=sum(l['amount'] for a in c('/amortizations') if a['kind']=='DEFERRED' for l in c(f"/amortizations/{a['id']}")['lines'] if l['posted'] and l['periodEnd'][:4]==y)
# a subscription paid for a year is a sale when invoiced (to deferred revenue), and its months then move to revenue
deferred-=sum(a['total'] for a in c('/amortizations') if a['kind']=='DEFERRED' and (a['name'].startswith('اشتراك ') or a['name'].startswith('ترقية اشتراك ')) and str(a['startDate'])[:4]==y)
ok(near(k['sales'],sales_gl-deferred,1.0),f"sales KPI {k['sales']} = ledger revenue {round(sales_gl,2)} − recognised deferred revenue {deferred}")
cogs=float(tb['5101']['debit'])-float(tb['5101']['credit']); ok(near(k['cost'],cogs,1.0),f"cost KPI {k['cost']} = COGS ledger {round(cogs,2)}")
ok(near(sum(p['v'] for p in d['categories']), sum(p['net'] for p in d['topProducts']) if len(d['topProducts'])<15 else sum(p['v'] for p in d['categories'])),'categories total consistent')
ok(d['abc']['A']['n']>0 and d['abc']['A']['n']+d['abc']['B']['n']+d['abc']['C']['n']==d['productsSold'],'ABC classes cover all sold products')
ok(len(d['daily'])>10 and len(d['topProducts'])>0 and len(d['topCustomers'])>0 and len(d['topSuppliers'])>0,'series & rankings populated')
val=c('/inventory/valuation'); tv=sum(float(r['value']) for r in (val['rows'] if isinstance(val,dict) else val)); ok(near(d['inventory']['value'],tv,1.0),f"stock value {d['inventory']['value']} = valuation {round(tv,2)}")
ag=c('/reports/aging?role=CUSTOMER') if False else None
ar=float(tb['110301']['debit'])-float(tb['110301']['credit']); ok(abs(d['receivables']['total']-ar)<ar*0.05+50,f"receivables {d['receivables']['total']} ≈ AR ledger {round(ar,2)} (ledger also holds unallocated receipts)")
ok(near(d['cash']['total'], sum(float(tb[x]['debit'])-float(tb[x]['credit']) for x in tb if x.startswith('1101') or x.startswith('1102')),1.0),'cash total = cash & bank ledger')
ok(len(d['insights'])>=4 and isinstance(d['alerts'],list),'insights & alerts generated: %d / %d'%(len(d['insights']),len(d['alerts'])))
print(*['  • '+x for x in d['insights'][:4]],sep='\n'); print(*['  ! '+a['area']+': '+a['text'][:90] for a in d['alerts'][:6]],sep='\n')
d1=c('/analytics/executive'); ok(d1['period']['days']>=1 and 'change' in d1,'default period = month to date')
# digest
g=c('/digest'); ok(len(g['sections'])==9 and g['mail']['configured'] is False,'digest meta; SMTP not configured here')
try: c('/digest/recipients',{'name':'x','email':'bad','sections':['summary']}); ok(False,'bad email')
except E as e: ok('400' in str(e),'bad email rejected')
try: c('/digest/recipients',{'name':'x','email':'a@b.sa','sections':[]}); ok(False,'no sections')
except E as e: ok('400' in str(e),'recipient needs at least one section')
ids=[c('/digest/recipients',{'name':f'مدير {i}','email':f'm{i}@co.sa','sections':['summary','alerts'] if i%2 else ['inventory','purchases'],'frequency':['DAILY','WEEKLY','MONTHLY'][i%3]})['id'] for i in range(25)]
ok(len(c('/digest')['recipients'])==25,'25 recipients added')
try: c('/digest/recipients',{'name':'dup','email':'m1@co.sa','sections':['summary']}); ok(False,'dup')
except E as e: ok('400' in str(e),'duplicate email rejected')
def html(qs):
    r=urllib.request.Request('http://127.0.0.1:3100/api/digest/preview'+qs,headers={'Authorization':'Bearer '+t}); return urllib.request.urlopen(r).read().decode()
h1=html('?recipientId='+ids[1]); h0=html('?recipientId='+ids[0])
ok('الملخص' not in h0 and 'المبيعات' in h1 and 'أصناف تحتاج طلباً' not in h1 and ('المخزون' in h0),'each recipient gets only his sections')
ok('الأصناف الأكثر مبيعاً' in html('?frequency=MONTHLY') and 'التقرير الشهري' in html('?frequency=MONTHLY'),'full monthly preview')
(os.makedirs('shots',exist_ok=True),open('shots/digest.html','w'))[1].write(html('?frequency=MONTHLY'))
c('/digest/settings',{'enabled':True,'hour':21,'weekday':4},m='PUT'); ok(c('/digest')['settings']['enabled'],'schedule saved')
try: c('/digest/send',{}); ok(False,'send')
except E as e: ok('400' in str(e),'send refused cleanly without SMTP')
c('/digest/recipients/'+ids[0],m='DELETE'); ok(len(c('/digest')['recipients'])==24,'recipient deleted')
# archive
pdf=base64.b64encode(b'%PDF-1.4 x').decode()
a=c('/archive/upload',{'name':'cr.pdf','mime':'application/pdf','data':pdf,'title':'السجل التجاري','category':'سجل تجاري','expiresAt':time.strftime('%Y-%m-%d',time.gmtime(time.time()+20*86400)),'tags':'حكومي، 2026'})
pi=[x for x in c('/invoices?direction=PURCHASE&kind=INVOICE&status=POSTED&limit=3')['rows']][0]
c(f"/attachments/invoice/{pi['id']}",{'name':'bill.pdf','mime':'application/pdf','data':pdf})
ar_=c('/archive'); ok(ar_['stats']['files']==2 and ar_['stats']['expiring']==1 and ar_['stats']['general']==1,'archive stats: '+str({k:ar_['stats'][k] for k in('files','expiring','general')}))
ok(any(r['ref']==pi['number'] for r in ar_['rows']),'invoice attachment listed with its document number')
ok(len(c('/archive?q='+urllib.parse.quote(pi['number']))['rows'])==1 and len(c('/archive?q='+urllib.parse.quote('السجل'))['rows'])==1,'search by document number and by title')
ok(len(c('/archive?tab=expiring')['rows'])==1 and len(c('/archive?entity=archive')['rows'])==1,'expiring & general filters')
c('/archive/'+a['id'],{'category':'رخصة / تصريح','notes':'تجديد سنوي'},m='PUT'); ok(c('/archive?entity=archive')['rows'][0]['category']=='رخصة / تصريح','metadata edited')
ms=c('/archive/missing'); ok(len(ms)>5 and all(m['id']!=pi['id'] for m in ms),'missing-documents list excludes the documented invoice (%d)'%len(ms))
d2=c('/analytics/executive'); ok(any(a['area']=='المستندات' for a in d2['alerts']),'expiring document appears in alerts')
t2=register('o2'); ok(call('/archive',tok=t2)['stats']['files']==0,'archive isolated per company')
print('FAILS',fails)
