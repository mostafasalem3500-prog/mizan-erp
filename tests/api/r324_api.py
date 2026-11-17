import sys, os, time; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B; R=0.14 if EG else 0.15
t=register('r324'); c=lambda *a,**k: call(*a,tok=t,**k)
def ask(text, conv=None, **kw):
    r=c('/ai/chat',{'text':text, **({'conversationId':conv} if conv else {}), **kw}); return r, r['view'][-1]
A=c('/accounts')['rows']; acc={x.get('systemKey'):x for x in A if x.get('systemKey')}; y=time.strftime('%Y'); d=time.strftime('%Y-%m-%d')
def bal(k):
    tb=c(f'/reports/trial-balance?from={y}-01-01&to={y}-12-31'); r=[x for x in tb['rows'] if x['id']==acc[k]['id']]; return round(float(r[0]['closingDr'])-float(r[0]['closingCr']),2) if r else 0.0
def refused(fn,name,word=None):
    try: fn(); ok(False,name)
    except E as e: ok(str(e)[:3] in ('400','409') and (word is None or word in str(e)), name+' → refused')
# ── quick entry ──
kinds=c('/quick-entry/kinds'); ok(len(kinds)==8 and all(k['why'] for k in kinds),'8 plain-language money movements, each with its explanation')
Q=lambda kind,amount,key='BANK',**k: c('/quick-entry',{'kind':kind,'amount':amount,'accountId':acc[key]['id'],'date':d,**k})
pv=c('/quick-entry/preview',{'kind':'CAPITAL','amount':100000,'accountId':acc['BANK']['id']}); ok(len(pv['lines'])==2 and near(pv['debit'],100000) and bal('BANK')==0,'preview of «زيادة رأس المال» shows the entry and records nothing')
e=Q('CAPITAL',100000); ok(e['number'] and bal('BANK')==100000 and bal('CAPITAL')==-100000,'capital increase: Dr bank / Cr capital')
Q('OWNER_DRAW',3000,note='مصروف شخصي'); ok(bal('OWNER_CURRENT')==3000 and bal('BANK')==97000,'owner withdrawal: Dr owner current / Cr bank — not an expense')
Q('OWNER_FUND',2000,'CASH'); ok(bal('OWNER_CURRENT')==1000 and bal('CASH')==2000,'owner funding in cash: Dr cash / Cr owner current')
Q('BANK_FEES',50); ok(bal('BANK_FEES')==50 and bal('BANK')==96950,'bank fees: Dr bank fees / Cr bank')
Q('OTHER_INCOME',400); ok(bal('OTHER_INCOME')==-400,'other income: Dr bank / Cr other income')
Q('DIVIDENDS',1000); ok(bal('RETAINED')==1000,'dividends: Dr retained earnings / Cr bank')
loan=[a for a in A if 'قروض' in a['nameAr'] and not a.get('isGroup')]
if loan:
    Q('LOAN_IN',20000); Q('LOAN_PAY',5000); tb=c(f'/reports/trial-balance?from={y}-01-01&to={y}-12-31'); lr=[x for x in tb['rows'] if x['id']==loan[0]['id']][0]; ok(near(float(lr['closingCr'])-float(lr['closingDr']),15000),'loan received then an instalment repaid: liability 15,000')
else: refused(lambda: Q('LOAN_IN',20000),'loan with no loans account in the chart','دليل الحسابات')
refused(lambda: Q('OWNER_DRAW',0),'zero amount','المبلغ'); refused(lambda: Q('XX',10),'unknown kind'); refused(lambda: c('/quick-entry',{'kind':'OWNER_DRAW','amount':10,'accountId':acc['SALES']['id']}),'a non cash/bank account','الصندوق')
it=c('/reports/integrity'); ok(all(x['ok'] for x in (it.get('checks') or it)),'books tie after the quick entries')
# ── daily report ──
ADDR={'street':'طريق الملك فهد','buildingNo':'1234','district':'العليا','city':'الرياض','postalCode':'12211','phone':'0501234567'}
sup=c('/partners',{'name':'مورد','isSupplier':True,'kind':'COMPANY','vatNumber':'300000000000003' if not EG else '200000001',**ADDR})
cus=c('/partners',{'name':'عميل الندى','isCustomer':True,'kind':'COMPANY','vatNumber':'310122393500003' if not EG else '300000002',**ADDR})
P=c('/products',{'name':'صنف أ','sku':'A1','type':'STOCK','salePrice':100,'purchasePrice':50,'taxCode':'S','reorderLevel':95})
def inv(direction,pid,q,u,date=d,**k):
    i=c('/invoices',{'direction':direction,'kind':'INVOICE','date':date,'partnerId':pid,'lines':[{'productId':P['id'],'qty':q,'unitPrice':u,'taxCode':'S'}],**k}); return c(f"/invoices/{i['id']}/post",{})
inv('PURCHASE',sup['id'],100,50); s1=inv('SALE',cus['id'],10,100)
c('/payments',{'direction':'IN','partnerId':cus['id'],'date':d,'amount':500,'accountId':acc['BANK']['id']})
old=time.strftime('%Y-%m-%d', time.localtime(time.time()-40*86400)); s0=c('/invoices',{'direction':'SALE','kind':'INVOICE','date':old,'dueDate':old,'partnerId':cus['id'],'lines':[{'productId':P['id'],'qty':1,'unitPrice':100,'taxCode':'S'}]})
try: c(f"/invoices/{s0['id']}/post",{}); overdue=True
except E: overdue=False
c('/expenses',{'date':d,'accountId':acc['RENT']['id'],'description':'إيجار','amount':1000,'taxCode':'S','amountIncludesVat':False,'payAccountId':acc['BANK']['id']})
c('/invoices',{'direction':'SALE','kind':'INVOICE','date':d,'partnerId':cus['id'],'lines':[{'productId':P['id'],'qty':1,'unitPrice':100,'taxCode':'S'}]})
r=c(f'/reports/daily?date={d}')
ok(r['sales']['count']==1 and near(r['sales']['total'],1000*(1+R)) and near(r['grossProfit'],500),f"daily: one sale {r['sales']['total']}, gross profit 500")
ok(r['purchases']['count']==1 and near(r['purchases']['total'],5000*(1+R)) and r['expenses']['count']==1 and near(r['expenses']['total'],1000*(1+R)) and near(r['receipts']['total'],500),'daily: purchases, expenses and receipts of the day')
bk=[a for a in r['cash'] if a['id']==acc['BANK']['id']][0]; ok(near(bk['closing'],bal('BANK')) and near(bk['opening'],0) and near(bk['closing'],bk['opening']+bk['in']-bk['out']),f"daily: bank movement closes at the ledger balance {bk['closing']}")
ok(r['topItems'] and r['topItems'][0]['name']=='صنف أ','daily: top item of the day')
y1=c(f"/reports/daily?date={time.strftime('%Y-%m-%d', time.localtime(time.time()-86400))}"); ok(y1['sales']['count']==0 and not y1['cash'] or all(near(a['closing'],a['opening']) for a in y1['cash']),'daily: a day with no movement is empty')
b=c('/brief'); todo={x['key']:x for x in b['todo']}
ok('drafts' in todo and todo['drafts']['count']>=1 and 'lowStock' in todo and 'billsDue' in todo,'brief: lists the draft invoice, the item at reorder level and the supplier bill due')
if overdue: ok('overdue' in todo and todo['overdue']['count']==1 and near(todo['overdue']['amount'],100*(1+R)),'brief: the overdue customer invoice with its amount')
# ── assistant ──
r,v=ask('ملخص اليوم'); ok('ملخص اليوم' in v['text'] and 'المبيعات' in v['text'] and 'يحتاج متابعتك' in v['text'] and '/collections' in v['text'] or 'مسودة' in v['text'],'assistant «ملخص اليوم»: the day and what needs attention')
ok(any('لم يسدد' in s for s in (v.get('suggest') or [])),'…with follow-up suggestions')
r,v=ask('ماذا أفعل اليوم؟'); ok('يحتاج متابعتك' in v['text'],'assistant «ماذا أفعل اليوم؟» → the to-do list')
r,v=ask('ملخص أمس'); ok('ملخص يوم' in v['text'] and 'يحتاج متابعتك' not in v['text'],'assistant «ملخص أمس» → that day, without the to-do list of today')
r,v=ask('ملخص هذا الشهر'); ok('ملخص اليوم' not in v['text'],'«ملخص هذا الشهر» still answers for the month')
r,v=ask('ربحية المشاريع'); ok('لا توجد مراكز' in v['text'] and '/projects' in v['text'],'assistant with no projects yet: says so and points to the screen')
p1=c('/projects',{'name':'برج الواحة','kind':'PROJECT','budget':500,'contractValue':4000}); p2=c('/projects',{'name':'فرع جدة','kind':'CENTER'})
inv('SALE',cus['id'],20,100,costCenterId=p1['id']); c('/expenses',{'date':d,'accountId':acc['RENT']['id'],'description':'موقع','amount':800,'taxCode':'O','payAccountId':acc['BANK']['id'],'costCenterId':p1['id']})
c('/expenses',{'date':d,'accountId':acc['RENT']['id'],'description':'إيجار جدة','amount':300,'taxCode':'O','payAccountId':acc['BANK']['id'],'costCenterId':p2['id']})
r,v=ask('ربحية المشاريع'); tx=v['text']; ok('برج الواحة' in tx and 'فرع جدة' in tx and '2,000.00' in tx and 'تجاوز' in tx and 'الإجمالي' in tx,'assistant «ربحية المشاريع»: revenue, cost, profit, contract %, and the budget overrun flagged')
r,v=ask('كم تكاليف مشروع برج الواحة؟'); tx=v['text']; ok('برج الواحة' in tx and 'فرع جدة' not in tx and '1,800.00' in tx,'assistant: one project by name (cost 1,000 COGS + 800 expense)')
r,v=ask('تقرير مشروع الفلاني'); ok('لم أجد' in v['text'] and 'برج الواحة' in v['text'],'assistant: unknown project name → says so and lists what exists')
r,v=ask('كم المبيعات هذا الشهر؟'); ok('المبيعات' in v['text'] and 'برج' not in v['text'],'ordinary figures questions unaffected')
r,v=ask('كيف أسجل مصروفاً على مشروع؟'); ok('ربحية' not in v['text'][:20],'a how-to question about projects is not mistaken for a report')
print('FAILS',lib.fails)
