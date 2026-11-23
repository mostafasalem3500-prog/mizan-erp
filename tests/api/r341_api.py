import sys, os, datetime; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B; R=0.14 if EG else 0.15
# ── 3.41: recurring rent and recurring expenses in the cash-flow forecast; the rent column no longer empty without a word ──
t=register('r341'); c=lambda *a,**k: call(*a,tok=t,**k)
A=c('/accounts')['rows']; K={x.get('systemKey'):x for x in A if x.get('systemKey')}
d=datetime.date.today(); dt=d.isoformat(); D=lambda n: (d+datetime.timedelta(days=n)).isoformat()
def refused(code, fn, name):
    try: fn(); ok(False,name)
    except E as e: ok(str(code) in str(e)[:3], name+' → '+str(e)[:90])
def bal(key):
    r=[x for x in c('/reports/trial-balance?from=2000-01-01&to=2099-12-31')['rows'] if x['id']==K[key]['id']]
    return round(float(r[0]['closingDr'])-float(r[0]['closingCr']),2) if r else 0.0
c('/journals',{'date':D(-80),'memo':'رأس المال','lines':[{'accountId':K['BANK']['id'],'debit':300000,'credit':0},{'accountId':K['CAPITAL']['id'],'debit':0,'credit':300000}]})
fc=lambda: c('/reports/cash-forecast?weeks=13')
col=lambda f,k: round(sum(b['out'][k] for b in f['buckets']),2)
f0=fc(); ok(col(f0,'leases')==0 and f0['assumptions']['rentMissing'] is False and not any('إيجار' in w for w in f0['warnings']),'a new establishment: no rent, and no rent remark')
# rent paid by hand for three months, never defined as recurring → the forecast says so
for n in (75,45,15): c('/expenses',{'date':D(-n),'accountId':K['RENT']['id'],'amount':6000,'taxCode':'S','payAccountId':K['BANK']['id'],'payee':'مالك العقار','description':'إيجار المعرض'})
f1=fc(); ok(col(f1,'leases')==0 and f1['assumptions']['rentMissing'] and near(f1['assumptions']['rentMonthlyAvg'],6000) and any('إيجار دوري' in w for w in f1['warnings']),'rent in the books but not recurring: the forecast explains the empty column and gives the monthly average (6,000)')
refused(400,lambda: c('/recurring',{'kind':'EXPENSE','name':'إيجار','frequency':'MONTHLY','nextDate':D(10),'payload':{'accountId':K['RENT']['id']}}),'a recurring expense needs an amount')
nxt=D(10)
tp=c('/recurring',{'kind':'EXPENSE','name':'إيجار المعرض الشهري','frequency':'MONTHLY','nextDate':nxt,'payload':{'accountId':K['RENT']['id'],'amount':6000,'taxCode':'S','amountIncludesVat':False,'payee':'مالك العقار','description':'إيجار المعرض','payAccountId':K['BANK']['id']}})
f2=fc()
import calendar
def occ(start, weeks):
    end=d+datetime.timedelta(days=weeks*7-1); k=0; cur=datetime.date.fromisoformat(start)
    while cur<=end:
        k+=1; m=cur.month+1; y=cur.year+(m>12); m=m-12 if m>12 else m; cur=datetime.date(y,m,min(cur.day,calendar.monthrange(y,m)[1]))
    return k
k=occ(nxt,13)
ok(near(col(f2,'leases'),k*6000*(1+R)) and col(f2,'recurring')==0,f'recurring rent fills the rent column: {k} payments of 6,000 + VAT in 13 weeks')
ok(f2['assumptions']['rentTemplates']==1 and not f2['assumptions']['rentMissing'] and not any('غير معرَّف' in w for w in f2['warnings']),'and the remark is gone')
ok(near(f1['closing']-f2['closing'],k*6000*(1+R)),'the forecast closing balance drops by exactly the rent to be paid')
# another fixed expense goes to the recurring column; a template merely named «إيجار» counts as rent too
c('/recurring',{'kind':'EXPENSE','name':'اشتراك الإنترنت','frequency':'MONTHLY','nextDate':nxt,'payload':{'accountId':K['UTILITIES']['id'],'amount':400,'taxCode':'S','payAccountId':K['BANK']['id'],'description':'إنترنت'}})
c('/recurring',{'kind':'EXPENSE','name':'إيجار سكن العمال','frequency':'QUARTERLY','nextDate':nxt,'payload':{'accountId':K['GENERAL_EXPENSE']['id'],'amount':9000,'taxCode':'E','payAccountId':K['BANK']['id'],'description':'سكن'}})
f3=fc()
ok(near(col(f3,'recurring'),k*400*(1+R)),'a fixed subscription is in the recurring-expenses column')
ok(near(col(f3,'leases'),k*6000*(1+R)+9000),'exempt housing rent (no VAT) named «إيجار» is counted as rent: one quarterly payment of 9,000')
# when it falls due it posts itself as an ordinary expense: Dr rent + input VAT / Cr bank
due=c('/recurring',{'kind':'EXPENSE','name':'إيجار مكتب (مستحق اليوم)','frequency':'MONTHLY','nextDate':dt,'payload':{'accountId':K['RENT']['id'],'amount':2000,'taxCode':'S','payAccountId':K['BANK']['id'],'payee':'المؤجر','description':'إيجار المكتب'}})
r0,b0,v0=bal('RENT'),bal('BANK'),bal('VAT_IN'); out=c('/recurring/run',{})
ok(len([x for x in out if not x.get('error')])==1 and near(bal('RENT')-r0,2000) and near(bal('VAT_IN')-v0,2000*R) and near(b0-bal('BANK'),2000*(1+R)),'due today: posted as an expense — Dr rent 2,000 + input VAT / Cr bank')
rows=c('/recurring'); mine=[x for x in rows if x['id']==due['id']][0]
ok(mine['runs']==1 and str(mine['nextDate'])[:10]>dt,'and its next date moves a month ahead')
tb=c('/reports/trial-balance?from=2000-01-01&to=2099-12-31'); ok(tb['balanced'] and c('/reports/integrity')['ok'],'trial balance balanced and sub-ledgers tied')
print('FAILS', len(lib.fails)); sys.exit(1 if lib.fails else 0)
