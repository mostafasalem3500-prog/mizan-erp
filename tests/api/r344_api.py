"""3.44: recipe waste, menu engineering, ISO 20022 bank file, the two new alerts, credit over-limit on the net in the
management dashboard, and the assistant's answers about dishes and set-offs."""
import sys, os, time, re; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B; R=0.14 if EG else 0.15
t=register('r344'); c=lambda *a,**k: call(*a,tok=t,**k)
A=c('/accounts')['rows']; acc={x.get('systemKey'):x for x in A if x.get('systemKey')}; d=time.strftime('%Y-%m-%d'); y=time.strftime('%Y')
ADDR={'street':'طريق الملك فهد','buildingNo':'1234','district':'العليا','city':'الرياض','postalCode':'12211','phone':'0501234567'}
def bal(key): return round(sum(float(x['debit'])-float(x['credit']) for x in c(f'/reports/trial-balance?from={y}-01-01&to={y}-12-31')['rows'] if x['code']==acc[key]['code']),2)
def refused(code, fn, name):
    try: fn(); ok(False,name)
    except E as e: ok(str(code) in str(e), name+' → refused')
c('/journals',{'date':f'{y}-01-01','memo':'رأس المال','lines':[{'accountId':acc['BANK']['id'],'debit':500000,'credit':0},{'accountId':acc['CAPITAL']['id'],'debit':0,'credit':500000}]})
sup=c('/partners',{'name':'مورد الأغذية','isSupplier':True,'kind':'COMPANY','vatNumber':'300000000000003' if not EG else '200000001',**ADDR})
cu=c('/partners',{'name':'زبون','isCustomer':True,'kind':'INDIVIDUAL','phone':'0501234567'})
mk=lambda n,s,pp: c('/products',{'name':n,'sku':s,'type':'STOCK','salePrice':0,'purchasePrice':pp,'taxCode':'S','unit':'كجم'})
potato=mk('بطاطس','PT',5); meat=mk('لحم','MT',40); bread=mk('خبز','BR',1)
dish=lambda n,s,p: c('/products',{'name':n,'sku':s,'type':'SERVICE','salePrice':p,'taxCode':'S'})
fries=dish('بطاطس مقلية','D1',10); burger=dish('برجر','D2',30); steak=dish('ستيك','D3',90); soup=dish('شوربة','D4',6)
def inv(direction,pid,lines):
    x=c('/invoices',{'direction':direction,'kind':'INVOICE','date':d,'partnerId':pid,'lines':lines}); return c(f"/invoices/{x['id']}/post",{})
inv('PURCHASE',sup['id'],[{'productId':potato['id'],'qty':200,'unitPrice':5,'taxCode':'S'},{'productId':meat['id'],'qty':100,'unitPrice':40,'taxCode':'S'},{'productId':bread['id'],'qty':300,'unitPrice':1,'taxCode':'S'}])
rec=lambda p,lines: c(f"/products/{p['id']}/recipe",{'lines':lines},'PUT')
# waste: 0.2 kg net of potato with 25% peel loss = 0.25 kg taken → cost 1.25
r=rec(fries,[{'componentId':potato['id'],'qty':0.2,'wastePct':25}])
ok(near(r['cost'],1.25) and near(r['lines'][0]['usedQty'],0.25) and r['canMake']==800,'waste: 0.2 kg + 25% loss = 0.25 kg per portion, cost 1.25, stock makes 800')
refused(400,lambda: rec(fries,[{'componentId':potato['id'],'qty':0.2,'wastePct':95}]),'waste above 90%')
rec(burger,[{'componentId':meat['id'],'qty':0.15},{'componentId':bread['id'],'qty':1}])   # cost 7 → margin 23
rec(steak,[{'componentId':meat['id'],'qty':0.5,'wastePct':10}])                           # cost 22 → margin 68
rec(soup,[{'componentId':potato['id'],'qty':0.9}])                                        # cost 4.5 of a 6 price → thin
iv0,cg0=bal('INVENTORY'),bal('COGS')
inv('SALE',cu['id'],[{'productId':fries['id'],'qty':100,'unitPrice':10,'taxCode':'S'},{'productId':burger['id'],'qty':60,'unitPrice':30,'taxCode':'S'},{'productId':steak['id'],'qty':5,'unitPrice':90,'taxCode':'S'},{'productId':soup['id'],'qty':4,'unitPrice':6,'taxCode':'S'}])
exp=100*1.25+60*7+5*22+4*4.5
ok(near(bal('COGS'),cg0+exp,0.02) and near(bal('INVENTORY'),iv0-exp,0.02),f'sale: cost of sales and inventory move by the ingredients with their waste ({exp})')
ok(near({p['sku']:p for p in c('/products')}['PT']['qty'],200-25-3.6,0.001),'potato stock: 25 kg for the fries (with peel loss) and 3.6 kg for the soup taken')
e=c('/recipes/engineering?days=30'); K={r['name']:r for r in e['rows']}
ok(K['بطاطس مقلية']['klass']=='PLOWHORSE' and K['برجر']['klass']=='STAR' and K['ستيك']['klass']=='PUZZLE' and K['شوربة']['klass']=='DOG','menu engineering: fries sell with a thin margin, burger is the star, steak a puzzle, soup a dog')
ok(near(e['totals']['profit'],(1000+1800+450+24)-exp,0.05) and near(sum(r['profit'] for r in e['rows']),e['totals']['profit'],0.05),'its profit = the dishes revenue − their cost of sales in the ledger')
# alerts
both=c('/partners',{'name':'الرواد العامة','isCustomer':True,'isSupplier':True,'kind':'COMPANY','vatNumber':'310122393500003' if not EG else '300000002','creditLimit':50000,**ADDR})
S=c('/products',{'name':'خدمة','sku':'SV','type':'SERVICE','salePrice':100,'taxCode':'S'})
one=lambda g:[{'productId':S['id'],'qty':1,'unitPrice':round(g/(1+R),2),'taxCode':'S'}]
inv('PURCHASE',both['id'],one(23000)); inv('SALE',both['id'],one(60000))
al=' '.join(a['text'] for a in c('/alerts')['items'])
ok('يمكن مقاصة' in al and '23,000' in al,'alert: a party that is customer and supplier can be set off for 23,000')
ok('أكثر من 70%' in al,'alert: a dish whose recipe cost passed 70% of its price (the soup)')
# over the credit limit on the net: 60,000 owed − 23,000 = 37,000 < 50,000 → not flagged; gross mode flags it
ex=lambda: [o for o in c(f'/analytics/executive?from={y}-01-01&to={y}-12-31')['alerts'] if 'حد الائتمان' in o['text']]
ok(ex()==[],'management dashboard: no over-limit alert while the net (37,000) is under the limit')
c('/credit-netting',{'mode':'GROSS'},'PUT'); ok(len(ex())==1,'in gross mode the same customer is flagged'); c('/credit-netting',{'mode':'NET'},'PUT')
# ISO 20022 bank file
IB='EG380019000500000000263180002' if EG else 'SA0380000000608010167519'
c(f"/partners/{sup['id']}/bank",{'iban':IB,'bankBeneficiary':'مؤسسة <الأغذية> & شركاه'},'PUT')
pr=c('/payment-runs/propose?dueUntil=2100-12-31'); lines=[{'invoiceId':i['invoiceId'],'amount':i['amount']} for s in pr['suppliers'] if s['partnerId']==sup['id'] for i in s['invoices']]
run=c('/payment-runs',{'accountId':acc['BANK']['id'],'payDate':d,'dueUntil':d,'lines':lines}); c(f"/payment-runs/{run['id']}/approve",{})
bf=c(f"/payment-runs/{run['id']}/bank-file"); x=bf['xml']
import xml.etree.ElementTree as ET
root=ET.fromstring(x.encode()); ns={'p':'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03'}
amt=(1000+4000+300)*(1+R)
ok(root.find('.//p:CtrlSum',ns).text==f'{amt:.2f}' and root.find('.//p:NbOfTxs',ns).text=='1' and root.find('.//p:CdtrAcct/p:Id/p:IBAN',ns).text==IB,'pain.001: well-formed XML with the control sum, one transfer and the creditor IBAN')
ok(root.find('.//p:Cdtr/p:Nm',ns).text=='مؤسسة <الأغذية> & شركاه' and root.find('.//p:InstdAmt',ns).attrib['Ccy']==bf['rows'][0]['currency'],'special characters in the beneficiary name are escaped; currency on the amount')
# the assistant
def ask(text):
    r=c('/ai/chat',{'text':text}); v=r['view'][-1]; return v.get('text') or v.get('content') or str(v)
a=ask('هندسة القائمة'); ok('برجر' in a and 'نجم' in a and 'شوربة' in a,'assistant: «هندسة القائمة» lists the dishes with their class')
a=ask('ربحية الأطباق'); ok('بطاطس مقلية' in a and '/recipes' in a,'assistant: «ربحية الأطباق» answers from the same data')
a=ask('مع من أقدر أعمل مقاصة؟'); ok('الرواد العامة' in a and '23,000' in a,'assistant: who can be set off and for how much')
tb=c('/reports/trial-balance?from=2000-01-01&to=2099-12-31'); ok(tb['balanced'] and c('/reports/integrity')['ok'],'trial balance balanced and sub-ledgers tied')
fy=[v for v in c('/fiscal-years')['years'] if v['name']==y][0]; fa=c('/reports/final-accounts?fiscalYearId='+fy['id']); ok(fa['ok'],'final accounts: every linkage check holds')
print('FAILS', len(lib.fails)); sys.exit(1 if lib.fails else 0)
