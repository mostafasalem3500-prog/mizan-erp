import sys, os, time, datetime, re; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B
t=register('r314'); c=lambda *a,**k: call(*a,tok=t,**k)
c('/demo/load',{})
for i in range(80):
    if c('/demo/status').get('demoLoaded'): break
    time.sleep(3)
td=datetime.date.today(); y=td.year; m=td.strftime('%Y-%m'); d=td.isoformat()
pm=(td.replace(day=1)-datetime.timedelta(days=1)); PMF=pm.replace(day=1).isoformat(); PMT=pm.isoformat()
def ask(text, conv=None):
    r=c('/ai/chat',{'text':text, **({'conversationId':conv} if conv else {})}); return r['id'], r['view'][-1]
f=lambda v: '{:,.2f}'.format(float(v))
ex=lambda a,b: c(f'/analytics/executive?from={a}&to={b}')
# ── financial analysis
cid,v=ask('حلّل الوضع المالي'); tx=v['text']; bs=c(f'/reports/balance-sheet?to={d}')
ok('التحليل المالي' in tx and 'الصحة المالية' in tx and 'التوصيات' in tx and '| نسبة التداول |' in tx and v['engine']=='local','financial analysis: score, ratio table, recommendations — built-in engine')
cur=round(bs['currentAssets']['total']/bs['currentLiab']['total'],2) if bs['currentLiab']['total'] else None
ok(cur is None or f'| نسبة التداول | {cur:g} مرة' in tx or f'| نسبة التداول | {cur} مرة' in tx,f'current ratio in the answer = balance sheet ({cur})')
inc=c(f'/reports/income?from={y}-01-01&to={d}') if False else None
ok(f(bs['totalAssets']) in tx and f(bs['totalEquity']) in tx,'total assets and equity quoted from the balance sheet')
ok(v.get('suggest') and 'اكتب تقريراً للإدارة' in v['suggest'],'follow-up chips offered: '+' | '.join(v.get('suggest') or []))
_,v=ask('ما هي نسبة السيولة؟'); ok('نسبة السيولة السريعة' in v['text'],'«ما هي نسبة السيولة؟» → ratios, not a lesson')
_,v=ask('كيف أرفع الأرباح؟'); ok('التوصيات' in v['text'],'«كيف أرفع الأرباح؟» → analysis with recommendations')
# ── comparison
_,v=ask('قارن هذا الشهر بالشهر الماضي'); tx=v['text']; a=ex(f'{m}-01',d)['kpis']; b=ex(PMF,PMT)['kpis']
ok('مقارنة هذا الشهر مع الشهر الماضي' in tx and f"| المبيعات | {f(a['sales'])} | {f(b['sales'])} |" in tx,f"month vs last month: sales {a['sales']} / {b['sales']} match the dashboard")
ok(f"| صافي الربح التشغيلي | {f(a['netProfit'])} | {f(b['netProfit'])} |" in tx and 'القراءة' in tx,'comparison has net profit row and a reading')
_,v=ask('قارن مبيعات يناير وفبراير'); ok(f'يناير {y}' in v['text'] and f'فبراير {y}' in v['text'],'two named months compared')
_,v=ask(f'مقارنة سنة {y} مع السنة الماضية'); ok(f'سنة {y}' in v['text'] and f'سنة {y-1}' in v['text'],'year vs previous year')
_,v=ask('قارن المصروفات'); ok('مقارنة هذا الشهر' in v['text'],'comparison with no period named → this month vs the one before')
# ── management report
_,v=ask('اكتب تقريراً للإدارة عن هذه السنة'); tx=v['text']; k=ex(f'{y}-01-01',d)['kpis']
ok(all(s in tx for s in ['تقرير الإدارة','1. الأداء','2. السيولة والذمم','3. المؤشرات المالية','4. الضريبة والدفاتر','5. المخاطر','6. التوصيات']),'management report has its six sections')
ok(f"| المبيعات | {f(k['sales'])} |" in tx and 'هذه السنة' in tx,'report figures are the year figures')
# ── VAT
_,v=ask('كم الضريبة المستحقة هذا الربع؟'); q0=(td.month-1)//3*3+1; vr=c(f'/reports/vat?from={y}-{q0:02d}-01&to={d}')
ok(f(vr['outputVat']) in v['text'] and f(vr['inputVat']) in v['text'] and f(abs(vr['net'])) in v['text'],f"VAT position = the return: out {vr['outputVat']} in {vr['inputVat']} net {vr['net']}")
_,v=ask('كيف أقدّم الإقرار الضريبي؟'); ok('المستحق سداده' not in v['text'] and 'رصيد دائن لصالحك' not in v['text'],'«كيف أقدّم الإقرار؟» still answers with the how-to')
# ── one item
top=ex(f'{y}-01-01',d)['topProducts'][0]
_,v=ask(f"كم بعنا من صنف {top['name']} هذه السنة؟"); ok(top['name'] in v['text'] and f(top['net']) in v['text'] and 'الرصيد الآن' in v['text'],f"item card: {top['name']} sold {top['net']} this year, with stock on hand")
_,v=ask('كم مخزون صنف زززز غير موجود'); ok('لم أجد صنفاً' in v['text'],'unknown item → says so')
# ── payroll
_,v=ask('كم إجمالي الرواتب؟'); ok('الرواتب والموظفون' in v['text'] and 'السلف القائمة' in v['text'],'payroll summary')
# ── follow-ups continue the last question
cid,v=ask('كم المبيعات هذا الشهر؟'); ok('هذا الشهر' in v['text'] and f(a['sales']) in v['text'],'sales this month')
_,v=ask('والشهر الماضي؟',cid); ok('الشهر الماضي' in v['text'] and f(b['sales']) in v['text'] and 'المبيعات' in v['text'],'«والشهر الماضي؟» → sales of last month')
_,v=ask('والمصروفات؟',cid); ok('المصروفات' in v['text'] and f(b['expenses']) in v['text'] and PMF in v['text'],'«والمصروفات؟» → expenses of the same period')
# ── each question is read on its own
_,v=ask('كيف أضيف عميلاً؟',cid); ok('المبيعات:' not in v['text'] and ('عميل' in v['text']),'a how-to after a figures question is not answered with figures')
_,v=ask('فاتورة كهرباء 460 ريال شامل الضريبة نقداً',cid); p=v.get('plan'); ok(p and p['status']=='pending' and any(abs(float(x.get('total',0))-460)<0.01 for x in p['preview']),'an expense in the same conversation is planned cleanly (460)')
c(f'/ai/conversations/{cid}/cancel',{})
cid2,v=ask('فاتورة قرطاسية 230 ريال'); ok(not v.get('plan') and '؟' in v['text'],'missing details are asked for')
_,v=ask('شامل الضريبة، نقداً',cid2); ok(v.get('plan') and v['plan']['status']=='pending','the answer completes the same request')
c(f'/ai/conversations/{cid2}/cancel',{})
# ── everyday wording
tdk=ex(d,d)['kpis']
_,v=ask('كام المبيعات النهارده؟'); ok('اليوم' in v['text'] and f(tdk['sales']) in v['text'],'Egyptian wording: «كام المبيعات النهارده؟»')
_,v=ask('وش صافي الربح الشهر اللي فات'); ok('الشهر الماضي' in v['text'] and 'صافي الربح' in v['text'],'Gulf wording: «وش صافي الربح الشهر اللي فات»')
_,v=ask('ابغى اعرف كم علينا للموردين'); ok('مستحقات الموردين' in v['text'],'«ابغى اعرف كم علينا للموردين»')
# ── periods
_,v=ask(f'كم المبيعات في الربع الأول {y}؟'); ok(f'{y}-01-01' in v['text'] and f'{y}-03-31' in v['text'],'first quarter resolved')
_,v=ask('كم المصروفات آخر 30 يوم؟'); ok('آخر 30 يوماً' in v['text'],'last 30 days resolved')
# ── nothing matched → closest matches, one tap away
_,v=ask('ما هي طريقة جرد المخزون الدوري والتسوية؟'); 
if 'أقرب ما عندي' in v['text']:
    ok(len(v.get('suggest') or [])>0,'unknown question → closest lessons offered: '+' | '.join(v['suggest']))
    _,v2=ask(v['suggest'][0]); ok(len(v2['text'])>120 and 'أقرب ما عندي' not in v2['text'],'tapping a suggestion opens it')
else: ok(len(v['text'])>100,'stock-count question answered directly')
_,v=ask('ققققق ططططط'); ok('لم أفهم' in v['text'] or 'أقرب' in v['text'],'gibberish → asks to rephrase')
_,v=ask('اعكس القيد JV-2026-00001'); ok('عكس القيد' in v['text'] and not v.get('plan'),'reversal → explains where to do it, posts nothing')
_,v=ask('افحص الدفاتر'); ok('فحص' in v['text'] and v.get('suggest'),'books check still works, with chips')
print('FAILS',lib.fails); sys.exit(1 if lib.fails else 0)
