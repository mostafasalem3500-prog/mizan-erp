"""3.58: the till and items sold through a recipe — a recipe item sells at the point of sale without a stock of its
own, and the till is told how many can still be made from what was produced in advance."""
import sys, os, time; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B
t=register('r358'); c=lambda *a,**k: call(*a,tok=t,**k)
A=c('/accounts')['rows']; acc={x.get('systemKey'):x for x in A if x.get('systemKey')}; d=time.strftime('%Y-%m-%d'); y=time.strftime('%Y')
ADDR={'street':'طريق الملك فهد','buildingNo':'1234','district':'العليا','city':'الرياض','postalCode':'12211','phone':'0501234567'}
def bal(key): return round(sum(float(x['debit'])-float(x['credit']) for x in c(f'/reports/trial-balance?from={y}-01-01&to={y}-12-31')['rows'] if x['code']==acc[key]['code']),2)
P=lambda: {p['sku']:p for p in c('/products?limit=500&active=all')}
c('/journals',{'date':f'{y}-01-01','memo':'رأس المال','lines':[{'accountId':acc['BANK']['id'],'debit':500000,'credit':0},{'accountId':acc['CAPITAL']['id'],'debit':0,'credit':500000}]})
sup=c('/partners',{'name':'مورد','isSupplier':True,'kind':'COMPANY','vatNumber':'300000000000003' if not EG else '200000001',**ADDR})
comp=lambda n,s,pp,u='كجم': c('/products',{'name':n,'sku':s,'buyRoles':['COMPONENT'],'saleClass':None,'purchasePrice':pp,'taxCode':'S','unit':u})
ck=comp('دجاج','CK',20); bd=comp('خبز','BD',0.5,'حبة')
x=c('/invoices',{'direction':'PURCHASE','kind':'INVOICE','date':d,'partnerId':sup['id'],'lines':[{'productId':ck['id'],'qty':100,'unitPrice':20,'taxCode':'S'},{'productId':bd['id'],'qty':500,'unitPrice':0.5,'taxCode':'S'}]}); c(f"/invoices/{x['id']}/post",{})
rec=lambda p,lines,**k: c(f"/products/{p['id']}/recipe",{'lines':lines,**k},'PUT')
item=lambda n,s,price,u='حبة': c('/products',{'name':n,'sku':s,'buyRoles':[],'saleClass':'RECIPE','salePrice':price,'taxCode':'S','unit':u})
faj=item('ساندوتش فاهيتا','FJ',15); rec(faj,[{'componentId':ck['id'],'qty':0.1},{'componentId':bd['id'],'qty':1}],outputQty=1,method='DIRECT')
shw=item('شاورما مطبوخة','SHW',0,'كجم'); rec(shw,[{'componentId':ck['id'],'qty':10}],outputQty=6.5,method='BATCH')
ssw=item('ساندوتش شاورما','SSW',12); rec(ssw,[{'componentId':shw['id'],'qty':0.12},{'componentId':bd['id'],'qty':1}],outputQty=1,method='DIRECT')
pep=c('/products',{'name':'بيبسي','sku':'PEP','type':'STOCK','salePrice':3,'purchasePrice':1.5,'taxCode':'S'})
av=c('/pos/availability')
ok(av[faj['id']]['left'] is None and faj['id'] in av,'a recipe on raw materials only is never «sold out» at the till')
ok(av[ssw['id']]['left']==0 and av[ssw['id']]['prep']=='شاورما مطبوخة','a recipe on a bulk preparation: nothing produced yet → 0 left, and it names the preparation')
ok(shw['id'] not in av and pep['id'] not in av and ck['id'] not in av,'items held in stock are read from their own balance, not listed')
sess=c('/pos/session/open',{'openingCash':0}); sid=sess['id']
sale=lambda lines,**k: c('/pos/sale',{'sessionId':sid,'lines':lines,'tenders':[{'method':'CASH','amount':None}],**k})
i0=bal('INVENTORY'); s1=sale([{'productId':faj['id'],'qty':4,'unitPrice':15}])
ok(near(i0-bal('INVENTORY'),4*2.5) and near(P()['CK']['qty'],100-0.4,0.001) and near(P()['FJ']['qty'],0),'a recipe item sells at the till with no stock of its own and no override: its ingredients leave at 2.50 each')
c('/prep-batches',{'productId':shw['id'],'inputQty':10,'outputQty':6,'date':d})
ok(c('/pos/availability')[ssw['id']]['left']==50,'6 kg produced at 120 g a sandwich → 50 left')
sale([{'productId':ssw['id'],'qty':48,'unitPrice':12}])
av=c('/pos/availability'); ok(av[ssw['id']]['left']==2 and near(P()['SHW']['qty'],0.24,0.001),'48 sold → 2 left (0.24 kg on hand)')
sale([{'productId':ssw['id'],'qty':2,'unitPrice':12}]); ok(c('/pos/availability')[ssw['id']]['left']==0 and near(P()['SHW']['qty'],0,0.001),'the last two sold → sold out')
L=c(f'/preps/leftovers?date={d}'); r=[x for x in L['rows'] if x['productId']==shw['id']][0]
ok(near(r['produced'],6) and near(r['sold'],6) and near(r['left'],0),'the day close agrees: 6 produced, 6 taken by the till, nothing left')
ig=c('/reports/integrity'); ok(ig['ok'],'integrity checks pass')
ok(near(sum(float(q['stockValue']) for q in P().values()),bal('INVENTORY'),0.05),'stock value = the inventory account')
print('FAILS', lib.fails); sys.exit(1 if lib.fails else 0)
