"""3.45: restaurant costing — a shawarma built from a first recipe (marinated meat), a final recipe (cooked meat, by yield)
and a sandwich on top, costed both ways: the batch (production) method and the direct-deduction method. Every figure is
worked by hand and followed to inventory, cost of sales and the final accounts."""
import sys, os, time; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B; R=0.14 if EG else 0.15
t=register('r345'); c=lambda *a,**k: call(*a,tok=t,**k)
A=c('/accounts')['rows']; acc={x.get('systemKey'):x for x in A if x.get('systemKey')}; d=time.strftime('%Y-%m-%d'); y=time.strftime('%Y')
ADDR={'street':'طريق الملك فهد','buildingNo':'1234','district':'العليا','city':'الرياض','postalCode':'12211','phone':'0501234567'}
def bal(key): return round(sum(float(x['debit'])-float(x['credit']) for x in c(f'/reports/trial-balance?from={y}-01-01&to={y}-12-31')['rows'] if x['code']==acc[key]['code']),2)
def refused(code, fn, name, has=None):
    try: fn(); ok(False,name)
    except E as e: ok(str(code) in str(e) and (has is None or has in str(e)), name+' → refused')
qty=lambda sku: float({p['sku']:p for p in c('/products')}[sku]['qty'])
c('/journals',{'date':f'{y}-01-01','memo':'رأس المال','lines':[{'accountId':acc['BANK']['id'],'debit':500000,'credit':0},{'accountId':acc['CAPITAL']['id'],'debit':0,'credit':500000}]})
sup=c('/partners',{'name':'مورد المطعم','isSupplier':True,'kind':'COMPANY','vatNumber':'300000000000003' if not EG else '200000001',**ADDR})
cu=c('/partners',{'name':'زبون','isCustomer':True,'kind':'INDIVIDUAL','phone':'0501234567'})
raw=lambda n,s,pp,u='كجم': c('/products',{'name':n,'sku':s,'type':'STOCK','salePrice':0,'purchasePrice':pp,'taxCode':'S','unit':u})
chicken=raw('صدور دجاج','CK',20); spice=raw('بهارات شاورما','SP',40); yog=raw('زبادي','YG',8); oil=raw('زيت','OL',10); garlic=raw('ثوم','GR',12); bread=raw('خبز صاج','BD',0.5,'حبة'); pickle=raw('مخلل','PK',6)
marin=raw('شاورما متبلة (وصفة أولية)','MR',0); cooked=raw('شاورما مطبوخة (وصفة نهائية)','CKD',0); toum=raw('ثومية','TM',0)
sand=c('/products',{'name':'ساندوتش شاورما','sku':'SW','type':'SERVICE','salePrice':15,'taxCode':'S'})
def inv(direction,pid,lines):
    x=c('/invoices',{'direction':direction,'kind':'INVOICE','date':d,'partnerId':pid,'lines':lines}); return c(f"/invoices/{x['id']}/post",{})
inv('PURCHASE',sup['id'],[{'productId':p['id'],'qty':q,'unitPrice':pr,'taxCode':'S'} for p,q,pr in [(chicken,100,20),(spice,10,40),(yog,20,8),(oil,30,10),(garlic,10,12),(bread,500,0.5),(pickle,10,6)]])
rec=lambda p,lines,**k: c(f"/products/{p['id']}/recipe",{'lines':lines,**k},'PUT')
# first recipe: 10 kg chicken + 0.5 spice + 1 yogurt + 0.5 oil = 12 kg in → 12 kg of marinated meat; cost 200+20+8+5 = 233
m=rec(marin,[{'componentId':chicken['id'],'qty':10},{'componentId':spice['id'],'qty':0.5},{'componentId':yog['id'],'qty':1},{'componentId':oil['id'],'qty':0.5}],outputQty=12,method='DIRECT')
ok(m['isPrep'] and near(m['inputTotal'],12) and near(m['yieldPct'],100) and near(m['batchCost'],233) and near(m['cost'],233/12,0.001),'first recipe: 12 kg in, 12 kg out, batch cost 233 → 19.4167 per kg')
refused(400,lambda: rec(cooked,[{'componentId':marin['id'],'qty':12}]),'a preparation without its output','ناتج')
# final recipe: 12 kg marinated → 7.8 kg cooked (65% yield); cost per kg = 233 / 7.8 = 29.8718
k=rec(cooked,[{'componentId':marin['id'],'qty':12}],outputQty=7.8,method='BATCH')
ok(near(k['yieldPct'],65) and near(k['cost'],233/7.8,0.001) and k['lines'][0]['kind']=='PREP_DIRECT','final recipe: 65% yield, 29.8718 per cooked kg, built on the first recipe')
refused(400,lambda: rec(marin,[{'componentId':cooked['id'],'qty':1}],outputQty=1),'a recipe that contains itself','تدور')
tm=rec(toum,[{'componentId':garlic['id'],'qty':1},{'componentId':oil['id'],'qty':2}],outputQty=3,method='DIRECT')      # (12+20)/3 = 10.6667 per kg
# the sandwich: 0.12 kg cooked + 0.03 toum + 1 bread + 0.02 pickle
s=rec(sand,[{'componentId':cooked['id'],'qty':0.12},{'componentId':toum['id'],'qty':0.03},{'componentId':bread['id'],'qty':1},{'componentId':pickle['id'],'qty':0.02}])
unit=0.12*233/7.8+0.03*32/3+0.5+0.12
ok(near(s['cost'],unit,0.01) and [l['kind'] for l in s['lines']]==['PREP_BATCH','PREP_DIRECT','RAW','RAW'],f'sandwich: recipe cost {unit:.4f} from a batch preparation, a direct one and two raw items')
ok(s['canMake']==0,'nothing can be made yet: no cooked shawarma in stock (batch method)')
# ── method 1: the batch (الطبخة) ──
refused(400,lambda: c('/prep-batches',{'productId':marin['id']}),'a batch of a direct-method preparation','الخصم المباشر')
pv=c('/prep-batches/preview',{'productId':cooked['id'],'inputQty':24})
ok(near(pv['expectedQty'],15.6) and near(pv['cost'],466) and len(pv['lines'])==4 and near([l for l in pv['lines'] if l['name']=='صدور دجاج'][0]['qty'],20),'batch preview for 24 kg in: 15.6 kg expected, cost 466, exploded to the 4 raw materials (20 kg chicken)')
iv0=bal('INVENTORY'); cg0=bal('COGS')
b1=c('/prep-batches',{'productId':cooked['id'],'inputQty':24,'outputQty':15,'date':d})
ok(near(b1['cost'],466) and near(b1['unitCost'],466/15,0.001) and near(b1['yieldPct'],62.5),'batch posted: 15 kg came out instead of 15.6 → yield 62.5%, real cost 31.0667 per kg')
ok(near(qty('CK'),80) and near(qty('SP'),9) and near(qty('CKD'),15) and near(qty('MR'),0),'stock: chicken 80, spice 9, cooked shawarma 15; the marinated meat is never stocked')
ok(near(bal('INVENTORY'),iv0) and near(bal('COGS'),cg0) and c('/reports/integrity')['ok'],'the batch moves value inside inventory only: ledger unchanged, valuation still tied')
s2=c(f"/products/{sand['id']}/recipe"); unit1=0.12*466/15+0.03*32/3+0.5+0.12
ok(near(s2['cost'],unit1,0.01) and s2['canMake']==125,f'the sandwich now costs {unit1:.4f} (real batch cost) and 125 can be made')
inv('SALE',cu['id'],[{'productId':sand['id'],'qty':50,'unitPrice':15,'taxCode':'S'}])
ok(near(bal('COGS'),cg0+50*unit1,0.02) and near(bal('INVENTORY'),iv0-50*unit1,0.02),f'50 sandwiches sold: cost of sales {50*unit1:.2f}')
ok(near(qty('CKD'),9) and near(qty('GR'),10-0.5) and near(qty('OL'),30-1-1) and near(qty('BD'),450) and near(qty('PK'),9),'stock after the sale: cooked 9 kg (from the batch), garlic and oil taken directly through the toum, bread 450, pickle 9')
# ── method 2: direct deduction for the cooked meat too ──
refused(400,lambda: rec(cooked,[{'componentId':marin['id'],'qty':12}],outputQty=7.8,method='DIRECT'),'switching to direct while cooked meat is in stock','رصيد')
b2=c('/prep-batches',{'productId':cooked['id'],'batches':1}); x=c(f"/prep-batches/{b2['id']}/cancel",{})
ok(x['status']=='CANCELLED' and near(qty('CKD'),9) and near(qty('CK'),80) and near(bal('INVENTORY'),iv0-50*unit1,0.02) and c('/reports/integrity')['ok'],'a cancelled batch gives the ingredients back and leaves the books tied')
inv('SALE',cu['id'],[{'productId':sand['id'],'qty':75,'unitPrice':15,'taxCode':'S'}])     # uses the remaining 9 kg
ok(near(qty('CKD'),0,0.0005),'the cooked meat is used up')
rec(cooked,[{'componentId':marin['id'],'qty':12}],outputQty=7.8,method='DIRECT')
s3=c(f"/products/{sand['id']}/recipe"); unitD=0.12*233/7.8+0.03*32/3+0.5+0.12
ok(near(s3['cost'],unitD,0.01) and s3['lines'][0]['kind']=='PREP_DIRECT' and s3['canMake']>0,f'direct method: the sandwich costs {unitD:.4f} at the standard yield and can be made from the raw stock')
iv1=bal('INVENTORY'); cg1=bal('COGS'); ck=qty('CK')
inv('SALE',cu['id'],[{'productId':sand['id'],'qty':65,'unitPrice':15,'taxCode':'S'}])     # 65 × 0.12 = 7.8 kg cooked = one batch = 10 kg chicken
ok(near(qty('CK'),ck-10) and near(qty('CKD'),0,0.0005) and near(bal('COGS')-cg1,iv1-bal('INVENTORY'),0.011) and abs(bal('COGS')-cg1-65*unitD)<1,'65 sandwiches by direct deduction: exactly 10 kg of chicken leave stock; cost of sales = what left inventory, within 1 of the standard recipe cost (stock averages)')
P=c('/preps')['rows']; ok(len(P)==3 and {p['name']:p['method'] for p in P}['ثومية']=='DIRECT','preparations list: three, each with its method')
L=c('/prep-batches')['rows']; ok(len(L)==2 and sorted(r['status'] for r in L)==['CANCELLED','POSTED'] and near([r for r in L if r['status']=='POSTED'][0]['variance'],-0.6),'batches list: the posted one shows −0.6 kg against the standard')
tb=c('/reports/trial-balance?from=2000-01-01&to=2099-12-31'); ok(tb['balanced'] and c('/reports/integrity')['ok'],'trial balance balanced and inventory tied to its valuation')
fy=[v for v in c('/fiscal-years')['years'] if v['name']==y][0]; fa=c('/reports/final-accounts?fiscalYearId='+fy['id']); inc=c(f'/reports/income?from={y}-01-01&to={y}-12-31')
ok(fa['ok'] and near(fa['balanceSheet']['totals']['currentResult'][0],inc['net'],0.02),'final accounts: every linkage check holds; the result equals the income statement')
print('FAILS', len(lib.fails)); sys.exit(1 if lib.fails else 0)
