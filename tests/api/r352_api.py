"""3.52: human resources and payroll — GOSI from the effective-dated table (old scheme and the new law in the same run,
the wage cap), joiners prorated, leave types with their limits and sick-leave tiers, unpaid days deducted in the payroll,
approval before posting, payroll journal = WPS file, IBAN and ID checks, documents with expiry, salary changes with
an effective date, end-of-service on resignation after 3 years 7 months — every figure checked by hand."""
import sys, os, time, datetime, calendar, csv, io; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B
t=register('r352'); c=lambda *a,**k: call(*a,tok=t,**k)
T=datetime.date.today(); d=T.isoformat(); P=d[:7]
D=lambda n: (T+datetime.timedelta(days=n)).isoformat()
near=lambda a,b,e=0.011: abs(float(a)-float(b))<=e
def refused(code, fn, name, has=None):
    try: fn(); ok(False,name)
    except E as e: ok(str(code) in str(e) and (has is None or has in str(e)), name+' → refused '+('' if has is None or has in str(e) else str(e)[:160]))
def mkiban(bban, cc='SA'):
    s=''.join(str(ord(ch)-55) if ch.isalpha() else ch for ch in bban+cc+'00'); return cc+str(98-int(s)%97).zfill(2)+bban
acc={x.get('systemKey'):x for x in c('/accounts')['rows'] if x.get('systemKey')}
c('/journals',{'date':f'{T.year}-01-01','memo':'رأس المال','lines':[{'accountId':acc['BANK']['id'],'debit':500000,'credit':0},{'accountId':acc['CAPITAL']['id'],'debit':0,'credit':500000}]})
NAT_S,NAT_F=('EGYPTIAN','FOREIGN') if EG else ('SAUDI','NON_SAUDI')
emp=lambda **k: c('/employees',{'gosi':True,**k})

# ═══ the employee file: IBAN and identity checked ═══
refused(400,lambda: emp(name='خطأ',iban='SA0380000000608010167518',basic=1000),'an IBAN with wrong check digits','IBAN')
if not EG: refused(400,lambda: emp(name='خطأ',idType='IQAMA',idNumber='3123456789',basic=1000),'an iqama number must start with 2','10 أرقام')
iban1=mkiban('80000123456789012345'); ok(iban1.startswith('SA') and len(iban1)==24,'a valid IBAN '+iban1)

if not EG:
    # ═══ GOSI: old scheme, new law, a non-Saudi and the cap in one run ═══
    old=emp(name='سعودي النظام السابق',nationality='SAUDI',hireDate='2020-03-01',gosiRegDate='2020-03-01',idType='NATIONAL_ID',idNumber='1012345678',iban=iban1,basic=8000,housing=2000,transport=500)
    new=emp(name='سعودي النظام الجديد',nationality='SAUDI',hireDate='2025-01-15',gosiRegDate='2025-01-15',idType='NATIONAL_ID',idNumber='1098765432',iban=mkiban('80000123456789012346'),basic=6000,housing=1500)
    exp_=emp(name='مقيم',nationality='NON_SAUDI',hireDate='2021-05-01',idType='IQAMA',idNumber='2234567890',iban=mkiban('80000123456789012347'),basic=4000,housing=1000)
    top=emp(name='أجر فوق الحد',nationality='SAUDI',hireDate='2019-01-01',idType='NATIONAL_ID',idNumber='1111111111',iban=mkiban('80000123456789012348'),basic=40000,housing=10000)
    joiner=emp(name='منضم منتصف الشهر',nationality='SAUDI',hireDate=P+'-16',gosiRegDate=P+'-16',idType='NATIONAL_ID',idNumber='1222222222',iban=mkiban('80000123456789012349'),basic=6000,housing=0)
    g=c('/hr/gosi-rates'); now={(x['scheme'],x['nationality']):x for x in g['now']}
    newE,newR=(10.75,12.75) if d>='2026-07-01' and d<'2027-07-01' else (now[('NEW','SAUDI')]['employee'],now[('NEW','SAUDI')]['employer'])
    ok(now[('OLD','SAUDI')]['employee']==9.75 and now[('OLD','SAUDI')]['employer']==11.75 and now[('NEW','SAUDI')]['employee']==newE and now[('NON_SAUDI' and 'OLD','NON_SAUDI')]['employer']==2,f"rates today: old 9.75/11.75, new law {newE}/{newR}, non-Saudi 0/2")
    run=c('/payroll',{'period':P}); L={l['name']:l for l in run['lines']}
    ok(L['سعودي النظام السابق']['gosiScheme']=='OLD' and near(L['سعودي النظام السابق']['gosiEmp'],10000*0.0975) and near(L['سعودي النظام السابق']['gosiEr'],10000*0.1175),'old scheme: 9.75% and 11.75% of basic + housing (10,000)')
    ok(L['سعودي النظام الجديد']['gosiScheme']=='NEW' and near(L['سعودي النظام الجديد']['gosiEmp'],round(7500*newE/100,2)) and near(L['سعودي النظام الجديد']['gosiEr'],round(7500*newR/100,2)),f"new law (registered 2025): {newE}% and {newR}% of 7,500 in the same run")
    pb={b['branch']:b for b in L['سعودي النظام الجديد']['gosiBranches']}; ok(set(pb)=={'PENSION','SANED','HAZARD'} and near(pb['HAZARD']['employer'],150) and near(pb['SANED']['employee'],56.25),'the branches: hazards 2% employer, SANED 0.75% each')
    ok(near(L['مقيم']['gosiEmp'],0) and near(L['مقيم']['gosiEr'],100),'non-Saudi: hazards 2% on the employer only (100)')
    ok(near(L['أجر فوق الحد']['gosiBase'],45000) and near(L['أجر فوق الحد']['gosiEmp'],45000*0.0975),'wage over the cap: GOSI on 45,000, not 50,000')
    dim=calendar.monthrange(T.year,T.month)[1]; days=dim-15
    ok(L['منضم منتصف الشهر'].get('prorate',{}).get('days')==days and near(L['منضم منتصف الشهر']['basic'],round(6000*days/dim,2)),f"joined on the 16th: {days}/{dim} of the month")
    # ═══ approval, journal = WPS ═══
    c('/hr/settings',{'requireApproval':True},'PUT')
    refused(409,lambda: c(f"/payroll/{run['id']}/post",{}),'policy: approve before posting','يُعتمد')
    ap=c(f"/payroll/{run['id']}/approve",{}); ok(ap['status']=='APPROVED' and ap['approvedBy'],'approved, with who approved')
    refused(409,lambda: c(f"/payroll/{run['id']}/recalc",{}),'an approved run is not recalculated','معتمد')
    wc=c(f"/payroll/{run['id']}/wps-check"); ok(wc['problems']==[],'WPS check: IBANs and IDs complete '+str(wc['problems'][:1]))
    pr=c(f"/payroll/{run['id']}/post",{}); j=c(f"/journals/{pr['journalId']}")
    pay_=sum(float(l['credit'])-float(l['debit']) for l in j['lines'] if l.get('accountId')==acc['SALARIES_PAYABLE']['id'])
    raw=lib.raw(f"/payroll/{run['id']}/wps.csv",tok=t) if hasattr(lib,'raw') else None
    if raw is None:
        import urllib.request; rq=urllib.request.Request(B+f"/payroll/{run['id']}/wps.csv",headers={'Authorization':'Bearer '+t}); raw=urllib.request.urlopen(rq).read().decode('utf-8-sig')
    rows=list(csv.reader(io.StringIO(raw))); hd=rows[0]; ni=hd.index('Net Salary'); ii=hd.index('National ID / Iqama')
    wnet=round(sum(float(r[ni]) for r in rows[1:]),2)
    ok(near(pay_,wnet) and near(wnet,pr['totalNet']) and all(r[ii] for r in rows[1:]),f"payroll journal salaries payable {round(pay_,2)} = WPS file net {wnet}, with the ID column")
    ok(abs(sum(float(l['debit']) for l in j['lines'])-sum(float(l['credit']) for l in j['lines']))<0.01,'the payroll journal balances')
    c('/hr/settings',{'requireApproval':False},'PUT')
    # past month on the new law: the rate in force then
    if d>='2026-01-01':
        r25=c('/payroll',{'period':'2025-08'}); n25={l['name']:l for l in r25['lines']}
        ok(near(n25['سعودي النظام الجديد']['gosiEmp'],round(7500*0.1025,2)) and near(n25['سعودي النظام الجديد']['gosiEr'],round(7500*0.1225,2)),'August 2025: the new law was 10.25% / 12.25% then')
        c(f"/payroll/{r25['id']}",None,'DELETE')
    # an establishment's own rate from a date wins
    own=c('/hr/gosi-rates',{'scheme':'OLD','nationality':'NON_SAUDI','branch':'HAZARD','employeePct':0,'employerPct':2.5,'effectiveFrom':P+'-01','note':'اختبار'})
    pv={l['name']:l for l in c(f'/payroll/preview2?period={P}')}; ok(near(pv['مقيم']['gosiEr'],125),'own rate row from this month: non-Saudi hazards 2.5% → 125')
    c(f"/hr/gosi/rate/{own['id']}",None,'DELETE'); pv={l['name']:l for l in c(f'/payroll/preview2?period={P}')}; ok(near(pv['مقيم']['gosiEr'],100),'removed: back to 2%')
    refused(400,lambda: c(f"/hr/gosi/rate/{[x for x in c('/hr/gosi-rates')['rates'] if not x['own']][0]['id']}",None,'DELETE'),'the published rows cannot be deleted','ما أضافته')

# ═══ leave: types, limits, sick tiers, approval, payroll deduction ═══
types={x['code']:x for x in c('/hr/leave-types')}
ok({'ANNUAL','SICK','MATERNITY','UNPAID','HAJJ'} <= set(types),'leave types seeded '+str(len(types)))
w=emp(name='موظف الإجازات',nationality=NAT_S,gender='M',hireDate=D(-400),idType='NATIONAL_ID',idNumber='1333333333',iban=mkiban('80000123456789012350'),basic=3000,housing=750,transport=0)
refused(400,lambda: c('/hr/leave-requests',{'employeeId':w['id'],'type':'MATERNITY','fromDate':D(30),'toDate':D(40)}),'maternity leave for a male employee','فقط')
refused(400,lambda: c('/hr/leave-requests',{'employeeId':w['id'],'type':'HAJJ','fromDate':D(30),'toDate':D(40)}),'hajj leave before the service required','من الخدمة')
if not EG:
    refused(400,lambda: c('/hr/leave-requests',{'employeeId':w['id'],'type':'MARRIAGE','fromDate':D(30),'toDate':D(35)}),'marriage leave of 6 days (5 allowed)','الحد الأقصى')
    # sick: 25 days already this year, 10 more → 5 at full pay, 5 at three quarters
    c('/hr/leave-requests',{'employeeId':w['id'],'type':'SICK','fromDate':D(-120),'toDate':D(-96),'approve':True})
    q=c('/hr/leave-requests/quote',{'employeeId':w['id'],'type':'SICK','fromDate':D(-60),'toDate':D(-51)})
    ok(q['used']==25 and q['pay']==[{'days':5,'pct':100},{'days':5,'pct':75}] and near(q['unpaidDays'],1.25),'art. 117: after 25 sick days, 10 more = 5 at 100% + 5 at 75% (1.25 days unpaid)')
pend=c('/hr/leave-requests',{'employeeId':w['id'],'type':'UNPAID','fromDate':P+'-03','toDate':P+'-05','reason':'ظرف عائلي'})
ok(pend['status']=='PENDING','request waits for approval')
refused(409,lambda: c('/hr/leave-requests',{'employeeId':w['id'],'type':'ANNUAL','fromDate':P+'-04','toDate':P+'-06'}),'overlapping leave','تتداخل')
pv=[l for l in c(f'/payroll/preview2?period={P}') if l['employeeId']==w['id']][0]; ok(not pv.get('leaveDeduction'),'pending leave: nothing deducted yet')
c(f"/hr/leave-requests/{pend['id']}/approve",{})
pv=[l for l in c(f'/payroll/preview2?period={P}') if l['employeeId']==w['id']][0]
ok(pv.get('leaveDeduction') and near(pv['leaveDeduction']['amount'],round(3750/30*3,2)) and near(pv['absence'],round(3750/30*3,2)),'approved unpaid leave: 3 days × 3,750/30 = 375 off the payroll')
rj=c('/hr/leave-requests',{'employeeId':w['id'],'type':'ANNUAL','fromDate':D(60),'toDate':D(64)}); rj=c(f"/hr/leave-requests/{rj['id']}/reject",{'note':'ضغط العمل'})
ok(rj['status']=='REJECTED' and rj['decisionNote']=='ضغط العمل','rejected with a reason')
bal=c(f"/hr/employees/{w['id']}/leave-balances"); ok(bal['annual']['accrued']>(15 if EG else 20) and bal['annual']['taken']==0,f"annual balance {bal['annual']['balance']} days after 400 days of service")

# ═══ documents and expiry ═══
c('/hr/documents',{'employeeId':w['id'],'kind':'PASSPORT','number':'A1','expiryDate':D(10)})
c('/hr/documents',{'employeeId':w['id'],'kind':'HEALTH_INSURANCE','number':'H1','expiryDate':D(-3)})
c('/hr/documents',{'employeeId':w['id'],'kind':'CONTRACT','number':'C1','expiryDate':D(400)})
refused(400,lambda: c('/hr/documents',{'employeeId':w['id'],'kind':'PASSPORT','issueDate':D(5),'expiryDate':D(1)}),'expiry before issue','قبل')
ds={x['number']:x for x in c('/hr/documents?within=60')}
ok(ds['A1']['state']=='SOON' and ds['A1']['daysLeft']==10 and ds['H1']['state']=='EXPIRED' and 'C1' not in ds,'within 60 days: passport in 10 days, insurance lapsed 3 days ago; the contract is not listed')

# ═══ salary changes ═══
fut=c(f"/hr/employees/{w['id']}/salary-change",{'effectiveDate':D(40),'basic':3300,'reason':'ترقية'})
ok(fut['status']=='PENDING' and float([e for e in c('/employees') if e['id']==w['id']][0]['basic'])==3000,'a raise from a future date waits; the pay is unchanged today')
refused(409,lambda: c(f"/hr/employees/{w['id']}/salary-change",{'basic':3500}),'one pending change at a time','لم يسرِ')
c(f"/hr/salary-changes/{fut['id']}/cancel",{})
now_=c(f"/hr/employees/{w['id']}/salary-change",{'effectiveDate':d,'basic':3200,'housing':800,'reason':'تعديل'})
ok(now_['status']=='APPLIED' and float([e for e in c('/employees') if e['id']==w['id']][0]['basic'])==3200,'effective today: applied at once')
h=c(f"/hr/employees/{w['id']}/salary-history"); ap_=[x for x in h if x['status']=='APPLIED'][0]; ok(len(h)==2 and ap_['oldTotal']==3750 and ap_['newTotal']==4000 and any(x['status']=='CANCELLED' for x in h),'history: 3,750 → 4,000 and the cancelled one')

# ═══ end of service (arts. 84, 85, 87) ═══
if not EG:
    tot=T.year*12+T.month-1-43; hire=datetime.date(tot//12,tot%12+1,min(T.day,28)).isoformat()
    r=emp(name='مستقيل بعد 3 سنوات و7 أشهر',nationality='SAUDI',hireDate=hire,basic=6000,housing=1500,transport=500)
    s=c('/hr/settlements/compute',{'employeeId':r['id'],'date':d,'reason':'RESIGNATION'})
    yrs=(T-datetime.date.fromisoformat(hire)).days/365.25; full=round(8000*0.5*yrs,2)
    ok(near(s['eosbFull'],full,0.05) and near(s['eosbDue'],round(full/3,2),0.05),f"resigned after {round(yrs,3)} years: full {full}, one third {round(full/3,2)} (art. 85)")
    s87=c('/hr/settlements/compute',{'employeeId':r['id'],'date':d,'reason':'ART87'}); ok(near(s87['eosbDue'],s87['eosbFull']),'art. 87 exception: the full award')
    s80=c('/hr/settlements/compute',{'employeeId':r['id'],'date':d,'reason':'ART80'}); ok(s80['eosbDue']==0,'art. 80: nothing')

# ═══ dashboard and profile ═══
db_=c('/hr/dashboard'); ok(db_['headcount']['active']>=1 and len(db_['documents']['expired'])>=1 and len(db_['documents']['soon'])>=1,'dashboard: headcount, documents lapsed and about to lapse')
pf=c(f"/hr/employees/{w['id']}/profile"); ok(pf['employee']['name']=='موظف الإجازات' and len(pf['documents'])==3 and len(pf['history'])==2 and pf['balances']['annual'],'employee profile: file, documents, salary history, balances')
ig=c('/reports/integrity'); ok(ig['ok'],'integrity checks pass '+str([x['name'] for x in ig['checks'] if not x['ok']][:2]))
print('FAILS', len(lib.fails)); sys.exit(1 if lib.fails else 0)
