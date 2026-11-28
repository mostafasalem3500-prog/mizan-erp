"""Full-cycle audit across the sections: one establishment trades for a year through purchases, recipe sales, bulk
production and its write-off, a manufacturing order, payroll, an asset and its depreciation; every figure is followed
to the ledger, the sub-ledgers are tied to their accounts, a month is locked, the year is closed, reopened and closed
again, and the new year opens clean. Then rentals and subscriptions in the new year keep the books tied."""
import sys, os, time, datetime; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B; R=0.14 if EG else 0.15
t=register('cycle'); c=lambda *a,**k: call(*a,tok=t,**k)
Y=int(time.strftime('%Y'))-1; N=Y+1; today=time.strftime('%Y-%m-%d')
A=c('/accounts')['rows']; acc={x.get('systemKey'):x for x in A if x.get('systemKey')}
ADDR={'street':'طريق الملك فهد','buildingNo':'1234','district':'العليا','city':'الرياض','postalCode':'12211','phone':'0501234567'}
def tbal(key, frm=f'{Y}-01-01', to=today):
    rows=c(f'/reports/trial-balance?from={frm}&to={to}')['rows']; a=acc.get(key)
    return round(sum(float(x['debit'])-float(x['credit']) for x in rows if a and x['code']==a['code']),2)
def refused(code, fn, name, has=None):
    try: fn(); ok(False,name)
    except E as e: ok(str(code) in str(e) and (has is None or has in str(e)), name+' → refused')
def je(date, lines, memo='قيد'): return c('/journals',{'date':date,'memo':memo,'lines':[{'accountId':a,'debit':dr,'credit':cr} for a,dr,cr in lines]})
def inv(direction,pid,lines,date,**k):
    x=c('/invoices',{'direction':direction,'kind':'INVOICE','date':date,'partnerId':pid,'lines':lines,**k}); return c(f"/invoices/{x['id']}/post",{})
P=lambda: {p['sku']:p for p in c('/products?limit=500&active=all')}
def tied(tag):
    it=c('/reports/integrity'); bad=[x['name'] for x in (it.get('checks') or []) if not x['ok']]
    tb=c(f'/reports/trial-balance?from={Y}-01-01&to={today}'); bs=c(f'/reports/balance-sheet?to={today}')
    ok(not bad and tb['balanced'] and bs['balanced'], f'{tag}: integrity, trial balance and balance sheet all tie '+str(bad[:3]))
    ok(near(sum(float(p['stockValue']) for p in P().values()), tbal('INVENTORY'), 0.05), f'{tag}: stock valuation = the inventory account')

# ═══ the year's operations ═══
je(f'{Y}-01-01',[(acc['BANK']['id'],500000,0),(acc['CAPITAL']['id'],0,500000)],'رأس المال')
sup=c('/partners',{'name':'مورد','isSupplier':True,'kind':'COMPANY','vatNumber':'300000000000003' if not EG else '200000001',**ADDR})
cu=c('/partners',{'name':'زبون','isCustomer':True,'kind':'INDIVIDUAL','phone':'0501234567'})
comp=lambda n,s,pp,u='كجم': c('/products',{'name':n,'sku':s,'buyRoles':['COMPONENT'],'saleClass':None,'purchasePrice':pp,'taxCode':'S','unit':u})
ck=comp('دجاج','CK',20); sp=comp('بهارات','SP',40); bd=comp('خبز','BD',0.5,'حبة')
pi=inv('PURCHASE',sup['id'],[{'productId':ck['id'],'qty':100,'unitPrice':20,'taxCode':'S'},{'productId':sp['id'],'qty':10,'unitPrice':40,'taxCode':'S'},{'productId':bd['id'],'qty':500,'unitPrice':0.5,'taxCode':'S'}],f'{Y}-11-01')
ok(near(tbal('INVENTORY'),2650) and near(tbal('AP'),-round(2650*(1+R),2)) and near(tbal('VAT_IN'),round(2650*R,2)),'purchase: Dr inventory 2,650 + input VAT / Cr supplier')
# a recipe item taken on sale: 0.1 kg chicken + 1 bread = 2.50 a sandwich
sw=c('/products',{'name':'ساندوتش','sku':'SW','buyRoles':[],'saleClass':'RECIPE','salePrice':15,'taxCode':'S','unit':'حبة'})
c(f"/products/{sw['id']}/recipe",{'lines':[{'componentId':ck['id'],'qty':0.1},{'componentId':bd['id'],'qty':1}],'outputQty':1,'method':'DIRECT'},'PUT')
inv('SALE',cu['id'],[{'productId':sw['id'],'qty':10,'unitPrice':15,'taxCode':'S'}],f'{Y}-11-05')
ok(near(tbal('COGS'),25) and near(tbal('INVENTORY'),2625) and near(tbal('SALES'),-150) and near(tbal('AR'),round(150*(1+R),2)) and near(tbal('VAT_OUT'),-round(150*R,2)),'recipe sale: Dr customer / Cr sales 150 + output VAT; Dr cost of sales 25 / Cr inventory')
# bulk production: 10 chicken + 0.5 spice → 6.4 kg for 220, no entry; 1.4 kg written off
shw=c('/products',{'name':'شاورما','sku':'SHW','buyRoles':[],'saleClass':'RECIPE','unit':'كجم','taxCode':'S'})
c(f"/products/{shw['id']}/recipe",{'lines':[{'componentId':ck['id'],'qty':10},{'componentId':sp['id'],'qty':0.5}],'outputQty':6.5,'method':'BATCH'},'PUT')
inv0=tbal('INVENTORY'); b=c('/prep-batches',{'productId':shw['id'],'inputQty':10.5,'outputQty':6.4,'date':f'{Y}-11-10'})
ok(near(b['cost'],220) and near(tbal('INVENTORY'),inv0),'production: value moves inside inventory, the account does not change')
ssw=c('/products',{'name':'ساندوتش شاورما','sku':'SSW','buyRoles':[],'saleClass':'RECIPE','salePrice':12,'taxCode':'S','unit':'حبة'})
c(f"/products/{ssw['id']}/recipe",{'lines':[{'componentId':shw['id'],'qty':0.1},{'componentId':bd['id'],'qty':1}],'outputQty':1,'method':'DIRECT'},'PUT')
inv('SALE',cu['id'],[{'productId':ssw['id'],'qty':50,'unitPrice':12,'taxCode':'S'}],f'{Y}-11-10')      # 5 kg shawarma (171.875) + 50 bread (25)
ok(near(tbal('COGS'),25+171.88+25,0.02),'sale from the produced batch: cost of sales at the batch cost')
L=c(f'/preps/leftovers?date={Y}-11-10'); r=[x for x in L['rows'] if x['productId']==shw['id']][0]
ok(near(r['left'],1.4) and near(r['sold'],5),'day close: 6.4 produced, 5 sold, 1.4 left')
w=c('/preps/leftovers/waste',{'date':f'{Y}-11-10','lines':[{'productId':shw['id'],'warehouseId':r['warehouseId']}]})
ok(near(tbal('INV_LOSS'),48.13,0.02) and near(P()['SHW']['qty'],0),'write-off: Dr stock loss and damage 48.13 / Cr inventory; nothing left')
# manufacturing: 10 frozen meals, 0.5 kg chicken each
fz=c('/products',{'name':'وجبة مجمدة','sku':'FZ','type':'STOCK','salePrice':50,'taxCode':'S','unit':'حبة'})
c('/mfg/boms',{'productId':fz['id'],'outputQty':1,'lines':[{'componentId':ck['id'],'qty':0.5}]})
mo=c('/mfg/orders',{'productId':fz['id'],'qty':10,'confirm':True,'date':f'{Y}-11-12','dueDate':f'{Y}-11-15'})
inv1=tbal('INVENTORY'); c(f"/mfg/orders/{mo['id']}/issue",{'all':True,'date':f'{Y}-11-12'})
ok(near(tbal('WIP'),100) and near(tbal('INVENTORY'),inv1-100),'manufacturing issue: Dr work in progress 100 / Cr inventory')
c(f"/mfg/orders/{mo['id']}/produce",{'qty':10,'date':f'{Y}-11-13'})
ok(near(tbal('WIP'),0) and near(tbal('INVENTORY'),inv1) and near(float(P()['FZ']['stockValue']),100),'manufacturing receipt: work in progress cleared into finished goods at 100')
# payroll, rent, an asset and its depreciation
c('/employees',{'name':'عامل','basic':4000,'gosi':False})
run=c('/payroll',{'period':f'{Y}-11'})
try: c(f"/payroll/{run['id']}/approve",{})
except E: pass
pr=c(f"/payroll/{run['id']}/post",{})
ok(near(tbal('SALARIES'),4000) and near(tbal('SALARIES_PAYABLE'),-4000),'payroll: Dr salaries 4,000 / Cr salaries payable')
je(f'{Y}-11-20',[(acc['RENT']['id'],3000,0),(acc['BANK']['id'],0,3000)],'إيجار')
c('/assets',{'name':'فرن','acquisitionDate':f'{Y}-10-01','cost':12000,'usefulLifeMonths':24,'payAccountId':acc['BANK']['id']})
c('/assets/depreciate',{'through':f'{Y}-12-31'})
dep=tbal('DEPRECIATION'); ok(near(dep,1500) and near(tbal('ACCUM_DEPRECIATION'),-1500),f'depreciation: three months at 500 → 1,500 ({dep})')
tied('after the year\'s operations')
# ═══ results before closing ═══
exp_net=round(150+600-(25+171.88+25)-48.13-4000-3000-1500,2)
isY=c(f'/reports/income-statement?from={Y}-01-01&to={Y}-12-31'); net=float(isY.get('netIncome', isY.get('net', 0)) if not isinstance(isY.get('totals'),dict) else isY['totals'].get('netIncome', isY['totals'].get('net', 0)))
ok(near(net,exp_net,0.03),f'income statement for the year: net result {net} = worked by hand {exp_net}')
# ═══ a month locked ═══
periods=c('/periods'); periods=periods.get('periods') or periods.get('rows') or periods if isinstance(periods,dict) else periods
nov=[p for p in periods if str(p.get('startDate') or p.get('start_date') or p.get('from'))[:7]==f'{Y}-11'][0]
ck_=c(f"/closing?periodId={nov['id']}"); ok(isinstance(ck_.get('items') or ck_.get('checks'),list),'month-close cockpit lists its checks')
try: c(f"/closing/{nov['id']}/lock",{})
except E: c(f"/closing/{nov['id']}/lock",{'force':True})
refused(409,lambda: je(f'{Y}-11-25',[(acc['RENT']['id'],1,0),(acc['BANK']['id'],0,1)]),'posting into the locked month')
refused(409,lambda: inv('SALE',cu['id'],[{'productId':sw['id'],'qty':1,'unitPrice':15,'taxCode':'S'}],f'{Y}-11-26'),'an invoice dated in the locked month')
# ═══ the year closed, reopened, closed ═══
years=c('/fiscal-years')['years']; fy=[y for y in years if y['name']==str(Y)][0]
ck_=c(f"/fiscal-years/{fy['id']}/close-check"); blocks=[i['key'] for i in ck_['items'] if i['level']=='block']
ok(ck_['canClose'] and not blocks and near(ck_['preview']['netIncome'],exp_net,0.03) and near(ck_['preview']['debit'],ck_['preview']['credit']),f'close-check: nothing blocks, the closing entry is balanced and carries {exp_net} '+str(blocks))
fa=c('/reports/final-accounts?fiscalYearId='+fy['id']); ok(fa['ok'],'final accounts before closing: every linkage check '+str([x['name'] for x in fa['checks'] if not x['ok']]))
r=c(f"/fiscal-years/{fy['id']}/close",{}); ok(near(r['netIncome'],exp_net,0.03) and r['nextYear']['name']==str(N),'the year is closed and the next one opened')
fa=c('/reports/final-accounts?fiscalYearId='+fy['id']); eq=fa['equity']['closing']
ok(fa['ok'] and near(eq['retained'],exp_net,0.03) and near(eq['result'],0) and near(eq['total'],500000+exp_net,0.03),'after closing: the result sits in retained earnings, equity = capital + result')
ok(near(fa['incomeStatement']['totals']['net'][0],exp_net,0.03),'the income statement of the closed year still shows its result')
refused(409,lambda: je(f'{Y}-12-15',[(acc['RENT']['id'],1,0),(acc['BANK']['id'],0,1)]),'posting into the closed year')
isN=c(f'/reports/income-statement?from={N}-01-01&to={today}'); netN=float(isN.get('netIncome', isN.get('net', 0)) if not isinstance(isN.get('totals'),dict) else isN['totals'].get('netIncome', isN['totals'].get('net', 0)))
ok(near(netN,0),'the new year opens with no result carried in its income statement')
bsY=c(f'/reports/balance-sheet?to={Y}-12-31'); bsN=c(f'/reports/balance-sheet?to={today}')
ok(bsY['balanced'] and bsN['balanced'] and near(bsY['totalAssets'],bsN['totalAssets']),'the balance sheet carries forward unchanged into the new year')
c(f"/fiscal-years/{fy['id']}/reopen",{}); fa=c('/reports/final-accounts?fiscalYearId='+fy['id'])
ok(near(fa['equity']['closing']['retained'],0) and near(fa['equity']['closing']['result'],exp_net,0.03),'reopened: the closing entry is undone, the result is current again')
r=c(f"/fiscal-years/{fy['id']}/close",{}); ok(near(r['netIncome'],exp_net,0.03),'closed again with the same result')
tied('after closing')
# ═══ the new year: rentals and subscriptions ═══
D=lambda n=0: (datetime.date.today()+datetime.timedelta(days=n)).isoformat()
if D(-3)[:4]==str(N):
    car=c('/rentals/assets',{'name':'سيارة','kind':'VEHICLE','rateDay':200})
    rc=c('/rentals/contracts',{'partnerId':cu['id'],'startDate':D(-3),'endDate':D(-1),'lines':[{'assetId':car['id']}],'reserve':True})
    c(f"/rentals/contracts/{rc['id']}/deliver",{'date':D(-3),'lines':[{'assetId':car['id']}]})
    rr=tbal('RENTAL_REVENUE',f'{N}-01-01'); acc.update({x.get('systemKey'):x for x in c('/accounts')['rows'] if x.get('systemKey')}); rr=tbal('RENTAL_REVENUE',f'{N}-01-01')
    ok(rr<0,f'rental delivered: revenue invoiced to the rental revenue account ({rr})')
    plan=c('/subs/plans',{'name':'شهري','period':'MONTH','price':300}); c('/subs',{'partnerId':cu['id'],'planId':plan['id']})
    acc.update({x.get('systemKey'):x for x in c('/accounts')['rows'] if x.get('systemKey')})
    ok(near(tbal('SUBSCRIPTION_REVENUE',f'{N}-01-01'),-300),'subscription: the first month invoiced to subscription revenue')
    tied('after rentals and subscriptions in the new year')
print('FAILS', lib.fails); sys.exit(1 if lib.fails else 0)
