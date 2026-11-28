"""3.56: classifying many items at once, the waste log of the day closes against what was produced, and the two
reminders: an item classed «with a recipe» that has no ingredients, and a bulk preparation left from an earlier day."""
import sys, os, time, datetime; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B
t=register('r356'); c=lambda *a,**k: call(*a,tok=t,**k)
A=c('/accounts')['rows']; acc={x.get('systemKey'):x for x in A if x.get('systemKey')}; d=time.strftime('%Y-%m-%d'); y=time.strftime('%Y')
yd=(datetime.date.today()-datetime.timedelta(days=1)).isoformat()
ADDR={'street':'طريق الملك فهد','buildingNo':'1234','district':'العليا','city':'الرياض','postalCode':'12211','phone':'0501234567'}
def bal(key): return round(sum(float(x['debit'])-float(x['credit']) for x in c(f'/reports/trial-balance?from={y}-01-01&to={y}-12-31')['rows'] if x['code']==acc[key]['code']),2)
def refused(code, fn, name, has=None):
    try: fn(); ok(False,name)
    except E as e: ok(str(code) in str(e) and (has is None or has in str(e)), name+' → refused')
P=lambda: {p['sku']:p for p in c('/products?limit=500&active=all')}
alerts=lambda: [a['text'] for a in c('/alerts')['items']]
c('/journals',{'date':f'{y}-01-01','memo':'رأس المال','lines':[{'accountId':acc['BANK']['id'],'debit':500000,'credit':0},{'accountId':acc['CAPITAL']['id'],'debit':0,'credit':500000}]})
sup=c('/partners',{'name':'مورد','isSupplier':True,'kind':'COMPANY','vatNumber':'300000000000003' if not EG else '200000001',**ADDR})
# items as they were before classification: only a type
old=lambda n,s,pp=10,ty='STOCK': c('/products',{'name':n,'sku':s,'type':ty,'purchasePrice':pp,'salePrice':0 if ty=='STOCK' else 20,'taxCode':'S','unit':'كجم'})
ck=old('دجاج','CK',20); sp=old('بهارات','SP',40); ol=old('زيت','OL'); pep=old('بيبسي','PEP',1.5); sv=old('توصيل','DLV',0,'SERVICE')
x=c('/invoices',{'direction':'PURCHASE','kind':'INVOICE','date':yd,'partnerId':sup['id'],'lines':[{'productId':ck['id'],'qty':100,'unitPrice':20,'taxCode':'S'},{'productId':sp['id'],'qty':10,'unitPrice':40,'taxCode':'S'}]}); c(f"/invoices/{x['id']}/post",{})
# ── many items at once ──
r=c('/products/classify',{'ids':[ck['id'],sp['id'],ol['id']],'saleClass':None,'component':True})
p=P(); ok(r['updated']==3 and not r['skipped'] and all(p[k]['saleClass'] is None and sorted(p[k]['buyRoles'])==['COMPONENT','STOCK'] for k in ('CK','SP','OL')),'three raw materials made «ingredient, not for sale» in one step')
ok(not ({'CK','SP','OL'}&{q['sku'] for q in c('/products?limit=500&use=sale')}) and p['PEP']['saleClass']=='STOCK','they leave the sale screens; the items not chosen keep their class')
r=c('/products/classify',{'ids':[ck['id'],sv['id'],pep['id']],'saleClass':'SERVICE'})
ok(r['updated']==1 and len(r['skipped'])==2 and {s['name'] for s in r['skipped']}=={'دجاج','بيبسي'} and P()['CK']['type']=='STOCK','a change an item cannot take is skipped with its reason, the rest go through')
ok(any('حركات' in s['reason'] or 'مكوِّن' in s['reason'] or 'مخزني' in s['reason'] for s in r['skipped']),'the reason says why')
r=c('/products/classify',{'ids':[ol['id']],'component':False}); ok(P()['OL']['buyRoles']==['STOCK'] and P()['OL']['saleClass'] is None,'the ingredient use is removed without touching the sale class')
refused(400,lambda: c('/products/classify',{'ids':[ck['id']]}),'nothing to change','اختر')
refused(400,lambda: c('/products/classify',{'ids':[],'saleClass':'STOCK'}),'no items chosen','حدّد')
other=register('r356b'); ro=call('/products/classify',{'ids':[ck['id']],'saleClass':'STOCK'},tok=other); ok(ro['updated']==0,'another establishment cannot classify my items')
ok(P()['CK']['saleClass'] is None,'and my item is unchanged')
# ── reminder: classed «with a recipe», no ingredients ──
shw=c('/products',{'name':'شاورما مطبوخة','sku':'SHW','buyRoles':[],'saleClass':'RECIPE','unit':'كجم','taxCode':'S'})
ok(any('بلا مكونات' in a for a in alerts()),'reminder: an item with a recipe class has no ingredients')
c(f"/products/{shw['id']}/recipe",{'lines':[{'componentId':ck['id'],'qty':10},{'componentId':sp['id'],'qty':0.5}],'outputQty':6.5,'method':'BATCH'},'PUT')
ok(not any('بلا مكونات' in a for a in alerts()),'the reminder goes once the recipe is written')
# ── yesterday's production left on hand → reminder; then the waste log ──
c('/prep-batches',{'productId':shw['id'],'inputQty':10.5,'outputQty':6.5,'date':yd})
ok(any('إنتاج سابق' in a for a in alerts()),'reminder: a preparation is still on hand from an earlier day')
L=c(f'/preps/leftovers?date={yd}'); wh=L['rows'][0]['warehouseId']
c('/preps/leftovers/waste',{'date':yd,'notes':'نهاية الوردية','lines':[{'productId':shw['id'],'warehouseId':wh,'qty':1.5}]})
ok(any('إنتاج سابق' in a for a in alerts()),'a partial write-off leaves the reminder')
c('/prep-batches',{'productId':shw['id'],'inputQty':10.5,'outputQty':6.5,'date':d})
ok(not any('إنتاج سابق' in a for a in alerts()),'produced again today: no reminder while the day is running')
c('/preps/leftovers/waste',{'date':d,'lines':[{'productId':shw['id'],'warehouseId':wh}]})        # 5 + 6.5 = 11.5 left, all written off
W=c('/preps/waste-log'); r=W['rows'][0]
# 13 kg produced for 440; 1.5 + 11.5 = 13 written off (nothing was sold)
ok(len(W['rows'])==1 and near(r['produced'],13) and near(r['wasted'],13) and r['days']==2 and near(r['wastePct'],100) and near(r['wastedValue'],440,0.05),'waste log: 13 kg produced, 13 written off over two closes')
ok(near(W['totals']['wastedValue'],bal('INV_LOSS'),0.02) and len(W['days'])==2 and W['days'][0]['date']==d,'the log equals the stock loss account, newest close first')
ok(near(c(f'/preps/waste-log?from={d}&to={d}')['totals']['wastedValue'],11.5*440/13,0.1),'the log by period: today only')
tb=c(f'/reports/trial-balance?from={y}-01-01&to={y}-12-31')['rows']; ok(near(sum(float(x['debit']) for x in tb),sum(float(x['credit']) for x in tb),0.01),'trial balance balanced')
ok(near(sum(float(q['stockValue']) for q in P().values()),bal('INVENTORY'),0.05),'stock value = the inventory account')
print('FAILS', lib.fails); sys.exit(1 if lib.fails else 0)
