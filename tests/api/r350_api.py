"""3.50: manufacturing completed — frozen standard cost, QC criteria with limits, an outside workshop's invoice into
WIP, serial numbers per piece and traceability both ways, hours by operator; and rentals — best-rate pricing, no
double booking, deposits as a liability, up-front and monthly billing, extension, late return with charges, deposit
applied to the invoices, maintenance windows, the calendar and the reports — every figure checked by hand."""
import sys, os, time; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib, datetime
EG='3200' in B; R=0.14 if EG else 0.15
t=register('r350'); c=lambda *a,**k: call(*a,tok=t,**k)
A=c('/accounts')['rows']; acc={x.get('systemKey'):x for x in A if x.get('systemKey')}; d=time.strftime('%Y-%m-%d'); y=time.strftime('%Y')
D=lambda n: (datetime.date.today()+datetime.timedelta(days=n)).isoformat()
ADDR={'street':'طريق الملك فهد','buildingNo':'1234','district':'العليا','city':'الرياض','postalCode':'12211','phone':'0501234567'}
def refused(code, fn, name, has=None):
    try: fn(); ok(False,name)
    except E as e: ok(str(code) in str(e) and (has is None or has in str(e)), name+' → refused '+('' if has is None or has in str(e) else str(e)[:160]))
def bal(key):
    a={x.get('systemKey'):x for x in c('/accounts')['rows'] if x.get('systemKey')}.get(key)
    return round(sum(float(x['debit'])-float(x['credit']) for x in c('/reports/trial-balance?from=2000-01-01&to=2099-12-31')['rows'] if a and x['code']==a['code']),2)
c('/journals',{'date':f'{y}-01-01','memo':'رأس المال','lines':[{'accountId':acc['BANK']['id'],'debit':200000,'credit':0},{'accountId':acc['CAPITAL']['id'],'debit':0,'credit':200000}]})
sup=c('/partners',{'name':'مورد الخشب','isSupplier':True,'kind':'COMPANY','vatNumber':'300000000000003' if not EG else '200000001',**ADDR})
shop=c('/partners',{'name':'ورشة الدهان الخارجية','isSupplier':True,'kind':'COMPANY','vatNumber':'300000000000003' if not EG else '200000001',**ADDR})
cu=c('/partners',{'name':'عميل التأجير','isCustomer':True,'kind':'INDIVIDUAL','phone':'0501234567'})
buy=lambda lines: c(f"/invoices/{c('/invoices',{'direction':'PURCHASE','kind':'INVOICE','date':d,'partnerId':sup['id'],'lines':lines})['id']}/post",{})

# ═══════════ manufacturing: what 3.49 left ═══════════
leg=c('/products',{'name':'رجل كرسي','sku':'CL','type':'STOCK','purchasePrice':20,'taxCode':'S','unit':'حبة','trackLots':True})
chair=c('/products',{'name':'كرسي','sku':'CH','type':'STOCK','purchasePrice':0,'salePrice':200,'taxCode':'S','unit':'حبة','trackLots':True})
buy([{'productId':leg['id'],'qty':10,'unitPrice':20,'taxCode':'S','lotNo':'LOT-A'}])
asm=c('/mfg/work-centers',{'name':'تجميع','rateHour':40,'overheadHour':20}); out=c('/mfg/work-centers',{'name':'دهان خارجي','kind':'OUTSOURCE','rateHour':0,'overheadHour':0})
refused(400,lambda: c('/mfg/boms',{'productId':chair['id'],'lines':[{'componentId':leg['id'],'qty':2}],'ops':[{'seq':10,'name':'تجميع','workCenterId':asm['id'],'runMin':30,'qc':True,'checks':[{'name':'الطول','min':92,'max':90}]}]}),'QC limits the wrong way round','معكوسان')
bom=c('/mfg/boms',{'productId':chair['id'],'lines':[{'componentId':leg['id'],'qty':2}],'ops':[{'seq':10,'name':'تجميع','workCenterId':asm['id'],'runMin':30,'checks':[{'name':'الطول','min':90,'max':92,'unit':'سم'},{'name':'ثابت بلا اهتزاز'}]},{'seq':20,'name':'دهان','workCenterId':out['id'],'runMin':0}]})
ok(bom['ops'][0]['qc'] and len(bom['ops'][0]['checks'])==2 and near(bom['cost']['unitCost'],70),'stage with two QC criteria (a measured one and a yes/no one); standard 2 × 20 + 30 min × 60/h = 70')
fz=c(f"/mfg/boms/{bom['id']}/freeze",{}); ok(near(fz['frozenCost'],70) and fz['frozenAt'],'standard cost frozen at 70')
buy([{'productId':leg['id'],'qty':10,'unitPrice':26,'taxCode':'S','lotNo':'LOT-B'}])
bl=[b for b in c('/mfg/boms') if b['id']==bom['id']][0]; ok(near(bl['unitCost'],76) and near(bl['frozenCost'],70) and near(bl['drift'],round(6/70*100,2)),f"legs now average 23: current cost 76, frozen 70, drift {bl['drift']}%")
mo=c('/mfg/orders',{'productId':chair['id'],'qty':3,'confirm':True}); ok(near(mo['stdUnitCost'],70),'the order is measured against the frozen standard 70')
mo=c(f"/mfg/orders/{mo['id']}/issue",{'all':True}); ok(near(mo['wip'],138),'6 legs at the average 23 = 138 in WIP')
refused(400,lambda: c(f"/mfg/orders/{mo['id']}/ops/10",{'action':'finish','minutes':30,'qcResults':[{'name':'الطول','value':91}]}),'a criterion left unmeasured','ثابت')
mo=c(f"/mfg/orders/{mo['id']}/ops/10",{'action':'finish','minutes':30,'operator':'سعيد','qcResults':[{'name':'الطول','value':93},{'name':'ثابت بلا اهتزاز','value':'نعم'}]})
op=mo['ops'][0]; ok(op['status']=='FAILED' and op['qcResult']=='FAIL' and not op['qcResults'][0]['ok'] and op['qcResults'][1]['ok'],'93 cm is outside 90–92: the stage fails on its own')
mo=c(f"/mfg/orders/{mo['id']}/ops/10",{'action':'finish','minutes':30,'operator':'سعيد','qcResults':[{'name':'الطول','value':91},{'name':'ثابت بلا اهتزاز','value':'نعم'}]})
ok(mo['ops'][0]['status']=='DONE' and near(mo['wip'],198),'reworked: 91 cm passes; 2 × 30 min = 60 → WIP 198')
ap0=bal('AP'); vi0=bal('VAT_IN')
mo=c(f"/mfg/orders/{mo['id']}/ops/20",{'action':'subcontract','supplierId':shop['id'],'amount':45,'ref':'W-77','finish':True})
ok(near(mo['wip'],243) and mo['ops'][1]['status']=='DONE' and near(mo['ops'][1]['subcontracted'],45),'outside painting invoice 45 joins the order: WIP 243, stage done')
ok(near(bal('AP')-ap0,-round(45*(1+R),2)) and near(bal('VAT_IN')-vi0,round(45*R,2)) and near(bal('WIP'),243),f"the purchase invoice: Dr WIP 45 + input VAT / Cr the workshop {round(45*(1+R),2)}")
refused(409,lambda: c(f"/mfg/orders/{mo['id']}/cancel",{}),'cancelling an order with an outside invoice','ورشة خارجية')
mo=c(f"/mfg/orders/{mo['id']}/produce",{'qty':3,'serialize':True})
rc=[m for m in mo['moves'] if m['kind']=='RECEIPT'][0]
ok(mo['status']=='DONE' and near(mo['sheet']['actualUnitCost'],81) and rc['serials']==[f"{mo['number']}-001",f"{mo['number']}-002",f"{mo['number']}-003"],'3 chairs at 81 (243 / 3), each with its own serial number')
lots={l['lotNo']:l for l in c(f"/lots?productId={chair['id']}")['rows']} if isinstance(c(f"/lots?productId={chair['id']}"),dict) else {}
s=c('/invoices',{'direction':'SALE','kind':'INVOICE','date':d,'partnerId':cu['id'],'lines':[{'productId':chair['id'],'qty':1,'unitPrice':200,'taxCode':'S'}]}); c(f"/invoices/{s['id']}/post",{})
tr=c(f"/mfg/trace?lot={mo['number']}-001")
og=tr['origins'][0]; comp=og['components'][0]
ok(tr['found'] and og['order']['number']==mo['number'] and 'سعيد' in og['operators'] and og['qc'][0]['result']=='PASS',f"trace backwards: the order, its operator and the QC result")
ok({l['lotNo'] for l in comp['lots']}>={'LOT-A'} and any(x['supplier']=='مورد الخشب' for x in comp['suppliers']),f"…and the leg lots used with their supplier ({[l['lotNo'] for l in comp['lots']]})")
ok(tr['soldTo'] and tr['soldTo'][0]['number']==c(f"/invoices/{s['id']}")['number'],'trace forwards: the customer invoice that took serial 001')
tl=c('/mfg/trace?lot=LOT-A'); ok(any(x['number']==mo['number'] for x in tl['consumedBy']),'a raw material lot traced to the order that used it (for a recall)')
refused(409,lambda: c(f"/mfg/orders/{mo['id']}/produce",{'qty':1}),'receiving on a finished order')
m2=c('/mfg/orders',{'productId':chair['id'],'qty':1,'confirm':True}); c(f"/mfg/orders/{m2['id']}/issue",{'all':True}); c(f"/mfg/orders/{m2['id']}/ops/10",{'action':'finish','minutes':30,'qcResults':[{'name':'الطول','value':91},{'name':'ثابت بلا اهتزاز','value':'نعم'}]})
refused(409,lambda: c(f"/mfg/orders/{m2['id']}/produce",{'qty':1,'serials':[f"{mo['number']}-002"]}),'a serial number already used','مستخدم')
rp=c(f'/mfg/reports?from={y}-01-01&to={d}')
ok(any(o_['operator']=='سعيد' and near(o_['hours'],1) and near(o_['value'],60) for o_ in rp['operators']) and rp['outside'] and near(rp['outside'][0]['value'],45),'reports: hours by operator and the outside workshops')

# ═══════════ rentals ═══════════
gen=c('/rentals/assets',{'name':'مولد','kind':'EQUIPMENT','rateDay':100,'rateWeek':600,'rateMonth':2000,'deposit':1000,'costValue':20000,'meter':100,'meterUnit':'ساعة'})
car=c('/rentals/assets',{'name':'سيارة','kind':'VEHICLE','rateDay':200,'rateWeek':1000,'deposit':500,'identifier':'أ ب 123','meter':5000,'meterUnit':'كم'})
apt=c('/rentals/assets',{'name':'شقة 12','kind':'UNIT','rateMonth':3000,'deposit':3000,'costValue':400000})
refused(400,lambda: c('/rentals/assets',{'name':'بلا سعر'}),'an asset without any rate')
q=lambda a,f,t_,u='AUTO': c('/rentals/quote',{'startDate':f,'endDate':t_,'lines':[{'assetId':a['id'],'unit':u}]})
ok(near(q(gen,D(0),D(9))['subtotal'],900),'10 days: 1 week + 3 days = 900, cheaper than 10 days (1,000) or 2 weeks (1,200)')
ok(near(q(gen,D(0),D(34))['subtotal'],2500),'35 days: 1 month + 5 days = 2,500')
ok(near(q(car,D(0),D(12))['subtotal'],2000),'13 days of the car: 2 weeks (2,000) beat 1 week + 6 days (2,200)')
ok(near(q(gen,D(0),D(9),'DAY')['subtotal'],1000),'a fixed daily rate when asked: 1,000')
# A: generator up front, 10% off, deposit, extension, late return with a damage charge, deposit settled
cA=c('/rentals/contracts',{'partnerId':cu['id'],'startDate':D(-20),'endDate':D(-11),'lines':[{'assetId':gen['id']}],'discountPct':10,'reserve':True})
ok(cA['status']=='RESERVED' and near(cA['subtotal'],810) and near(cA['deposit'],1000),'contract: 900 less 10% = 810; deposit taken from the asset, 1,000')
refused(409,lambda: c('/rentals/contracts',{'partnerId':cu['id'],'startDate':D(-15),'endDate':D(-14),'lines':[{'assetId':gen['id']}],'reserve':True}),'booking the generator on taken days','تعارض')
cash=acc.get('CASH') or acc['BANK']
c(f"/rentals/contracts/{cA['id']}/deposit",{'amount':1000,'accountId':cash['id'],'date':D(-20)})
ok(near(bal('RENTAL_DEPOSITS'),-1000),'deposit received: Cr deposits held 1,000 (a liability, not income)')
rev0=bal('RENTAL_REVENUE'); ar0=bal('AR')
cA=c(f"/rentals/contracts/{cA['id']}/deliver",{'date':D(-20),'lines':[{'assetId':gen['id'],'meterOut':100}]})
ok(cA['status']=='ACTIVE' and len(cA['invoices'])==1 and near(cA['invoices'][0]['net'],810) and near(bal('RENTAL_REVENUE')-rev0,-810) and near(bal('AR')-ar0,round(810*(1+R),2)),f"delivered: invoiced up front 810 + VAT = {round(810*(1+R),2)}")
cA=c(f"/rentals/contracts/{cA['id']}/extend",{'endDate':D(-7),'date':D(-11)})
ok(cA['endDate']==D(-7) and near(cA['invoices'][1]['net'],360),'extended 4 days: 400 less 10% = 360 invoiced')
cA=c(f"/rentals/contracts/{cA['id']}/return",{'date':D(-5),'lines':[{'assetId':gen['id'],'meterIn':180}],'charges':[{'description':'إصلاح كابل','amount':50}]})
ri=cA['invoices'][-1]; ret=[m for m in cA['moves'] if m['kind']=='RETURN'][0]
ok(cA['status']=='RETURNED' and near(ri['net'],250) and ret['detail']['lateDays']==2 and near(ret['detail']['lines'][0]['used'],80),'returned 2 days late: late fee 2 × 100 + cable repair 50 = 250 invoiced; 80 hours used')
billed=round(810*(1+R),2)+round(360*(1+R),2)+round(250*(1+R),2)
cA=c(f"/rentals/contracts/{cA['id']}/settle",{'accountId':cash['id'],'date':D(-5)})
ok(cA['status']=='CLOSED' and near(cA['depositApplied'],1000) and near(cA['depositHeld'],0) and near(cA['due'],round(billed-1000,2)),f"deposit pays the invoices first (1,000), nothing to refund; {round(billed-1000,2)} still due; contract closed")
ok(near(bal('RENTAL_DEPOSITS'),0) and near(bal('RENTAL_REVENUE')-rev0,-1420),'deposits back to 0; rental income 810 + 360 + 250 = 1,420')
# B: monthly flat
startB=(datetime.date.today().replace(day=1)-datetime.timedelta(days=1)).replace(day=1)
startB=(startB-datetime.timedelta(days=1)).replace(day=1).isoformat()
cB=c('/rentals/contracts',{'partnerId':cu['id'],'startDate':startB,'endDate':D(300),'billing':'MONTHLY','lines':[{'assetId':apt['id'],'unit':'MONTH'}]})
c(f"/rentals/contracts/{cB['id']}/deposit",{'amount':3000,'accountId':cash['id'],'date':startB})
cB=c(f"/rentals/contracts/{cB['id']}/deliver",{'date':startB})
ok(len(cB['invoices'])==1 and near(cB['invoices'][0]['net'],3000) and cB['nextBillDate']>startB,'monthly lease: the first month invoiced on delivery (3,000)')
r_=c('/rentals/bill-due',{}); cB=c(f"/rentals/contracts/{cB['id']}")
ok(r_['invoices']==2 and len(cB['invoices'])==3 and cB['nextBillDate']>d,f"billing run: the two months since then invoiced ({[i['from'] for i in cB['invoices']]})")
ok(c('/rentals/bill-due',{})['invoices']==0,'running it again bills nothing more')
# C: car reserved, maintenance blocked, cancel
cC=c('/rentals/contracts',{'partnerId':cu['id'],'startDate':D(5),'endDate':D(17),'lines':[{'assetId':car['id']}],'reserve':True})
refused(409,lambda: c(f"/rentals/assets/{car['id']}/maintenance",{'fromDate':D(6),'toDate':D(7)}),'maintenance on reserved days','محجوز')
c(f"/rentals/contracts/{cC['id']}/cancel",{'reason':'غيّر رأيه'}); ok(c(f"/rentals/contracts/{cC['id']}")['status']=='CANCELLED','reservation cancelled')
c(f"/rentals/assets/{car['id']}/maintenance",{'fromDate':D(6),'toDate':D(7),'description':'تغيير زيت','cost':300})
refused(409,lambda: c('/rentals/contracts',{'partnerId':cu['id'],'startDate':D(5),'endDate':D(6),'lines':[{'assetId':car['id']}],'reserve':True}),'booking over a maintenance window','صيانة')
# views
cal=c(f'/rentals/calendar?from={D(0)}&days=14'); row={r['name']:r for r in cal['assets']}
ok(row['شقة 12']['cells'][0]['s']=='R' and row['سيارة']['cells'][6]['s']=='M' and row['مولد']['cells'][0]['s']=='','calendar: the flat rented today, the car in maintenance on day 7, the generator free')
db_=c('/rentals/dashboard'); ok(db_['deposits']['match'] and near(db_['deposits']['held'],3000) and db_['assets']['rented']==1 and db_['contracts']['active']==1,f"dashboard: 3,000 deposits held = ledger; one asset out ({db_['assets']})")
rp=c(f'/rentals/reports?from={D(-30)}&to={d}'); ra={r['name']:r for r in rp['assets']}
ok(near(ra['مولد']['revenue'],1170) and ra['مولد']['rentedDays']==16 and near(ra['مولد']['returnPct'],round(1170/20000*100,2)),f"report: the generator — 1,170 of rent over 16 days out, return on cost {ra['مولد']['returnPct']}%")
je=[m for m in cB['moves'] if m['kind']=='DEPOSIT_IN'][0]['entryId']
refused(409,lambda: c(f'/journals/{je}/reverse',{}),'reversing a deposit entry from the journal','التأمين')
ig=c('/reports/integrity'); ok(ig['ok'] and any('تأمينات المستأجرين' in x['name'] and x['ok'] for x in ig['checks']) and any('إنتاج تحت التشغيل' in x['name'] and x['ok'] for x in ig['checks']),'integrity: deposits held = their account, WIP = its account, all checks pass')
tb=c('/reports/trial-balance?from=2000-01-01&to=2099-12-31'); ok(tb['balanced'] and c('/reports/balance-sheet')['balanced'],'trial balance and balance sheet balanced')
print('FAILS', len(lib.fails)); sys.exit(1 if lib.fails else 0)
