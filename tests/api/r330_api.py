import sys, os, time, datetime; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
# ── amortisation schedules: prepaid expenses and deferred revenue ──
t=register('r330'); c=lambda *a,**k: call(*a,tok=t,**k)
A=c('/accounts')['rows']; K={x.get('systemKey'):x for x in A if x.get('systemKey')}
ok('PREPAID' in K and 'DEFERRED_REVENUE' in K and K['DEFERRED_REVENUE']['type']=='LIABILITY','chart has the prepaid-expenses and deferred-revenue accounts')
exp=[x for x in A if x['type']=='EXPENSE' and not x['isGroup'] and 'إيجار' in x['nameAr']][0]
rev=[x for x in A if x['type']=='REVENUE' and not x['isGroup']][0]
bank=[x for x in A if x.get('isCashBank') and x.get('subtype')=='BANK'][0]
today=datetime.date.today(); first=today.replace(day=1)
def months_back(n):
    y,m=first.year,first.month-n
    while m<=0: m+=12; y-=1
    return datetime.date(y,m,1).isoformat()
d=today.isoformat(); y0=months_back(14)
def bal(acc_id):
    rows=c(f'/reports/trial-balance?from={y0}&to={d}')['rows']
    r=[x for x in rows if x['id']==acc_id]
    return round(float(r[0]['closingDr'])-float(r[0]['closingCr']),2) if r else 0.0
b0=bal(bank['id'])
base=dict(kind='PREPAID',name='إيجار المعرض لسنة',total=12000,months=12,startDate=months_back(5),targetAccountId=exp['id'],payAccountId=bank['id'],vat=1800)
# preview saves nothing
n0=len(c('/amortizations'))
pv=c('/amortizations/preview',base)
ok(near(pv['monthly'],1000) and len(pv['schedule'])==12 and any(near(l['credit'],13800) for l in pv['lines']) and any(near(l['debit'],1000) for l in pv['lines']),'preview: payment 13,800 (12,000 + VAT 1,800) and the first month of 1,000')
ok(len(c('/amortizations'))==n0 and near(bal(bank['id']),b0),'…and nothing was saved')
a=c('/amortizations',base); aid=a['id']
ok(a['number'].startswith('AMR') and a['payEntry'] and near(bal(K['PREPAID']['id']),12000) and near(bal(bank['id']),b0-13800) and near(bal(K['VAT_IN']['id']),1800),'payment recorded: prepaid 12,000, input VAT 1,800, bank −13,800')
r=c('/amortizations/run',{})
ok(len(r)==5 and all(near(x['amount'],1000) for x in r),'run: the five months that have ended are posted, 1,000 each')
ok(near(bal(K['PREPAID']['id']),7000) and near(bal(exp['id']),5000),'prepaid 7,000 left, rent expense 5,000')
ok(len(c('/amortizations/run',{}))==0,'running again posts nothing twice')
g=c(f'/amortizations/{aid}'); posted=[l for l in g['lines'] if l['posted']]
ok(len(posted)==5 and all(l['periodEnd'][8:]>= '28' for l in posted) and near(posted[-1]['balanceAfter'],7000),'each month dated at month end, running balance 7,000')
# taking months back from the journal
try: c(f"/journals/{posted[0]['entryId']}/reverse",{'date':d}); ok(False,'reversing an older month')
except E as e: ok(str(e)[:3]=='409','an older month cannot be reversed while later months stand')
c(f"/journals/{posted[-1]['entryId']}/reverse",{'date':d})
g=c(f'/amortizations/{aid}'); ok(g['postedMonths']==4 and near(g['remaining'],8000),'reversing the last month gives it back to the schedule')
c('/amortizations/run',{'id':aid}); g=c(f'/amortizations/{aid}'); ok(g['postedMonths']==5 and near(bal(K['PREPAID']['id']),7000),'…and it posts again')
# early end: the rest at once
g=c(f'/amortizations/{aid}/finish',{'date':d})
ok(g['status']=='DONE' and near(g['remaining'],0) and near(bal(K['PREPAID']['id']),0) and near(bal(exp['id']),12000),'early end posts the 7,000 left; the whole 12,000 is now rent expense')
try: c(f'/amortizations/{aid}',m='DELETE'); ok(False,'delete posted')
except E as e: ok(str(e)[:3] in ('400','409'),'a schedule with posted months cannot be deleted')
# deferred revenue: rounding on the last month
dv=c('/amortizations',dict(kind='DEFERRED',name='عقد صيانة ربع سنوي',total=1000,months=3,startDate=months_back(3),targetAccountId=rev['id'],payAccountId=bank['id'],vat=150,auto=False))
ok(near(bal(K['DEFERRED_REVENUE']['id']),-1000) and near(bal(K['VAT_OUT']['id']),-150),'deferred revenue: receipt 1,150 → deferred revenue 1,000, output VAT 150')
br=c('/brief'); todo=[x for x in (br.get('todo') or []) if x['key']=='amortization']
ok(todo and todo[0]['count']==3,'the to-do list shows the three manual months that are due')
cl=c('/closing'); ok(any(i['key']=='amortization' for i in cl['items']),'month-end checklist has the amortisation line')
c('/amortizations/run',{'id':dv['id']}); g=c(f"/amortizations/{dv['id']}")
ok([l['amount'] for l in g['lines']]==[333.33,333.33,333.34] and g['status']=='DONE' and near(bal(K['DEFERRED_REVENUE']['id']),0) and near(-bal(rev['id']),1000),'3 × 333.33 with 333.34 last: exactly 1,000 revenue, deferred revenue cleared')
# delete before anything is posted reverses the payment; cancel stops a schedule
b1=bal(bank['id'])
x=c('/amortizations',dict(kind='PREPAID',name='تأمين سنوي',total=2400,months=12,startDate=months_back(0),targetAccountId=exp['id'],payAccountId=bank['id']))
ok(near(bal(bank['id']),b1-2400),'insurance paid 2,400')
c(f"/amortizations/{x['id']}",m='DELETE'); ok(near(bal(bank['id']),b1) and near(bal(K['PREPAID']['id']),0),'deleting it reverses the payment')
y=c('/amortizations',dict(kind='PREPAID',name='اشتراك برنامج',total=600,months=6,startDate=months_back(4),targetAccountId=exp['id']))
c(f"/amortizations/{y['id']}/cancel",{}); ok(not [r for r in c('/amortizations/run',{}) if r['number']==y['number']] and c(f"/amortizations/{y['id']}")['status']=='CANCELLED','a stopped schedule posts nothing more')
# validation and isolation
for bad_body,label in [(dict(base,targetAccountId=rev['id']),'prepaid onto a revenue account'),(dict(base,months=0),'zero months'),(dict(base,total=-5),'negative amount'),(dict(base,payAccountId=exp['id']),'payment from a non-cash account'),(dict(base,kind='X'),'unknown kind')]:
    try: c('/amortizations',bad_body); ok(False,label)
    except E as e: ok(str(e)[:3]=='400',f'refused: {label}')
t2=register('r330b')
try: call(f'/amortizations/{aid}',tok=t2); ok(False,'other establishment reads')
except E as e: ok(str(e)[:3] in ('400','404'),'another establishment cannot open the schedule')
try: call('/amortizations',dict(base,payAccountId=None),tok=t2); ok(False,'foreign account')
except E as e: ok(str(e)[:3]=='400',"another establishment cannot use this establishment's accounts")
ok(len(call('/amortizations',tok=t2))==0,'the other establishment sees no schedules')
tb=c(f'/reports/trial-balance?from={y0}&to={d}'); ok(near(sum(float(r['closingDr']) for r in tb['rows']),sum(float(r['closingCr']) for r in tb['rows'])),'trial balance still balances')
print('FAILS',lib.fails)
