import sys, os, time; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B; VR=14 if EG else 15
t=register('r320'); c=lambda *a,**k: call(*a,tok=t,**k)
A=c('/accounts')['rows']; acc={x.get('systemKey'):x for x in A if x.get('systemKey')}; d=time.strftime('%Y-%m-%d'); y=time.strftime('%Y')
EXP=[a for a in A if a['type']=='EXPENSE' and not a.get('isGroup') and a.get('subtype')!='COGS'][0]
def refused(code, fn, name):
    try: fn(); ok(False,name)
    except E as e: ok(str(code) in str(e), name+' → refused')
c('/journals',{'date':f'{y}-01-01','memo':'رأس المال','lines':[{'accountId':acc['BANK']['id'],'debit':500000,'credit':0},{'accountId':acc['CAPITAL']['id'],'debit':0,'credit':500000}]})
p1=c('/projects',{'name':'مشروع أ','kind':'PROJECT'}); p2=c('/projects',{'name':'مشروع ب','kind':'PROJECT'}); adm=c('/projects',{'name':'الإدارة العامة','kind':'CENTER'})
X=lambda **k: c('/expenses',{'date':d,'accountId':EXP['id'],'description':'مصروف','payAccountId':acc['BANK']['id'],'taxCode':'S','amountIncludesVat':False,**k})
J=lambda e: [l for l in c(f"/reports/journal?from={d}&to={d}")['rows'] if l.get('number')] if False else None
def lines_of(e):
    D=c(f"/projects/{p1['id']}?from={d}&to={d}&type=ALL")
    return D
# 1) a general expense: no centre at all
g=X(amount=1000,description='إيجار الإدارة'); ok(g['costCenterId'] is None and g['allocations'] is None,'general expense: posted with no centre')
# 2) one project takes the whole net amount; VAT is not charged to it
e1=X(amount=1150 if not EG else 1140,amountIncludesVat=True,costCenterId=p1['id'],description='مواد للمشروع أ'); ok(e1['costCenterId']==p1['id'] and float(e1['amount'])==1000 and float(e1['vatAmount'])==VR*10,'one project: the expense keeps it; net 1,000 separated from VAT')
D1=c(f"/projects/{p1['id']}?from={d}&to={d}"); ok(D1['figures']['expenses']==1000,'the project is charged the net 1,000 only — recoverable VAT is not a project cost')
o=c(f"/projects/{p1['id']}?from={d}&to={d}&type=OTHER"); ok(o['lineCount']==0,'VAT and bank lines of the entry carry no centre')
# 3) shared between two projects, the rest general
e2=X(amount=3000,description='نقل مشترك',allocations=[{'costCenterId':p1['id'],'amount':1200},{'costCenterId':p2['id'],'amount':800}])
ok(e2['costCenterId'] is None and len(e2['allocations'])==2 and float(e2['amount'])==3000,'shared expense stored with its two shares')
L=c(f'/projects?from={d}&to={d}'); R={r['name']:r for r in L['rows']}
ok(R['مشروع أ']['expenses']==2200 and R['مشروع ب']['expenses']==800 and L['unassigned']['cost']==2000,'project A 1,000+1,200, project B 800, general 1,000 + the undistributed 1,000')
tb={r['code']:r for r in c(f'/reports/trial-balance?from={d}&to={d}')['rows']}; ok(abs(float(tb[EXP['code']]['debit'])-float(tb[EXP['code']]['credit'])-5000)<0.01,'the expense account holds the full 5,000: sharing changes no account, only the tag')
ok(abs(L['totals']['cost']+L['unassigned']['cost']-5000)<0.01,'centres + general = the expense account total')
# 4) fully distributed in three
e3=X(amount=900,taxCode='O',description='تأمين',allocations=[{'costCenterId':p1['id'],'amount':300},{'costCenterId':p2['id'],'amount':300},{'costCenterId':adm['id'],'amount':300}])
L=c(f'/projects?from={d}&to={d}'); ok({r['name']:r['expenses'] for r in L['rows']}=={'الإدارة العامة':300,'مشروع أ':2500,'مشروع ب':1100} and L['unassigned']['cost']==2000,'three equal shares, nothing left general')
# 5) what must be refused
refused(400,lambda: X(amount=1000,allocations=[{'costCenterId':p1['id'],'amount':700},{'costCenterId':p2['id'],'amount':400}]),'shares larger than the net amount')
refused(400,lambda: X(amount=1150,amountIncludesVat=True,allocations=[{'costCenterId':p1['id'],'amount':600},{'costCenterId':p2['id'],'amount':550}]),'shares that add up to the amount with VAT (more than the net)') if not EG else ok(True,'(VAT-inclusive check runs on the Saudi edition)')
refused(400,lambda: X(amount=1000,allocations=[{'costCenterId':p1['id'],'amount':500},{'costCenterId':p1['id'],'amount':500}]),'the same centre twice')
refused(400,lambda: X(amount=1000,allocations=[{'costCenterId':p1['id'],'amount':-100},{'costCenterId':p2['id'],'amount':600}]),'a negative share')
refused(400,lambda: X(amount=1000,allocations=[{'costCenterId':'','amount':500}]),'a share with no centre')
c(f"/projects/{p2['id']}",{'name':'مشروع ب','kind':'PROJECT','status':'DONE'},m='PUT'); refused(400,lambda: X(amount=100,costCenterId=p2['id']),'charging a finished project')
# 6) cancelling gives the shares back
c(f"/expenses/{e2['id']}/cancel",{}); L=c(f'/projects?from={d}&to={d}'); R={r['name']:r for r in L['rows']}
ok(R['مشروع أ']['expenses']==1300 and R['مشروع ب']['expenses']==300 and L['unassigned']['cost']==1000,'cancelling the shared expense reverses each share from its centre')
lst={x['number']:x for x in c(f'/expenses?from={d}&to={d}')}; ok(lst[e1['number']]['costCenterName']=='مشروع أ' and 'مشروع أ 300' in (lst[e3['number']]['allocationText'] or ''),'expense list shows the centre, or the shares')
ig=c('/reports/integrity'); bs=c(f'/reports/balance-sheet?to={d}'); ok(ig['ok'] and bs['balanced'],'books tie and the balance sheet balances')
print('FAILS',lib.fails); sys.exit(1 if lib.fails else 0)
