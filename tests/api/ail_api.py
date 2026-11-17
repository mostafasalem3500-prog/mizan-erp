import sys, os, base64; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
t=register('ail'); c=lambda *a,**k: call(*a,tok=t,**k)
st=c('/ai/status'); ok(st['entitled'] and st['configured'] and not st['advanced'],'built-in agent available with no API key')
def ask(text, conv=None, **kw):
    r=c('/ai/chat',{'text':text, **({'conversationId':conv} if conv else {}), **kw}); return r, r['view'][-1]
def plan_of(text, **kw):
    r,v=ask(text, **kw); return r, v.get('plan'), v['text']
def exp(p): return [x for x in p['preview'] if x['type']=='expense'][0]
def has(p, acct, dr=None, cr=None): return any(acct in l['account'] and (dr is None or near(l['debit'],dr)) and (cr is None or near(l['credit'],cr)) for l in p['lines'])
# 1 the user's own example, one message
r,p,txt=plan_of('فاتورة مياه المكتب بقيمة 200 ريال شامل الضريبة من المورد شركة المياه الوطنية، دُفعت نقداً')
e=exp(p); ok(r['engine']=='local' and p['preview'][0]['type']=='create_partner' and has(e,'الكهرباء والمياه',dr=173.91) and has(e,'المدخلات',dr=26.09) and has(e,'الصندوق الرئيسي',cr=200),'water bill 200 incl. → utilities 173.91 + VAT 26.09 / cash 200, new supplier')
ok('غير موجود' in txt and 'تأكيد' in txt,'explains: supplier will be created, asks to confirm')
r2=c(f"/ai/conversations/{r['id']}/confirm",{}); ok(r2['results'][1]['number'].startswith('EXP-'),'confirmed and posted')
# 2 slot filling over several turns
r,v=ask('فاتورة كهرباء من المورد الشركة السعودية للكهرباء'); ok(not r['pending'] and 'المبلغ' in v['text'] and 'السداد' in v['text'],'missing amount & payment → asks both')
r,v=ask('460 ريال', r['id']); ok(not r['pending'] and 'شامل الضريبة' in v['text'],'then asks whether VAT-inclusive')
r,v=ask('نعم من البنك', r['id']); p=v.get('plan'); ok(p and has(exp(p),'الكهرباء والمياه',dr=400) and has(exp(p),'البنك الأهلي',cr=460),'answers merged → 400 + 60 from bank')
r,v=ask('المبلغ 575', r['id']); p=v.get('plan'); ok(p and near(exp(p)['total'],575) and has(exp(p),'الكهرباء',dr=500),'amendment instead of confirming → new plan 575 (old one superseded)')
c(f"/ai/conversations/{r['id']}/cancel",{})
# 3 credit, net amount, named bank, date, invoice no, VAT number
r,p,txt=plan_of('إيجار المكتب 5,000 ريال غير شامل الضريبة آجل على المورد مؤسسة العقار المتحد بتاريخ 2026-11-01 رقم الفاتورة INV-88 الرقم الضريبي 310122393500003')
e=exp(p); ok(has(e,'الإيجارات',dr=5000) and has(e,'المدخلات',dr=750) and any(l.get('partner')=='مؤسسة العقار المتحد' and near(l['credit'],5750) for l in e['lines']) and e['date']=='2026-11-01','rent 5000 + 750 VAT on credit to supplier, dated')
ok('310122393500003' in p['preview'][0]['title'],'supplier created with its VAT number')
c(f"/ai/conversations/{r['id']}/confirm",{})
r,p,txt=plan_of('صيانة مكيفات ٣٤٥ ريال شامل من مصرف الراجحي أمس'); e=exp(p); ok(has(e,'الصيانة',dr=300) and has(e,'الراجحي',cr=345),'Arabic digits, named bank, maintenance 300+45')
import datetime; y=(datetime.datetime.utcnow()+datetime.timedelta(hours=3)-datetime.timedelta(days=1)).strftime('%Y-%m-%d'); ok(e['date']==y,'«أمس» → yesterday')
# 4 tax knowledge
r,p,txt=plan_of('ضيافة عملاء 230 ريال شامل الضريبة نقداً'); e=exp(p); ok(near(e['vat'],0) and near(e['net'],230) and 'غير قابلة للخصم' in txt,'hospitality: VAT not deductible → 230 all expense, explained')
r,p,txt=plan_of('تجديد إقامة عامل 650 ريال من البنك'); e=exp(p); ok(near(e['vat'],0) and has(e,'رسوم حكومية',dr=650),'government fee: out of scope, no VAT question asked')
r,p,txt=plan_of('قرطاسية 115 ريال بدون ضريبة كاش'); ok(near(exp(p)['vat'],0) and has(exp(p),'القرطاسية',dr=115),'«بدون ضريبة» respected')
r,p,txt=plan_of('وقود 100 ريال شامل نقدا'); ok('الأقرب' in txt,'no dedicated account → nearest (general) and says so')
# 5 existing supplier reused (normalised spelling)
r,p,txt=plan_of('فاتورة مياه 115 شامل الضريبة نقدا من المورد شركه المياه الوطنيه'); ok(len(p['preview'])==1 and 'موجود' not in p['preview'][0]['title'],'existing supplier found → not recreated')
# 6 guidance instead of a wrong entry
r,v=ask('اشترينا سيارة بمبلغ 80000 ريال من البنك'); ok(not r['pending'] and 'أصل ثابت' in v['text'],'car purchase → fixed-asset guidance, no expense')
r,v=ask('سجل راتب الموظف 5000'); ok(not r['pending'] and 'مسيرات الرواتب' in v['text'],'salary → payroll screen')
r,v=ask('فاتورة مبيعات للعميل أحمد 1000'); ok(not r['pending'] and 'فاتورة مبيعات جديدة' in v['text'],'sales invoice → sales screen')
# 7 journals
r,p,txt=plan_of('إيداع نقدي في البنك 10,000'); j=p['preview'][0]; ok(j['type']=='journal' and has(j,'البنك الأهلي',dr=10000) and has(j,'الصندوق الرئيسي',cr=10000),'cash deposit → Dr bank / Cr cash')
r,v=ask('مسحوبات المالك 3000'); ok(not r['pending'] and 'أي حساب' in v['text'],'owner draw: asks which account')
r,v=ask('من الصندوق', r['id']); j=v['plan']['preview'][0]; ok(has(j,'جاري المالك',dr=3000) and has(j,'الصندوق',cr=3000) and 'ليست مصروفاً' in v['text'],'owner draw → Dr owner current, explained')
c(f"/ai/conversations/{r['id']}/confirm",{})
# 8 vouchers
r,p,txt=plan_of('سددنا للمورد مؤسسة العقار المتحد 2000 من البنك'); pv=p['preview'][0]; ok(pv['type']=='payment' and has(pv,'الموردون',dr=2000) and has(pv,'البنك',cr=2000),'payment voucher to existing supplier')
c(f"/ai/conversations/{r['id']}/confirm",{})
r,v=ask('سددنا للمورد شركة غير موجودة 500 نقدا'); ok(not r['pending'] and 'لم أجد' in v['text'],'payment to unknown supplier → not invented')
# 9 explanations
r,v=ask('كيف أعالج المصروفات المدفوعة مقدماً؟'); ok('مدفوعة مقدماً' in v['text'] and not r['pending'],'principle question answered')
r,v=ask('ما هو القيد المزدوج'); ok('مدين' in v['text'],'double entry explained')
r,v=ask('أين أسجل الأرصدة الافتتاحية؟'); ok('قيد افتتاحي' in v['text'],'program how-to answered')
num=c('/expenses')[0]['number']; r,v=ask(f'اشرح القيد {num}'); ok('من:' in v['text'] and 'سند مصروف' in v['text'],'explains a posted entry by number')
r,v=ask('كم رصيد الصندوق الرئيسي'); ok('رصيد' in v['text'] and 'دائن' in v['text'] or 'مدين' in v['text'],'balance query: '+v['text'][:60])
r,v=ask('مرحبا'); ok('تسجيل المصروفات' in v['text'],'greeting → capabilities')
r,v=ask('حلل لي ربحية المشروع حسب مراكز التكلفة مع توزيع المصروفات غير المباشرة بنسبة الإيرادات'); ok(not r['pending'] and r['engine']=='local','complex request without key: stays local, replies honestly → '+v['text'][:50].replace('\n',' '))
# 10 QR from the browser
png=base64.b64encode(b'\x89PNG\r\n\x1a\n'+b'0'*40).decode()
r=c('/ai/chat',{'text':'','files':[{'name':'inv.png','mime':'image/png','data':png,'qr':{'seller':'مكتبة جرير','vat':'300000000000003','date':'2026-11-05T10:00:00Z','total':230,'vatAmount':30}}]}); v=r['view'][-1]
ok(not r['pending'] and 'مكتبة جرير' in v['text'] and 'نوع المصروف' in v['text'],'QR read → asks only for kind/payment')
r,v=ask('قرطاسية نقدا', r['id']); p=v['plan']; e=exp(p); ok(has(e,'القرطاسية',dr=200) and near(e['vat'],30) and e['date']=='2026-11-05' and '300000000000003' in p['preview'][0]['title'],'QR data used: 200+30, date, supplier with VAT no.')
rr=c(f"/ai/conversations/{r['id']}/confirm",{}); eid=[x for x in rr['results'] if x['type']=='expense'][0]['id']; ok(len(c(f'/attachments/expense/{eid}'))==1,'image attached to the posted expense')
r=c('/ai/chat',{'text':'','files':[{'name':'scan.png','mime':'image/png','data':png}]}); ok('QR' in r['view'][-1]['text'] and not r['pending'],'image without QR and no key → explains the limit')
try: c('/ai/chat',{'text':'x','engine':'advanced'}); ok(False,'adv')
except E as e: ok('400' in str(e),'advanced engine refused without a key')
tb=c('/reports/trial-balance')['totals']; ok(near(tb['debit'],tb['credit']),'trial balance balanced'); ok(all(x['ok'] for x in c('/reports/integrity')['checks']),'integrity checks pass')
ok(c('/ai/status')['used']==0,'built-in agent turns are not metered')
print('FAILS',fails)
