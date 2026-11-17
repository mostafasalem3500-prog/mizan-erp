import sys, os, time, json, urllib.request; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
ROOT=B[:-4]; EG='3200' in B
def raw(path):
    r=urllib.request.urlopen(ROOT+path); return r.status, {k.lower():v for k,v in r.headers.items()}, r.read().decode('utf8')
# ── public API description ──
st,h,body=raw('/api/v1/openapi.json'); spec=json.loads(body)
ok(st==200 and spec['openapi'].startswith('3.1') and set(spec['paths'])=={'/me','/products','/stock','/partners','/orders','/invoices','/invoices/{id}','/payments'},'OpenAPI 3.1 file is public and lists the eight paths of the REST API')
ok(spec['servers'][0]['url'].endswith('/api/v1') and 'bearer' in spec['components']['securitySchemes'] and 'OrderInput' in spec['components']['schemas'] and 'invoice.posted' in spec['x-webhooks-events'],'…with the server address, bearer-key security, request schemas and webhook events')
refs=[x for x in body.split('"$ref":"')[1:]]; missing=[r.split('"')[0] for r in refs if r.split('"')[0].split('/')[-1] not in {**spec['components']['schemas'],**spec['components']['responses']}]
ok(not missing,'every $ref in the file resolves '+str(missing[:2]))
st,h,page=raw('/developers'); ok(st==200 and 'text/html' in h['content-type'] and '/api/v1/orders' in page and 'Authorization: Bearer' in page and '<script' not in page and "default-src 'none'" in h['content-security-policy'],'developer page is public, script-free, and shows the order example')
try: call('/v1/products'); ok(False,'v1 without key')
except E as e: ok('401' in str(e)[:3],'the API itself still needs a key')
# the documented calls work with a real key
t=register('r327'); c=lambda *a,**k: call(*a,tok=t,**k); A=c('/accounts')['rows']; acc={x.get('systemKey'):x for x in A if x.get('systemKey')}; y=time.strftime('%Y'); d=time.strftime('%Y-%m-%d')
c('/demo/load',{})
while True:
    s=c('/demo/status')
    if s.get('demoLoaded') and not (s.get('demoJob') or {}).get('running'): break
    time.sleep(1)
# ── notes to the financial statements ──
nt=c(f'/reports/notes?from={y}-01-01&to={d}'); N={x['no']:x for x in nt['notes']}
ok(len(nt['notes'])==17 and [x['no'] for x in nt['notes']]==list(range(1,18)),'17 numbered notes')
tb={r['id']:r for r in c(f'/reports/trial-balance?from={y}-01-01&to={d}')['rows']}
def gl(pred,sign=1): return round(sum(sign*(float(r['closingDr'])-float(r['closingCr'])) for r in tb.values() if pred(r)),2)
ok(near(N[4]['total'],gl(lambda r: r['subtype'] in ('CASH','BANK'))),f"note 4 cash and banks = ledger ({N[4]['total']})")
ok(near(N[5]['total'],gl(lambda r: r['subtype']=='RECEIVABLE')) and near(N[5]['ageing']['total'],N[5]['ageing']['notDue']+N[5]['ageing']['d1_30']+N[5]['ageing']['d31_60']+N[5]['ageing']['d61_90']+N[5]['ageing']['over90']),f"note 5 receivables = ledger ({N[5]['total']}); ageing buckets add up")
it=c('/reports/integrity'); ch={x['name']:x for x in (it.get('checks') or it)}; invv=[v for k,v in ch.items() if 'المخزون' in k][0]
ok(near(N[6]['total'],invv['a'],0.02),f"note 6 inventory = stock valuation ({N[6]['total']})")
fa=gl(lambda r: r['subtype'] in ('FIXED_ASSET','ACC_DEPRECIATION')); P=N[7]['ppe']
ok(near(N[7]['total'],fa,0.02) and all(near(p['costClose'],p['costOpen']+p['additions']) and near(p['netBook'],p['costClose']-p['depClose']) for p in P) and len(P)==3,f"note 7 property and equipment: net book value = ledger ({N[7]['total']}), each category reconciles")
ok(near(N[8]['total'],gl(lambda r: r['subtype']=='PAYABLE',-1)),f"note 8 payables = ledger ({N[8]['total']})")
pl=round(sum(-(float(r['debit'])-float(r['credit'])) for r in tb.values() if r['type']=='REVENUE')-sum(float(r['debit'])-float(r['credit']) for r in tb.values() if r['type']=='EXPENSE'),2)
ok(near(nt['profit'],pl,0.02) and near(N[12]['total']-N[13]['total']-N[14]['total'],pl,0.02),f"notes 12–14 revenue − cost − expenses = profit of the period ({pl})")
bs=c(f'/reports/balance-sheet?to={d}'); ok(near(N[11]['total'], float(bs['totalLiabEquity'])-gl(lambda r: r['type']=='LIABILITY',-1),0.05),f"note 11 equity with the period profit = balance sheet equity ({N[11]['total']})")
ok(all(N[k].get('todo') for k in (15,16,17)) and not N[15].get('rows'),'related parties, contingencies and subsequent events are left for management — nothing invented')
ok(('IFRS' in N[2]['text'][0]) != EG and 'المتوسط المرجح' in ' '.join(N[3]['text']),'basis of preparation names the right framework for the edition; policies match what the program does')
# ── combined statements ──
t2=c('/auth/companies',{'nameAr':'منشأة شقيقة'})['token']; c2=lambda *a,**k: call(*a,tok=t2,**k); A2={x.get('systemKey'):x for x in c2('/accounts')['rows'] if x.get('systemKey')}
c2('/journals',{'date':d,'memo':'رأس المال','lines':[{'accountId':A2['BANK']['id'],'debit':70000,'credit':0},{'accountId':A2['CAPITAL']['id'],'debit':0,'credit':70000}]})
cb=c(f'/reports/combined?from={y}-01-01&to={d}'); ok(len(cb['available'])==2 and len(cb['companies'])==2 and cb['totals']['balanced'],'combined: both establishments of the user, balanced')
one=c(f"/reports/combined?from={y}-01-01&to={d}&companies={cb['available'][0]['id']}"); two=c(f"/reports/combined?from={y}-01-01&to={d}&companies={cb['available'][1]['id']}")
ok(near(cb['totals']['assets'],one['totals']['assets']+two['totals']['assets'],0.02) and near(cb['totals']['profit'],one['totals']['profit']+two['totals']['profit'],0.02),f"combined assets and profit = the sum of each establishment ({cb['totals']['assets']})")
bank=[r for r in cb['rows'] if r['code']==acc['BANK']['code']][0]; ok(len(bank['per'])==2 and near(bank['total'],sum(bank['per'].values())),'each account shows a column per establishment and their total')
other=register('r327x'); cx=call(f'/reports/combined?from={y}-01-01&to={d}&companies={cb["available"][0]["id"]}',tok=other); ok(len(cx['available'])==1 and all(x['id']!=cb['available'][0]['id'] for x in cx['companies']) and near(cx['totals'].get('assets',0),0),'another user cannot pull an establishment that is not theirs into the report')
print('FAILS',lib.fails)
