"""3.57: what each section raises before it slips (a late manufacturing order, a rental past its end, a trial about to
end, a probation about to end), the last price with a party, and the restaurant and classification reports."""
import sys, os, time, datetime; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B; R=0.14 if EG else 0.15
t=register('r357'); c=lambda *a,**k: call(*a,tok=t,**k)
A=c('/accounts')['rows']; acc={x.get('systemKey'):x for x in A if x.get('systemKey')}; y=time.strftime('%Y')
D=lambda n=0: (datetime.date.today()+datetime.timedelta(days=n)).isoformat(); d=D()
ADDR={'street':'طريق الملك فهد','buildingNo':'1234','district':'العليا','city':'الرياض','postalCode':'12211','phone':'0501234567'}
def bal(key): return round(sum(float(x['debit'])-float(x['credit']) for x in c(f'/reports/trial-balance?from={y}-01-01&to={y}-12-31')['rows'] if x['code']==acc[key]['code']),2)
alerts=lambda: [a['text'] for a in c('/alerts')['items']]
has=lambda w: any(w in a for a in alerts())
c('/journals',{'date':f'{y}-01-01','memo':'رأس المال','lines':[{'accountId':acc['BANK']['id'],'debit':500000,'credit':0},{'accountId':acc['CAPITAL']['id'],'debit':0,'credit':500000}]})
sup=c('/partners',{'name':'مورد','isSupplier':True,'kind':'COMPANY','vatNumber':'300000000000003' if not EG else '200000001',**ADDR})
sup2=c('/partners',{'name':'مورد آخر','isSupplier':True,'kind':'COMPANY','vatNumber':'300000000000003' if not EG else '200000001',**ADDR})
cu=c('/partners',{'name':'زبون','isCustomer':True,'kind':'INDIVIDUAL','phone':'0501234567'})
cu2=c('/partners',{'name':'زبون آخر','isCustomer':True,'kind':'INDIVIDUAL','phone':'0501234568'})
ck=c('/products',{'name':'دجاج','sku':'CK','buyRoles':['STOCK','COMPONENT'],'saleClass':'STOCK','purchasePrice':20,'salePrice':30,'taxCode':'S','unit':'كجم','uoms':[{'name':'كرتون','factor':10}]})
def inv(direction,pid,lines,date=None,**k):
    x=c('/invoices',{'direction':direction,'kind':'INVOICE','date':date or d,'partnerId':pid,'lines':lines,**k}); return c(f"/invoices/{x['id']}/post",{})
# ── the last price with a party ──
LP=lambda pid,dr: c(f"/products/{ck['id']}/last-price?partnerId={pid}&direction={dr}")['last']
ok(LP(sup['id'],'PURCHASE') is None,'no purchases yet: no last price')
inv('PURCHASE',sup['id'],[{'productId':ck['id'],'qty':100,'unitPrice':20,'taxCode':'S'}],D(-3))
uom=[u for u in c('/products?limit=50')[0]['uoms']][0]
inv('PURCHASE',sup['id'],[{'productId':ck['id'],'qty':5,'unitPrice':185,'taxCode':'S','uomId':uom['id']}],D(-1))
l=LP(sup['id'],'PURCHASE'); ok(near(l['price'],18.5) and l['date'][:10]==D(-1),'the supplier\'s last price per base unit: a carton of 10 at 185 → 18.50')
ok(LP(sup2['id'],'PURCHASE') is None,'another supplier has no last price for it')
inv('SALE',cu['id'],[{'productId':ck['id'],'qty':2,'unitPrice':round(28*(1+R),4),'taxCode':'S'}],pricesIncludeVat=True)
l=LP(cu['id'],'SALE'); ok(near(l['price'],28,0.001) and LP(cu2['id'],'SALE') is None,'the customer\'s last price is before VAT even when the invoice was VAT-inclusive')
ok(LP(cu['id'],'PURCHASE') is None,'sale and purchase prices are kept apart')
# ── reminders across the sections ──
ok(not has('أمر تصنيع') and not has('عقد تأجير') and not has('تنتهي تجربته') and not has('فترة تجربته'),'nothing raised on a clean establishment')
e=c('/employees',{'name':'موظف تحت التجربة','basic':4000,'gosi':False,'probationEnd':D(10)}); ok(has('فترة تجربته'),'HR: a probation ending within 14 days')
c('/employees',{'name':'موظف بعيد','basic':4000,'gosi':False,'probationEnd':D(40)}); ok(sum('فترة تجربته' in a and a.startswith('1 ') for a in alerts())==1,'a probation ending later is not counted')
plan=c('/subs/plans',{'name':'تجربة يومين','period':'MONTH','price':100,'trialDays':2}); c('/subs',{'partnerId':cu['id'],'planId':plan['id']})
ok(has('تنتهي تجربته'),'subscriptions: a trial ending within 3 days')
car=c('/rentals/assets',{'name':'سيارة','kind':'VEHICLE','rateDay':200})
rc=c('/rentals/contracts',{'partnerId':cu['id'],'startDate':D(-5),'endDate':D(-1),'lines':[{'assetId':car['id']}],'reserve':True})
c(f"/rentals/contracts/{rc['id']}/deliver",{'date':D(-5),'lines':[{'assetId':car['id']}]})
ok(has('انتهت مدته'),'rentals: a delivered contract past its end with no return')
van=c('/rentals/assets',{'name':'فان','kind':'VEHICLE','rateDay':150})
r2c=c('/rentals/contracts',{'partnerId':cu2['id'],'startDate':D(-2),'endDate':D(2),'lines':[{'assetId':van['id']}],'reserve':True}); c(f"/rentals/contracts/{r2c['id']}/deliver",{'date':D(-2),'lines':[{'assetId':van['id']}]})
ok(has('ينتهي خلال 3 أيام'),'rentals: a contract ending within 3 days')
tbl=c('/products',{'name':'وجبة مجمدة','sku':'FZ','type':'STOCK','salePrice':50,'taxCode':'S','unit':'حبة'})
c('/mfg/boms',{'productId':tbl['id'],'outputQty':1,'lines':[{'componentId':ck['id'],'qty':0.5}]})
c('/mfg/orders',{'productId':tbl['id'],'qty':10,'confirm':True,'date':D(-4),'dueDate':D(-1)})
ok(has('أمر تصنيع'),'manufacturing: a confirmed order past its due date')
c('/mfg/orders',{'productId':tbl['id'],'qty':5,'confirm':True,'dueDate':D(5)}); ok(sum('أمر تصنيع' in a and a.startswith('1 ') for a in alerts())==1,'an order due later is not counted')
# ── reports ──
cat=c('/reports/catalog'); keys=[r['key'] for r in cat['reports']]
ok('resto' in [m['key'] for m in cat['modules']] and all(k in keys for k in ['resto.waste','resto.batches','inventory.classes']),'report centre: the restaurant module and the classification report are listed')
RR=lambda k,extra='': c(f'/reports/run/{k}?from={y}-01-01&to={y}-12-31{extra}')
shw=c('/products',{'name':'شاورما مطبوخة','sku':'SHW','buyRoles':[],'saleClass':'RECIPE','unit':'كجم','taxCode':'S'})
c(f"/products/{shw['id']}/recipe",{'lines':[{'componentId':ck['id'],'qty':10}],'outputQty':6.5,'method':'BATCH'},'PUT')
b1=c('/prep-batches',{'productId':shw['id'],'inputQty':10,'outputQty':6,'date':D(-1)}); b2=c('/prep-batches',{'productId':shw['id'],'inputQty':20,'date':d})
L=c(f'/preps/leftovers?date={d}'); wh=L['rows'][0]['warehouseId']
c('/preps/leftovers/waste',{'date':d,'lines':[{'productId':shw['id'],'warehouseId':wh,'qty':4}]})
rb=RR('resto.batches'); ok(len(rb['rows'])==2 and near(rb['totals']['cost'],b1['cost']+b2['cost'],0.02) and near([r for r in rb['rows'] if r['number']==b1['number']][0]['yieldPct'],60),'batches report: both batches, cost adds up, 60% yield on the first')
gp=RR('resto.batches','&groupBy=product'); ok(len(gp['rows'])==1 and near(gp['rows'][0]['output'],19) and near(gp['rows'][0]['variance'],-0.5) and near(gp['totals']['cost'],rb['totals']['cost'],0.02),'by preparation: 19 kg out, half a kilo under the expected')
rw=RR('resto.waste'); wl=c(f'/preps/waste-log?from={y}-01-01&to={y}-12-31')
ok(len(rw['rows'])==1 and near(rw['totals']['wastedValue'],wl['totals']['wastedValue']) and near(rw['totals']['wastedValue'],bal('INV_LOSS'),0.02) and near(rw['rows'][0]['wastePct'],round(4/19*100,2),0.02),'waste report = the waste log = the stock loss account; 4 of 19 kg')
rc_=RR('inventory.classes'); prods=c('/products?limit=500')
ok(len(rc_['rows'])==len(prods) and near(rc_['totals']['value'],sum(float(p['stockValue']) for p in prods),0.05) and near(rc_['totals']['value'],bal('INVENTORY'),0.05),'items by classification: every item, value = the inventory account')
row={r['sku']:r for r in rc_['rows']}; ok(row['CK']['buy']=='مخزني، مكوِّن' and row['CK']['sale']=='مخزني' and row['SHW']['sale']=='له خلطة' and row['SHW']['recipe']=='نعم' and row['SHW']['buy']=='لا يُشترى','each item shows its purchase uses, sale class and whether its recipe is written')
gs=RR('inventory.classes','&groupBy=sale'); ok(sum(r['items'] for r in gs['rows'])==len(prods) and near(gs['totals']['value'],rc_['totals']['value'],0.02),'by sale class adds up to the detail')
ig=c('/reports/integrity'); ok(ig['ok'],'integrity checks pass')
print('FAILS', lib.fails); sys.exit(1 if lib.fails else 0)
