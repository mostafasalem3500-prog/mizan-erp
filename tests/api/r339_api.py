import sys, os, datetime; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B
# ── 3.39: payroll remittances (both editions); Egypt — insurance limits by year, labour-law leave, gratuity after 60,
#          simplified regime, solidarity contribution, legal reserve, salary-tax report ──
t=register('r339'); c=lambda *a,**k: call(*a,tok=t,**k)
A=c('/accounts')['rows']; K={x.get('systemKey'):x for x in A if x.get('systemKey')}
d=datetime.date.today(); dt=d.isoformat()
def refused(code, fn, name):
    try: fn(); ok(False,name)
    except E as e: ok(str(code) in str(e)[:3], name+' → '+str(e)[:90])
def bal(key):
    r=[x for x in c(f'/reports/trial-balance?from=2000-01-01&to=2099-12-31')['rows'] if x['id']==K[key]['id']]
    return round(float(r[0]['closingDr'])-float(r[0]['closingCr']),2) if r else 0.0
Y=d.year-1; P=f'{Y}-03'
c('/journals',{'date':f'{Y}-01-02','memo':'رأس المال','lines':[{'accountId':K['BANK']['id'],'debit':400000,'credit':0},{'accountId':K['CAPITAL']['id'],'debit':0,'credit':400000}]})
emp=c('/employees',{'code':'E1','name':'أحمد علي','nationality':'EGYPTIAN' if EG else 'SAUDI','hireDate':f'{Y-3}-01-01','basic':20000,'housing':0,'transport':0,'otherAllow':0,'gosi':True})
run=c('/payroll',{'period':P}); c(f"/payroll/{run['id']}/post",{})
line=[r for r in c('/payroll')['runs'] if r['id']==run['id']][0]
ins=round(float(line['totalGosiEmp'])+float(line['totalGosiEr']),2)

# ── remittances ──
s=c(f'/payroll/remittances?year={Y}'); row=[r for r in s['rows'] if r['period']==P][0]
it={i['kind']:i for i in row['items']}
ok(near(it['INSURANCE']['accrued'],ins) and it['INSURANCE']['outstanding']==it['INSURANCE']['accrued'],'the month shows the insurance of both shares as outstanding')
ok(row['due']==f'{Y}-04-15' and it['INSURANCE']['late'],'due the 15th of the following month, flagged late once past')
ok(('SALARY_TAX' in it)==EG,'salary tax line exists in the Egyptian edition only')
refused(400,lambda: c('/payroll/remittances',{'kind':'X','period':P,'accountId':K['BANK']['id']}),'unknown kind refused')
refused(400,lambda: c('/payroll/remittances',{'kind':'INSURANCE','period':f'{Y}-01','accountId':K['BANK']['id']}),'a month with no posted payroll refused')
refused(404,lambda: c('/payroll/remittances',{'kind':'INSURANCE','period':P,'accountId':K['CAPITAL']['id']}),'a non-bank account refused')
al=[a for a in c('/alerts')['items'] if '/payroll/remittances' in a.get('to','')]
ok(len(al)==(2 if EG else 1) and all(a['level']=='err' for a in al),'the dashboard warns about each overdue remittance')
b0=bal('BANK')
r1=c('/payroll/remittances',{'kind':'INSURANCE','period':P,'accountId':K['BANK']['id'],'date':dt,'reference':'NOSI-1'})
ok(near(r1['amount'],ins) and near(bal('GOSI_PAYABLE'),0) and near(bal('BANK'),b0-ins),'insurance remitted: payable cleared and the bank paid')
refused(409,lambda: c('/payroll/remittances',{'kind':'INSURANCE','period':P,'accountId':K['BANK']['id']}),'the same month is not remitted twice')
if EG:
    tax=round(float(line['totalSalaryTax']),2); mar=round(float(line['totalMartyrs']),2)
    ok(near(it['SALARY_TAX']['accrued'],tax+mar),'salary tax and martyrs fund are remitted together')
    r2_=c('/payroll/remittances',{'kind':'SALARY_TAX','period':P,'accountId':K['BANK']['id']})
    ok(near(bal('SALARY_TAX_PAYABLE'),0) and near(bal('MARTYRS_PAYABLE'),0) and near(r2_['amount'],tax+mar),'tax authority paid: both payables cleared')
ok(not [a for a in c('/alerts')['items'] if '/payroll/remittances' in a.get('to','')],'no alert once everything is remitted')
c(f"/payroll/remittances/{r1['id']}/cancel",{})
ok(near(bal('GOSI_PAYABLE'),-ins) and near(bal('BANK'),b0-(tax+mar if EG else 0)),'cancelling a remittance restores the payable and the bank')
refused(409,lambda: c(f"/payroll/remittances/{r1['id']}/cancel",{}),'a cancelled remittance cannot be cancelled again')
# a liability already cleared by a manual journal is not paid a second time
c('/journals',{'date':dt,'memo':'سداد يدوي','lines':[{'accountId':K['GOSI_PAYABLE']['id'],'debit':ins,'credit':0},{'accountId':K['BANK']['id'],'debit':0,'credit':ins}]})
refused(409,lambda: c('/payroll/remittances',{'kind':'INSURANCE','period':P,'accountId':K['BANK']['id']}),'paid by a manual entry: the remittance is refused instead of paying twice')
ok(not [a for a in c('/alerts')['items'] if '/payroll/remittances' in a.get('to','')],'and the dashboard does not nag about it')
rates=c('/payroll/overtime-rates')['rates']
ok([x['factor'] for x in rates]==([1.35,1.7,2,3] if EG else [1.5]),'overtime rates of the edition')

if not EG:
    refused(404,lambda: c('/tax/solidarity'),'Egyptian screens are absent from the Saudi edition')
    pos=[x for x in c('/hr/positions')['rows'] if x['employeeId']==emp['id']][0] if isinstance(c('/hr/positions'),dict) else [x for x in c('/hr/positions') if x['employeeId']==emp['id']][0]
    ok(pos['eosbDue']>0,'Saudi end-of-service still accrues (unchanged)')
    print('FAILS', len(lib.fails)); sys.exit(1 if lib.fails else 0)

# ── insurance limits follow the payroll year ──
rules=c('/tax/eg/rules'); by=rules['insurance']['byYear']
ok(by['2026']=={'minWage':2700,'maxWage':16700} and by['2027']=={'minWage':3200,'maxWage':19300},'insurance wage limits kept per year (2026 and 2027)')
hi=c('/employees',{'code':'E2','name':'منى حسن','nationality':'EGYPTIAN','hireDate':'2020-01-01','basic':50000,'gosi':True})
p26=[x for x in c('/payroll/preview?period=2026-06') if x['employeeId']==hi['id']][0]; p27=[x for x in c('/payroll/preview?period=2027-02') if x['employeeId']==hi['id']][0]
ok(near(p26['gosiEmp'],16700*0.11) and near(p27['gosiEmp'],19300*0.11),'a salary above the ceiling: 2026 capped at 16,700 and 2027 at 19,300')
lo=c('/employees',{'code':'E3','name':'سيد','nationality':'EGYPTIAN','hireDate':'2026-01-01','basic':2000,'gosi':True})
q26=[x for x in c('/payroll/preview?period=2026-06') if x['employeeId']==lo['id']][0]; q27=[x for x in c('/payroll/preview?period=2027-02') if x['employeeId']==lo['id']][0]
ok(near(q26['gosiEr'],2700*0.1875) and near(q27['gosiEr'],3200*0.1875),'a salary under the floor is insured at the floor of its year')

# ── leave & gratuity under the Egyptian labour law ──
def pos_of(e, as_of):
    r=c(f'/hr/positions?asOf={as_of}'); rows=r['rows'] if isinstance(r,dict) else r
    return [x for x in rows if x['employeeId']==e['id']][0]
n1=c('/employees',{'code':'L1','name':'جديد','nationality':'EGYPTIAN','hireDate':'2026-01-01','basic':9000,'gosi':True})
ok(near(pos_of(n1,'2026-07-02')['leaveAccrued'],7.5,0.1),'first year of service accrues 15 days a year (7.5 after six months)')
ok(near(pos_of(n1,'2028-01-01')['leaveAccrued'],15+21,0.1),'21 days from the second year')
old=c('/employees',{'code':'L2','name':'قديم','nationality':'EGYPTIAN','hireDate':'2014-01-01','leaveBalanceDate':'2026-01-01','basic':9000,'gosi':True})
ok(near(pos_of(old,'2027-01-01')['leaveAccrued'],30,0.1),'30 days after ten years of service')
a50=c('/employees',{'code':'L3','name':'خمسيني','nationality':'EGYPTIAN','hireDate':'2023-01-01','birthDate':'1970-01-01','leaveBalanceDate':'2026-01-01','basic':9000,'gosi':True})
ok(near(pos_of(a50,'2027-01-01')['leaveAccrued'],30,0.1),'30 days from age fifty')
ok(pos_of(old,'2027-01-01')['eosbDue']==0,'no end-of-service gratuity before age 60 (the pension is from social insurance)')
sen=c('/employees',{'code':'L4','name':'ستيني','nationality':'EGYPTIAN','hireDate':'2010-01-01','birthDate':'1964-01-01','basic':10000,'gosi':True})
ok(near(pos_of(sen,'2026-01-01')['eosbDue'],10000*0.5*2,60),'after 60: half a month for each of the first five years past 60')

# ── simplified regime (Law 6/2025) ──
for tv,rate in [(400000,0.004),(1500000,0.005),(2500000,0.0075),(9000000,0.01),(15000000,0.015)]:
    x=c(f'/tax/simplified?turnover={tv}'); ok(near(x['rate'],rate,1e-9) and near(x['tax'],tv*rate),f'simplified tax on turnover {tv:,}: {rate*100:g}%')
ok(c('/tax/simplified?turnover=21000000')['eligible'] is False,'turnover above 20m is outside the simplified regime')
cust=c('/partners',{'name':'عميل','type':'CUSTOMER','vatNumber':'200000001'})
svc=c('/products',{'name':'خدمة','sku':'S1','type':'SERVICE','salePrice':1000,'taxCode':'S'})
inv=c('/invoices',{'direction':'SALE','kind':'INVOICE','date':f'{Y}-06-10','partnerId':cust['id'],'lines':[{'productId':svc['id'],'qty':300,'unitPrice':1000,'taxCode':'S'}]}); c(f"/invoices/{inv['id']}/post",{})
it0=c(f'/tax/income-tax?year={Y}')
ok(it0['simplified']['enabled'] is False and near(it0['simplified']['tax'],300000*0.004),'income-tax screen shows what the simplified regime would cost')
c('/settings',{'egSimplified':True,'vatPeriod':'QUARTERLY'},m='PUT')
me=c('/auth/me')['company']; ok(me.get('egSimplified') is True and me['vatPeriod']=='QUARTERLY','the establishment opts into the simplified regime with a quarterly VAT return')
z=c('/tax/income-tax',{'year':str(Y)})
ok(near(z['zakat'],1200) and near(z['base'],300000) and near(bal('INCOME_TAX_PAYABLE'),-1200),'simplified regime: tax posted on turnover (300,000 × 0.4% = 1,200), not on profit')
c(f"/tax/income-tax/{z['id']}/cancel",{}); c('/settings',{'egSimplified':False,'vatPeriod':'MONTHLY'},m='PUT')
z2=c('/tax/income-tax',{'year':str(Y)}); ok(near(z2['zakat'],round(z2['base']*0.225,2)) and z2['base']<300000,'back to the general regime: 22.5% of the taxable profit')

# ── solidarity contribution ──
so=c(f'/tax/solidarity?year={Y}')
ok(near(so['revenue'],300000) and near(so['amount'],750) and so['dueDate']==f'{Y+1}-04-30','solidarity contribution: 2.5 per thousand of revenue, due with the income-tax return')
c('/tax/solidarity',{'year':str(Y)})
A=c('/accounts')['rows']; K={x.get('systemKey'):x for x in A if x.get('systemKey')}
ok('SOLIDARITY_EXPENSE' in K and near(bal('SOLIDARITY_PAYABLE'),-750) and near(bal('SOLIDARITY_EXPENSE'),750),'posted: expense and payable accounts created in an older chart')
refused(409,lambda: c('/tax/solidarity',{'year':str(Y)}),'not posted twice for one year')
c('/tax/solidarity/pay',{'year':str(Y),'accountId':K['BANK']['id']})
so=c(f'/tax/solidarity?year={Y}'); ok(near(so['paid'],750) and so['due']==0 and near(bal('SOLIDARITY_PAYABLE'),0),'paid to the tax authority: payable cleared')
refused(409,lambda: c('/tax/solidarity/cancel',{'year':str(Y)}),'a paid contribution cannot be cancelled')
refused(409,lambda: c('/tax/solidarity/pay',{'year':str(Y),'accountId':K['BANK']['id']}),'not paid twice')

# ── legal reserve ──
lr=c(f'/tax/legal-reserve?year={Y}')
ok(lr['netProfit']>0 and near(lr['amount'],round(lr['netProfit']*0.05,2)) and near(lr['cap'],200000),'legal reserve: 5% of net profit, capped at half the capital')
re0=bal('RETAINED'); c('/tax/legal-reserve',{'year':str(Y)})
lr2=c(f'/tax/legal-reserve?year={Y}'); ok(lr2['posted'] and near(lr2['reserve'],lr['amount']) and near(bal('RETAINED'),re0+lr['amount']),'formed: retained earnings to legal reserve')
refused(409,lambda: c('/tax/legal-reserve',{'year':str(Y)}),'formed once a year')
c('/tax/legal-reserve/cancel',{'year':str(Y)}); ok(near(c(f'/tax/legal-reserve?year={Y}')['reserve'],0),'cancelled: reserve back to zero')

# ── salary-tax report ──
q1=c(f'/tax/salary-tax-report?year={Y}&quarter=1'); r=[x for x in q1['rows'] if x['code']=='E1'][0]
ok(q1['periods']==[P] and near(r['tax'],tax) and near(r['gross'],20000) and q1['due']==f'{Y}-04-30','quarterly Form 4 figures per employee, due the end of the following month')
an=c(f'/tax/salary-tax-report?year={Y}'); r=[x for x in an['rows'] if x['code']=='E1'][0]
ok(near(r['taxDue'],r['tax'],0.05) and abs(r['difference'])<=0.05 and an['due']==f'{Y+1}-01-31','annual settlement: tax due equals what the payroll withheld for a steady salary')
tb=c(f'/reports/trial-balance?from=2000-01-01&to=2099-12-31'); ok(near(sum(float(x['closingDr']) for x in tb['rows']),sum(float(x['closingCr']) for x in tb['rows'])),'trial balance still balanced')
print('FAILS', len(lib.fails)); sys.exit(1 if lib.fails else 0)
