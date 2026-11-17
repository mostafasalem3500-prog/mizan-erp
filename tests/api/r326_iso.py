"""Tenant isolation: a user of one establishment must not read, change or act on another establishment's records by guessing ids."""
import sys, os, time; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B
ta=register('isoA'); tb=register('isoB'); a=lambda *x,**k: call(*x,tok=ta,**k); b=lambda *x,**k: call(*x,tok=tb,**k)
A=a('/accounts')['rows']; acc={x.get('systemKey'):x for x in A if x.get('systemKey')}; d=time.strftime('%Y-%m-%d')
a('/journals',{'date':d,'memo':'تمويل','lines':[{'accountId':acc['BANK']['id'],'debit':50000,'credit':0},{'accountId':acc['CAPITAL']['id'],'debit':0,'credit':50000}]})
ADDR={'street':'طريق الملك فهد','buildingNo':'1234','district':'العليا','city':'الرياض','postalCode':'12211','phone':'0501234567'}
cus=a('/partners',{'name':'عميل سري','isCustomer':True,'kind':'COMPANY','vatNumber':'310122393500003' if not EG else '300000002',**ADDR})
P=a('/products',{'name':'صنف سري','sku':'SEC1','type':'SERVICE','salePrice':100,'taxCode':'S'})
dr=a('/invoices',{'direction':'SALE','kind':'INVOICE','date':d,'partnerId':cus['id'],'lines':[{'productId':P['id'],'qty':1,'unitPrice':100,'taxCode':'S'}]})
i2=a('/invoices',{'direction':'SALE','kind':'INVOICE','date':d,'partnerId':cus['id'],'lines':[{'productId':P['id'],'qty':2,'unitPrice':100,'taxCode':'S'}]}); posted=a(f"/invoices/{i2['id']}/post",{})
ex=a('/expenses',{'date':d,'accountId':acc['RENT']['id'],'description':'إيجار','amount':100,'taxCode':'O','payAccountId':acc['BANK']['id']})
pay=a('/payments',{'direction':'IN','partnerId':cus['id'],'date':d,'amount':50,'accountId':acc['BANK']['id']})
prj=a('/projects',{'name':'مشروع سري','kind':'PROJECT'})
emp=a('/employees',{'name':'موظف سري','nationality':'NON_SAUDI','hireDate':d,'basic':3000,'housing':0,'transport':0,'otherAllow':0,'gosi':False})
jr=a('/journals/post',{'date':d,'memo':'قيد سري','lines':[{'accountId':acc['UTILITIES']['id'],'debit':10,'credit':0},{'accountId':acc['BANK']['id'],'debit':0,'credit':10}]})
def denied(method, path, body=None, name=None):
    try:
        r=call(path, body, m=method, tok=tb)
        leak = r is not None and r != [] and not (isinstance(r,dict) and (r.get('rows')==[] or r.get('lines')==[] or r.get('error')))
        ok(not leak, f"{method} {path.split('?')[0][:44]} — {name or ''} ✗ answered: {str(r)[:90]}")
    except E as e: ok(str(e)[:3] in ('400','403','404','409','402','422'), f"{method} {path.split('?')[0][:44]} → {str(e)[:3]} {name or ''}")
B_acc={x.get('systemKey'):x for x in b('/accounts')['rows'] if x.get('systemKey')}
# read by id
for path,name in [(f"/partners/{cus['id']}",'partner'),(f"/invoices/{posted['id']}",'invoice'),(f"/invoices/{dr['id']}",'draft'),(f"/projects/{prj['id']}",'project'),(f"/journals/{jr['id']}",'journal'),(f"/payments/{pay['id']}",'payment'),(f"/reports/ledger?accountId={acc['BANK']['id']}",'account ledger'),(f"/reports/partner-statement?partnerId={cus['id']}",'statement'),(f"/payments/open-invoices/{cus['id']}?direction=IN",'open invoices'),(f"/products/{P['id']}",'product'),(f"/employees/{emp['id']}",'employee')]: denied('GET',path,name=name)
# change / act
denied('PUT',f"/partners/{cus['id']}",{'name':'مخترق','isActive':False},'rename partner'); denied('DELETE',f"/partners/{cus['id']}",name='delete partner')
denied('PUT',f"/products/{P['id']}",{'name':'مخترق','salePrice':1},'edit product'); denied('DELETE',f"/invoices/{dr['id']}",name='delete draft'); denied('POST',f"/invoices/{dr['id']}/post",{},'post draft'); denied('POST',f"/invoices/{dr['id']}/preview-entry",{},'preview draft')
denied('PUT',f"/invoices/{dr['id']}",{'direction':'SALE','kind':'INVOICE','date':d,'partnerId':cus['id'],'lines':[{'productId':P['id'],'qty':9,'unitPrice':1,'taxCode':'S'}]},'edit draft')
denied('POST',f"/invoices/{posted['id']}/credit-note",{},'credit note'); denied('POST',f"/expenses/{ex['id']}/cancel",{},'cancel expense'); denied('POST',f"/payments/{pay['id']}/cancel",{},'cancel payment'); denied('POST',f"/journals/{jr['id']}/reverse",{},'reverse journal')
denied('PUT',f"/projects/{prj['id']}",{'name':'مخترق','kind':'PROJECT'},'edit project'); denied('DELETE',f"/projects/{prj['id']}",name='delete project'); denied('PUT',f"/employees/{emp['id']}",{'name':'مخترق','basic':1},'edit employee')
# using another establishment's ids inside my own documents
denied('POST','/invoices',{'direction':'SALE','kind':'INVOICE','date':d,'partnerId':cus['id'],'lines':[{'description':'x','qty':1,'unitPrice':1,'taxCode':'S'}]},'invoice for a foreign customer')
denied('POST','/expenses',{'date':d,'accountId':acc['RENT']['id'],'description':'x','amount':5,'taxCode':'O','payAccountId':B_acc['BANK']['id']},'expense on a foreign account')
denied('POST','/expenses',{'date':d,'accountId':B_acc['RENT']['id'],'description':'x','amount':5,'taxCode':'O','payAccountId':B_acc['BANK']['id'],'costCenterId':prj['id']},'expense on a foreign project')
denied('POST','/payments',{'direction':'IN','partnerId':cus['id'],'date':d,'amount':5,'accountId':B_acc['BANK']['id']},'receipt from a foreign customer')
denied('POST','/journals/post',{'date':d,'memo':'x','lines':[{'accountId':acc['BANK']['id'],'debit':5,'credit':0},{'accountId':B_acc['CAPITAL']['id'],'debit':0,'credit':5}]},'journal on a foreign account')
denied('POST','/quick-entry',{'kind':'OWNER_DRAW','amount':5,'accountId':acc['BANK']['id']},'quick entry on a foreign bank account')
# the victim's data is untouched
g=a(f"/partners/{cus['id']}"); ok(g['name']=='عميل سري' and g['isActive'],'victim: customer unchanged'); ok(a(f"/invoices/{dr['id']}")['status']=='DRAFT' and float(a(f"/invoices/{dr['id']}")['total'])>100,'victim: draft unchanged')
it=a('/reports/integrity'); ok(all(x['ok'] for x in (it.get('checks') or it)),'victim: books still tie'); tb_=a(f"/reports/trial-balance?from={d[:4]}-01-01&to={d[:4]}-12-31")['totals']['debit']
ok(len((lambda e: e.get('rows') if isinstance(e,dict) else e)(a('/expenses')))==1 and len(a('/partners?role=CUSTOMER'))==1,'victim: nothing added')
ok(a(f"/projects/{prj['id']}")['centre']['name']=='مشروع سري' and [e for e in (lambda r: r.get('rows') if isinstance(r,dict) else r)(a('/employees')) if e['id']==emp['id']][0]['name']=='موظف سري','victim: project and employee unchanged')
# account takeover through the members screen: invite the victim's e-mail, then "reset" the password
st=str(time.time_ns()); vmail=f'victim{st}@t.sa'; tv=call('/auth/register',{'fullName':'ضحية','companyName':'منشأة الضحية '+st,'email':vmail,'password':'Victim123!'})['token']
m=b('/users',{'email':vmail,'role':'CASHIER','fullName':'x','password':'Whatever123'})
try: call(f"/users/{m['id']}",{'password':'Hacked1234'},m='PUT',tok=tb); ok(False,'reset the password of a user who has another establishment')
except E as e: ok('403' in str(e)[:3],'resetting the password of a user who belongs to another establishment → refused')
try: call(f"/users/{m['id']}",{'fullName':'مخترق'},m='PUT',tok=tb); ok(False,'rename foreign user')
except E as e: ok('403' in str(e)[:3],'renaming such a user → refused')
ok(call('/auth/login',{'email':vmail,'password':'Victim123!'})['token'],'the victim still signs in with their own password')
try: call('/auth/login',{'email':vmail,'password':'Hacked1234'}); ok(False,'attacker password')
except E as e: ok('401' in str(e)[:3],'the attacker password does not work')
own=b('/users',{'email':f'staff{st}@t.sa','role':'CASHIER','fullName':'كاشير','password':'Cashier123'}); call(f"/users/{own['id']}",{'password':'Newcash1234','role':'ACCOUNTANT'},m='PUT',tok=tb)
ok(call('/auth/login',{'email':f'staff{st}@t.sa','password':'Newcash1234'})['token'],'an establishment still resets the password of an account it created itself')
# search and lists of the attacker never show the victim's rows
ok(not [p for p in b('/partners?role=CUSTOMER') if 'سري' in p['name']] and 'سري' not in str(b('/products')) and 'سري' not in str(b('/projects')),'attacker lists contain none of the victim rows')
# no token / garbage token
for tok,name in [(None,'no token'),('abc.def.ghi','garbage token')]:
    try: call('/partners',tok=tok); ok(False,name)
    except E as e: ok('401' in str(e)[:3],f'{name} → 401')
print('FAILS',lib.fails)
