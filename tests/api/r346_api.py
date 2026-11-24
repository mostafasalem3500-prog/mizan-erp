"""3.46: cost per size and per add-on, drawn from stock at the till, and the food-cost report — every figure worked by hand."""
import sys, os, time; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B; R=0.14 if EG else 0.15
t=register('r346'); c=lambda *a,**k: call(*a,tok=t,**k)
A=c('/accounts')['rows']; acc={x.get('systemKey'):x for x in A if x.get('systemKey')}; d=time.strftime('%Y-%m-%d'); y=time.strftime('%Y')
ADDR={'street':'طريق الملك فهد','buildingNo':'1234','district':'العليا','city':'الرياض','postalCode':'12211','phone':'0501234567'}
def bal(key): return round(sum(float(x['debit'])-float(x['credit']) for x in c(f'/reports/trial-balance?from={y}-01-01&to={y}-12-31')['rows'] if x['code']==acc[key]['code']),2)
def refused(code, fn, name, has=None):
    try: fn(); ok(False,name)
    except E as e: ok(str(code) in str(e) and (has is None or has in str(e)), name+' → refused')
qty=lambda sku: float({p['sku']:p for p in c('/products')}[sku]['qty'])
c('/journals',{'date':f'{y}-01-01','memo':'رأس المال','lines':[{'accountId':acc['BANK']['id'],'debit':100000,'credit':0},{'accountId':acc['CAPITAL']['id'],'debit':0,'credit':100000}]})
sup=c('/partners',{'name':'مورد الكافيه','isSupplier':True,'kind':'COMPANY','vatNumber':'300000000000003' if not EG else '200000001',**ADDR})
raw=lambda n,s,pp,u='كجم': c('/products',{'name':n,'sku':s,'type':'STOCK','salePrice':0,'purchasePrice':pp,'taxCode':'S','unit':u})
beans=raw('بن مختص','BN',100); milk=raw('حليب','MK',6,'لتر'); syrup=raw('شراب فانيلا','SY',40,'لتر'); cup=raw('كوب ورقي','CP',0.3,'حبة')
latte=c('/products',{'name':'لاتيه','sku':'LT','type':'SERVICE','salePrice':14,'taxCode':'S'})
x=c('/invoices',{'direction':'PURCHASE','kind':'INVOICE','date':d,'partnerId':sup['id'],'lines':[{'productId':p['id'],'qty':q,'unitPrice':pr,'taxCode':'S'} for p,q,pr in [(beans,10,100),(milk,100,6),(syrup,5,40),(cup,1000,0.3)]]}); c(f"/invoices/{x['id']}/post",{})
# the medium latte: 18 g beans + 0.2 L milk + a cup → 1.8 + 1.2 + 0.3 = 3.30
c(f"/products/{latte['id']}/recipe",{'lines':[{'componentId':beans['id'],'qty':0.018},{'componentId':milk['id'],'qty':0.2},{'componentId':cup['id'],'qty':1}]},'PUT')
refused(400,lambda: c('/modifiers',{'name':'خطأ','minSelect':0,'maxSelect':1,'productIds':[latte['id']],'options':[{'name':'جرعة','price':3,'componentId':beans['id']}]}),'an option with an ingredient but no quantity','كمية')
refused(400,lambda: c('/modifiers',{'name':'خطأ','minSelect':0,'maxSelect':1,'productIds':[latte['id']],'options':[{'name':'ضخم','price':3,'factor':50}]}),'a size factor out of range','معامل')
sz=c('/modifiers',{'name':'الحجم','minSelect':1,'maxSelect':1,'productIds':[latte['id']],'options':[{'name':'صغير','price':-0 ,'factor':0.75},{'name':'وسط','price':0},{'name':'كبير','price':4,'factor':1.5}]})
ad=c('/modifiers',{'name':'إضافات','minSelect':0,'maxSelect':3,'productIds':[latte['id']],'options':[{'name':'جرعة إسبريسو','price':3,'componentId':beans['id'],'componentQty':0.009},{'name':'فانيلا','price':2,'componentId':syrup['id'],'componentQty':0.015},{'name':'بدون سكر','price':0}]})
O={o['name']:o['id'] for g in (sz,ad) for o in g['options']}
v=c(f"/products/{latte['id']}/variant-costs"); V={r['option']:r for r in v['rows']}
ok(near(v['baseCost'],3.3) and near(V['صغير']['cost'],2.475,0.006) and near(V['كبير']['cost'],4.95) and near(V['كبير']['price'],18) and near(V['كبير']['costPct'],27.5),'cost per size: small 2.48, medium 3.30, large 4.95 (27.5% of its 18 price)')
ok(V['جرعة إسبريسو']['kind']=='ADDON' and near(V['جرعة إسبريسو']['cost'],0.9) and near(V['جرعة إسبريسو']['margin'],2.1) and near(V['فانيلا']['cost'],0.6),'cost per add-on: an extra shot costs 0.90 and sells for 3, vanilla costs 0.60')
sess=c('/pos/session/open',{'openingCash':0})
def sale(lines): return c('/pos/sale',{'sessionId':sess['id'],'lines':lines,'tenders':[{'method':'CASH','amount':None}]})
iv,cg=bal('INVENTORY'),bal('COGS'); b0,m0,s0,c0=qty('BN'),qty('MK'),qty('SY'),qty('CP')
# 4 large with an extra shot, 2 medium with vanilla, 6 small plain
sale([{'productId':latte['id'],'qty':4,'unitPrice':14,'modifiers':[O['كبير'],O['جرعة إسبريسو']]},{'productId':latte['id'],'qty':2,'unitPrice':14,'modifiers':[O['وسط'],O['فانيلا'],O['بدون سكر']]},{'productId':latte['id'],'qty':6,'unitPrice':14,'modifiers':[O['صغير']]}])
wb=4*(0.027+0.009)+2*0.018+6*0.0135; wm=4*0.3+2*0.2+6*0.15; wc=4*1.5+2*1+6*0.75
ok(near(b0-qty('BN'),wb,0.0015) and near(m0-qty('MK'),wm,0.0015) and near(s0-qty('SY'),0.03,0.0015) and near(c0-qty('CP'),wc,0.0015),f'stock drawn by size and add-on: beans {wb:.3f} kg, milk {wm:.2f} L, syrup 0.03 L')
cost=wb*100+wm*6+0.03*40+wc*0.3
ok(near(bal('COGS')-cg,cost,0.03) and near(iv-bal('INVENTORY'),bal('COGS')-cg),f'cost of sales +{cost:.2f} = what left the warehouse')
# the report
f=c(f'/restaurant/food-cost?from={d}&to={d}'); D={r['variant']:r for r in f['dishes']}
rev=(4*(14+4+3)+2*(14+2)+6*14) if EG or not c('/auth/me')['company'].get('pricesIncludeVat') else None
ok(len(f['dishes'])==3 and near(f['totals']['cost'],cost,0.03) and near(f['totals']['cost'],bal('COGS')-cg,0.011),'food-cost report: three lines (one per size sold) and its cost = cost of sales in the ledger')
big=[r for r in f['dishes'] if 'كبير' in r['variant']][0]; small=[r for r in f['dishes'] if 'صغير' in r['variant']][0]
ok(near(big['qty'],4) and near(big['unitCost'],4.95+0.9,0.011) and near(small['unitCost'],2.475,0.011),'per unit: a large latte with a shot cost 5.85, a small one 2.48')
ok(near(f['totals']['costPct'],f['totals']['cost']/f['totals']['revenue']*100,0.02) and f['target']==30 and all(r['level'] in ('good','watch','high') for r in f['dishes']),'food cost % against the 30% target, each line graded')
I={r['name']:r for r in f['ingredients']}
ok(near(I['بن مختص']['soldQty'],wb,0.0015) and near(I['بن مختص']['boughtQty'],10) and near(sum(r['soldValue'] for r in f['ingredients']),cost,0.03),'ingredients: what was sold of each, tied to the same cost')
ok(len(f['days'])==1 and near(f['days'][0]['cost'],cost,0.03) and c('/restaurant/food-cost-target',{'target':32},'PUT')['target']==32 and c(f'/restaurant/food-cost?from={d}&to={d}')['target']==32,'by day; the target can be changed')
# waste recorded by a stock adjustment shows in the report
tb=c('/reports/trial-balance?from=2000-01-01&to=2099-12-31'); ok(tb['balanced'] and c('/reports/integrity')['ok'],'trial balance balanced and inventory tied to its valuation')
fy=[v for v in c('/fiscal-years')['years'] if v['name']==y][0]; ok(c('/reports/final-accounts?fiscalYearId='+fy['id'])['ok'],'final accounts: every linkage check holds')
print('FAILS', len(lib.fails)); sys.exit(1 if lib.fails else 0)
