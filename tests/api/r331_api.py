import sys, os, time, json, random, subprocess, datetime; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B; DBN='mizan_eg' if EG else 'mizan'
# ── allowance for doubtful debts, demo amortisation schedules, response times ──
t=register('r331'); c=lambda *a,**k: call(*a,tok=t,**k)
c('/demo/load',{})
for _ in range(200):
    s=c('/demo/status')
    if s.get('demoLoaded') and not (s.get('demoJob') or {}).get('running'): break
    time.sleep(1.5)
A=c('/accounts')['rows']; K={x.get('systemKey'):x for x in A if x.get('systemKey')}
ok('DOUBTFUL_ALLOWANCE' in K and 'BAD_DEBT' in K and K['BAD_DEBT']['type']=='EXPENSE','chart: allowance for doubtful debts and its expense account')
d=datetime.date.today().isoformat(); y0=f'{datetime.date.today().year-1}-01-01'
def bal(aid):
    r=[x for x in c(f'/reports/trial-balance?from={y0}&to={d}')['rows'] if x['id']==aid]
    return round(float(r[0]['closingDr'])-float(r[0]['closingCr']),2) if r else 0.0
# ── the matrix ──
e=c(f'/ecl?asOf={d}')
ag=c(f'/reports/aging?role=CUSTOMER&to={d}')
ok(e['rates']=={'current':1,'d30':3,'d60':10,'d90':25,'d120':50},'default matrix 1 / 3 / 10 / 25 / 50 %')
ok(near(e['receivables'],ag['totals']['total']) and all(near(b['balance'],ag['totals'][b['band']]) for b in e['bands']),f"bands agree with the ageing report ({e['receivables']})")
ok(near(e['required'],sum(b['balance']*b['rate']/100 for b in e['bands']),0.05) and near(e['existing'],0) and near(e['adjustment'],e['required']),f"required = Σ balance × rate ({e['required']}), nothing in the books yet")
ok(e['receivables']>0 and e['required']>0 and e['lines'][0]['debit']>0,'the entry shown: debit bad-debt expense, credit the allowance')
rates={'current':0,'d30':5,'d60':20,'d90':40,'d120':100}
from urllib.parse import quote
e2=c(f"/ecl?asOf={d}&rates={quote(json.dumps(rates))}")
ok(near(e2['required'],sum(b['balance']*rates[b['band']]/100 for b in e2['bands']),0.05),'own rates recalculate the requirement')
for bad_rates,label in [({'d30':150},'a rate above 100'),({'d60':-1},'a negative rate')]:
    try: c('/ecl/post',{'asOf':d,'rates':bad_rates}); ok(False,label)
    except E as x: ok(str(x)[:3]=='400',f'refused: {label}')
try: call(f"/ecl?asOf={d}&rates=%7Bbroken",tok=t); ok(False,'bad json')
except E as x: ok(str(x)[:3]=='400','malformed rates answer 400, not 500')
p=c('/ecl/post',{'asOf':d,'rates':rates})
ok(p['entryNumber'] and near(bal(K['DOUBTFUL_ALLOWANCE']['id']),-p['required']) and near(bal(K['BAD_DEBT']['id']),p['required']),f"posted: allowance {p['required']} credit, same amount bad-debt expense")
again=c(f'/ecl?asOf={d}')
ok(again['rates']==rates and near(again['existing'],p['required']) and near(again['adjustment'],0) and not again['lines'],'next time: the saved rates are the defaults and nothing is left to post')
low={k:v/2 for k,v in rates.items()}
r2_=c('/ecl/post',{'asOf':d,'rates':low})
ok(r2_['adjustment']<0 and near(-bal(K['DOUBTFUL_ALLOWANCE']['id']),r2_['required']) and near(bal(K['BAD_DEBT']['id']),r2_['required']),'lower rates release the excess: Dr allowance / Cr bad-debt expense')
runs=c('/ecl/runs'); ok(len(runs)==2 and runs[0]['rates']==low,'both runs are kept with their rates')
nt=c(f'/reports/notes?from={d[:4]}-01-01&to={d}'); n5=[x for x in nt['notes'] if x['no']==5][0]
ok(not n5.get('todo') and 'مصفوفة' in ' '.join(n5.get('text') or []),'note 5 states how the allowance was measured instead of a to-do')
tb=c(f'/reports/trial-balance?from={y0}&to={d}'); ok(near(sum(float(r['closingDr']) for r in tb['rows']),sum(float(r['closingCr']) for r in tb['rows'])),'trial balance balances')
fy=[y for y in c('/fiscal-years')['years'] if y['startDate']<=d<=y['endDate']]
ch=c(f"/fiscal-years/{fy[0]['id']}/close-check"); items={i.get('key') or i.get('id'):i for i in (ch.get('items') or ch.get('checks') or [])}
ok('ecl' in items,'year-end check has the doubtful-debts line')
# ── the demo dataset now has amortisation schedules ──
am=c('/amortizations')
ok(len(am)==2 and {a['kind'] for a in am}=={'PREPAID','DEFERRED'} and all(a['postedMonths']==5 and a['dueMonths']==0 for a in am),'demo: a prepaid insurance and a deferred maintenance contract, five months posted, nothing due')
pre=[a for a in am if a['kind']=='PREPAID'][0]
ok(near(pre['remaining'],9600-5*800) and near(bal(K['PREPAID']['id']),pre['remaining']),'demo prepaid balance in the books = schedule remaining')
# purge keeps the books consistent
c('/demo/purge',{})
ok(len(c('/amortizations'))==0 and near(bal(K['PREPAID']['id']),0),'deleting the demo data removes the schedules and their entries')
# ── VAT recorded with a schedule is in the VAT return (fix: it was in the VAT accounts only) ──
def vr(): v=c(f'/reports/vat?from={d[:4]}-01-01&to={d}'); return v
v0=vr()
bank=[a for a in A if a.get('isCashBank') and not a.get('isGroup')][0]
exp=[a for a in A if a['type']=='EXPENSE' and not a.get('isGroup')][0]
rev=[a for a in A if a.get('systemKey')=='SERVICE_REVENUE'][0]
c('/amortizations',{'kind':'PREPAID','name':'اشتراك برنامج سنوي','total':1200,'months':12,'startDate':d[:8]+'01','targetAccountId':exp['id'],'payAccountId':bank['id'],'vat':180})
c('/amortizations',{'kind':'DEFERRED','name':'عقد دعم مقبوض مقدماً','total':2400,'months':12,'startDate':d[:8]+'01','targetAccountId':rev['id'],'payAccountId':bank['id'],'vat':360})
v1=vr(); box=lambda v,n:[b for b in v['boxes'] if b['no']==n][0]
ok(near(v1['inputVat']-v0['inputVat'],180) and near(v1['outputVat']-v0['outputVat'],360) and near(box(v1,7)['vat']-box(v0,7)['vat'],180) and near(box(v1,1)['vat']-box(v0,1)['vat'],360),'VAT paid or received with a schedule appears in the VAT return boxes')
ok(v1['reconciled'],'VAT return still agrees with the VAT accounts')
ig=c('/reports/integrity'); bad_=[x['name'] for x in ig['checks'] if not x['ok']] if isinstance(ig,dict) and 'checks' in ig else []
ok(not bad_,'books integrity check passes '+str(bad_[:2]))
# ── response times ──
st=call('/status') if False else json.load(__import__('urllib.request').request.urlopen(B[:-4]+'/api/status'))
ok(st['responseMs']['requests']>0 and st['responseMs']['median']>=0,'status reports response times')
pg=os.environ.get('TEST_PG','postgresql://postgres@127.0.0.1:5433')
st_=str(time.time_ns()); email=f'perf{st_}@t.sa'
call('/auth/register',{'fullName':'م','companyName':'perf '+st_,'email':email,'password':'Passw0rd!'})
if subprocess.run(['psql',pg+f'/{DBN}','-qc',f"UPDATE users SET is_super_admin=true WHERE email='{email}'"],capture_output=True).returncode==0:
    ta=call('/auth/login',{'email':email,'password':'Passw0rd!'})['token']
    pf=call('/admin/errors?days=1',tok=ta)['performance']
    ok(pf['rows'] and all(set(r)>={'route','count','avgMs','p95Ms','maxMs','slow'} for r in pf['rows']) and any(':id' in r['route'] or '/api/' in r['route'] for r in pf['rows']),'the system manager sees the slowest routes, ids collapsed')
print('FAILS',lib.fails)
