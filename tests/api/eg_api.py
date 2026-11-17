import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ['B']='http://127.0.0.1:3200/api'
import lib; lib.B='http://127.0.0.1:3200/api'
from lib import *
cfg=call('/config'); ok(cfg['country']=='EG' and cfg['vatRate']==14 and cfg['currency']=='EGP','config: EG / 14% / EGP')
try: register_bad=call('/auth/register',{'fullName':'x','companyName':'x','email':f'bad{time.time_ns()}@t.sa','password':'Passw0rd!','vatNumber':'300000000000003'}); ok(False,'reject Saudi VAT format')
except E as e: ok('400' in str(e),'reject Saudi 15-digit tax id on Egypt server')
st=str(time.time_ns())
t=call('/auth/register',{'fullName':'محمد','companyName':'شركة النيل للتجارة '+st,'email':f'eg{st}@t.eg','password':'Passw0rd!','vatNumber':'123456789','city':'القاهرة'})['token']
c=lambda *a,**k: call(*a,tok=t,**k)
me=c('/auth/me'); co=me.get('company') or {}
acc={a.get('systemKey'):a for a in c('/accounts')['rows'] if a.get('systemKey')}
ok(acc['BANK']['nameAr']=='البنك الأهلي المصري' and 'SALARY_TAX_PAYABLE' in acc and 'EG_WHT_CREDIT' in acc and 'INCOME_TAX' in acc,'Egyptian chart of accounts')
ok('ZAKAT' not in acc,'no zakat account in Egypt')
# ETA config (MOCK)
cf=c('/eta/config'); ok(cf['config']['environment']=='MOCK' and len(cf['issues'])>0,'ETA starts in MOCK with setup issues')
c('/eta/config',{'environment':'MOCK','rin':'123456789','activityCode':'4620','governate':'القاهرة','regionCity':'مدينة نصر','street':'شارع مكرم عبيد','buildingNumber':'12','posSerial':'POS-EG-1','documentVersion':'1.0','autoSubmit':True},m='PUT')
cf=c('/eta/config'); ok(cf['issues']==[],'ETA config complete')
ok(c('/eta/test',{})['ok'],'ETA connection test (simulator)')
p1=c('/products',{'name':'جهاز كهربائي','sku':'EL1','type':'STOCK','salePrice':1000,'purchasePrice':700,'taxCode':'S','etaItemType':'EGS','etaUnitType':'EA'})
p2=c('/products',{'name':'تركيب','sku':'SV1','type':'SERVICE','salePrice':500,'purchasePrice':0,'taxCode':'S','etaItemType':'GS1','etaItemCode':'6221234567890','etaUnitType':'HUR'})
sup=c('/partners',{'name':'مورد القاهرة','isSupplier':True,'vatNumber':'200000001','whtType':'SUPPLIES'})
cus=c('/partners',{'name':'شركة الدلتا','isCustomer':True,'vatNumber':'300000002','governate':'الجيزة','city':'الدقي','street':'شارع التحرير','buildingNo':'7'})
try: c('/partners',{'name':'خطأ','isCustomer':True,'vatNumber':'3000000000000003'}); ok(False,'reject bad id')
except E as e: ok('400' in str(e),'reject invalid Egyptian tax id')
wh=None
def doc(direction, kind, date, partner, lines, extra={}):
    d=c('/invoices',{'direction':direction,'kind':kind,'date':date,'partnerId':partner,'lines':lines,**extra})
    return c(f"/invoices/{d['id']}/post",{'overrideCreditLimit':True})
c('/journals',{'date':'2026-01-02','memo':'رأس المال','lines':[{'accountId':acc['BANK']['id'],'debit':500000,'credit':0},{'accountId':acc['CAPITAL']['id'],'debit':0,'credit':500000}]})
pur=doc('PURCHASE','INVOICE','2026-07-05',sup['id'],[{'productId':p1['id'],'qty':20,'unitPrice':700,'taxCode':'S'}])
ok(near(pur['vatTotal'],1960) and near(pur['total'],15960),'purchase 14,000 + VAT 14% = 15,960')
pay=c('/payments',{'direction':'OUT','partnerId':sup['id'],'date':'2026-07-10','amount':15960,'accountId':acc['BANK']['id']})
ok(near(pay['whtAmount'],140) and near(pay['netPaid'],15820),'supplier default 1% deduction on 14,000 = 140 (paid 15,820)')
sale=doc('SALE','INVOICE','2026-07-15',cus['id'],[{'productId':p1['id'],'qty':5,'unitPrice':1000,'taxCode':'S'},{'productId':p2['id'],'qty':2,'unitPrice':500,'taxCode':'S'}])
ok(near(sale['total'],6840),'sale 6,000 + 840 VAT = 6,840')
s2=c(f"/invoices/{sale['id']}")
ok(s2['etaStatus']=='VALID' and s2['etaUuid'] and len(s2['etaUuid'])==26,'e-invoice auto-submitted and accepted (simulator) '+str(s2.get('etaStatus')))
pv=c(f"/eta/invoices/{sale['id']}/preview"); d=pv['document']
ok(d['invoiceLines'][0]['itemCode']=='EG-123456789-EL1' and d['invoiceLines'][1]['itemType']=='GS1','EGS auto code and GS1 code in document')
ok(near(d['totalAmount'],6840) and d['taxTotals'][0]['amount']==840,'document totals 6,840 / T1 840')
cn=doc('SALE','CREDIT_NOTE','2026-07-20',cus['id'],[{'productId':p1['id'],'qty':1,'unitPrice':1000,'taxCode':'S'}],{'originId':sale['id'],'reason':'مرتجع'})
cn2=c(f"/invoices/{cn['id']}")
ok(cn2['etaStatus']=='VALID','credit note accepted with reference to original uuid')
rc=c('/payments',{'direction':'IN','partnerId':cus['id'],'date':'2026-07-25','amount':5700,'accountId':acc['BANK']['id'],'wht':{'type':'SUPPLIES'}})
ok(near(rc['whtAmount'],50) and near(rc['netPaid'],5650),'customer deducted 1% of 5,000 = 50 → bank 5,650')
# POS e-receipts
sess=c('/pos/session/open',{'openingCash':0})
r1=c('/pos/sale',{'sessionId':sess['id'],'lines':[{'productId':p1['id'],'qty':1}],'tenders':[{'method':'CASH','amount':None}]})
r2=c('/pos/sale',{'sessionId':sess['id'],'lines':[{'productId':p2['id'],'qty':1}],'tenders':[{'method':'CARD','amount':None}]})
a=c(f"/invoices/{r1['id']}"); b=c(f"/invoices/{r2['id']}")
ok(a['etaKind']=='RECEIPT' and a['etaStatus']=='VALID' and b['etaStatus']=='VALID','POS sales sent as e-receipts and accepted')
ok(b['etaDocument']['header']['previousUUID']==a['etaUuid'],'receipt chain: second receipt references the first uuid')
ok(b['etaDocument']['paymentMethod']=='V' and a['etaDocument']['paymentMethod']=='C','payment method C (cash) / V (card)')
c('/pos/session/close',{'sessionId':sess['id'],'countedCash':1140})
# bad document detection
cus2=c('/partners',{'name':'شركة بلا رقم','isCustomer':True,'etaType':'B'})
bad=doc('SALE','INVOICE','2026-08-01',cus2['id'],[{'productId':p2['id'],'qty':1,'unitPrice':500,'taxCode':'S'}])
bb=c(f"/invoices/{bad['id']}")
ok(bb['etaStatus']=='INVALID' and any('receiver.id' in e for e in bb['etaErrors']),'invalid receiver detected before sending: '+str(bb.get('etaErrors'))[:80])
c(f"/partners/{cus2['id']}",{'vatNumber':'400000003','governate':'القاهرة','city':'المعادي','street':'شارع 9','buildingNo':'3'},m='PUT')
rr=c(f"/eta/invoices/{bad['id']}/submit",{})
ok(rr['status']=='VALID','resubmitted after fixing customer data → accepted')
docs=c('/eta/documents'); ok(len(docs)>=5,'ETA documents list')
# VAT return (July 2026)
vr=c('/reports/vat?from=2026-07-01&to=2026-07-31')
ok(near(vr['outputVat'],700) and near(vr['inputVat'],1960),'VAT return July: output 840 − 140 = 700, input 1,960')
ok('14%' in vr['boxes'][0]['label'] and vr['reconciled'],'Egyptian VAT form layout reconciled with ledger')
# Form 41 Q3
f=c('/tax/form41?period=2026-Q3'); ok(near(f['taxTotal'],140) and near(f['creditsTotal'],50),'Form 41 Q3: deducted 140 / credits 50')
try: c('/tax/form41/file',{'period':'2026-Q3','accountId':acc['BANK']['id']}); ok(True,'file Form 41 Q3 (quarter ended)')
except E as e: ok(False,'file Form 41 '+str(e))
# payroll
emp=c('/employees',{'code':'E1','name':'أحمد علي','nationality':'EGYPTIAN','hireDate':'2025-01-01','basic':20000,'housing':0,'transport':0,'otherAllow':0,'gosi':True})
pr=c('/payroll/preview?period=2026-08')[0]
# insurable capped 16,700 → emp 1,837, er 3,131.25; taxable month 18,163 → annual 217,956 − 20,000 = 197,956
# tax: 1,500 + 2,250 + 20%×(197,956−70,000)=25,591.20 → 29,341.20 /12 = 2,445.10 ; martyrs 10.00
ok(near(pr['gosiEmp'],1837) and near(pr['gosiEr'],3131.25),'insurance capped at 16,700: 1,837 / 3,131.25')
ok(near(pr['salaryTax'],2445.10) and near(pr['martyrs'],10),'salary tax 2,445.10 and martyrs fund 10.00: '+str((pr['salaryTax'],pr['martyrs'])))
run=c('/payroll',{'period':'2026-08'}); c(f"/payroll/{run['id']}/post",{})
calc=c('/tax/salary-tax?monthly=20000'); ok(near(calc['monthlyTax'],2445.10),'salary-tax calculator agrees')
# income tax for 2026 (provision)
it=c('/tax/income-tax?year=2026'); ok(it['profitBeforeTax']!=0,'income tax compute: profit '+str(it['profitBeforeTax']))
tb=c('/reports/trial-balance?from=2026-01-01&to=2026-12-31'); ok(tb['balanced'],'trial balance')
i=c('/reports/integrity'); ok(i['ok'],'integrity '+str([x['name'] for x in i['checks'] if not x['ok']]))
fy=[y for y in c('/fiscal-years')['years'] if y['name']=='2026'][0]
fa=c('/reports/final-accounts?fiscalYearId='+fy['id']); ok(fa['ok'],'final accounts linkage '+str([x['name'] for x in fa['checks'] if not x['ok']]))
al=c('/dashboard') if False else None
print('FAILS',len(fails),fails); print('TOKEN',t)
