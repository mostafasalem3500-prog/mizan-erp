import sys, os, time; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
t=register('r321'); c=lambda *a,**k: call(*a,tok=t,**k)
def refused(fn, name, word=None):
    try: fn(); ok(False,name)
    except E as e: ok('400' in str(e) and (word is None or word in str(e)), name+' → refused'+('' if word is None else f' ({word})'))
ADDR={'street':'طريق الملك فهد','buildingNo':'1234','district':'العليا','city':'الرياض','postalCode':'12211','additionalNo':'5678'}
S=lambda **k: c('/partners',{'name':'مورد اختبار','isSupplier':True,'kind':'COMPANY',**k})
# local establishment supplier
refused(lambda: S(), 'supplier with name only', 'الرقم الضريبي')
refused(lambda: S(vatNumber='310122393500003'), 'supplier without address', 'اسم الشارع')
refused(lambda: S(vatNumber='310122393500003', **ADDR), 'supplier without phone', 'الجوال')
refused(lambda: S(vatNumber='123', phone='0501234567', **ADDR), 'supplier with bad VAT number')
refused(lambda: S(vatNumber='310122393500003', phone='0501234567', **{**ADDR,'postalCode':'12'}), 'supplier with bad postal code', 'الرمز البريدي')
s1=S(vatNumber='310122393500003', phone='0501234567', email='a@b.sa', **ADDR); ok(s1['id'] and s1['additionalNo']=='5678' and s1['email']=='a@b.sa','complete supplier saved with address and contacts')
s2=S(name='مورد غير مسجل', vatExemptReason='منشأة غير ملزمة بالتسجيل (إيرادات دون حد التسجيل)', phone='0501234567', **ADDR); ok(s2['id'] and not s2['vatNumber'],'unregistered supplier saved with the reason, no VAT number')
# foreign supplier
refused(lambda: S(name='Foreign', country='AE'), 'foreign supplier without city/contact', 'المدينة')
s3=S(name='Foreign Co', country='AE', city='Dubai', email='x@y.ae'); ok(s3['country']=='AE','foreign supplier: country, city and e-mail are enough')
refused(lambda: S(name='NR', isNonResident=True, city='Dubai', email='x@y.ae'), 'non-resident supplier with country SA', 'دولة المورد')
# individual supplier
refused(lambda: S(name='فرد', kind='INDIVIDUAL'), 'individual supplier without phone', 'الجوال')
s4=S(name='فرد', kind='INDIVIDUAL', phone='0551112223'); ok(s4['id'],'individual supplier: phone is enough')
# import path keeps working
s5=S(name='مورد مستورد', strict=False); ok(s5['id'],'strict off (import) accepts a name only')
# list flags
L={x['id']:x for x in c('/partners?role=SUPPLIER')}
ok(L[s1['id']]['taxReady'] is True and L[s2['id']]['taxReady'] is True and L[s3['id']]['taxReady'] is True,'complete suppliers flagged ready')
ok(L[s5['id']]['taxReady'] is False and any('الضريبي' in m for m in L[s5['id']]['taxMissing']),'incomplete supplier flagged with what is missing')
# editing an incomplete supplier through the form demands completion
refused(lambda: c(f"/partners/{s5['id']}",{'name':'مورد مستورد','phone':'0501234567'},m='PUT'), 'edit of incomplete supplier', 'اسم الشارع')
c(f"/partners/{s5['id']}",{'isActive':False},m='PUT'); ok(True,'quick toggle (deactivate) not blocked')
u=c(f"/partners/{s5['id']}",{'name':'مورد مستورد','isActive':True,'vatNumber':'310122393500003','phone':'0501234567',**ADDR},m='PUT'); ok(u['street']==ADDR['street'],'completed supplier saved')
# customers unchanged
C=lambda **k: c('/partners',{'name':'عميل','isCustomer':True,**k})
refused(lambda: C(kind='COMPANY'), 'company customer with name only', 'الرقم الضريبي')
refused(lambda: C(kind='INDIVIDUAL'), 'individual customer without phone', 'الجوال')
c1=C(kind='COMPANY', vatNumber='300000000000003', phone='0501234567', **ADDR); ok(c1['id'],'complete company customer saved')
c2=C(kind='COMPANY', name='جهة حكومية', crNumber='1010101010', vatExemptReason='جهة حكومية', phone='0112345678', **ADDR); ok(c2['id'],'unregistered company customer identified by CR + reason')
both=c('/partners',{'name':'عميل ومورد','isCustomer':True,'isSupplier':True,'kind':'COMPANY','vatNumber':'300000000000003','phone':'0501234567',**ADDR}); ok(both['id'],'customer+supplier saved')
# readiness lists the supplier item
r=c('/readiness'); it={i['key']:i for i in (r.get('items') or r.get('checks') or [])}
ok('supplierTax' in it and it['supplierTax']['ok'] is True,'readiness: supplier data item ok when all complete')
s6=S(name='ناقص', strict=False); r=c('/readiness'); it={i['key']:i for i in (r.get('items') or r.get('checks') or [])}
ok(it['supplierTax']['ok'] is False and '1' in (it['supplierTax'].get('hint') or ''),'readiness: flags 1 incomplete supplier')
# purchase invoice from complete supplier → input VAT in the return; demo data suppliers complete
P=c('/products',{'name':'صنف','sku':'X1','type':'STOCK','salePrice':100,'purchasePrice':60,'taxCode':'S'})
d=time.strftime('%Y-%m-%d')
def inv(direction, pid, tax='S', post=True):
    i=c('/invoices',{'direction':direction,'kind':'INVOICE','date':d,'partnerId':pid,'lines':[{'productId':P['id'],'qty':2,'unitPrice':60,'taxCode':tax}]})
    return c(f"/invoices/{i['id']}/post",{}) if post else i
refused(lambda: inv('PURCHASE', s2['id']), 'purchase with VAT from a supplier with no VAT number', 'رقم ضريبي')
ok(inv('PURCHASE', s2['id'], 'O')['status']=='POSTED','purchase without VAT from unregistered supplier posts')
ok(inv('PURCHASE', s1['id'])['status']=='POSTED','purchase with VAT from registered supplier posts')
legacy=c('/partners',{'name':'عميل قديم','isCustomer':True,'kind':'COMPANY','vatNumber':'300000000000003','strict':False})
refused(lambda: inv('SALE', legacy['id']), 'standard sale invoice to a customer without national address', 'اسم الشارع')
ok(inv('SALE', c1['id'])['status']=='POSTED','standard sale invoice to complete customer posts')
ind=C(kind='INDIVIDUAL', phone='0551112223'); ok(inv('SALE', ind['id'])['invoiceType']=='SIMPLIFIED','individual gets a simplified invoice')
print('FAILS',lib.fails)
