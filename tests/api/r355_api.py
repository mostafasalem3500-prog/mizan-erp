"""3.55: item classification (bought as stock / service / ingredient; sold as stock / with a recipe / service / not sold),
a recipe item sold by proportion (the fajita inside a sandwich), and the bulk-production day: a minimum run, sales
drawing on what was produced, and the write-off of what is left at the end of the day."""
import sys, os, time; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B
t=register('r355'); c=lambda *a,**k: call(*a,tok=t,**k)
A=c('/accounts')['rows']; acc={x.get('systemKey'):x for x in A if x.get('systemKey')}; d=time.strftime('%Y-%m-%d'); y=time.strftime('%Y')
ADDR={'street':'طريق الملك فهد','buildingNo':'1234','district':'العليا','city':'الرياض','postalCode':'12211','phone':'0501234567'}
def bal(key): return round(sum(float(x['debit'])-float(x['credit']) for x in c(f'/reports/trial-balance?from={y}-01-01&to={y}-12-31')['rows'] if x['code']==acc[key]['code']),2)
def refused(code, fn, name, has=None):
    try: fn(); ok(False,name)
    except E as e: ok(str(code) in str(e) and (has is None or has in str(e)), name+' → refused')
P=lambda: {p['sku']:p for p in c('/products?limit=500&active=all')}
qty=lambda sku: float(P()[sku]['qty'])
skus=lambda use: {p['sku'] for p in c(f'/products?limit=500&use={use}')}
c('/journals',{'date':f'{y}-01-01','memo':'رأس المال','lines':[{'accountId':acc['BANK']['id'],'debit':500000,'credit':0},{'accountId':acc['CAPITAL']['id'],'debit':0,'credit':500000}]})
sup=c('/partners',{'name':'مورد المطعم','isSupplier':True,'kind':'COMPANY','vatNumber':'300000000000003' if not EG else '200000001',**ADDR})
cu=c('/partners',{'name':'زبون','isCustomer':True,'kind':'INDIVIDUAL','phone':'0501234567'})
# ── classification at definition ──
comp=lambda n,s,pp,u='كجم': c('/products',{'name':n,'sku':s,'buyRoles':['COMPONENT'],'saleClass':None,'purchasePrice':pp,'taxCode':'S','unit':u})
chicken=comp('دجاج مبرد','CK',20); garlic=comp('ثوم','GR',12); yog=comp('زبادي','YG',8); paste=comp('معجون طماطم','TP',10); spice=comp('بهارات','SP',40); oil=comp('زيت نباتي','OL',10)
ok(chicken['type']=='STOCK' and chicken['buyRoles']==['COMPONENT'] and chicken['saleClass'] is None,'an ingredient-only item is held in stock and is not for sale')
pepsi=c('/products',{'name':'بيبسي','sku':'PEP','buyRoles':['STOCK'],'saleClass':'STOCK','salePrice':3,'purchasePrice':1.5,'taxCode':'S','unit':'حبة','uoms':[{'name':'كرتون','factor':24}]})
ok(pepsi['type']=='STOCK' and pepsi['saleClass']=='STOCK' and len(P()['PEP']['uoms'])==1,'a stock item for sale: bought by the carton, sold by the piece')
multi=c('/products',{'name':'جبن شرائح','sku':'CH','buyRoles':['STOCK','COMPONENT'],'saleClass':'STOCK','salePrice':30,'purchasePrice':20,'taxCode':'S','unit':'كجم'})
ok(sorted(multi['buyRoles'])==['COMPONENT','STOCK'],'an item may carry several purchase uses at once')
svc=c('/products',{'name':'توصيل','sku':'DLV','buyRoles':['SERVICE'],'saleClass':'SERVICE','salePrice':10,'taxCode':'S'})
ok(svc['type']=='SERVICE','a service bought and sold is a service item')
faj=c('/products',{'name':'فاهيتا دجاج','sku':'FJ','buyRoles':[],'saleClass':'RECIPE','salePrice':0,'taxCode':'S','unit':'كجم'})
sand=c('/products',{'name':'ساندوتش فاهيتا','sku':'SWF','buyRoles':[],'saleClass':'RECIPE','salePrice':15,'taxCode':'S','unit':'حبة'})
ok(faj['type']=='STOCK' and faj['saleClass']=='RECIPE' and faj['buyRoles']==[],'an item with a recipe: sold, not bought')
refused(400,lambda: c('/products',{'name':'بلا تصنيف','sku':'X1','buyRoles':[],'saleClass':None}),'an item with no use at all','حدّد')
refused(400,lambda: c('/products',{'name':'متعارض','sku':'X2','buyRoles':['COMPONENT'],'saleClass':'SERVICE'}),'sold as a service and an ingredient at once','مكوِّن')
old=c('/products',{'name':'خبز صاج','sku':'BD','type':'STOCK','purchasePrice':0.5,'taxCode':'S','unit':'حبة'}); olds=c('/products',{'name':'خدمة قديمة','sku':'OS','type':'SERVICE','salePrice':5,'taxCode':'S'})
ok(old['saleClass']=='STOCK' and old['buyRoles']==['STOCK'] and olds['saleClass']=='SERVICE' and olds['buyRoles']==['SERVICE'],'a request that sends only the type is classified from it')
sale=skus('sale'); buy=skus('buy'); cmp_=skus('component')
ok({'PEP','SWF','FJ','DLV','BD'}<=sale and not ({'CK','GR','OL'}&sale),'sale screens: items for sale only, ingredients left out')
ok({'CK','PEP','DLV','BD'}<=buy and not ({'SWF','FJ'}&buy),'purchase screens: what is bought, recipe items left out')
ok({'CK','GR','YG','TP','SP','OL','CH'}<=cmp_ and not ({'PEP','BD','DLV','SWF'}&cmp_),'recipe editor: ingredient items only')
ok({p['sku'] for p in c('/products?limit=500&saleClass=RECIPE')}=={'FJ','SWF'} and 'CK' in {p['sku'] for p in c('/products?limit=500&saleClass=NONE')},'filter by sale class')
def inv(direction,pid,lines):
    x=c('/invoices',{'direction':direction,'kind':'INVOICE','date':d,'partnerId':pid,'lines':lines}); return c(f"/invoices/{x['id']}/post",{})
inv('PURCHASE',sup['id'],[{'productId':p['id'],'qty':q,'unitPrice':pr,'taxCode':'S'} for p,q,pr in [(chicken,100,20),(garlic,10,12),(yog,20,8),(paste,10,10),(spice,10,40),(oil,30,10),(old,500,0.5)]])
rec=lambda p,lines,**k: c(f"/products/{p['id']}/recipe",{'lines':lines,**k},'PUT')
# ── method 1: the recipe is taken by proportion when sold ──
# fajita: 100 g chicken + 15 garlic + 15 yogurt + 10 tomato paste + 5 spice + 5 oil = 150 g; cost 2 + .18 + .12 + .10 + .20 + .05 = 2.65
f=rec(faj,[{'componentId':chicken['id'],'qty':0.1},{'componentId':garlic['id'],'qty':0.015},{'componentId':yog['id'],'qty':0.015},{'componentId':paste['id'],'qty':0.01},{'componentId':spice['id'],'qty':0.005},{'componentId':oil['id'],'qty':0.005}],outputQty=0.15,method='DIRECT')
ok(near(f['batchCost'],2.65) and near(f['cost'],2.65/0.15,0.001) and f['method']=='DIRECT' and f['saleClass']=='RECIPE','fajita recipe: 150 g for 2.65 → 17.6667 per kg')
s=rec(sand,[{'componentId':faj['id'],'qty':0.12},{'componentId':old['id'],'qty':1}],outputQty=1,method='DIRECT')
ok(near(s['cost'],0.12*2.65/0.15+0.5,0.01) and s['lines'][0]['kind']=='PREP_DIRECT','sandwich with 120 g of fajita costs 2.62')
ok('COMPONENT' in P()['BD']['buyRoles'] and 'BD' in skus('component'),'a stock item put into a recipe becomes an ingredient item')
i0=bal('INVENTORY'); inv('SALE',cu['id'],[{'productId':sand['id'],'qty':10,'unitPrice':15,'taxCode':'S'}])
# 10 sandwiches = 1.2 kg fajita = 8 × the 150 g recipe
ok(near(qty('CK'),100-0.8,0.001) and near(qty('GR'),10-0.12,0.001) and near(qty('YG'),20-0.12,0.001) and near(qty('TP'),10-0.08,0.001) and near(qty('SP'),10-0.04,0.001) and near(qty('OL'),30-0.04,0.001) and near(qty('BD'),490),'10 sandwiches take the ingredients in the recipe\'s proportions: 800 g chicken, 120 garlic, 120 yogurt, 80 paste, 40 spice, 40 oil')
ok(near(i0-bal('INVENTORY'),26.2,0.02) and near(qty('FJ'),0) and near(qty('SWF'),0),'cost of the sale 26.20 leaves inventory; nothing is held of the recipe items themselves')
inv('SALE',cu['id'],[{'productId':faj['id'],'qty':0.3,'unitPrice':60,'taxCode':'S'}])
ok(near(qty('CK'),100-0.8-0.2,0.001),'the recipe item sold on its own by weight: 300 g takes 200 g of chicken')
# ── method 2: produced in bulk, drawn on by sales, the rest written off ──
shw=c('/products',{'name':'شاورما دجاج مطبوخة','sku':'SHW','buyRoles':[],'saleClass':'RECIPE','salePrice':0,'taxCode':'S','unit':'كجم'})
k=rec(shw,[{'componentId':chicken['id'],'qty':10},{'componentId':spice['id'],'qty':0.5}],outputQty=6.5,method='BATCH',minBatch=6.5)
ok(k['method']=='BATCH' and near(k['minBatch'],6.5),'bulk preparation with a minimum run of one 10 kg skewer')
refused(400,lambda: c('/prep-batches',{'productId':shw['id'],'inputQty':5.25,'date':d}),'half a skewer is under the minimum run','الحد الأدنى')
ck0=qty('CK'); b=c('/prep-batches',{'productId':shw['id'],'inputQty':10.5,'outputQty':6.4,'date':d})
ok(near(b['cost'],220) and near(qty('SHW'),6.4) and near(qty('CK'),ck0-10,0.001),'production entered by hand: 10.5 kg in, 6.4 kg out at 220')
ssw=c('/products',{'name':'ساندوتش شاورما','sku':'SSW','buyRoles':[],'saleClass':'RECIPE','salePrice':12,'taxCode':'S','unit':'حبة'})
rec(ssw,[{'componentId':shw['id'],'qty':0.12},{'componentId':old['id'],'qty':1}],outputQty=1,method='DIRECT')
inv('SALE',cu['id'],[{'productId':ssw['id'],'qty':20,'unitPrice':12,'taxCode':'S'}])
ok(near(qty('SHW'),4.0,0.001) and near(qty('CK'),ck0-10,0.001),'20 sandwiches draw 2.4 kg from what was produced, not from the raw chicken')
L=c(f'/preps/leftovers?date={d}'); r=[x for x in L['rows'] if x['productId']==shw['id']]
ok(len(r)==1 and near(r[0]['produced'],6.4) and near(r[0]['sold'],2.4) and near(r[0]['left'],4.0) and near(r[0]['value'],137.5,0.02) and L['totals']['left']==1,'end of day: produced 6.4, sold 2.4, left 4.0 worth 137.50')
ok(not [x for x in L['rows'] if x['productId'] in (faj['id'],sand['id'])],'recipe items taken on sale never have a leftover')
W=lambda q,pid=None: c('/preps/leftovers/waste',{'date':d,'lines':[{'productId':pid or shw['id'],'warehouseId':r[0]['warehouseId'],'qty':q}]})
refused(400,lambda: W(5),'writing off more than is left','فقط')
refused(400,lambda: W(1,faj['id']),'a write-off for an item that is not produced in bulk','الطبخة')
l0=bal('INV_LOSS'); i1=bal('INVENTORY'); w=W(1.5)
ok(near(bal('INV_LOSS')-l0,51.56,0.02) and near(i1-bal('INVENTORY'),51.56,0.02) and near(qty('SHW'),2.5,0.001),'part written off: 1.5 kg, 51.56 to stock loss and damage')
w=c('/preps/leftovers/waste',{'date':d,'lines':[{'productId':shw['id'],'warehouseId':r[0]['warehouseId']}]})
ok(near(bal('INV_LOSS')-l0,137.5,0.03) and near(qty('SHW'),0,0.0005) and w['vouchers'][0]['number'].startswith('DMG'),'the rest written off without typing a quantity: the day closes at zero, 137.50 in all')
L2=c(f'/preps/leftovers?date={d}'); r2_=[x for x in L2['rows'] if x['productId']==shw['id']][0]
ok(near(r2_['wasted'],4.0) and near(r2_['left'],0) and L2['totals']['left']==0,'the day shows 4.0 written off and nothing left')
refused(400,lambda: W(1),'nothing left to write off','لا يوجد')
tb=c(f'/reports/trial-balance?from={y}-01-01&to={y}-12-31')['rows']
ok(near(sum(float(x['debit']) for x in tb),sum(float(x['credit']) for x in tb),0.01),'trial balance balanced')
stockval=sum(float(p['stockValue']) for p in P().values())
ok(near(stockval,bal('INVENTORY'),0.05),f'stock value {stockval:.2f} = the inventory account')
# ── reclassification ──
u=c(f"/products/{chicken['id']}",{'saleClass':'STOCK','buyRoles':['COMPONENT','STOCK'],'salePrice':28},'PUT')
ok(u['saleClass']=='STOCK' and 'CK' in skus('sale'),'an ingredient reclassified for sale appears in the sale screens')
refused(400,lambda: c(f"/products/{chicken['id']}",{'saleClass':'SERVICE','buyRoles':['SERVICE']},'PUT'),'an item with stock movements turned into a service','حركات')
u2=c(f"/products/{pepsi['id']}",{'name':'بيبسي 330','salePrice':3.5},'PUT')
ok(u2['type']=='STOCK' and u2['saleClass']=='STOCK' and u2['buyRoles']==['STOCK'] and u2['name']=='بيبسي 330','an ordinary edit leaves the classification as it is')
print('FAILS', lib.fails); sys.exit(1 if lib.fails else 0)
