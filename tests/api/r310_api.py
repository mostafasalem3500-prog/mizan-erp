import sys, os, time, io, zipfile, base64, urllib.request, json; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
t=register('r310'); c=lambda *a,**k: call(*a,tok=t,**k)
c('/demo/load',{})
for i in range(80):
    if c('/demo/status').get('demoLoaded'): break
    time.sleep(3)
open('tok310.txt','w').write('TOKEN='+t+'\n')
def ask(text):
    r=c('/ai/chat',{'text':text}); v=r['view'][-1]; return v.get('text','') or '', r
y=time.strftime('%Y'); m=time.strftime('%Y-%m')
# ── data questions agree with the analytics service
ex=c(f'/analytics/executive?from={m}-01&to={time.strftime("%Y-%m-%d")}')
a,_=ask('كم مبيعات هذا الشهر؟'); ok('{:,.2f}'.format(ex['kpis']['sales']) in a and 'هذا الشهر' in a,'sales this month = analytics figure')
a,_=ask('ما صافي الربح هذا الشهر'); ok('{:,.2f}'.format(ex['kpis']['netProfit']) in a and 'مجمل الربح' in a,'net profit explained with its build-up')
a,_=ask('الاكثر مبيعا هذه السنة'); exy=c(f'/analytics/executive?from={y}-01-01&to={time.strftime("%Y-%m-%d")}'); ok(exy['topProducts'][0]['name'] in a and '1.' in a,'top sellers this year')
a,_=ask('من يدين لنا؟'); ok('{:,.2f}'.format(ex['receivables']['total']) in a and '/collections' in a,'receivables with link')
a,_=ask('كم علينا للموردين'); ok('{:,.2f}'.format(ex['payables']['total']) in a,'payables')
a,_=ask('السيولة المتوقعة'); ok('{:,.2f}'.format(ex['forecast']['projected']) in a,'cash forecast')
a,_=ask('الاصناف الناقصة'); ok('إعادة الطلب' in a and 'نافد' in a,'stock alerts')
a,_=ask('كم مصروفات اكتوبر'); e10=c(f'/analytics/executive?from={y}-10-01&to={y}-10-31'); ok('{:,.2f}'.format(e10['kpis']['expenses']) in a and 'اكتوبر' in a,'month by name')
a,_=ask('ملخص الشهر الماضي'); ok('الشهر الماضي' in a and 'النقدية والبنوك' in a,'summary of last month')
cust=c('/partners?role=CUSTOMER&limit=50'); top=max(cust,key=lambda x: float(x['balance']))
a,_=ask('رصيد العميل '+top['name']); ok('{:,.2f}'.format(float(top['balance'])) in a and '/customers/'+top['id'] in a,f"partner balance matches list ({top['name']})")
a,_=ask('رصيد العميل زززز غير موجود'); ok('لم أجد' in a,'unknown partner')
# ── books check: clean first, then a planted problem is found and explained
a,r=ask('افحص الدفاتر'); ok('فحص' in a and (__import__('re').search(r'نجح (\d+) من \1 ', a) or 'سليمة' in a),'books check runs: '+a[:60].replace('\n',' '))
acc={x.get('systemKey'):x for x in c('/accounts')['rows'] if x.get('systemKey')}
c('/journals',{'date':time.strftime('%Y-%m-%d'),'memo':'قيد يدوي خاطئ','lines':[{'accountId':acc['AR']['id'],'debit':777,'credit':0},{'accountId':acc['CAPITAL']['id'],'debit':0,'credit':777}]})
a,_=ask('هل دفاتري سليمة؟'); ok('العملاء' in a and '777.00' in a and 'العلاج' in a,'planted AR line without customer is detected with the difference and a fix')
ok('بلا تحديد الطرف' in a,'…and named as a line without a partner')
# ── knowledge: how-to from lessons, problems, new journals
a,_=ask('كيف اسجل فاتورة مشتريات؟'); ok('فاتورة مشتريات جديدة' in a and 'ضريبة المدخلات' in a and '/learn?s=purchases&l=purchase-invoice' in a,'how-to answered from the lesson')
a,_=ask('كيف أضيف مورد'); ok('مورد جديد' in a and '/suppliers?new=1' in a,'how to add a supplier')
a,_=ask('لماذا رصيد الصندوق سالب؟'); ok('لم تُسجَّل' in a and 'العلاج' in a,'problem: negative cash')
a,_=ask('عندي فاتورة مرحلة بالخطأ كيف اصححها'); ok('إشعاراً دائناً' in a,'problem: fix a posted invoice')
a,_=ask('استلمت عربون من عميل كيف اسجله'); ok('سند قبض' in a and 'دفعة مقدمة' in a,'problem: customer advance')
a,r=ask('سددنا قسط القرض 5000 من البنك'); pl=r['view'][-1].get('plan'); ok(r.get('pending') and pl['preview'][0]['lines'][0]['account'].startswith('قروض') and pl['preview'][0]['lines'][0]['debit']==5000,'loan repayment → plan awaiting confirmation')
a,r=ask('عجز في الصندوق 35 ريال'); ok(r.get('pending') and r['view'][-1]['plan']['preview'][0]['lines'][0]['code']=='5214','cash shortage → plan')
a,_=ask('فاتورة كهرباء 460 ريال شامل الضريبة من البنك'); ok('كهرباء' in a or 'تأكيد' in a,'old behaviour kept: expense entry')
a,_=ask('ما هو الاهلاك'); ok('مجمع الإهلاك' in a and '/learn?s=gl&l=assets' in a,'topic + lesson link')
# ── archive: duplicate detection + auditor pack
png=base64.b64encode(b'\x89PNG\r\n\x1a\n'+b'x'*400).decode(); pdf=base64.b64encode(b'%PDF-1.4 test '+b'y'*900).decode()
bills=c('/invoices?direction=PURCHASE&kind=INVOICE&limit=3'); bills=bills['rows'] if isinstance(bills,dict) else bills; b0=bills[0]
r1=c(f"/attachments/invoice/{b0['id']}",{'name':'bill.pdf','mime':'application/pdf','data':pdf}); ok(r1['duplicate'] is None,'first attach: no duplicate')
r2=c(f"/attachments/invoice/{bills[1]['id']}",{'name':'copy.pdf','mime':'application/pdf','data':pdf}); ok(r2['duplicate'] and b0['number'] in r2['duplicate']['where'],'same file on another bill → warned, names the first bill')
c('/archive/upload',{'name':'سجل.png','mime':'image/png','data':png,'category':'سجل تجاري','title':'السجل التجاري','expiresAt':'2030-01-01'})
try: c('/archive/upload',{'name':'again.png','mime':'image/png','data':png,'category':'عقد'}); ok(False,'dup upload')
except E as e: ok('409' in str(e) and 'DUPLICATE' in str(e),'archive refuses the same file twice')
ok(c('/archive/upload',{'name':'again.png','mime':'image/png','data':png,'category':'عقد','allowDuplicate':True})['id'] is not None,'…unless confirmed')
ar=c('/archive'); ok(any(k['label']=='سجل تجاري' and k['n']==1 for k in ar['byKind']) and any(k['label']=='فاتورة' and k['n']==2 for k in ar['byKind']),'archive breakdown by kind')
req=urllib.request.Request(B+f'/archive/pack?from={y}-01-01&to={y}-12-31',headers={'Authorization':'Bearer '+t}); raw=urllib.request.urlopen(req).read()
z=zipfile.ZipFile(io.BytesIO(raw)); names=z.namelist(); ok(z.testzip() is None and len(names)==6,'pack is a valid ZIP: %d entries'%len(names)); print(names)
ok(any(n.startswith('فواتير المشتريات/'+b0['number']) for n in names) and any(n.startswith('مستندات المنشأة/سجل تجاري/') for n in names),'folders per kind, files prefixed with the document number')
idx=z.read('فهرس المستندات.csv').decode('utf-8-sig').splitlines(); ok(len(idx)==5 and b0['number'] in '\n'.join(idx) and idx[0].startswith('المجلد'),'index sheet lists every file with its reference')
ok(z.read([n for n in names if n.endswith('bill.pdf')][0])==base64.b64decode(pdf),'file bytes intact')
miss=z.read('مستندات ناقصة (بلا مرفق).csv').decode('utf-8-sig').splitlines(); ok(len(miss)>5,'missing-documents list included (%d rows)'%(len(miss)-1))
try: urllib.request.urlopen(urllib.request.Request(B+'/archive/pack?from=2001-01-01&to=2001-01-31',headers={'Authorization':'Bearer '+t})); ok(False,'empty pack')
except urllib.error.HTTPError as e: ok(e.code==400,'empty period → clear error')
t2=register('r310b'); 
try: urllib.request.urlopen(urllib.request.Request(B+f'/archive/pack?from={y}-01-01&to={y}-12-31',headers={'Authorization':'Bearer '+t2})); ok(False,'other co')
except urllib.error.HTTPError as e: ok(e.code==400,'another company gets none of these files')
print('FAILS',fails); sys.exit(1 if fails else 0)
