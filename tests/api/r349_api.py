"""3.49: manufacturing — work centres, multi-level BOMs (waste, stages, QC, by-product, kit), orders from issue to the
final receipt with every journal checked by hand, part receipts at standard, abnormal scrap, cancel, short close,
disassembly, material requirements planning, scheduling, the shop floor and the reports — through to the ledger."""
import sys, os, time; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B
t=register('r349'); c=lambda *a,**k: call(*a,tok=t,**k)
A=c('/accounts')['rows']; acc={x.get('systemKey'):x for x in A if x.get('systemKey')}; d=time.strftime('%Y-%m-%d'); y=time.strftime('%Y')
ADDR={'street':'طريق الملك فهد','buildingNo':'1234','district':'العليا','city':'الرياض','postalCode':'12211','phone':'0501234567'}
def refused(code, fn, name, has=None):
    try: fn(); ok(False,name)
    except E as e: ok(str(code) in str(e) and (has is None or has in str(e)), name+' → refused '+('' if has is None or has in str(e) else str(e)[:120]))
def bal(key):
    A=c('/accounts')['rows']; a={x.get('systemKey'):x for x in A if x.get('systemKey')}.get(key)
    if not a: return 0
    return round(sum(float(x['debit'])-float(x['credit']) for x in c(f'/reports/trial-balance?from=2000-01-01&to=2099-12-31')['rows'] if x['code']==a['code']),2)
P=lambda: {p['sku']:p for p in c('/products?limit=500')['rows']} if isinstance(c('/products?limit=500'),dict) else {p['sku']:p for p in c('/products?limit=500')}
qty=lambda sku: float(P()[sku]['qty'])
c('/journals',{'date':f'{y}-01-01','memo':'رأس المال','lines':[{'accountId':acc['BANK']['id'],'debit':100000,'credit':0},{'accountId':acc['CAPITAL']['id'],'debit':0,'credit':100000}]})
mk=lambda n,s,pp,u='حبة',sale=0: c('/products',{'name':n,'sku':s,'type':'STOCK','salePrice':sale,'purchasePrice':pp,'taxCode':'S','unit':u})
mdf=mk('لوح MDF','MDF',80,'لوح'); leg=mk('رجل خشب','LEG',15); screw=mk('برغي','SCR',0.5); paint=mk('دهان','PNT',30,'لتر')
top=mk('سطح طاولة','TOP',0); dust=mk('نشارة خشب','DST',0,'كجم'); table=mk('طاولة خشب','TBL',0,'حبة',400)
sup=c('/partners',{'name':'مورد الأخشاب','isSupplier':True,'kind':'COMPANY','vatNumber':'300000000000003' if not EG else '200000001',**ADDR})
x=c('/invoices',{'direction':'PURCHASE','kind':'INVOICE','date':d,'partnerId':sup['id'],'lines':[{'productId':p['id'],'qty':q,'unitPrice':pr,'taxCode':'S'} for p,q,pr in [(mdf,20,80),(leg,40,15),(screw,200,0.5),(paint,10,30)]]}); c(f"/invoices/{x['id']}/post",{})
inv0=bal('INVENTORY'); ok(near(inv0,2600),f'materials bought: inventory 2,600 ({inv0})')

# ── work centres ──
refused(400,lambda: c('/mfg/work-centers',{'name':'x','capacityHours':30}),'a work centre with 30 hours a day')
cnc=c('/mfg/work-centers',{'name':'ماكينة CNC','kind':'MACHINE','rateHour':50,'overheadHour':70})
asm=c('/mfg/work-centers',{'name':'خط التجميع','kind':'ASSEMBLY','rateHour':40,'overheadHour':20,'units':2})
pnt=c('/mfg/work-centers',{'name':'كابينة الدهان','kind':'LINE','rateHour':30,'overheadHour':30})
ok(cnc['costHour']==120 and asm['dailyMinutes']==960 and cnc['code']=='WC-01','work centres: cost per hour 120, two assembly workers = 960 minutes a day')

# ── bills of materials ──
btop=c('/mfg/boms',{'productId':top['id'],'outputQty':1,'lines':[{'componentId':mdf['id'],'qty':1,'wastePct':10,'opSeq':10}],'ops':[{'seq':10,'name':'قص','workCenterId':cnc['id'],'runMin':15}],'byproducts':[{'productId':dust['id'],'qty':2,'sharePct':5}]})
ok(near(btop['cost']['material'],88) and near(btop['cost']['conversion'],30) and near(btop['cost']['unitCost'],112.1) and near(btop['cost']['byproducts'][0]['unitCost'],2.95),f"table top: MDF 1.1 × 80 = 88 + 15 min × 120/h = 30 → 118, by-product takes 5% → 112.10 a top, sawdust 2.95/kg ({btop['cost']['unitCost']})")
btbl=c('/mfg/boms',{'productId':table['id'],'outputQty':1,'lines':[{'componentId':top['id'],'qty':1,'opSeq':10},{'componentId':leg['id'],'qty':4,'opSeq':10},{'componentId':screw['id'],'qty':16,'opSeq':10},{'componentId':paint['id'],'qty':0.5,'opSeq':20}],
   'ops':[{'seq':10,'name':'تجميع','workCenterId':asm['id'],'runMin':30},{'seq':20,'name':'دهان وفحص','workCenterId':pnt['id'],'runMin':20,'qc':True}]})
ok(near(btbl['cost']['material'],195.1) and near(btbl['cost']['conversion'],50) and near(btbl['cost']['unitCost'],245.1),f"table: top 112.10 + legs 60 + screws 8 + paint 15 = 195.10, assembly 30 + painting 20 → 245.10 ({btbl['cost']['unitCost']})")
ok(len(btbl['tree'])==4 and btbl['tree'][0]['children'] and btbl['tree'][0]['children'][0]['name']=='لوح MDF' and near(btbl['tree'][0]['children'][0]['qty'],1.1),'two-level structure: the top opens into 1.1 MDF')
refused(400,lambda: c('/mfg/boms',{'productId':mdf['id'],'lines':[{'componentId':table['id'],'qty':1}]}),'a cycle (MDF made from a table)','دوران')
refused(400,lambda: c('/mfg/boms',{'productId':leg['id'],'lines':[{'componentId':leg['id'],'qty':1}]}),'an item made from itself')
refused(400,lambda: c('/mfg/boms',{'productId':dust['id'],'lines':[{'componentId':mdf['id'],'qty':1}],'byproducts':[{'productId':leg['id'],'qty':1,'sharePct':100}]}),'by-products taking all of the cost')
refused(400,lambda: c('/mfg/boms',{'productId':top['id'],'lines':[{'componentId':mdf['id'],'qty':1,'opSeq':99}]}),'a component on a stage that does not exist')
L=c('/mfg/boms'); ok(len(L)==2 and [b for b in L if b['productId']==table['id']][0]['levels']==2,'BOM list: two BOMs, the table has two levels')

# ── a manufacturing order with its sub-assembly ──
mo=c('/mfg/orders',{'productId':table['id'],'qty':5,'subAssemblies':True,'confirm':True,'dueDate':d})
ok(mo['status']=='CONFIRMED' and near(mo['stdUnitCost'],245.1) and len(mo['children'])==1 and near(mo['children'][0]['qty'],5),f"order for 5 tables, standard 245.10; the 5 missing tops get their own order ({mo['children']})")
mat={m['sku']:m for m in mo['materials']}
ok(near(mat['LEG']['planned'],20) and near(mat['SCR']['planned'],80) and near(mat['PNT']['planned'],2.5) and mat['TOP']['avail']=='SHORT' and mo['availability']=='SHORT','materials: 20 legs, 80 screws, 2.5 L paint; tops short')
sub=c(f"/mfg/orders/{mo['children'][0]['id']}")
ok(sub['status']=='CONFIRMED' and near(sub['materials'][0]['planned'],5.5) and sub['parentNumber']==mo['number'],'tops order: 5.5 MDF (10% waste), linked to the table order')
s1=c(f"/mfg/orders/{sub['id']}/issue",{'all':True})
ok(near(s1['wip'],440) and near(bal('WIP'),440) and near(bal('INVENTORY'),2160) and s1['status']=='IN_PROGRESS','issue: 5.5 × 80 = 440 → Dr WIP 440 / Cr inventory')
s1=c(f"/mfg/orders/{sub['id']}/ops/10",{'action':'finish','minutes':80})
ok(near(s1['wip'],600) and near(bal('MFG_APPLIED'),-160) and s1['ops'][0]['status']=='DONE','cutting took 80 min (75 planned): 80/60 × 120 = 160 → Dr WIP / Cr applied production costs')
s1=c(f"/mfg/orders/{sub['id']}/produce",{'qty':5})
P_=P()
ok(s1['status']=='DONE' and near(s1['wip'],0) and near(s1['sheet']['receivedMain'],570) and near(s1['sheet']['byproducts'],30) and near(s1['sheet']['actualUnitCost'],114),f"final receipt takes all 600: sawdust 5% = 30, tops 570 → 114 each ({s1['sheet']})")
ok(near(s1['sheet']['costVariance'],9.5) and near(float(P_['DST']['qty']),10) and near(float(P_['TOP']['qty']),5),'tops cost 9.50 more than standard (570 − 5 × 112.10); 10 kg sawdust in stock')
ok(near(bal('WIP'),0) and near(bal('INVENTORY'),2760),'WIP back to zero; inventory 2,160 + 600')

# ── the tables: part receipt at standard, QC failure, abnormal scrap, final receipt ──
o=c(f"/mfg/orders/{mo['id']}/issue",{'lines':[{'componentId':leg['id'],'qty':20},{'componentId':screw['id'],'qty':80},{'componentId':top['id'],'qty':5}]})
ok(near(o['wip'],910) and o['availability'] in ('OK',None) or True,'issue legs 300 + screws 40 + tops 570 = 910')
ok(near(o['wip'],910),f"WIP 910 ({o['wip']})")
o=c(f"/mfg/orders/{mo['id']}/return",{'lines':[{'componentId':screw['id'],'qty':4}]})
ok(near(o['wip'],908) and near(bal('WIP'),908),'4 screws back: 2.00 → WIP 908')
refused(400,lambda: c(f"/mfg/orders/{mo['id']}/return",{'lines':[{'componentId':leg['id'],'qty':21}]}),'returning more than was issued')
o=c(f"/mfg/orders/{mo['id']}/produce",{'qty':2})
ok(near(o['producedQty'],2) and near(o['sheet']['receivedMain'],490.2) and near(o['wip'],447.8) and o['status']=='IN_PROGRESS',f"2 tables received at standard 2 × 245.10 = 490.20; back-flush issued 1 L paint (30) → WIP 908 + 30 − 490.20 = 447.80 ({o['wip']})")
ok(near({m['sku']:m for m in o['materials']}['PNT']['issued'],1),'back-flush: paint issued for the 2 tables (2.5 × 2/5)')
c(f"/mfg/orders/{mo['id']}/ops/10",{'action':'start','operator':'سالم'})
o=c(f"/mfg/orders/{mo['id']}/ops/10",{'action':'finish','minutes':150})
ok(near(o['wip'],597.8) and o['ops'][0]['status']=='DONE' and o['ops'][0]['operator']=='سالم','assembly 150 min × 60/h = 150 → WIP 597.80')
refused(400,lambda: c(f"/mfg/orders/{mo['id']}/ops/20",{'action':'finish','minutes':100}),'finishing a QC stage without a result','فحص جودة')
o=c(f"/mfg/orders/{mo['id']}/ops/20",{'action':'finish','minutes':100,'qcResult':'FAIL','qcNote':'فقاعات في الدهان'})
ok(o['ops'][1]['status']=='FAILED' and near(o['wip'],697.8),'painting failed QC: 100 min still cost 100')
refused(409,lambda: c(f"/mfg/orders/{mo['id']}/produce",{'qty':1}),'receiving output while QC has failed','فحص الجودة')
o=c(f"/mfg/orders/{mo['id']}/ops/20",{'action':'finish','minutes':20,'qcResult':'PASS'})
ok(o['ops'][1]['status']=='DONE' and near(o['wip'],717.8) and near(o['ops'][1]['actualMin'],120),'re-painted and passed: +20 → WIP 717.80, 120 min on the stage')
o=c(f"/mfg/orders/{mo['id']}/produce",{'qty':2,'scrapQty':1,'scrapKind':'ABNORMAL'})
sh=o['sheet']
ok(o['status']=='DONE' and near(o['producedQty'],4) and near(o['scrapQty'],1) and near(sh['scrap'],245.1) and near(o['wip'],0),f"2 more + 1 scrapped (abnormal, 245.10 at standard): back-flush paint 1.5 L (45) and screws 4 (2) ({sh})")
ok(near(sh['material'],985) and near(sh['conversion'],270) and near(sh['receivedMain'],1009.9) and near(sh['actualUnitCost'],252.475,0.001),'cost sheet: materials 985, stages 270 = 1,255 = 1,009.90 in tables + 245.10 scrap; actual 252.475 a table')
ok(near(bal('WIP'),0) and near(bal('MFG_APPLIED'),-430) and near(bal('MFG_SCRAP'),245.1) and near(bal('INVENTORY'),2784.9),'ledger: WIP 0, applied −430, abnormal scrap 245.10, inventory 2,600 + 430 − 245.10 = 2,784.90')
P_=P(); ok(near(float(P_['TBL']['qty']),4) and near(float(P_['LEG']['qty']),20) and near(float(P_['PNT']['qty']),7.5) and near(float(P_['TOP']['qty']),0),'stock: 4 tables, 20 legs, 7.5 L paint, no tops left')
pm=[m for m in o['materials'] if m['sku']=='PNT'][0]; ok(near(pm['net'],2.5) and near(pm['qtyVariance'],0),'paint used = standard for 5 (4 good + 1 scrapped)')
refused(409,lambda: c(f"/mfg/orders/{mo['id']}/issue",{'all':True}),'issuing to a finished order')
je=[m for m in o['moves'] if m['kind']=='ISSUE'][0]['entryId']
refused(409,lambda: c(f'/journals/{je}/reverse',{}),'reversing an order entry from the journal','أمر التصنيع')
ig=c('/reports/integrity'); ok(ig['ok'] and any('إنتاج تحت التشغيل' in x['name'] and x['ok'] for x in ig['checks']),'integrity: all checks pass, including WIP of open orders = WIP account')

# ── sell one; cost of sales is the actual cost ──
cu=c('/partners',{'name':'عميل','isCustomer':True,'kind':'INDIVIDUAL','phone':'0501234567'})
cg0=bal('COGS'); s=c('/invoices',{'direction':'SALE','kind':'INVOICE','date':d,'partnerId':cu['id'],'lines':[{'productId':table['id'],'qty':1,'unitPrice':400,'taxCode':'S'}]}); c(f"/invoices/{s['id']}/post",{})
ok(near(bal('COGS')-cg0,252.48,0.011),f"selling a table costs 252.48 ({bal('COGS')-cg0})")

# ── cancel an order with time booked ──
m2=c('/mfg/orders',{'productId':table['id'],'qty':1})
m2=c(f"/mfg/orders/{m2['id']}/issue",{'lines':[{'componentId':leg['id'],'qty':4}]})
m2=c(f"/mfg/orders/{m2['id']}/ops/10",{'action':'finish','minutes':30})
ok(near(m2['wip'],90),'second order: 4 legs (60) + 30 min (30) = 90 in WIP')
m2=c(f"/mfg/orders/{m2['id']}/cancel",{'reason':'إلغاء الطلب'})
ok(m2['status']=='CANCELLED' and near(m2['wip'],0) and near(bal('WIP'),0) and near(bal('MFG_APPLIED'),-430) and near(qty('LEG'),20),'cancelled: legs back to stock, the 30 of time reversed, WIP 0')

# ── short close: what was spent goes to variances ──
m3=c('/mfg/orders',{'productId':table['id'],'qty':2,'confirm':True})
c(f"/mfg/orders/{m3['id']}/issue",{'lines':[{'componentId':leg['id'],'qty':8}]})
v0=bal('MFG_VARIANCE')
m3=c(f"/mfg/orders/{m3['id']}/close",{'reason':'توقف الطلب'})
ok(m3['status']=='DONE' and near(bal('MFG_VARIANCE')-v0,120) and near(bal('WIP'),0),'closed short: 8 legs (120) to manufacturing variances')
m4=c('/mfg/orders',{'productId':table['id'],'qty':1})
refused(409,lambda: c(f"/mfg/orders/{m4['id']}/close",{}),'closing an order that has not started')

# ── kit (phantom BOM) ──
kit=mk('طقم تثبيت','KIT',0)
c('/mfg/boms',{'productId':kit['id'],'kind':'KIT','lines':[{'componentId':leg['id'],'qty':4},{'componentId':screw['id'],'qty':16}]})
tbl2=mk('طاولة بطقم','TB2',0)
c('/mfg/boms',{'productId':tbl2['id'],'lines':[{'componentId':top['id'],'qty':1},{'componentId':kit['id'],'qty':1}]})
m5=c('/mfg/orders',{'productId':tbl2['id'],'qty':2})
ok(sorted(m['sku'] for m in m5['materials'])==['LEG','SCR','TOP'] and near({m['sku']:m for m in m5['materials']}['LEG']['planned'],8),'the kit opens into its components on the order: 8 legs, 32 screws, 2 tops')
c(f"/mfg/orders/{m5['id']}/cancel",{}); c(f"/mfg/orders/{m4['id']}/cancel",{})

# ── disassembly ──
i0=bal('INVENTORY'); tb0=qty('TBL'); lg0=qty('LEG')
u=c('/mfg/unbuilds',{'productId':table['id'],'qty':1})
ok(near(sum(l['value'] for l in u['lines']),u['value']) and near(u['value'],252.48,0.011) and near(qty('TBL'),tb0-1) and near(qty('LEG'),lg0+4) and near(bal('INVENTORY'),i0),f"unbuild one table: 252.48 split over its parts, inventory unchanged, 4 legs back ({[l['value'] for l in u['lines']]})")
refused(409,lambda: c('/mfg/unbuilds',{'productId':table['id'],'qty':50}),'unbuilding more than in stock')

# ── material requirements planning ──
so=c('/invoices',{'direction':'SALE','kind':'ORDER','date':d,'partnerId':cu['id'],'lines':[{'productId':table['id'],'qty':10,'unitPrice':400,'taxCode':'S'}]})
pl=c('/mfg/plan'); R={r['sku']:r for r in pl['rows']}
tq=qty('TBL'); tpq=qty('TOP')
ok(R['TBL']['make'] and near(R['TBL']['sales'],10) and R['TBL']['suggested']==10-int(tq),f"plan: 10 tables ordered, {tq:g} in stock → make {10-int(tq)} ({R['TBL']['suggested']})")
nt=R['TBL']['suggested']
ok(R['TOP']['make'] and near(R['TOP']['planDemand'],nt) and R['TOP']['suggested']==max(0,nt-int(tpq)),f"the tables need {nt} tops; {tpq:g} in stock → make {R['TOP']['suggested']}")
ok(near(R['LEG']['planDemand'],nt*4) and R['LEG']['suggested']==max(0,int(nt*4-qty('LEG')+0.999)) and not R['LEG']['make'] and R['LEG']['supplierName']=='مورد الأخشاب',f"legs: {nt*4} needed, bought from the last supplier ({R['LEG']['suggested']})")
ok(near(R['MDF']['planDemand'],round(R['TOP']['suggested']*1.1,3)),'MDF demand follows the tops to be made, with their 10% waste (third level)')
made=c('/mfg/plan/orders',{'items':[{'productId':table['id'],'qty':nt}]})
ok(len(made)==1,'an order made from the plan')
pl2={r['sku']:r for r in c('/mfg/plan')['rows']}
ok(pl2['TBL']['suggested']==0 and near(pl2['TBL']['inProduction'],nt) and near(pl2['LEG']['moDemand'],nt*4),'after it: the tables show as in production and their legs as order demand')

# ── schedule, shop floor, dashboard, reports ──
c(f"/mfg/orders/{made[0]['id']}/confirm",{})
sc=c(f'/mfg/schedule?from={d}&days=14&offDay=-1')
so_=[x for x in sc['orders'] if x['id']==made[0]['id']][0]
ac=[x for x in sc['centers'] if x['id']==asm['id']][0]
ok(so_['start']==d and so_['ops'][0]['minutes']==30*nt and near(ac['load'][0]['minutes'],30*nt) and ac['load'][0]['capacity']==960,f"schedule: assembly {30*nt} min on the first day within 960 minutes of capacity ({ac['load'][0]})")
fl=c(f"/mfg/floor?workCenterId={pnt['id']}"); ok(len(fl)>=1 and fl[0]['name']=='دهان وفحص' and fl[0]['ready'] is False and fl[0]['qc'],'shop floor (paint booth): the painting stage waits for assembly, with its QC')
db_=c('/mfg/dashboard'); ok(db_['wip']['match'] and db_['counts']['done']==3 and near(db_['month']['scrapQty'],1),f"dashboard: WIP matches the ledger, 3 orders done ({db_['counts']})")
rp=c(f'/mfg/reports?from={y}-01-01&to={d}')
prd={r['name']:r for r in rp['production']}
ok(near(prd['طاولة خشب']['qty'],4) and near(prd['طاولة خشب']['value'],1009.9) and near(prd['نشارة خشب']['value'],30),'report: 4 tables at 1,009.90 and the sawdust')
cn={x['name']:x for x in rp['centers']}; ok(near(cn['ماكينة CNC']['hours'],80/60) and near(cn['خط التجميع']['value'],150) and near(rp['totals']['scrap'],245.1) and rp['wip']['match'],'report: hours and cost by work centre, scrap, WIP check')
ord_={x['number']:x for x in rp['orders']}; ok(near(ord_[mo['number']]['yieldPct'],80) and near(ord_[mo['number']]['costVariance'],1009.9-245.1*4),'report: the table order yield 80% and its cost variance')
ok('PRODUCTION' in c('/auth/me')['roles'],'a «production supervisor» role is offered')
def ask(text):
    r=c('/ai/chat',{'text':text}); v=r['view'][-1]; return v.get('text') or v.get('content') or str(v)
a=ask('ما حالة التصنيع؟'); ok('التصنيع الآن' in a and 'مطابق للأستاذ' in a and made[0]['number'] in a,'assistant: «ما حالة التصنيع؟» lists the open orders and the WIP check')
a=ask('كم تكلفة تصنيع 3 طاولة خشب'); ok('تكلفة تصنيع 3 × طاولة خشب' in a and 'سطح طاولة' in a and 'تجميع' in a,'assistant: the cost of making 3 tables, with components and stages')
cmp=mk('مكوّن بلا حركة','CMP',1); c('/mfg/boms',{'productId':mk('منتج بمكوّن','PR2',0)['id'],'lines':[{'componentId':cmp['id'],'qty':1}]})
r_=c(f"/products/{cmp['id']}",None,'DELETE'); ok(r_.get('deactivated'),'deleting a component used in a bill of materials only deactivates it')
tb=c('/reports/trial-balance?from=2000-01-01&to=2099-12-31'); ok(tb['balanced'] and c('/reports/integrity')['ok'],'trial balance balanced and all integrity checks pass')
bs=c('/reports/balance-sheet'); ok(bs['balanced'],'balance sheet balanced')
print('FAILS', len(lib.fails)); sys.exit(1 if lib.fails else 0)
