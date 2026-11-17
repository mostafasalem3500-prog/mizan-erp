import sys, os, subprocess; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
EG='3200' in B; DBN='mizan_eg' if EG else 'mizan'; MODE=os.environ.get('MODE','open')
t=register('r317'); c=lambda *a,**k: call(*a,tok=t,**k)
cid=c('/settings')['id']
def plan(p): subprocess.run(['psql',f'postgresql://postgres@127.0.0.1:5433/{DBN}','-qc',f"UPDATE companies SET plan='{p}' WHERE id='{cid}'"],check=True)
for p in ['BASIC','PRO','TRIAL','ENTERPRISE']:
    plan(p); st=c('/ai/status')
    if MODE=='open':
        ok(st['entitled'] and st['open'] and not st['trial'] and st['plan']==p,f'{p}: assistant open')
        v=c('/ai/chat',{'text':'ملخص هذا الشهر'})['view'][-1]; ok(v['engine']=='local' and len(v['text'])>40,f'{p}: built-in agent answers')
    else:
        want=p in ('ENTERPRISE','TRIAL'); ok(st['entitled']==want and not st['open'],f'{p}: gate restored → entitled={want}')
        if not want:
            try: c('/ai/chat',{'text':'ملخص هذا الشهر'}); ok(False,p+' chat')
            except E as e: ok('402' in str(e),f'{p}: chat refused with 402 when the gate is on')
print('FAILS',lib.fails); sys.exit(1 if lib.fails else 0)
