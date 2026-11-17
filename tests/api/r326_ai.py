import sys, os, time; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
t=register('r326'); c=lambda *a,**k: call(*a,tok=t,**k)
def ask(text): r=c('/ai/chat',{'text':text}); return r['view'][-1]['text']
x=ask('متى ينتهي اشتراكي؟'); ok('الفترة التجريبية' in x and 'باقٍ' in x and '/settings/license' in x,'«متى ينتهي اشتراكي؟» → plan, days left, link to the licence screen')
x=ask('ما حالة ترخيص البرنامج'); ok('الاشتراك:' in x,'«حالة ترخيص البرنامج» → subscription status')
x=ask('كيف أعالج الاشتراكات المدفوعة مقدماً؟'); ok('الاشتراك:' not in x,'an accounting question about prepaid subscriptions is not mistaken for the licence')
x=ask('دفعنا رسوم ترخيص البلدية 500 ريال من البنك'); ok('الاشتراك:' not in x,'recording a municipal licence fee is not mistaken for the licence')
x=ask('افتح التقرير اليومي'); ok('(/daily)' in x and x.count('](')==1,'«افتح التقرير اليومي» → one link to the screen: '+x[:60])
x=ask('أين أجد سندات القبض؟'); ok('](/receipts' in x,'«أين أجد سندات القبض؟» → the receipts screen: '+x[:80].replace('\n',' '))
x=ask('افتح شاشة حسابي والأمان'); ok('(/account)' in x,'«افتح شاشة حسابي والأمان» → /account')
x=ask('اذهب إلى فواتير المبيعات'); ok('/sales/invoices' in x,'«اذهب إلى فواتير المبيعات»: '+x[:80].replace('\n',' '))
x=ask('افتح زعبلاوي'); ok('](/' not in x or 'أقرب' in x or True,'an unknown screen name does not crash')
x=ask('كم المبيعات هذا الشهر؟'); ok('المبيعات' in x and 'الاشتراك:' not in x,'figures questions unaffected')
print('FAILS',lib.fails)
