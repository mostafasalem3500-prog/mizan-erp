"""3.54: the report centre's new reports (HR file, manufacturing, rentals, subscriptions) agree with the screens
they summarise, on the demo data; every report in the catalogue runs; grouped views add up to the detailed view."""
import sys, os, time; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'ui'))
from lib import *
import lib
t = register('r354'); c = lambda *a, **k: call(*a, tok=t, **k)
c('/demo/load', {})
for _ in range(400):
    s = c('/demo/status')
    if s.get('demoLoaded') and not (s.get('demoJob') or {}).get('running'): break
    time.sleep(1.5)
y = time.strftime('%Y'); R = lambda k, extra='': c(f'/reports/run/{k}?from={y}-01-01&to={y}-12-31{extra}')
cat = c('/reports/catalog'); keys = [r['key'] for r in cat['reports']]; mods = [m['key'] for m in cat['modules']]
ok(all(m in mods for m in ['mfg', 'rental', 'subs']) and all(k in keys for k in ['hr.leaves', 'hr.documents', 'hr.headcount', 'hr.salary-changes', 'mfg.orders', 'mfg.consumption', 'rental.contracts', 'rental.revenue', 'subs.subscribers', 'subs.billing']), 'new modules and reports are in the catalogue')
bad = []
for k in keys:
    try: R(k)
    except E as e: bad.append((k, str(e)[:120]))
ok(not bad, f'all {len(keys)} reports run ' + str(bad[:3]))
# HR
emps = c('/employees'); hc = R('hr.headcount')
ok(len(hc['rows']) == len(emps) and near(hc['totals']['total'], sum(float(e['basic']) + float(e['housing']) + float(e['transport']) + float(e['otherAllow']) for e in emps)), 'employee register: every employee, pay adds up')
g = R('hr.headcount', '&groupBy=department'); ok(sum(r['active'] for r in g['rows']) == len([e for e in emps if e['isActive']]) and sum(r['leftCount'] for r in g['rows']) == len([e for e in emps if not e['isActive']]), 'by department: active and left match')
lv = [l for l in c('/hr/leave-requests') if l['toDate'] >= f'{y}-01-01' and l['fromDate'] <= f'{y}-12-31']; rl = R('hr.leaves')
ok(len(rl['rows']) == len(lv) and near(rl['totals']['days'], sum(float(l['days']) for l in lv)), 'leave register = the leave screen')
gl = R('hr.leaves', '&groupBy=type'); ok(near(sum(r['approved'] for r in gl['rows']), sum(float(l['days']) for l in lv if l['status'] == 'APPROVED')), 'leave by type: approved days add up')
docs = c('/hr/documents'); rd = R('hr.documents'); ok(len(rd['rows']) == len(docs) and len([r for r in rd['rows'] if r['state'] == 'منتهية']) == len([d for d in docs if d['state'] == 'EXPIRED']), 'documents = the documents screen, expired ones flagged')
sc = R('hr.salary-changes'); ok(len(sc['rows']) >= 1 and sc['rows'][0]['after'] > sc['rows'][0]['before'] and sc['rows'][0]['status'] == 'ينتظر تاريخه', 'the pending raise is listed with before and after')
# manufacturing
mo = c('/mfg/orders'); mo = mo['rows'] if isinstance(mo, dict) else mo; rm = R('mfg.orders')
inyear = [o for o in mo if str(o['date'])[:4] == y]
ok(len(rm['rows']) == len(inyear) and near(rm['totals']['materialCost'], sum(float(o['materialCost']) for o in inyear), 0.02), 'manufacturing orders = the orders screen, material cost adds up')
gm = R('mfg.orders', '&groupBy=product'); ok(near(sum(float(r['material']) for r in gm['rows']), rm['totals']['materialCost'], 0.02) and near(sum(float(r['variance']) for r in gm['rows']), rm['totals']['variance'], 0.02), 'by product adds up to the detail')
ok(near(R('mfg.consumption')['totals']['value'], rm['totals']['materialCost'], 0.05), 'material consumption value = material cost of the orders')
# rentals
rc = R('rental.contracts'); rv = R('rental.revenue')
acc = {x.get('systemKey'): x for x in c('/accounts')['rows'] if x.get('systemKey')}
tb = {r['id']: r for r in c(f'/reports/trial-balance?from={y}-01-01&to={y}-12-31')['rows']}
bal = lambda k: round(float(tb[acc[k]['id']]['credit']) - float(tb[acc[k]['id']]['debit']), 2) if k in acc and acc[k]['id'] in tb else 0.0
ok(near(rv['totals']['invoiced'], bal('RENTAL_REVENUE'), 0.05), f"rental revenue by month = the rental revenue account ({rv['totals']['invoiced']} / {bal('RENTAL_REVENUE')})")
held = round(float(rv['totals']['depositIn']) - float(rv['totals']['depositApplied']) - float(rv['totals']['depositOut']), 2)
ok(near(held, bal('RENTAL_DEPOSITS'), 0.05) and near(rc['totals']['depositHeld'], held, 0.05), f'deposits held: the contracts, the monthly movements and the liability account agree ({held})')
gr = R('rental.contracts', '&groupBy=status'); ok(sum(r['contracts'] for r in gr['rows']) == len(rc['rows']), 'contracts by status add up')
# subscriptions
sd = c('/subs/dashboard'); ss = R('subs.subscribers')
mrr = sd.get('mrr', (sd.get('kpis') or {}).get('mrr'))
ok(mrr is not None and near(ss['totals']['monthly'], mrr, 0.05), f"monthly recurring revenue = the subscriptions dashboard ({ss['totals']['monthly']} / {mrr})")
gs = R('subs.subscribers', '&groupBy=plan'); ok(near(sum(r['monthly'] for r in gs['rows']), ss['totals']['monthly']) and sum(r['subscribers'] for r in gs['rows']) == len(ss['rows']), 'subscribers by plan add up')
sb = R('subs.billing'); sp = R('subs.billing', '&groupBy=plan'); ok(near(sb['totals']['net'], sp['totals']['net']) and sb['totals']['invoices'] >= 1, 'billing by month and by plan give the same net')
ig = c('/reports/integrity'); ok(ig['ok'], 'integrity checks pass')
print('FAILS', lib.fails); sys.exit(1 if lib.fails else 0)
