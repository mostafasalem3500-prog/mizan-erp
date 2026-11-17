import sys, os, time, datetime; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
EG='3200' in B
t=register('r313'); c=lambda *a,**k: call(*a,tok=t,**k)
m=time.strftime('%Y-%m'); y=time.strftime('%Y'); D=lambda n: f'{m}-{n:02d}'
fri=next(n for n in range(1,8) if datetime.date(int(y),int(m[5:]),n).weekday()==4)
wd=[n for n in range(1,12) if datetime.date(int(y),int(m[5:]),n).weekday()!=4][:4]; d1,d2,d3,d4=wd
nat='EGYPTIAN' if EG else 'SAUDI'
e1=c('/employees',{'name':'أحمد','nationality':nat,'hireDate':f'{y}-01-01','basic':6000,'housing':1500,'transport':500,'otherAllow':0,'gosi':True})
e2=c('/employees',{'name':'سالم','nationality':'NON_SAUDI','hireDate':f'{y}-01-01','basic':3000,'housing':0,'transport':0,'otherAllow':0,'gosi':False})
S=lambda: {e['name']:e for e in c(f'/attendance?period={m}')['employees']}
sh=c(f'/attendance?period={m}'); s=sh['settings']
ok(s['workStart']=='08:00' and s['workHours']==8 and s['graceMinutes']==10 and s['weekend']==[5],'default working hours 08:00 × 8h, grace 10 min, Friday off')
ok(len(sh['employees'])==2 and next(x for x in sh['days'] if x['date']==D(fri))['off'] and not sh['days'][wd[0]-1]['off'],'month sheet lists employees and marks Fridays as rest days')
put=lambda n,rows: c('/attendance/day',{'date':D(n),'rows':rows},m='PUT')
put(d1,[{'employeeId':e1['id'],'status':'PRESENT','timeIn':'08:05','timeOut':'16:00'},{'employeeId':e2['id'],'status':'PRESENT','timeIn':'08:30','timeOut':'18:00'}])
x=S(); a=x['أحمد']['days'][D(d1)]; b=x['سالم']['days'][D(d1)]
ok(a['late']==0 and a['overtime']==0 and a['hours']==7.92,'5 minutes late is inside the grace period')
ok(b['late']==30 and b['overtime']==1.5 and b['hours']==9.5,'30 minutes late counted; 9.5h worked → 1.5h overtime')
put(d2,[{'employeeId':e1['id'],'status':'ABSENT'},{'employeeId':e2['id'],'status':'PRESENT','timeIn':'08:00','timeOut':'16:20'}])
ok(S()['سالم']['days'][D(d2)]['overtime']==0,'20 extra minutes are below the overtime threshold')
put(fri,[{'employeeId':e1['id'],'status':'PRESENT','timeIn':'09:00','timeOut':'13:00'}])
f=S()['أحمد']['days'][D(fri)]; ok(f['overtime']==4 and f['late']==0,'work on a rest day is all overtime, no lateness')
put(d3,[{'employeeId':e2['id'],'status':'PRESENT','timeIn':'22:00','timeOut':'06:00'}]); ok(S()['سالم']['days'][D(d3)]['hours']==8,'a shift past midnight is 8 hours')
put(d3,[{'employeeId':e2['id'],'status':''}]); ok(D(d3) not in S()['سالم']['days'],'clearing the status removes the record')
for body,why in [({'date':'2999-01-01','rows':[]},'future day'),({'date':D(d1),'rows':[{'employeeId':e1['id'],'status':'PRESENT','timeIn':'25:99','timeOut':'16:00'}]},'bad time')]:
    try: c('/attendance/day',body,m='PUT'); ok(False,why)
    except E as e: ok('400' in str(e),why+' → refused')
r=c('/attendance/import',{'rows':[{'code':e2['code'],'date':f'{d3:02d}/{m[5:]}/{y}','timeIn':'8:45 AM','timeOut':'5:00 PM'},{'code':e1['code'],'date':D(d3),'timeIn':'','timeOut':''},{'name':'أحمد','date':D(d4),'timeIn':0.3333333,'timeOut':0.6666667},{'code':'ZZZ','date':D(d3),'timeIn':'08:00','timeOut':'16:00'},{'code':e1['code'],'date':'2999-01-01','timeIn':'08:00','timeOut':'16:00'}]})
ok(r['saved']==3 and r['skipped']==2 and 'ZZZ' in r['errors'][0],f"import: 3 saved, unknown employee and future date skipped ({r['errors'][0]})")
x=S(); i=x['سالم']['days'][D(d3)]; ok(i['timeIn']=='08:45' and i['timeOut']=='17:00' and i['late']==45 and i['overtime']==0 and i['hours']==8.25,'imported dd/mm/yyyy date and AM/PM times; 45 min late, 15 extra minutes not overtime')
ok(x['أحمد']['days'][D(d3)]['status']=='ABSENT' and x['أحمد']['days'][D(d4)]['timeIn']=='08:00','row with no times = absent; Excel time fractions read')
sa=x['أحمد']['summary']; ss=x['سالم']['summary']; print(sa,ss)
ok(sa['absent']==2 and sa['overtimeHours']==4 and sa['lateMinutes']==0 and sa['present']==3,'month summary — أحمد: 2 absent, 4h overtime')
ok(ss['lateMinutes']==75 and ss['lateDays']==2 and ss['overtimeHours']==1.5,'month summary — سالم: 75 min late in 2 days, 1.5h overtime')
p=c('/attendance/post',{'period':m}); ok(p['created']==4,'posting creates 4 payroll transactions')
I=lambda: c(f'/payroll-items?period={m}')['rows']; it={(next(n for n,e in (('أحمد',e1),('سالم',e2)) if e['id']==i_['employeeId']),i_['kind']):i_ for i_ in I()}
F=1.35 if EG else 1.5
ok(float(it[('أحمد','ABSENCE')]['amount'])==round(2*8000/30,2) and float(it[('أحمد','ABSENCE')]['qty'])==2,'absence 2 days = 533.33')
ok(float(it[('سالم','LATE')]['amount'])==15.63,'lateness 75 min = 1.25h × hourly wage = 15.63')
ok(float(it[('أحمد','OVERTIME')]['amount'])==round(4*(8000+(F-1)*6000)/240,2) and float(it[('سالم','OVERTIME')]['qty'])==1.5,'overtime valued with the legal factor')
man=c('/payroll-items',{'employeeId':e1['id'],'kind':'BONUS','date':D(d1),'amount':300})
ok(c('/attendance/post',{'period':m})['created']==4 and len(I())==5,'posting again replaces the attendance transactions and keeps manual ones')
put(d2,[{'employeeId':e1['id'],'status':'LEAVE'}]); c('/attendance/post',{'period':m}); ab=[i_ for i_ in I() if i_['kind']=='ABSENCE'][0]
ok(float(ab['qty'])==1 and S()['أحمد']['summary']['leave']==1,'day changed to leave → absence drops to 1 day after re-posting')
ns=c('/attendance/settings',{'graceMinutes':60,'workHours':9,'weekend':[5,6]},m='PUT'); ok(ns['graceMinutes']==60 and ns['workHours']==9 and ns['weekend']==[5,6] and ns['workStart']=='08:00','settings saved')
put(d1,[{'employeeId':e2['id'],'status':'PRESENT','timeIn':'08:30','timeOut':'18:00'}]); b=S()['سالم']['days'][D(d1)]; ok(b['late']==0 and b['overtime']==0.5,'new settings apply to days saved afterwards')
try: c('/attendance/settings',{'workHours':30},m='PUT'); ok(False,'bad hours')
except E as e: ok('400' in str(e),'working day over 16 hours refused')
ok(c(f'/attendance?period={m}')['posted']=={'open':4,'included':0},'sheet reports 4 open posted transactions')
run=c('/payroll',{'period':m}); L={l['name']:l for l in run['lines']}
ok(L['أحمد']['absence']==266.67 and L['سالم']['deduction']==15.63 and L['سالم']['overtime']>0,'payroll run picks up the attendance transactions')
try: c('/attendance/post',{'period':m}); ok(False,'post after run')
except E as e: ok('409' in str(e),'re-posting refused once the transactions are inside a run')
try: c('/attendance?period=2026'); ok(False,'bad period')
except E as e: ok('400' in str(e),'bad month refused')
import lib; print("FAILS",lib.fails); sys.exit(1 if lib.fails else 0)
