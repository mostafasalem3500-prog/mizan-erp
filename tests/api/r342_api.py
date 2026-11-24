import sys, os, time; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B; R=0.14 if EG else 0.15
t=register('r342'); c=lambda *a,**k: call(*a,tok=t,**k)
A=c('/accounts')['rows']; acc={x.get('systemKey'):x for x in A if x.get('systemKey')}; d=time.strftime('%Y-%m-%d'); y=time.strftime('%Y')
ADDR={'street':'طريق الملك فهد','buildingNo':'1234','district':'العليا','city':'الرياض','postalCode':'12211','phone':'0501234567'}
both=c('/partners',{'name':'الرواد العامة','isCustomer':True,'isSupplier':True,'kind':'COMPANY','vatNumber':'310122393500003' if not EG else '300000002','creditLimit':50000,**ADDR})
P=c('/products',{'name':'كيبل','sku':'CB1','type':'SERVICE','salePrice':100,'purchasePrice':50,'taxCode':'S'})
def inv(direction,net,post=True,**k):
    q=round(net/(50 if direction=='PURCHASE' else 100),4)
    x=c('/invoices',{'direction':direction,'kind':'INVOICE','date':d,'partnerId':both['id'],'lines':[{'productId':P['id'],'qty':q,'unitPrice':50 if direction=='PURCHASE' else 100,'taxCode':'S'}],**k})
    return c(f"/invoices/{x['id']}/post",{}) if post else x
def refused(fn,name,has=None):
    try: fn(); ok(False,name)
    except E as e: ok('409' in str(e) and (has is None or has in str(e)), name+' → refused')
# we owe the party 23,000 as a supplier
inv('PURCHASE',23000/(1+R))
ap=lambda: sum(float(r['credit'])-float(r['debit']) for r in c(f'/reports/trial-balance?from={y}-01-01&to={y}-12-31')['rows'] if r['code']==acc['AP']['code'])
ok(near(ap(),23000,0.1),'payable to the party as supplier = 23,000')
# gross 54,000 > limit 50,000, but net 31,000 → allowed
inv('SALE',54000/(1+R)); ok(True,'credit sale 54,000 with 23,000 owed to them passes: net 31,000 under the 50,000 limit')
# up to net 50,000 exactly: 19,000 more
inv('SALE',18990/(1+R)); ok(True,'a further 18,990 brings the net to 49,990 — allowed')
refused(lambda: inv('SALE',100),'one more sale goes over the net limit','كمورد')
# netting posts nothing: receivable and payable stay gross in the ledger
tb={r['code']:r for r in c(f'/reports/trial-balance?from={y}-01-01&to={y}-12-31')['rows']}
ok(near(float(tb[acc['AR']['code']]['debit'])-float(tb[acc['AR']['code']]['credit']),72990,0.1) and near(ap(),23000,0.1),'ledger unchanged by the netting: receivable 72,990 and payable 23,000 stay gross')
# switch to gross: blocked even for a small sale; switch back
ok(c('/credit-netting',{'mode':'GROSS'},'PUT')['mode']=='GROSS','setting: gross mode saved')
try: inv('SALE',100); ok(False,'gross mode blocks')
except E as e: ok('409' in str(e) and 'كمورد' not in str(e),'gross mode: the payable is ignored and the plain message is shown')
ok(c('/credit-netting',{'mode':'NET'},'PUT')['mode']=='NET','setting: back to net')

tb=c('/reports/trial-balance?from=2000-01-01&to=2099-12-31'); ok(tb['balanced'] and c('/reports/integrity')['ok'],'trial balance balanced and sub-ledgers tied')
print('FAILS', len(lib.fails)); sys.exit(1 if lib.fails else 0)
