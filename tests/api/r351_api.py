"""3.51: subscriptions — plans, the first invoice with the setup fee, catch-up of past periods, a free trial, a fixed
term that expires, annual plans on deferred revenue earned month by month, a prorated upgrade and a downgrade from
the next period, pause keeping the paid days, check-ins against a quota with a charge above it, past due blocking
entry, cancellation at the period end or now with a credit note, MRR and churn, the worked example — every figure
checked by hand."""
import sys, os, time; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib, datetime, calendar
EG='3200' in B; R=0.14 if EG else 0.15
t=register('r351'); c=lambda *a,**k: call(*a,tok=t,**k)
d=time.strftime('%Y-%m-%d'); y=time.strftime('%Y')
T=datetime.date.today()
D=lambda n: (T+datetime.timedelta(days=n)).isoformat()
def addm(s, k):
    x=datetime.date.fromisoformat(s); m=x.month-1+k; yy=x.year+m//12; mm=m%12+1
    return datetime.date(yy,mm,min(x.day,calendar.monthrange(yy,mm)[1])).isoformat()
pend=lambda s, k=1: (datetime.date.fromisoformat(addm(s,k))-datetime.timedelta(days=1)).isoformat()
days=lambda a,b: (datetime.date.fromisoformat(b)-datetime.date.fromisoformat(a)).days+1
def refused(code, fn, name, has=None):
    try: fn(); ok(False,name)
    except E as e: ok(str(code) in str(e) and (has is None or has in str(e)), name+' → refused '+('' if has is None or has in str(e) else str(e)[:160]))
def bal(key):
    a={x.get('systemKey'):x for x in c('/accounts')['rows'] if x.get('systemKey')}.get(key)
    return round(sum(float(x['debit'])-float(x['credit']) for x in c('/reports/trial-balance?from=2000-01-01&to=2099-12-31')['rows'] if a and x['code']==a['code']),2)
acc={x.get('systemKey'):x for x in c('/accounts')['rows'] if x.get('systemKey')}
cash=acc.get('CASH') or acc['BANK']
cu=lambda name, phone: c('/partners',{'name':name,'isCustomer':True,'kind':'INDIVIDUAL','phone':phone})
inv=lambda iid: c(f'/invoices/{iid}')
near=lambda a,b,e=0.011: abs(float(a)-float(b))<=e

# ═══════════ plans ═══════════
refused(400,lambda: c('/subs/plans',{'name':'بلا سعر','period':'MONTH','price':0}),'a plan needs a price','سعر')
refused(400,lambda: c('/subs/plans',{'name':'حد صفر','period':'MONTH','price':10,'quota':0}),'a zero quota','الحد')
gym=c('/subs/plans',{'name':'نادي شهري','period':'MONTH','price':300,'setupFee':100,'quota':4,'quotaUnit':'زيارة','overagePrice':25})
gymP=c('/subs/plans',{'name':'نادي ذهبي','period':'MONTH','price':450})
strict=c('/subs/plans',{'name':'حصص محددة','period':'MONTH','price':200,'quota':2,'quotaUnit':'حصة'})
year=c('/subs/plans',{'name':'سنوي','period':'YEAR','price':1200})
yearP=c('/subs/plans',{'name':'سنوي مميز','period':'YEAR','price':2400})
saas=c('/subs/plans',{'name':'برنامج لكل مستخدم','period':'MONTH','price':100,'trialDays':14})
week=c('/subs/plans',{'name':'أسبوعي','period':'WEEK','price':70,'quota':4,'overagePrice':25})
ok(gym['code']=='PL-001' and year['deferred'] and not gym['deferred'] and near(year['monthly'],100) and near(week['monthly'],70*52/12,0.01),'plans: codes, a year is deferred, monthly equivalents')

# ═══════════ 1) a monthly member from today: setup fee on the first invoice ═══════════
p1=cu('مشترك شهري','0500000001')
s1=c('/subs',{'partnerId':p1['id'],'planId':gym['id']})
ok(s1['status']=='ACTIVE' and s1['currentFrom']==d and s1['currentTo']==pend(d) and s1['nextBillDate']==addm(d,1),f"active, period {d} → {pend(d)}, next {addm(d,1)}")
i1=inv(s1['invoices'][0]['id'])
ok(len(s1['invoices'])==1 and near(s1['invoices'][0]['net'],400) and near(i1['total'],round(400*(1+R),2)),f"first invoice: 300 + setup 100 = 400 + VAT ({s1['invoices'][0]['net']})")
ok(near(-bal('SUBSCRIPTION_REVENUE'),400),'monthly: straight to subscription revenue (400)')

# ═══════════ 2) catch-up and a fixed term that expires ═══════════
p2=cu('مشترك قديم','0500000002')
st2=D(-65); s2=c('/subs',{'partnerId':p2['id'],'planId':gymP['id'],'startDate':st2})
per=[st2,addm(st2,1),addm(st2,2)]; per=[x for x in per if x<=d]
ok(len(s2['invoices'])==len(per) and all(near(x['net'],450) for x in s2['invoices']) and s2['nextBillDate']==addm(st2,len(per)),f"catch-up: {len(per)} periods since {st2}, 450 each")
p3=cu('مدة محددة','0500000003')
s3=c('/subs',{'partnerId':p3['id'],'planId':gymP['id'],'startDate':st2,'endDate':D(-10)})
n3=len([x for x in [st2,addm(st2,1),addm(st2,2)] if x<=D(-10)])
ok(s3['status']=='EXPIRED' and len(s3['invoices'])==n3,f"fixed term ending {D(-10)}: {n3} invoices then expired ({s3['status']})")

# ═══════════ 3) free trial ═══════════
p4=cu('تجربة','0500000004')
s4=c('/subs',{'partnerId':p4['id'],'planId':saas['id'],'qty':3})
ok(s4['status']=='TRIAL' and not s4['invoices'] and s4['trialEnd']==D(13) and s4['nextBillDate']==D(14),'trial: no invoice, first one after 14 days')
s4=c(f"/subs/{s4['id']}/change",{'planId':saas['id'],'qty':5})
ok(s4['qty']==5 and not s4['invoices'],'more users during the trial: no invoice')
p5=cu('تجربة منتهية','0500000005')
s5=c('/subs',{'partnerId':p5['id'],'planId':saas['id'],'qty':2,'startDate':D(-20)})
ok(s5['status']=='ACTIVE' and s5['currentFrom']==D(-6) and len(s5['invoices'])==1 and near(s5['invoices'][0]['net'],200),'a trial that ended: billed from its day after (2 × 100)')

# ═══════════ 4) annual plan: deferred revenue earned month by month ═══════════
p6=cu('سنوي','0500000006')
m0=T.replace(day=1).isoformat(); st6=addm(m0,-2)
rev0=-bal('SUBSCRIPTION_REVENUE'); def0=-bal('DEFERRED_REVENUE')
s6=c('/subs',{'partnerId':p6['id'],'planId':year['id'],'startDate':st6})
ok(len(s6['invoices'])==1 and near(s6['invoices'][0]['net'],1200) and len(s6['deferred'])==1,'annual: one invoice of 1200 and a deferred schedule')
ok(near(s6['deferred'][0]['earned'],200) and near(s6['deferredLeft'],1000),f"two months ended: 200 earned, 1,000 left ({s6['deferred'][0]['earned']})")
ok(near(-bal('SUBSCRIPTION_REVENUE')-rev0,200) and near(-bal('DEFERRED_REVENUE')-def0,1000),'ledger: revenue +200, deferred revenue +1,000')
ok(s6['mrr']==100,'MRR of a year at 1,200 = 100')

# ═══════════ 5) plan changes ═══════════
p7=cu('ترقية','0500000007')
s7=c('/subs',{'partnerId':p7['id'],'planId':gymP['id'],'startDate':D(-10),'discountPct':10})
span=days(s7['currentFrom'],s7['currentTo']); left=days(d,s7['currentTo'])
gold=c('/subs/plans',{'name':'نادي ماسي','period':'MONTH','price':600})
s7=c(f"/subs/{s7['id']}/change",{'planId':gold['id']})
ch=round((600-450)*0.9*left/span,2)
up=[x for x in s7['invoices'] if x['from']==d]
ok(s7['planName']=='نادي ماسي' and len(up)==1 and near(up[0]['net'],ch),f"upgrade now: (600 − 450) × 90% × {left}/{span} days = {ch} ({up[0]['net'] if up else None})")
s7=c(f"/subs/{s7['id']}/change",{'planId':gymP['id']})
ok(s7['planName']=='نادي ماسي' and s7['pendingPlanName']=='نادي ذهبي' and len(s7['invoices'])==2,'downgrade: from the next period, no invoice now')
s6b=c(f"/subs/{s6['id']}/change",{'planId':yearP['id']})
l6=days(d,s6['currentTo']); sp6=days(s6['currentFrom'],s6['currentTo']); ch6=round(1200*l6/sp6,2)
u6=[x for x in s6b['invoices'] if x['from']==d]
ok(len(u6)==1 and near(u6[0]['net'],ch6) and len(s6b['deferred'])==2 and near(s6b['deferredLeft'],1000+ch6),f"annual upgrade: 1,200 × {l6}/{sp6} = {ch6} into deferred revenue, spread over the months left")

# ═══════════ 6) pause keeps the paid days ═══════════
p8=cu('موقوف','0500000008')
s8=c('/subs',{'partnerId':p8['id'],'planId':gym['id'],'startDate':D(-10),'waiveSetup':True})
to8=s8['currentTo']
c(f"/subs/{s8['id']}/pause",{'from':D(-5),'until':D(30),'reason':'سفر'})
refused(409,lambda: c('/subs-checkin',{'subscriptionId':s8['id']}),'no check-in while paused','موقوف')
s8=c(f"/subs/{s8['id']}/resume",{})
new_to=(datetime.date.fromisoformat(to8)+datetime.timedelta(days=5)).isoformat()
ok(s8['status']=='ACTIVE' and s8['currentTo']==new_to,f"paused 5 days: the period now ends {new_to} ({s8['currentTo']})")
ok(s8['nextBillDate']==(datetime.date.fromisoformat(new_to)+datetime.timedelta(days=1)).isoformat() and len(s8['invoices'])==1,'next invoice after the moved period end; nothing billed for the pause')
refused(400,lambda: c(f"/subs/{s6['id']}/pause",{}),'an annual plan cannot be paused','الإيقاف المؤقت')

# ═══════════ 7) check-ins against the quota ═══════════
for i in range(4): r=c('/subs-checkin',{'q':'0500000001'})
ok(r['subscription']['used']==4 and r['subscription']['left']==0 and not r['overage'],'4 of 4 visits by mobile number')
r=c('/subs-checkin',{'q':s1['number']}); ok(r['overage'] and r['subscription']['used']==5,'the 5th is above the quota (charged 25 later)')
p9=cu('حصص','0500000009'); s9=c('/subs',{'partnerId':p9['id'],'planId':strict['id']})
c('/subs-checkin',{'subscriptionId':s9['id']}); c('/subs-checkin',{'subscriptionId':s9['id']})
refused(409,lambda: c('/subs-checkin',{'subscriptionId':s9['id']}),'no price above the quota: the 3rd is refused','استُنفد')
refused(404,lambda: c('/subs-checkin',{'q':'0599999999'}),'unknown number')

# ═══════════ 8) past due blocks entry until paid or allowed ═══════════
p10=cu('متأخر','0500000010')
s10=c('/subs',{'partnerId':p10['id'],'planId':gymP['id'],'startDate':D(-20)})
ok([x for x in c('/subs?status=LIVE&flag=PAST_DUE') if x['id']==s10['id']] and c(f"/subs/{s10['id']}")['pastDue'],'unpaid 20 days (grace 7): past due')
refused(409,lambda: c('/subs-checkin',{'subscriptionId':s10['id']}),'past due: entry refused','متأخرة')
ok(c('/subs-checkin',{'subscriptionId':s10['id'],'force':True})['ok'],'allowed by the desk')
i10=s10['invoices'][-1]
c('/payments',{'direction':'IN','partnerId':p10['id'],'amount':i10['total'],'accountId':cash['id'],'method':'CASH','date':d,'allocations':[{'invoiceId':i10['id'],'amount':i10['total']}]})
ok(not c(f"/subs/{s10['id']}")['pastDue'] and c('/subs-checkin',{'subscriptionId':s10['id']})['ok'],'paid: in without permission')

# ═══════════ 9) cancellation ═══════════
s2c=c(f"/subs/{s2['id']}/cancel",{'when':'END','reason':'السعر'})
ok(s2c['status']=='ACTIVE' and s2c['cancelAtPeriodEnd'] and len(s2c['invoices'])==len(per),'at the period end: still running, nothing billed')
# now, monthly, with a credit for the unused days, and the visits above the quota billed
rv=-bal('SUBSCRIPTION_REVENUE')
s1c=c(f"/subs/{s1['id']}/cancel",{'when':'NOW','credit':True,'reason':'انتقل'})
sp1=days(s1['currentFrom'],s1['currentTo']); un1=days(D(1),s1['currentTo']); cr1=round(300*un1/sp1,2)
cn=[x for x in s1c['invoices'] if x['kind']=='CREDIT_NOTE']; ov=[x for x in s1c['invoices'] if x['kind']=='INVOICE' and not x['from']]
ok(s1c['status']=='CANCELLED' and len(cn)==1 and near(cn[0]['net'],cr1),f"cancelled now: credit note 300 × {un1}/{sp1} = {cr1} ({cn[0]['net'] if cn else None})")
ok(len(ov)==1 and near(ov[0]['net'],25),'the visit above the quota billed on cancelling (25)')
ok(near(-bal('SUBSCRIPTION_REVENUE')-rv,25-cr1),'ledger: revenue +25 − credit')
refused(409,lambda: c('/subs-checkin',{'subscriptionId':s1['id']}),'cancelled: no entry')
# after an upgrade: both the period and the upgrade charge credited for the days not used
s7c=c(f"/subs/{s7['id']}/cancel",{'when':'NOW','credit':True})
u7=days(D(1),s7['currentTo']); e1=round(450*0.9*u7/span,2); e2=round(ch*u7/left,2)
cn7=sorted(round(x['net'],2) for x in s7c['invoices'] if x['kind']=='CREDIT_NOTE')
ok(cn7==sorted([e1,e2]),f"cancelled after an upgrade: credits {e1} (period) and {e2} (upgrade) — {cn7}")
# now, annual (deferred): the months ended are earned, the unused part credited, the rest earned now
p11=cu('سنوي ملغى','0500000011')
s11=c('/subs',{'partnerId':p11['id'],'planId':year['id'],'startDate':st6})
rv=-bal('SUBSCRIPTION_REVENUE'); df=-bal('DEFERRED_REVENUE')
s11c=c(f"/subs/{s11['id']}/cancel",{'when':'NOW','credit':True})
un=days(D(1),s11['currentTo']); sp=days(s11['currentFrom'],s11['currentTo']); cr=round(min(1000,1200*un/sp),2)
cn=[x for x in s11c['invoices'] if x['kind']=='CREDIT_NOTE']
ok(len(cn)==1 and near(cn[0]['net'],cr),f"annual cancelled: credit 1,200 × {un}/{sp} = {cr}")
ok(near(-bal('DEFERRED_REVENUE')-df,-1000) and near(-bal('SUBSCRIPTION_REVENUE')-rv,round(1000-cr,2)) and near(s11c['deferredLeft'],0),f"deferred 1,000 cleared: {cr} credited, {round(1000-cr,2)} earned now")

# ═══════════ 10) dashboard ═══════════
db=c('/subs/dashboard'); lst=c('/subs')
mrr=round(sum(x['mrr'] for x in lst),2)
ok(near(db['mrr'],mrr) and near(db['arr'],mrr*12,0.05),f"MRR {db['mrr']} = sum of active subscribers, ARR = 12 ×")
ok(db['counts']['trial']==1 and db['counts']['paused']==0 and db['counts']['ended']==4,f"counts: 1 trial, 4 ended ({db['counts']})")
ok(any(x['id']==s4['id'] for x in db['trialsEnding'])==False and db['churn']['lost']>=2,'churn counts the cancellations')
ok(near(db['deferredLeft'],1000+ch6),'deferred revenue left on the dashboard')
chk=c('/reports/integrity'); fails=[x for x in chk.get('checks',[]) if not x.get('ok')]
ok(not fails,'integrity checks pass '+str([x.get('name') for x in fails][:3]))
tb=c('/reports/trial-balance?from=2000-01-01&to=2099-12-31'); ok(tb['balanced'] and c('/reports/balance-sheet')['balanced'],'trial balance and balance sheet balanced')

# ═══════════ 11) the worked example ═══════════
t2=register('r351x'); c2=lambda *a,**k: call(*a,tok=t2,**k)
c2('/subs-example',{})
dx=c2('/subs/dashboard')
ok(dx['counts']['active']>=4 and dx['counts']['trial']==1 and dx['counts']['paused']==1 and dx['counts']['ended']==1 and len(dx['pastDue'])==1,f"example: subscribers in every state ({dx['counts']}, past due {len(dx['pastDue'])})")
ok(dx['mrr']>0 and dx['deferredLeft']>0 and dx['churn']['lost']==1,'example: MRR, deferred revenue and one churned')
refused(409,lambda: c2('/subs-example',{}),'example loaded twice','محمَّل')
def ask(text):
    r=c2('/ai/chat',{'text':text}); v=r['view'][-1]; return v.get('text') or v.get('content') or str(v)
a1=ask('ما حالة الاشتراكات؟')
ok('الإيراد الشهري المتكرر' in a1 and 'متأخرون عن السداد' in a1,'assistant: subscription status with MRR and past due')
chk=c2('/reports/integrity'); fails=[x for x in chk.get('checks',[]) if not x.get('ok')]
ok(not fails,'example: integrity checks pass '+str([x.get('name') for x in fails][:3]))
print('FAILS', len(lib.fails)); sys.exit(1 if lib.fails else 0)
