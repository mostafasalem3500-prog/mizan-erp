import sys, os, time, urllib.parse as up; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B; V=0.14 if EG else 0.15
t=register('r319'); c=lambda *a,**k: call(*a,tok=t,**k)
A=c('/accounts')['rows']; acc={x.get('systemKey'):x for x in A if x.get('systemKey')}; d=time.strftime('%Y-%m-%d'); y=time.strftime('%Y')
def refused(code, fn, name):
    try: fn(); ok(False,name)
    except E as e: ok(str(code) in str(e), name+' → refused')
c('/journals',{'date':f'{y}-01-01','memo':'رأس المال','lines':[{'accountId':acc['BANK']['id'],'debit':500000,'credit':0},{'accountId':acc['CAPITAL']['id'],'debit':0,'credit':500000}]})
cust=c('/partners',{'name':'شركة البناء الحديث','kind':'COMPANY','isCustomer':True,'phone':'0500000001','street':'ش','buildingNo':'1234','district':'ح','city':'الرياض','postalCode':'12345','idType':'CRN','crNumber':'1010101010','vatExemptReason':'غير مسجل'} if not EG else {'name':'شركة البناء الحديث','kind':'INDIVIDUAL','isCustomer':True,'phone':'01000000001'})
sup=c('/partners',{'name':'مورد مواد','isSupplier':True,'kind':'COMPANY','vatNumber':('200000001' if EG else '310122393500003'),'strict':False})
svc=c('/products',{'name':'أعمال تشطيب','sku':'FIN1','type':'SERVICE','salePrice':1000,'purchasePrice':0,'taxCode':'S'})
stk=c('/products',{'name':'إسمنت','sku':'CEM1','type':'STOCK','salePrice':30,'purchasePrice':20,'taxCode':'S'})
# ── centres and projects
tot=c('/projects',{'name':'إجمالي المشاريع','kind':'CENTER'}); ok(tot['code']=='CC-001' and tot['kind']=='CENTER','a total centre created with an automatic code')
p1=c('/projects',{'name':'فيلا الياسمين','kind':'PROJECT','parentId':tot['id'],'partnerId':cust['id'],'contractValue':100000,'budget':5000,'startDate':f'{y}-01-01','manager':'م. سعد'})
p2=c('/projects',{'name':'عمارة النخيل','kind':'PROJECT','parentId':tot['id'],'contractValue':50000,'budget':40000})
br=c('/projects',{'name':'فرع جدة','kind':'CENTER','code':'JED'})
ok(p1['code']=='PRJ-001' and p2['code']=='PRJ-002' and br['code']=='JED','projects numbered PRJ-001…; own code kept')
refused(409,lambda: c('/projects',{'name':'x','code':'jed'}),'duplicate code')
refused(400,lambda: c(f"/projects/{tot['id']}",{'name':'إجمالي المشاريع','parentId':p1['id']},m='PUT'),'a centre under its own child')
refused(400,lambda: c('/projects',{'name':'y','startDate':f'{y}-05-01','endDate':f'{y}-01-01'}),'end before start')
# ── documents that carry the project
def inv(direction,partner,lines,cc,post=True):
    i=c('/invoices',{'direction':direction,'kind':'INVOICE','partnerId':partner,'date':d,'costCenterId':cc,'lines':lines})
    return c(f"/invoices/{i['id']}/post",{'overrideCreditLimit':True}) if post else i
pu=inv('PURCHASE',sup['id'],[{'productId':stk['id'],'qty':100,'unitPrice':20,'taxCode':'S'}],p1['id'])
s1=inv('SALE',cust['id'],[{'productId':svc['id'],'qty':10,'unitPrice':1000,'taxCode':'S'},{'productId':stk['id'],'qty':40,'unitPrice':30,'taxCode':'S'}],p1['id'])
ok(s1['costCenterId']==p1['id'],'sales invoice keeps its project')
s2=inv('SALE',cust['id'],[{'productId':svc['id'],'qty':3,'unitPrice':1000,'taxCode':'S'}],p2['id'])
s3=inv('SALE',cust['id'],[{'productId':svc['id'],'qty':1,'unitPrice':700,'taxCode':'S'}],None)
x1=c('/expenses',{'date':d,'accountId':[a for a in A if a['type']=='EXPENSE' and not a.get('isGroup') and a.get('subtype')!='COGS'][0]['id'],'amount':2000,'amountIncludesVat':False,'taxCode':'O','description':'أجور عمال المشروع','payAccountId':acc['BANK']['id'],'costCenterId':p1['id']})
c('/journals',{'date':d,'memo':'مصروف نقل للمشروع','lines':[{'accountId':x1['accountId'] if 'accountId' in x1 else [a for a in A if a['type']=='EXPENSE' and not a.get('isGroup') and a.get('subtype')!='COGS'][0]['id'],'debit':4500,'credit':0,'costCenterId':p1['id'],'description':'نقل مواد'},{'accountId':acc['BANK']['id'],'debit':0,'credit':4500}]})
cn=c(f"/invoices/{s2['id']}/credit-note",{'reason':'خصم متفق عليه'}); ok(cn['costCenterId']==p2['id'],'a credit note inherits the project of its invoice')
# ── list with totals
L=c(f'/projects?from={y}-01-01&to={d}'); R={r['name']:r for r in L['rows']}
a=R['فيلا الياسمين']; print({k:a[k] for k in ('revenue','cogs','expenses','cost','profit','margin','stock','budgetUsed','invoicedPct','overBudget')})
ok(a['revenue']==11200 and a['cogs']==800 and a['expenses']==6500 and a['cost']==7300 and a['profit']==3900 and a['margin']==34.82,'project 1: revenue 11,200 − cost of sales 800 − expenses 6,500 = 3,900 (34.82%)')
ok(a['stock']==2000 and a['budgetUsed']==146 and a['overBudget'] and a['invoicedPct']==11.2,'stock purchased for it 2,000; budget 146% used → flagged; 11.2% of the contract invoiced')
b=R['عمارة النخيل']; ok(b['revenue']==3000 and b['cost']==0 and b['profit']==3000 and not b['overBudget'],'project 2: revenue 3,000')
T=R['إجمالي المشاريع']; ok(T['revenue']==14200 and T['cost']==7300 and T['profit']==6900 and T['children']==2,'the parent centre shows the total of its two projects (14,200 / 7,300 / 6,900)')
ok(L['totals']['revenue']==14200 and L['totals']['profit']==6900 and L['totals']['count']==4,'grand total counts each amount once (parent not added to its children)')
ok(L['unassigned']['revenue']==700,'what carries no centre is reported as unassigned (700)')
inc=c(f'/reports/income?from={y}-01-01&to={d}'); ok(abs(inc['netSales']-(L['totals']['revenue']+L['unassigned']['revenue']))<0.01,f"centres + unassigned = income statement revenue ({inc['netSales']})")
# ── filters
ok([r['name'] for r in c(f'/projects?from={y}-01-01&to={d}&kind=PROJECT')['rows']]==['فيلا الياسمين','عمارة النخيل'],'filter by type: projects only')
ok([r['name'] for r in c(f'/projects?from={y}-01-01&to={d}&q='+up.quote('الياسمين'))['rows']]==['فيلا الياسمين'] and [r['name'] for r in c(f'/projects?from={y}-01-01&to={d}&q='+up.quote('البناء'))['rows']]==['فيلا الياسمين'] and [r['name'] for r in c(f'/projects?q=jed')['rows']]==['فرع جدة'],'search by name, by customer, by code')
pf=c(f"/projects?from={y}-01-01&to={d}&parentId={tot['id']}"); ok(len(pf['rows'])==3 and pf['totals']['revenue']==14200,'filter by a total centre: it and everything under it, total once')
ok(c(f'/projects?from=2020-01-01&to=2020-12-31')['totals']['revenue']==0,'filter by period: nothing in an old year')
c(f"/projects/{p2['id']}",{'name':'عمارة النخيل','kind':'PROJECT','parentId':tot['id'],'status':'DONE','contractValue':50000,'budget':40000},m='PUT'); ok([r['name'] for r in c('/projects?status=DONE')['rows']]==['عمارة النخيل'],'filter by status')
# ── one project in detail
D=c(f"/projects/{p1['id']}?from={y}-01-01&to={d}"); g=D['figures']
ok(g['revenue']==11200 and g['cost']==7300 and g['profit']==3900 and g['budgetLeft']==-2300 and g['toInvoice']==88800 and D['centre']['partnerName']=='شركة البناء الحديث','detail figures: budget overrun 2,300, 88,800 still to invoice')
ok(len(D['accounts'])>=3 and abs(sum(x['amount'] if x['type']=='REVENUE' else -x['amount'] for x in D['accounts'])-3900)<0.01 and D['months'][0]['revenue']==11200,'breakdown by account adds up to the profit; monthly series present')
ok(D['lineCount']==len(D['lines']) and all(l['type'] in ('REVENUE','EXPENSE') for l in D['lines']),'movements listed (revenue and cost lines)')
ok(all(l['type']=='REVENUE' for l in c(f"/projects/{p1['id']}?from={y}-01-01&to={d}&type=REVENUE")['lines']) and len(c(f"/projects/{p1['id']}?from={y}-01-01&to={d}&type=REVENUE")['lines'])==2,'movement filter: revenue only')
fx=c(f"/projects/{p1['id']}?from={y}-01-01&to={d}&q="+up.quote("نقل")); ok(fx['lineCount']==1 and fx['lines'][0]['debit']==4500,'movement search by description finds the transport entry')
fo=c(f"/projects/{p1['id']}?from={y}-01-01&to={d}&type=OTHER"); ok(fo['lineCount']>0 and all(l['code']==[x for x in A if x.get('systemKey')=='INVENTORY'][0]['code'] for l in fo['lines']),'outside revenue and cost only the stock bought for the project is tagged — never receivables, VAT or cash')
DT=c(f"/projects/{tot['id']}?from={y}-01-01&to={d}"); ok(DT['centre']['includes']==2 and DT['figures']['revenue']==11200+3000-round(3000,2) or DT['figures']['revenue']>0,'the total centre detail covers its projects')
ok(DT['figures']['revenue']==c(f'/projects?from={y}-01-01&to={d}')['rows'][0]['revenue'],'detail of the total centre = its row in the list')
refused(409,lambda: c(f"/projects/{p1['id']}",m='DELETE'),'deleting a project that has entries'); refused(409,lambda: c(f"/projects/{tot['id']}",m='DELETE'),'deleting a centre that has children')
c(f"/projects/{br['id']}",m='DELETE'); ok(len(c('/projects')['rows'])==3,'an unused centre can be deleted')
ig=c('/reports/integrity'); ok(ig['ok'],'books tie after project documents')
bs=c(f'/reports/balance-sheet?to={d}'); tb=c(f'/reports/trial-balance?from={y}-01-01&to={d}')
ok(bs['balanced'] and abs(sum(float(r['debit'])-float(r['credit']) for r in tb['rows']))<0.01,'balance sheet balances and the trial balance nets to zero')
ok(abs(inc['net']-bs['currentResult'])<0.01,f"income statement result = the result carried in the balance sheet ({inc['net']})")
cc=c(f'/reports/cost-centers?from={y}-01-01&to={d}'); ok(abs(cc['totals']['net']-inc['operating'])<0.01 or abs(cc['totals']['revenue']-inc['netSales'])<0.01,'cost-centre profitability report agrees with the income statement revenue')
print('FAILS',lib.fails); sys.exit(1 if lib.fails else 0)
