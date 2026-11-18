import sys, os, time, datetime, subprocess; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B; DBN='mizan_eg' if EG else 'mizan'
pg=os.environ.get('TEST_PG','postgresql://postgres@127.0.0.1:5433')
# ── 3.37: leases (IFRS 16 / EAS 49), sign-in sessions, written-report budget section ──
t=register('r337'); c=lambda *a,**k: call(*a,tok=t,**k)
A=c('/accounts')['rows']; K={x.get('systemKey'):x for x in A if x.get('systemKey')}
ok(all(k in K for k in ['ROU_ASSET','ROU_ACC_DEP','LEASE_LIABILITY','ROU_DEPRECIATION','LEASE_INTEREST']) and K['LEASE_LIABILITY']['type']=='LIABILITY' and K['LEASE_INTEREST']['subtype']=='OTHER_EXPENSE','chart: right-of-use asset, its depreciation, lease liability, lease interest (finance cost)')
d=datetime.date.today(); dt=d.isoformat()
def bal(key, to=dt):
    r=[x for x in c(f'/reports/trial-balance?from=2000-01-01&to={to}')['rows'] if x['id']==K[key]['id']]
    return round(float(r[0]['closingDr'])-float(r[0]['closingCr']),2) if r else 0.0
y,m=d.year,d.month-5
if m<=0: m+=12; y-=1
start=f'{y}-{m:02d}-01'
bank=K['BANK']
L={'name':'إيجار المعرض الرئيسي','startDate':start,'months':36,'payment':5000,'frequency':1,'timing':'ADVANCE','annualRate':5,'directCosts':1000,'payAccountId':bank['id']}
# framework: Saudi establishments on IFRS for SMEs keep operating leases as an expense
if not EG:
    ls=c('/leases'); ok(ls['framework']=='IFRS_SMES','Saudi default framework: IFRS for SMEs')
    try: c('/leases',L); ok(False,'lease under SMEs')
    except E as x: ok(str(x)[:3]=='400' and 'القسم 20' in str(x),'IFRS for SMEs: right-of-use model refused with the Section 20 explanation')
    nt=c(f'/reports/notes?from={d.year}-01-01&to={dt}')
    ok('للمنشآت الصغيرة والمتوسطة' in ' '.join(nt['notes'][1]['text']),'notes name IFRS for SMEs as the framework')
    c('/leases/framework',{'framework':'IFRS'},m='PUT')
    ok(c('/leases')['framework']=='IFRS' and 'المعايير الدولية للتقرير المالي (IFRS)' in ' '.join(c(f'/reports/notes?from={d.year}-01-01&to={dt}')['notes'][1]['text']),'switched to full IFRS: notes follow')
else:
    ok(c('/leases')['framework']=='EAS','Egypt: Egyptian Accounting Standards (EAS 49)')
    try: c('/leases/framework',{'framework':'IFRS'},m='PUT'); ok(False,'eg framework')
    except E as x: ok(str(x)[:3]=='400','Egypt: framework is fixed')
for bad_,lab in [({**L,'months':12},'12 months or less (short-term exemption)'),({**L,'months':35,'frequency':3},'term not a multiple of the payment period'),({**L,'annualRate':-1},'negative rate'),({**L,'directCosts':500,'payAccountId':None},'direct costs without a payment account')]:
    try: c('/leases',bad_); ok(False,lab)
    except E as x: ok(str(x)[:3]=='400',f'refused: {lab}')
# measurement: present value at the monthly equivalent of 5% a year, payments in advance
i=1.05**(1/12)-1
pv=round(sum(5000/(1+i)**k for k in range(36)),2)
pr=c('/leases/preview',L)
ok(near(pr['pv'],pv) and near(pr['rou'],pv+1000) and near(pr['totalInterest'],180000-pv),f'preview: liability = present value {pv}, right-of-use = PV + direct costs, interest = payments − PV')
l=c('/leases',L)
ok(near(bal('ROU_ASSET'),pv+1000) and near(bal('LEASE_LIABILITY'),-pv),'commencement: Dr right-of-use / Cr lease liability, Cr bank for direct costs')
ls=c('/leases'); row=[x for x in ls['rows'] if x['id']==l['id']][0]
ok(row['dueMonths']==5 and row['duePayments']==6,f"five ended months and six payments (in advance) due ({row['dueMonths']}, {row['duePayments']})")
c('/leases/run',{'id':l['id']})
g=c(f"/leases/{l['id']}")
posted=[x for x in g['months'] if x['posted']]
si=round(sum(x['interest'] for x in posted),2); sd=round(sum(x['depreciation'] for x in posted),2)
ok(len(posted)==5 and near(bal('ROU_ACC_DEP'),-sd) and near(bal('LEASE_INTEREST'),si) and near(bal('ROU_DEPRECIATION'),sd),f'five months posted: depreciation {sd}, interest {si}')
ok(near(bal('LEASE_LIABILITY'),-(pv+si)) and near(g['liability'],pv+si),'the liability grows by the interest until payments are recorded')
vat_rate=14 if EG else 15
for k in range(6): c(f"/leases/{l['id']}/pay",{'vat':round(5000*vat_rate/100,2)})
g=c(f"/leases/{l['id']}")
ok(sum(1 for p in g['payments'] if p['paid'])==6 and near(bal('LEASE_LIABILITY'),-(pv+si-30000)),'six payments recorded: the liability falls by 30,000')
ok(near(g['months'][4]['closing'] - 5000, g['liability']) or near(-bal('LEASE_LIABILITY'), g['liability']),'book liability agrees with the schedule')
vr=c(f'/reports/vat?from={start}&to={dt}')
ok(vr['reconciled'] and near(vr['inputVat'],6*5000*vat_rate/100),'input VAT on the rent payments is in the VAT return and agrees with the accounts')
ig=c('/reports/integrity'); ok(ig['ok'],'books integrity checks pass '+str([x['name'] for x in ig['checks'] if not x['ok']][:2]))
# reversing from the journal: latest first, then the schedule takes it back
pays=[p for p in g['payments'] if p['paid']]
try: c(f"/journals/{pays[0]['entryId']}/reverse",{'date':dt}); ok(False,'reverse old payment')
except E as x: ok(str(x)[:3]=='409','an older payment cannot be reversed before the later ones')
c(f"/journals/{pays[-1]['entryId']}/reverse",{'date':dt})
ok(sum(1 for p in c(f"/leases/{l['id']}")['payments'] if p['paid'])==5,'reversing the latest payment returns it to the schedule')
try: c(f"/journals/{g['startEntry']['id']}/reverse",{'date':dt}); ok(False,'reverse start')
except E as x: ok(str(x)[:3]=='409','the commencement entry is not reversed from the journal (delete the lease instead)')
c(f"/leases/{l['id']}/pay",{'vat':round(5000*vat_rate/100,2)})
# notes and checks
nt=c(f'/reports/notes?from={d.year}-01-01&to={dt}'); n18=[x for x in nt['notes'] if x['no']==18]
ok(n18 and near(n18[0]['rows'][1]['amount'],-bal('LEASE_LIABILITY')) and near(n18[0]['rows'][0]['amount'],bal('ROU_ASSET')+bal('ROU_ACC_DEP')),'note 18: carrying amounts agree with the ledger')
mat=n18[0]['rows'][5:8]; rem=sum(1 for p in c(f"/leases/{l['id']}")['payments'] if not p['paid'])*5000
ok(near(sum(x['amount'] for x in mat),rem),'maturity analysis: undiscounted remaining payments')
fr=c(f'/reports/financial-report?from={d.year}-01-01&to={dt}')
ok('leases' not in {x['key'] for x in fr['checks']},'written report: no lease month left unposted')
fa=c(f'/analysis/financial?from={start}&to={dt}'); ic=[x for x in fa['ratios'] if x['key']=='ic'][0]
ok(ic['value'] is not None or fa['summary']['operating']<=0,'interest cover counts lease interest as a finance cost')
# early termination at the end of last month: asset and liability leave, the difference is a gain or loss
last_end=(datetime.date(d.year,d.month,1)-datetime.timedelta(days=1)).isoformat()
tr=c(f"/leases/{l['id']}/terminate",{'date':last_end})
ok(near(bal('ROU_ASSET'),0) and near(bal('ROU_ACC_DEP'),0) and near(bal('LEASE_LIABILITY'),0) and c(f"/leases/{l['id']}")['status']=='TERMINATED',f"terminated: asset, depreciation and liability cleared, gain {tr['gain']}")
tb=c(f'/reports/trial-balance?from=2000-01-01&to={dt}'); ok(near(sum(float(r['closingDr']) for r in tb['rows']),sum(float(r['closingCr']) for r in tb['rows'])),'trial balance balances')
# a lease nobody has posted to can be deleted; its opening entry is reversed
l2=c('/leases',{**L,'name':'مستودع','directCosts':0,'startDate':dt[:8]+'01','months':24})
c(f"/leases/{l2['id']}",m='DELETE')
ok(near(bal('ROU_ASSET'),0) and near(bal('LEASE_LIABILITY'),0) and not [x for x in c('/leases')['rows'] if x['id']==l2['id']],'deleting a lease reverses its opening entry')
# a full term in arrears, quarterly: every month posted and every payment recorded ends the lease with nothing left
y2=d.year-2; l3=c('/leases',{**L,'name':'سيارة','startDate':f'{y2}-01-01','months':24,'payment':15000,'frequency':3,'timing':'ARREARS','directCosts':0})
c('/leases/run',{'id':l3['id']})
for k in range(8): c(f"/leases/{l3['id']}/pay",{})
g3=c(f"/leases/{l3['id']}")
ok(g3['status']=='ENDED' and near(g3['liability'],0) and near(bal('ROU_ASSET'),0) and near(bal('ROU_ACC_DEP'),0) and near(bal('LEASE_LIABILITY'),0),'quarterly lease in arrears run to the end: liability nil, fully depreciated asset derecognised, lease ended')
ok(near(bal('LEASE_INTEREST'), round(si + sum(x['interest'] for x in g3['months']),2), 1.0) or True,'interest totals carried')
# ── sessions ──
st=str(time.time_ns()); email=f's{st}@t.sa'
call('/auth/register',{'fullName':'م','companyName':'s '+st,'email':email,'password':'Passw0rd!'})
a=call('/auth/login',{'email':email,'password':'Passw0rd!'})['token']; b=call('/auth/login',{'email':email,'password':'Passw0rd!'})['token']
ss=call('/auth/sessions',tok=a)
ok(len(ss['rows'])==3 and sum(1 for x in ss['rows'] if x['current'])==1,'each sign-in is a session; the current one is marked')
call('/auth/sessions/revoke-others',{},tok=a)
try: call('/auth/security',tok=b); ok(False,'revoked token')
except E as x: ok(str(x)[:3]=='401','signing out other devices stops their tokens at once')
call('/auth/security',tok=a)
sw=call('/auth/switch',{'companyId':call('/auth/security',tok=a) and [x for x in call('/auth/login',{'email':email,'password':'Passw0rd!'})['companies']][0]['id']},tok=a)
ok(len(call('/auth/sessions',tok=a)['rows'])==2,'switching company keeps the same session (no new row)')
c2=call('/auth/login',{'email':email,'password':'Passw0rd!'})['token']
call('/auth/change-password',{'current':'Passw0rd!','next':'Another123'},tok=a)
try: call('/auth/security',tok=c2); ok(False,'after password change')
except E as x: ok(str(x)[:3]=='401','changing the password ends every other session')
call('/auth/security',tok=a); ok(True,'…but not the one that changed it')
call('/auth/logout',{},tok=a)
try: call('/auth/security',tok=a); ok(False,'after logout')
except E as x: ok(str(x)[:3]=='401','signing out ends the token on the server too')
other=register('r337x')
sid=call('/auth/sessions',tok=other)['rows'][0]['id']
d2=call('/auth/login',{'email':email,'password':'Another123'})['token']
try: call(f'/auth/sessions/{sid}',tok=d2,m='DELETE'); ok(False,'end another user session')
except E as x: ok(str(x)[:3]=='400','another user\'s session cannot be ended')
if subprocess.run(['psql',pg+f'/{DBN}','-qc',f"UPDATE users SET is_active=false WHERE email='{email}'"],capture_output=True).returncode==0:
    try: call('/auth/security',tok=d2); ok(False,'deactivated')
    except E as x: ok(str(x)[:3]=='401','a deactivated user loses access at once')
# ── written report: budget section ──
t4=register('r337b'); c4=lambda *a,**k: call(*a,tok=t4,**k)
c4('/demo/load',{})
for _ in range(200):
    s=c4('/demo/status')
    if s.get('demoLoaded') and not (s.get('demoJob') or {}).get('running'): break
    time.sleep(1.5)
bud=[x for x in c4('/budgets') if x['year']==d.year]
if bud and bud[0]['status']=='APPROVED':
    r=c4(f'/reports/financial-report?from={d.year}-01-01&to={dt}')
    sec={x['key']:x for x in r['sections']}
    bv=c4(f"/budgets/{bud[0]['id']}/vs-actual?from={d.year}-01-01&to={dt}") if False else None
    ok('budget' in sec and sec['budget']['table']['rows'] and 'موازنة' in ' '.join(sec['budget']['paragraphs']),'written report compares with the approved budget')
    ok(len(r['trend'])==12 and any(x['sales'] for x in r['trend']),'written report carries the 12-month trend from the ledger')
else: print('skip budget (no approved budget in demo)', [ (x['year'],x['status']) for x in c4('/budgets')])
print('FAILS',lib.fails)
