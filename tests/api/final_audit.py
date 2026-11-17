"""Final accounting audit on the demo dataset: loads it in a fresh company and checks books against sub-ledgers and statements."""
import sys, os, time; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B
t=register('audit'); c=lambda *a,**k: call(*a,tok=t,**k)
c('/demo/load',{})
for _ in range(600):
    s=c('/demo/status')
    if s.get('demoLoaded') and not (s.get('demoJob') or {}).get('running'): break
    time.sleep(1)
ok(bool(s.get('demoLoaded')),'demo dataset loaded')
it=c('/reports/integrity'); ch=it.get('checks') or it
for x in ch: ok(x['ok'], f"integrity: {x['name']} ({x['a']} / {x['b']})")
y=time.strftime('%Y'); d=time.strftime('%Y-%m-%d')
tb=c(f'/reports/trial-balance?from={y}-01-01&to={d}'); ok(tb['balanced'] and near(tb['totals']['debit'],tb['totals']['credit']),f"trial balance balanced {tb['totals']['debit']}")
bs=c(f'/reports/balance-sheet?to={d}'); ok(bs['balanced'],f"balance sheet balanced {bs['totalAssets']} = {bs['totalLiabEquity']}")

sup=c('/partners?role=SUPPLIER'); cus=c('/partners?role=CUSTOMER')
ok(len(sup)>=7 and all(p['taxReady'] for p in sup), f"all {len(sup)} demo suppliers have complete tax data: "+', '.join(p['name'] for p in sup if not p['taxReady']))
co=[p for p in cus if p['kind']=='COMPANY']
ok(len(co)>=7 and all(p['taxReady'] for p in co), f"all {len(co)} demo company customers have complete tax data")
ok(all(p.get('phone') for p in cus if p['code']!='WALKIN'), 'every demo customer has a phone')
print('FAILS',lib.fails)
pr=c('/projects'); rows=pr.get('rows') or pr
P=[x for x in rows if x.get('kind')=='PROJECT']; CC=[x for x in rows if x.get('kind')=='CENTER']
ok(len(P)==2 and len(CC)==2, f'demo has 2 projects and 2 cost centres ({len(P)}/{len(CC)})')
det=c(f"/projects/{P[0]['id']}"); print('  project keys', [k for k in det.keys()][:14]); print('  ', {k:det[k] for k in det if k in ('revenue','cost','profit','margin','totals')})
# purge then load again must work and keep the books tied
c('/demo/purge',{}); pr=c('/projects'); rows=pr['rows'] if isinstance(pr,dict) else pr; ok(len(rows)==0,'purging the demo removes its centres and projects'); tb=c(f'/reports/trial-balance?from={y}-01-01&to={d}'); ok(near(tb['totals']['debit'],0),'purging leaves empty books')
c('/demo/load',{})
for _ in range(600):
    s=c('/demo/status')
    if s.get('demoLoaded') and not (s.get('demoJob') or {}).get('running'): break
    time.sleep(1)
it=c('/reports/integrity'); ch=it.get('checks') or it; ok(all(x['ok'] for x in ch),'after reloading the demo the integrity checks still pass')
pr=c('/projects'); rows=pr.get('rows') or pr; ok(len(rows)==4,'reload does not duplicate centres/projects')
print('FAILS',lib.fails)
dr=c(f'/reports/daily?date={d}'); neg=[a for a in dr['cash'] if a['closing']<0]; ok(not neg, 'no cash or bank account of the demo is overdrawn: '+', '.join(f"{a['name']} {a['closing']}" for a in neg))
print('FAILS',lib.fails)
