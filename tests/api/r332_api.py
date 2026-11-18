import sys, os, time, json, datetime, re; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
from urllib.parse import quote
EG='3200' in B
# ── 3.32: dashboard filters and ledger profit, the written financial report, periodic reports ──
t=register('r332'); c=lambda *a,**k: call(*a,tok=t,**k)
c('/demo/load',{})
for _ in range(200):
    s=c('/demo/status')
    if s.get('demoLoaded') and not (s.get('demoJob') or {}).get('running'): break
    time.sleep(1.5)
d=datetime.date.today(); dt=d.isoformat(); y0=f'{d.year}-01-01'
inc=c(f'/reports/income?from={y0}&to={dt}')
ex=c(f'/analytics/executive?from={y0}&to={dt}')
k=ex['kpis']; L=k['ledger']
ok(near(k['netProfit'],inc['operating']) and near(k['expenses'],inc['opex']['total']) and near(L['net'],inc['net']) and near(L['netSales'],inc['netSales']),f"operating profit and expenses come from the ledger and equal the income statement ({k['netProfit']})")
ok(near(L['operating'],L['grossProfit']-L['opex']) and near(L['grossProfit'],L['netSales']-L['cogs']),'ledger build-up adds up: sales − cost of sales − operating expenses')
# comparison basis
yy=c(f'/analytics/executive?from={y0}&to={dt}&compare=yoy')
ok(yy['period']['prevFrom']==f'{d.year-1}-01-01' and yy['period']['prevTo']==f'{d.year-1}{dt[4:]}' and yy['period']['compare']=='yoy','compare with the same dates last year')
ok(ex['period']['compare']=='prev' and ex['period']['prevTo']==(datetime.date(d.year,1,1)-datetime.timedelta(days=1)).isoformat(),'default comparison: the previous period of equal length')
# channel: the filtered total is the channel's line in the unfiltered breakdown
ch=ex['byChannel'][0]
e2=c(f"/analytics/executive?from={y0}&to={dt}&channel={ch['k']}")
ok(near(e2['kpis']['sales'],ch['v']) and e2['kpis']['invoices']==ch['n'] and all(x['k']==ch['k'] for x in e2['byChannel']),f"channel {ch['k']}: sales {e2['kpis']['sales']} = its share of the unfiltered dashboard")
ok(e2['kpis']['netProfit'] is None and e2['kpis']['expenses'] is None and e2['docOnly'],'ledger figures are not cut by channel: shown as not available instead of wrong')
# category: line-level totals equal the category's line in the unfiltered dashboard
cats=c('/categories'); cat=[x for x in ex['categories'] if x['k']!='بدون تصنيف'][0]; cid_=[x['id'] for x in cats if x['name']==cat['k']][0]
e3=c(f'/analytics/executive?from={y0}&to={dt}&categoryId={cid_}')
ok(near(e3['kpis']['sales'],cat['v']) and all(p['category']==cat['k'] for p in e3['topProducts']) and near(sum(x['v'] for x in e3['categories']),cat['v']),f"category «{cat['k']}»: only its lines count ({e3['kpis']['sales']})")
ok(near(e3['kpis']['sales'],sum(x['sales'] for x in e3['daily'])),'the daily chart follows the category filter')
# customer
cu=ex['topCustomers'][0]
e4=c(f"/analytics/executive?from={y0}&to={dt}&partnerId={cu['id']}")
ok(near(e4['kpis']['sales'],cu['v']) and len(e4['topCustomers'])==1,f"customer «{cu['name']}»: {e4['kpis']['sales']}")
# cost centre: ledger result equals the projects report
pj=c(f'/projects?from={y0}&to={dt}')['rows']; pr=[x for x in pj if x.get('revenue')][0]
e5=c(f"/analytics/executive?from={y0}&to={dt}&costCenterId={pr['id']}")
ok(near(e5['kpis']['ledger']['operating'],pr['profit']) and near(e5['kpis']['ledger']['netSales'],pr['revenue']),f"project «{pr['name']}»: revenue {pr['revenue']} and result {pr['profit']} agree with the projects report")
# junk filter values are ignored, never reach SQL
e6=c(f"/analytics/executive?from={y0}&to={dt}&channel={quote(chr(39)+'; DROP TABLE x;--')}&categoryId=1%27%20OR%201%3D1&partnerId=abc")
ok(near(e6['kpis']['sales'],k['sales']) and e6['filters']['channel'] is None and e6['filters']['categoryId'] is None,'malformed filter values are ignored')
# ── the written financial report ──
r=c(f'/reports/financial-report?from={y0}&to={dt}')
kf={x['key']:x for x in r['keyFigures']}
ok(near(kf['sales']['value'],inc['netSales']) and near(kf['net']['value'],inc['net']) and near(kf['opex']['value'],inc['opex']['total']),'key figures are the income statement')
bs=c(f'/reports/balance-sheet?to={dt}')
ok(near(kf['equity']['value'],bs['totalEquity']),'equity is the balance sheet')
sec={s['key']:s for s in r['sections']}
ok(set(sec)>={'summary','profit','liquidity','position','working','books','compliance'} and all(s['paragraphs'] for s in r['sections']),'all sections written')
ok(r['verdict']['level'] in ('good','ok','watch','critical') and 0<=r['verdict']['health']<=100,f"overall verdict {r['verdict']['label']} ({r['verdict']['health']}/100)")
money_net='{:,.2f}'.format(abs(inc['net']))
ok(money_net in ' '.join(sec['summary']['paragraphs']),'the executive summary states the net result in figures')
chk={x['key']:x for x in r['checks']}
ok(chk['integrity']['status']=='good' and chk['cash']['status']=='good' and chk['vat']['status']=='good','demo books: reconciliations, cash and VAT clean')
cmp={x['key']:x for x in r['compliance']}
ok('vatReturn' in cmp and 'einvoice' in cmp and str(14 if EG else 15) in cmp['vatReturn']['label'],'VAT return and e-invoicing obligations with the edition rate')
if EG: ok('payrollTax' in cmp and 'eosb' not in cmp and 'المصرية' in cmp['einvoice']['ref'],'Egypt: payroll tax and Martyrs fund, ETA e-invoicing, no Saudi end-of-service line')
else: ok('eosb' in cmp and cmp['eosb']['status']=='good' and 'المادة 84' in cmp['eosb']['ref'] and 'partnerTax' in cmp,'Saudi: end-of-service provision (Labour Law art. 84) and partner tax data')
ok(all(x['priority'] in (1,2,3) for x in r['recommendations']) and [x['priority'] for x in r['recommendations']]==sorted(x['priority'] for x in r['recommendations']),'recommendations ordered by priority')
en=c(f'/reports/financial-report?from={y0}&to={dt}&lang=en')
titles=' '.join(s['title'] for s in en['sections'])+' '.join(x['label'] for x in en['checks'])
ok(not re.search('[ء-ي]',titles) and en['sections'][0]['paragraphs'][0].startswith('Overall') and en['company']['currency']==('EGP' if EG else 'SAR'),'English report written in English (titles, checks, currency code)')
rb=c(f"/reports/financial-report?from={y0}&to={dt}&branchId={c('/branches')[0]['id']}")
ok('integrity' not in {x['key'] for x in rb['checks']} and rb['period']['branchId'],'branch report: company-wide reconciliation not shown')
# problems are found: a fresh company paying an expense from an empty cash box
t2=register('r332b'); c2=lambda *a,**k: call(*a,tok=t2,**k)
A=c2('/accounts')['rows']; cash=[a for a in A if a.get('systemKey')=='CASH'][0]; ex_=[a for a in A if a['type']=='EXPENSE' and not a.get('isGroup') and a['code'].startswith('52')][0]
c2('/expenses',{'date':dt,'accountId':ex_['id'],'description':'إيجار','amount':1000,'taxCode':'E','payAccountId':cash['id']})
r2=c2(f'/reports/financial-report?from={dt[:8]}01&to={dt}')
ck2={x['key']:x for x in r2['checks']}
ok(ck2['cash']['status']=='bad' and any(x['priority']==1 and 'الصناديق' in x['text'] for x in r2['recommendations']),'a negative cash box is found and is an urgent recommendation')
cm2={x['key']:x for x in r2['compliance']}
ok(cm2['vatReturn']['status']=='good' and 'لا حركات' in cm2['vatReturn']['text'],'no VAT return is claimed late for a period before the establishment started')
ok(r2['verdict']['level'] in ('watch','critical') and r2['sections'][0]['status'] in ('warn','bad'),'and the verdict reflects it')
# ── periodic reports ──
lst=c('/periodic-reports')
last_end=(datetime.date(d.year,d.month,1)-datetime.timedelta(days=1)); lm=last_end.isoformat()[:8]+'01'
ok(len(lst['rows'])==1 and lst['rows'][0]['kind']=='MONTH' and lst['rows'][0]['periodFrom']==lm and lst['rows'][0]['auto'] and lst['issued'],'first visit issues last month\'s report for an establishment with activity')
ok(lst['settings']=={'MONTH':True,'QUARTER':True,'YEAR':True},'automatic issue on by default for the three kinds')
q1=c('/periodic-reports',{'kind':'QUARTER','date':lm})
g=c(f"/periodic-reports/{q1['id']}"); qs=(int(lm[5:7])-1)//3*3+1
ok(g['kind']=='QUARTER' and g['periodFrom']==f"{d.year if last_end.year==d.year else last_end.year}-{qs:02d}-01" and g['report']['sections'] and 'الربع' in g['title'],'quarterly report issued for the quarter containing the date')
ge=c(f"/periodic-reports/{q1['id']}?lang=en")
ok(ge['report']['lang']=='en' and ge['report']['sections'][0]['title']=='Executive summary','the English text is stored with it')
q2=c('/periodic-reports',{'kind':'QUARTER','date':lm})
ok(q2['id']==q1['id'] and len(c('/periodic-reports')['rows'])==2,'re-issuing replaces the same period, no duplicate')
for b,lab in [({'kind':'WEEK'},'unknown kind'),({'kind':'MONTH','date':f'{d.year+1}-06-01'},'period not started')]:
    try: c('/periodic-reports',b); ok(False,lab)
    except E as x: ok(str(x)[:3]=='400',f'refused: {lab}')
st=call('/periodic-reports/settings',{'MONTH':True,'QUARTER':False,'YEAR':True},tok=t,m='PUT')
ok(st=={'MONTH':True,'QUARTER':False,'YEAR':True} and c('/periodic-reports')['settings']['QUARTER'] is False,'automatic quarterly report can be switched off')
c(f"/periodic-reports/{q1['id']}",m='DELETE')
try: c(f"/periodic-reports/{q1['id']}"); ok(False,'deleted report')
except E as x: ok(str(x)[:3] in ('400','404'),'a deleted report is gone')
t3=register('r332c')
ok(call('/periodic-reports',tok=t3)['rows']==[] and call('/periodic-reports',tok=t3)['issued'] is None,'a new establishment with no activity gets no empty report')
try: call(f"/periodic-reports/{lst['rows'][0]['id']}",tok=t3); ok(False,'other company report')
except E as x: ok(str(x)[:3] in ('400','404'),'another establishment\'s report is not reachable')
print('FAILS',lib.fails)
