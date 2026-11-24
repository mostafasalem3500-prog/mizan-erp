"""3.48: kitchen stations (each category to its station, tickets split, the kitchen screen filtered), kitchen times
(from «sent» to «ready», by station and item), and the ingredient purchase plan from what actually left the warehouse
through recipes — with the purchase orders it makes, and the reorder list now counting ingredients."""
import sys, os, time, subprocess; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B; DBN='mizan_eg' if EG else 'mizan'; pg=os.environ.get('TEST_PG','postgresql://postgres@127.0.0.1:5433')
t=register('r348'); c=lambda *a,**k: call(*a,tok=t,**k)
A=c('/accounts')['rows']; acc={x.get('systemKey'):x for x in A if x.get('systemKey')}; d=time.strftime('%Y-%m-%d'); y=time.strftime('%Y')
ADDR={'street':'طريق الملك فهد','buildingNo':'1234','district':'العليا','city':'الرياض','postalCode':'12211','phone':'0501234567'}
def refused(code, fn, name, has=None):
    try: fn(); ok(False,name)
    except E as e: ok(str(code) in str(e) and (has is None or has in str(e)), name+' → refused')
c('/journals',{'date':f'{y}-01-01','memo':'رأس المال','lines':[{'accountId':acc['BANK']['id'],'debit':100000,'credit':0},{'accountId':acc['CAPITAL']['id'],'debit':0,'credit':100000}]})
food=c('/categories',{'name':'مشويات'}); sand=c('/categories',{'name':'سندوتشات','parentId':food['id']}); drinks=c('/categories',{'name':'عصائر'}); other=c('/categories',{'name':'حلويات'})
raw=lambda n,s,pp,u='كجم': c('/products',{'name':n,'sku':s,'type':'STOCK','salePrice':0,'purchasePrice':pp,'taxCode':'S','unit':u})
beef=raw('لحم مفروم','BF',40); bun=raw('خبز برجر','BN',1,'حبة'); orange=raw('برتقال','OR',5); salt=raw('ملح','SL',2)
burger=c('/products',{'name':'برجر لحم','sku':'BG','type':'SERVICE','salePrice':25,'taxCode':'S','categoryId':sand['id']})
juice=c('/products',{'name':'عصير برتقال','sku':'JC','type':'SERVICE','salePrice':12,'taxCode':'S','categoryId':drinks['id']})
cake=c('/products',{'name':'كيك','sku':'CK','type':'SERVICE','salePrice':10,'taxCode':'S','categoryId':other['id']})
rec=lambda p,lines,**k: c(f"/products/{p['id']}/recipe",{'lines':lines,**k},'PUT')
rec(burger,[{'componentId':beef['id'],'qty':0.15},{'componentId':bun['id'],'qty':1}]); rec(juice,[{'componentId':orange['id'],'qty':0.3}])
sup=c('/partners',{'name':'مورد اللحوم','isSupplier':True,'kind':'COMPANY','vatNumber':'300000000000003' if not EG else '200000001',**ADDR})
x=c('/invoices',{'direction':'PURCHASE','kind':'INVOICE','date':d,'partnerId':sup['id'],'lines':[{'productId':p['id'],'qty':q,'unitPrice':pr,'taxCode':'S'} for p,q,pr in [(beef,7,40),(bun,42,1),(orange,10,5),(salt,5,2)]]}); c(f"/invoices/{x['id']}/post",{})

# ── stations ──
refused(400,lambda: c('/pos/stations',{'stations':[{'name':'الشواية','categoryIds':[food['id']]},{'name':'الشواية','categoryIds':[]}]},'PUT'),'two stations with the same name')
refused(400,lambda: c('/pos/stations',{'stations':[{'name':'الشواية','categoryIds':[food['id']]},{'name':'البار','categoryIds':[food['id']]}]},'PUT'),'one category in two stations')
S=c('/pos/stations',{'stations':[{'name':'الشواية','icon':'🔥','categoryIds':[food['id']]},{'name':'البار','icon':'🥤','categoryIds':[drinks['id']]}]},'PUT')
ok([s['name'] for s in S]==['الشواية','البار'] and S[0]['icon']=='🔥' and c('/pos/stations')[1]['categoryIds']==[drinks['id']],'two stations saved, each with its categories')
grill,bar=S[0]['id'],S[1]['id']

# ── a table order split between the stations ──
c('/pos/restaurant/settings',{'mode':'RESTAURANT'},m='PUT'); T=c('/pos/restaurant')['floors'][0]['tables']
o=c('/pos/orders',{'tableId':T[0]['id'],'guests':3})
L=lambda p,q,pr: {'key':p['id'],'productId':p['id'],'name':p['name'],'qty':q,'unitPrice':pr,'discountPct':0}
o=c(f"/pos/orders/{o['id']}",{'lines':[L(burger,2,25),L(juice,1,12),L(cake,1,10)]},m='PUT')
tk=c(f"/pos/orders/{o['id']}/send",{})['ticket']
st={s['station']:[i['name'] for i in s['items']] for s in tk.get('stations') or []}
ok(st.get('الشواية')==['برجر لحم'] and st.get('البار')==['عصير برتقال'] and st.get('عام')==['كيك'],f'kitchen ticket split by station: the burger (a sub category of «مشويات») to the grill, the juice to the bar, the cake to «عام» ({st})')
kv=c('/pos/kitchen?v=2'); ok(len(kv['stations'])==2 and len(kv['orders'])==1 and len(kv['orders'][0]['items'])==3 and all(i.get('since') for i in kv['orders'][0]['items']),'kitchen screen: all stations, each item with the time it was sent')
kg=c(f'/pos/kitchen?v=2&station={grill}')['orders']; ok(len(kg)==1 and [i['name'] for i in kg[0]['items']]==['برجر لحم'] and kg[0]['items'][0]['station']=='الشواية','grill screen shows only the burger')
ok(c(f'/pos/kitchen?v=2&station={bar}')['orders'][0]['items'][0]['name']=='عصير برتقال' and isinstance(c('/pos/kitchen'),list),'bar screen shows only the juice; the old kitchen list still works')
c(f"/pos/orders/{o['id']}/ready",{'keys':[burger['id']]})
ok(not c(f'/pos/kitchen?v=2&station={grill}')['orders'] and len(c('/pos/kitchen?v=2')['orders'][0]['items'])==2,'«ready» at the grill clears the burger only; the bar and the cake still wait')
c(f"/pos/orders/{o['id']}/ready",{})
ok(not c('/pos/kitchen?v=2')['orders'],'the rest marked ready: the screen is empty')

# ── kitchen times ──
kp=c(f'/restaurant/kitchen-performance?from={d}&to={d}&late=15')
by={x['key']:x for x in kp['byStation']}
ok(kp['totals'] and kp['totals']['count']==3 and set(by)=={'الشواية','البار','عام'} and by['الشواية']['qty']==2 and kp['totals']['avg']<5,f"kitchen log: 3 lines timed (burger ×2 at the grill), minutes from sending to ready ({kp['totals']})")
cid_=c('/auth/me')['company']['id']
if subprocess.run(['psql',pg+f'/{DBN}','-qc',f"UPDATE kitchen_log SET minutes=CASE WHEN name='برجر لحم' THEN 22 ELSE 6 END WHERE company_id='{cid_}'"],capture_output=True).returncode==0:
    kp=c(f'/restaurant/kitchen-performance?from={d}&to={d}&late=15'); by={x['key']:x for x in kp['byStation']}
    ok(kp['totals']['late']==1 and by['الشواية']['late']==1 and near(kp['totals']['avg'],(22+6+6)/3,0.02) and kp['slow'][0]['name']=='برجر لحم' and kp['byItem'][0]['key']=='برجر لحم',f"one late line (22 min > 15): average {kp['totals']['avg']}, the burger listed slowest")
    ok(c(f'/restaurant/kitchen-performance?from={d}&to={d}&late=30')['totals']['late']==0,'with a 30-minute limit nothing is late')

# ── sell through the POS: the recipes take the ingredients out ──
sess=c('/pos/session/open',{'openingCash':0})
c('/pos/sale',{'sessionId':sess['id'],'lines':[{'productId':burger['id'],'qty':40,'unitPrice':25},{'productId':juice['id'],'qty':10,'unitPrice':12}],'tenders':[{'method':'CASH','amount':None}]})
pl=c('/inventory/purchase-plan?cover=7&lead=2&history=28&onlyRecipe=1')
R={r['sku']:r for r in pl['rows']}
ok(set(R)=={'BF','BN','OR'},f"plan lists the recipe ingredients that were used (salt is not in a recipe) ({sorted(R)})")
ok(near(R['BF']['used'],6) and near(R['BN']['used'],40) and near(R['OR']['used'],3) and near(R['BF']['onHand'],1) and near(R['BN']['onHand'],2),'consumption from the stock card: 6 kg beef, 40 buns, 3 kg oranges; 1 kg beef and 2 buns left')
ok(R['BN']['status']=='critical' and near(R['BN']['coverDays'],round(2/(40/28),2)) and R['BN']['suggested']==11,f"buns: 1.4 days left, less than the 2 days delivery → critical; buy 11 (40/28×9 − 2, whole pieces) ({R['BN']['suggested']})")
ok(R['BF']['status']=='low' and near(R['BF']['suggested'],1.0) and R['OR']['status']=='ok' and R['OR']['suggested']==0,f"beef: low, buy 1.0 kg (6/28×9 − 1, rounded up to 0.1); oranges: enough ({R['BF']['suggested']})")
ok(pl['totals']['critical']==1 and pl['totals']['low']==1 and pl['suppliers'][0]['supplierName']=='مورد اللحوم' and pl['suppliers'][0]['items']==2 and near(pl['totals']['value'],11*1+1.0*40),'totals: one critical, one low, both from the meat supplier, value 51 at the last prices')
ok([r['sku'] for r in pl['rows']][:2]==['BN','BF'],'shortest cover first')
ok('SL' not in {r['sku'] for r in c('/inventory/purchase-plan?onlyRecipe=0')['rows']},'unused salt is not listed even with all items')
# the reorder list now counts what left through the recipes
ro={r['sku']:r for r in c('/inventory/reorder?all=1')}
ok('BN' in ro and near(ro['BN']['sold90'],40) and ro['BN']['suggested']>0,f"reorder suggestions count the buns used by the burgers (before 3.48 they had no «sales») ({ro.get('BN',{}).get('sold90')})")
# purchase orders from the plan
po=c('/inventory/reorder/orders',{'items':[{'productId':R[k]['productId'],'qty':R[k]['suggested'],'supplierId':R[k]['supplierId'],'price':R[k]['price']} for k in ('BN','BF')]})
ok(len(po)==1 and po[0]['lines']==2,'one purchase order for the meat supplier with the two items')
pl2={r['sku']:r for r in c('/inventory/purchase-plan?cover=7&lead=2&history=28&onlyRecipe=1')['rows']}
ok(near(pl2['BN']['onOrder'],11) and pl2['BN']['suggested']==0 and pl2['BF']['suggested']==0,'after ordering: the quantities show as «on the way» and nothing more is suggested')
# the assistant
def ask(text):
    r=c('/ai/chat',{'text':text}); v=r['view'][-1]; return v.get('text') or v.get('content') or str(v)
a=ask('ايش اشتري للمطبخ؟')
ok('خطة الشراء' in a and 'خبز برجر' in a and 'recipes?tab=buy' in a,'assistant: «what do I buy for the kitchen» → the purchase plan with the buns')
a=ask('أداء المطبخ')
ok('أداء المطبخ' in a and 'دقيقة' in a,'assistant: kitchen performance')
tb=c('/reports/trial-balance?from=2000-01-01&to=2099-12-31'); ok(tb['balanced'] and c('/reports/integrity')['ok'],'trial balance balanced and sub-ledgers tied')
print('FAILS', len(lib.fails)); sys.exit(1 if lib.fails else 0)
