"""3.47: category tree (sub categories, icon, order, merge, move, delete), category profitability rolled up, the business
pulse against the ledger, sales breakdown, peak hours, smart observations, and the assistant's new answers."""
import sys, os, time, datetime; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B; R=0.14 if EG else 0.15
t=register('r347'); c=lambda *a,**k: call(*a,tok=t,**k)
A=c('/accounts')['rows']; acc={x.get('systemKey'):x for x in A if x.get('systemKey')}; d=time.strftime('%Y-%m-%d'); y=time.strftime('%Y')
ADDR={'street':'طريق الملك فهد','buildingNo':'1234','district':'العليا','city':'الرياض','postalCode':'12211','phone':'0501234567'}
def refused(code, fn, name, has=None):
    try: fn(); ok(False,name)
    except E as e: ok(str(code) in str(e) and (has is None or has in str(e)), name+' → refused')
c('/journals',{'date':f'{y}-01-01','memo':'رأس المال','lines':[{'accountId':acc['BANK']['id'],'debit':100000,'credit':0},{'accountId':acc['CAPITAL']['id'],'debit':0,'credit':100000}]})
# ── the tree ──
drinks=c('/categories',{'name':'مشروبات','icon':'🥤','color':'#0ea5e9'})
hot=c('/categories',{'name':'مشروبات ساخنة','parentId':drinks['id'],'icon':'☕'})
cold=c('/categories',{'name':'مشروبات باردة','parentId':drinks['id']})
iced=c('/categories',{'name':'قهوة مثلجة','parentId':cold['id']})
food=c('/categories',{'name':'مأكولات','icon':'🍔'})
refused(409,lambda: c('/categories',{'name':'مشروبات ساخنة'}),'a second category with the same name','يوجد')
refused(400,lambda: c(f"/categories/{drinks['id']}",{'name':'مشروبات','parentId':iced['id']},'PUT'),'putting a category under its own sub category','تحت هذا')
refused(400,lambda: c('/categories',{'name':'مستوى رابع','parentId':iced['id']}),'a fourth level','ثلاثة مستويات')
L={x['name']:x for x in c('/categories')}
ok(L['قهوة مثلجة']['depth']==2 and L['قهوة مثلجة']['path']=='مشروبات › مشروبات باردة › قهوة مثلجة' and L['مشروبات']['children']==2 and L['مشروبات']['icon']=='🥤','tree: depth, full path, children count and icon')
names=[x['name'] for x in c('/categories')]
ok(names.index('مشروبات')<names.index('مشروبات ساخنة')<names.index('مأكولات') and names.index('مشروبات باردة')<names.index('قهوة مثلجة'),'listed in tree order: each parent followed by what is below it')
mk=lambda n,s,cat,price,cost: c('/products',{'name':n,'sku':s,'type':'STOCK','salePrice':price,'purchasePrice':cost,'taxCode':'S','categoryId':cat})
tea=mk('شاي','T1',hot['id'],5,1); latte=mk('لاتيه مثلج','L1',iced['id'],15,5); juice=mk('عصير','J1',cold['id'],8,3); burger=mk('برجر','B1',food['id'],20,9); misc=mk('كيس','K1',None,1,0.2)
P=lambda q: {p['sku'] for p in c(f'/products?categoryId={q}')}
ok(P(drinks['id'])=={'T1','L1','J1'} and P(cold['id'])=={'L1','J1'} and P(iced['id'])=={'L1'},'the item list of a main category includes everything below it')
L={x['name']:x for x in c('/categories')}; ok(L['مشروبات']['total']==3 and L['مشروبات']['count']==0,'item count: 3 under «مشروبات», none directly')
c('/categories/reorder',{'ids':[food['id'],drinks['id']]},'PUT'); ok([x['name'] for x in c('/categories') if not x['parentId']]==['مأكولات','مشروبات'],'reorder the main categories')
# ── sales, rolled up ──
sup=c('/partners',{'name':'مورد','isSupplier':True,'kind':'COMPANY','vatNumber':'300000000000003' if not EG else '200000001',**ADDR})
x=c('/invoices',{'direction':'PURCHASE','kind':'INVOICE','date':d,'partnerId':sup['id'],'lines':[{'productId':p['id'],'qty':100,'unitPrice':cst,'taxCode':'S'} for p,cst in [(tea,1),(latte,5),(juice,3),(burger,9),(misc,0.2)]]}); c(f"/invoices/{x['id']}/post",{})
sess=c('/pos/session/open',{'openingCash':0})
sale=lambda lines: c('/pos/sale',{'sessionId':sess['id'],'lines':lines,'tenders':[{'method':'CASH','amount':None}]})
incl=bool(c('/auth/me')['company'].get('pricesIncludeVat'))
sale([{'productId':tea['id'],'qty':10,'unitPrice':5},{'productId':latte['id'],'qty':4,'unitPrice':15},{'productId':juice['id'],'qty':5,'unitPrice':8}])
sale([{'productId':burger['id'],'qty':6,'unitPrice':20},{'productId':misc['id'],'qty':10,'unitPrice':1}])
net=lambda v: v/(1+R) if incl else v
st=c(f'/categories/stats?from={d}&to={d}'); S={r['name']:r for r in st['rows']}
ok(near(S['مشروبات']['revenue'],net(50+60+40),0.03) and near(S['مشروبات باردة']['revenue'],net(100),0.03) and near(S['قهوة مثلجة']['revenue'],net(60),0.03),'profitability rolls up: cold drinks = juice + iced latte, drinks = all three')
ok(near(S['مشروبات']['cost'],10+20+15) and near(S['مشروبات']['profit'],S['مشروبات']['revenue']-45,0.02) and near(S['مأكولات']['cost'],54),'cost of each category from what left stock (drinks 45, food 54)')
ok(near(st['uncategorised']['revenue'],net(10),0.03) and near(st['totalRevenue'],net(280),0.05) and near(S['مشروبات']['sharePct']+S['مأكولات']['sharePct']+st['uncategorised']['revenue']/st['totalRevenue']*100,100,0.1),'uncategorised shown apart; the main categories and the rest add up to 100%')
inc=c(f'/reports/income?from={d}&to={d}'); ok(near(st['totalRevenue'],inc['netSales'],0.03),'categories total = net sales in the income statement')
rc=c(f"/reports/run/sales.summary?from={d}&to={d}&categoryId={drinks['id']}&groupBy=product")
ok(len(rc['rows'])==3,'report centre: filtering by the main category brings the items of its sub categories')
# ── move, merge, delete ──
r=c('/categories/move-products',{'productIds':[juice['id']],'categoryId':hot['id']}); ok(r['moved']==1 and P(hot['id'])=={'T1','J1'},'move an item to another category')
r=c(f"/categories/{iced['id']}/merge",{'into':hot['id']}); ok(r['items']==1 and P(hot['id'])=={'T1','J1','L1'} and 'قهوة مثلجة' not in [x['name'] for x in c('/categories')],'merge: its items move and the category is gone')
refused(400,lambda: c(f"/categories/{drinks['id']}/merge",{'into':hot['id']}),'merging a category into one below it','تحته')
c(f"/categories/{drinks['id']}",method='DELETE') if False else call(f"/categories/{drinks['id']}",None,'DELETE',tok=t)
L={x['name']:x for x in c('/categories')}; ok('مشروبات' not in L and L['مشروبات ساخنة']['parentId'] is None and L['مشروبات باردة']['parentId'] is None,'delete: its sub categories move up and keep their items')
# ── pulse ──
p=c('/dashboard/pulse?period=month'); K={k['key']:k for k in p['kpis']}
mi=c(f'/reports/income?from={p["from"]}&to={p["to"]}')
ok(near(K['sales']['value'],mi['netSales']) and near(K['gross']['value'],mi['grossProfit']) and near(K['net']['value'],mi['net']) and near(K['expenses']['value'],mi['opex']['total']),'pulse: sales, gross profit, net profit and expenses equal the income statement for the month')
ok(K['docs']['value']==2 and near(K['ticket']['value'],K['sales']['value']/2,0.02) and K['sales']['changePct'] is None,'pulse: two sales, average ticket = sales ÷ 2; no previous period to compare')
ok(p['seriesBy']=='day' and near(sum(x['v'] for x in p['series']),K['sales']['value'],0.03),'the daily series adds up to the period sales')
pt=c('/dashboard/pulse?period=today'); ok(pt['seriesBy']=='hour' and len(pt['series'])==24 and near(sum(x['v'] for x in pt['series']),K['sales']['value'],0.03),'today: hourly series of 24 hours')
py=c('/dashboard/pulse?period=year'); ok(py['from']==f'{y}-01-01' and py['prevFrom']==f'{int(y)-1}-01-01','year: from 1 January, compared with the same span last year')
# ── breakdown, peak hours, insights ──
bk=c(f'/analytics/breakdown?by=category&from={d}&to={d}'); ok(near(sum(r['revenue'] for r in bk['rows']),bk['total']) and near(bk['total'],inc['netSales'],0.03),'breakdown by category adds up to net sales')
hr_=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=2 if EG else 3))).hour
bh=c(f'/analytics/breakdown?by=hour&from={d}&to={d}'); ok(len(bh['rows'])==1 and bh['rows'][0]['key']==f'{hr_:02d}:00','breakdown by hour: the till sales fall in this hour '+f'{hr_:02d}:00')
hm=c('/analytics/heatmap?days=7'); ok(hm['peak']['hour']==hr_ and hm['peak']['docs']==2 and hm['timed']==2,'peak hours: the two sales at this hour today')
ins=c('/dashboard/insights'); ok(isinstance(ins['items'],list) and all({'title','text','level'}<=set(i) for i in ins['items']),'smart observations: a list of titled notes')
def ask(text):
    r=c('/ai/chat',{'text':text}); v=r['view'][-1]; return v.get('text') or v.get('content') or str(v)
a=ask('المبيعات حسب التصنيف اليوم'); ok('مأكولات' in a and '[[bars:2]]' in a and 'الحصة' in a,'assistant: «المبيعات حسب التصنيف اليوم» answers with a table and bars')
a=ask('المبيعات حسب الساعة'); ok(f'{hr_:02d}:00' in a,'assistant: sales by hour')
a=ask('متى وقت الذروة؟'); ok('أوقات الذروة' in a and f'{hr_:02d}:00' in a,'assistant: peak hours')
a=ask('ملاحظاتك على الوضع'); ok('ملاحظات' in a,'assistant: smart observations')
tb=c('/reports/trial-balance?from=2000-01-01&to=2099-12-31'); ok(tb['balanced'] and c('/reports/integrity')['ok'],'trial balance balanced and sub-ledgers tied')
print('FAILS', len(lib.fails)); sys.exit(1 if lib.fails else 0)
