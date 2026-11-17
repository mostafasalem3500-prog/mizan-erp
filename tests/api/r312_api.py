import sys, os, time, datetime; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
EG='3200' in B
t=register('r312'); c=lambda *a,**k: call(*a,tok=t,**k)
A=c('/accounts')['rows']; acc={x.get('systemKey'):x for x in A if x.get('systemKey')}
d=time.strftime('%Y-%m-%d'); m=time.strftime('%Y-%m'); y=time.strftime('%Y')
c('/journals',{'date':f'{y}-01-01','memo':'رأس المال','lines':[{'accountId':acc['BANK']['id'],'debit':500000,'credit':0},{'accountId':acc['CAPITAL']['id'],'debit':0,'credit':500000}]})
k1=c('/cost-centers',{'code':'RUH','name':'فرع الرياض'}); k2=c('/cost-centers',{'code':'JED','name':'فرع جدة'})
nat='EGYPTIAN' if EG else 'SAUDI'
e1=c('/employees',{'name':'أحمد','nationality':nat,'hireDate':f'{y}-01-01','basic':6000,'housing':1500,'transport':500,'otherAllow':0,'gosi':True,'costCenterId':k1['id']})
e2=c('/employees',{'name':'سالم','nationality':'NON_SAUDI','hireDate':f'{y}-01-01','basic':3000,'housing':0,'transport':0,'otherAllow':0,'gosi':False,'costCenterId':k2['id']})
P=lambda b: c('/payroll-items',b)
# ── computed amounts (month = 30 days × 8 hours; overtime = hourly wage + (factor−1) × basic hourly)
F=1.35 if EG else 1.5
ot=P({'employeeId':e1['id'],'kind':'OVERTIME','date':d,'qty':10}); exp_ot=round(10*(8000+(F-1)*6000)/240,2); ok(float(ot['amount'])==exp_ot and float(ot['factor'])==F,f"overtime 10h → {ot['amount']} (= 10 × (8000 + {F-1:.2f}×6000) ÷ 240)")
ot2=P({'employeeId':e1['id'],'kind':'OVERTIME','date':d,'qty':4,'factor':2}); ok(float(ot2['amount'])==round(4*(8000+6000)/240,2),'holiday overtime ×2')
ab=P({'employeeId':e1['id'],'kind':'ABSENCE','date':d,'qty':2}); ok(float(ab['amount'])==round(2*8000/30,2),f"absence 2 days → {ab['amount']} (wage ÷ 30 × 2)")
lt=P({'employeeId':e1['id'],'kind':'LATE','date':d,'qty':3}); ok(float(lt['amount'])==100.0,'lateness 3h → 100.00 (wage ÷ 240 × 3)')
pn=P({'employeeId':e2['id'],'kind':'PENALTY','date':d,'qty':1,'note':'قرار 12'}); ok(float(pn['amount'])==100.0,'penalty of one day for a 3,000 wage → 100.00')
bn=P({'employeeId':e2['id'],'kind':'BONUS','date':d,'amount':750}); cm=P({'employeeId':e2['id'],'kind':'COMMISSION','date':d,'amount':250})
man=P({'employeeId':e2['id'],'kind':'OVERTIME','date':d,'qty':5,'amount':200}); ok(float(man['amount'])==200 and man['manual'] is True,'typed amount overrides the computed one and is flagged')
for bad_,why in [({'employeeId':e1['id'],'kind':'OVERTIME','date':d},'hours required'),({'employeeId':e1['id'],'kind':'BONUS','date':d},'amount required'),({'employeeId':e1['id'],'kind':'XX','date':d,'amount':5},'unknown kind'),({'employeeId':e1['id'],'kind':'ABSENCE','date':d,'qty':40},'more days than a month')]:
    try: P(bad_); ok(False,why)
    except E as e: ok('400' in str(e),why+' → refused')
q_=c('/payroll-items/quote',{'employeeId':e1['id'],'kind':'ABSENCE','qty':1}); ok(q_['daily']==266.67 and q_['hourly']==33.33,'quote: daily 266.67, hourly 33.33')
ok(len(c(f'/payroll-items?period={m}')['rows'])==8,'8 transactions listed for the month')
# ── loans
ln=c('/hr/loans',{'employeeId':e2['id'],'date':d,'amount':3000,'installment':500,'startPeriod':m,'accountId':acc['BANK']['id']})
ln1=c('/hr/loans',{'employeeId':e1['id'],'date':d,'amount':1200,'installment':400,'startPeriod':m,'accountId':acc['BANK']['id']})
# ── preview and run
pv={l['name']:l for l in c(f'/payroll/preview2?period={m}')}
a=pv['أحمد']; print({k:a[k] for k in ('gross','overtime','bonus','absence','deduction','loan','gosiEmp','net')})
ok(a['overtime']==round(exp_ot+float(ot2['amount']),2) and a['absence']==533.33 and a['deduction']==100 and a['loan']==400 and len(a['items'])==4,'preview pulls the month transactions and the loan instalment')
s_=pv['سالم']; ok(s_['bonus']==1000 and s_['overtime']==200 and s_['deduction']==100 and s_['loan']==500 and not s_['overHalf'],'second employee: bonus+commission 1,000, overtime 200, penalty 100, loan 500')
run=c('/payroll',{'period':m,'adjustments':{e2['id']:{'deduction':1800}}}); L={l['name']:l for l in run['lines']}
ok(L['سالم']['deduction']==1900 and L['سالم']['overHalf'] is True,'manual extra deduction added on the run; deductions over half the wage are flagged')
ok(all(i['status']=='INCLUDED' for i in c(f'/payroll-items?period={m}')['rows']),'transactions marked as included in the run')
try: c(f"/payroll-items/{ot['id']}",m='DELETE'); ok(False,'del included')
except E as e: ok('409' in str(e),'a transaction inside a run cannot be deleted')
late=P({'employeeId':e1['id'],'kind':'BONUS','date':d,'amount':300}); r2_=c(f"/payroll/{run['id']}/recalc",{}); L2={l['name']:l for l in r2_['lines']}
ok(L2['أحمد']['bonus']==300 and L2['سالم']['deduction']==1900 and float(r2_['totalNet'])>float(run['totalNet']) and float(r2_['totalNet'])<=float(run['totalNet'])+300,'recalculation picks up a late transaction and keeps what was typed on the run')
# ── posting: per cost centre, overtime and bonus on their own accounts
posted=c(f"/payroll/{run['id']}/post",{}); je=c('/journals/'+posted['journalId']); JL=je['lines']; print([(l.get('accountCode') or l.get('code'), l.get('accountName') or l.get('nameAr'), float(l['debit']), float(l['credit'])) for l in JL][:14])
name=lambda l: l.get('accountName') or l.get('nameAr') or l.get('account') or ''
dr=round(sum(float(l['debit']) for l in JL),2); cr=round(sum(float(l['credit']) for l in JL),2); ok(dr==cr,'payroll journal balanced: %.2f'%dr)
ok(any('الإضافي' in name(l) and float(l['debit'])>0 for l in JL) and any('مكافآت' in name(l) and float(l['debit'])>0 for l in JL),'overtime and bonuses posted to their own expense accounts (created on first use)')
otsum=round(sum(float(l['debit']) for l in JL if 'الإضافي' in name(l)),2); ok(otsum==round(L2['أحمد']['overtime']+L2['سالم']['overtime'],2),'overtime account total = overtime in the run')
pnl={x['name']:x for x in c(f'/reports/cost-centers?from={m}-01&to={y}-12-31')['rows']}; a2=L2['أحمد']; s2=L2['سالم']
exp=lambda l: round(l['basic']-l['deduction']-l['absence']+l['overtime']+l['bonus']+l['housing']+l['transport']+l['other']+l['gosiEr'],2)
ok(pnl['فرع الرياض']['expenses']==exp(a2) and pnl['فرع جدة']['expenses']==exp(s2),f"each cost centre carries its own payroll: Riyadh {pnl['فرع الرياض']['expenses']}, Jeddah {pnl['فرع جدة']['expenses']}")
loans=c('/hr/loans'); lo={l['employeeName']:l for l in loans}; ok(float(lo['سالم']['paid'])==500 and float(lo['أحمد']['paid'])==400,'loan instalments applied on posting')
ig=c('/reports/integrity'); bad_=[x['name'] for x in ig['checks'] if not x['ok']]; ok(not bad_,'books still tie after payroll (loans register = advances account …): '+str(bad_))
# ── loan repayment and rescheduling
r=c(f"/hr/loans/{ln['id']}/repay",{'amount':1000,'accountId':acc['CASH']['id'],'date':d}); ok(r['rest']==1500,'cash repayment 1,000 → 1,500 left')
try: c(f"/hr/loans/{ln['id']}/repay",{'amount':5000,'accountId':acc['CASH']['id']}); ok(False,'overpay')
except E as e: ok('400' in str(e),'cannot repay more than what is left')
nxt=(datetime.date.today().replace(day=1)+datetime.timedelta(days=64)).strftime('%Y-%m')
rs=c(f"/hr/loans/{ln['id']}",{'installment':750,'startPeriod':nxt},m='PUT'); ok(float(rs['installment'])==750 and rs['startPeriod']==nxt,'rescheduled: instalment 750 from '+nxt)
nm=(datetime.date.today().replace(day=1)+datetime.timedelta(days=32)).strftime('%Y-%m'); pv2={l['name']:l for l in c(f'/payroll/preview2?period={nm}')}; ok(pv2['سالم']['loan']==0 and pv2['أحمد']['loan']==400,'next month: paused loan is skipped, the other still deducted')
r=c(f"/hr/loans/{ln1['id']}/repay",{'accountId':acc['CASH']['id']}); ok(r['rest']==0 and {l['employeeName']:l for l in c('/hr/loans')}['أحمد']['status']=='SETTLED','repaying without an amount settles the loan')
ig=c('/reports/integrity'); bad_=[x['name'] for x in ig['checks'] if not x['ok']]; ok(not bad_,'books tie after loan repayments: '+str(bad_))
# ── deleting a draft releases its transactions; pay
P({'employeeId':e1['id'],'kind':'BONUS','date':nm+'-05','amount':100}); rn=c('/payroll',{'period':nm}); c(f"/payroll/{rn['id']}",m='DELETE'); ok(all(i['status']=='OPEN' for i in c(f'/payroll-items?period={nm}')['rows']),'deleting a draft run frees its transactions')
paid=c(f"/payroll/{run['id']}/pay",{'accountId':acc['BANK']['id'],'date':d}); ok(paid['status']=='PAID','run paid')
tb={r['code']:r for r in c(f'/reports/trial-balance?from={y}-01-01&to={y}-12-31')['rows']}; sp=[r for r in tb.values() if r['id']==acc['SALARIES_PAYABLE']['id']][0]; ok(abs(float(sp['opening'])+float(sp['debit'])-float(sp['credit']))<0.005,'salaries payable is zero after payment')
print('FAILS',fails); sys.exit(1 if fails else 0)
