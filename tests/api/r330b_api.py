import sys, os, time, json, subprocess, urllib.request; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
import lib
# ── error monitoring and the service status page ──
EG='3200' in B; DBN='mizan_eg' if EG else 'mizan'; ROOT=B[:-4]
def raw(path, data=None, headers=None):
    r=urllib.request.Request(ROOT+path, data=data, headers=headers or {}, method='POST' if data is not None else 'GET')
    try:
        with urllib.request.urlopen(r) as x: return x.status, {k.lower():v for k,v in x.headers.items()}, x.read().decode('utf8')
    except urllib.error.HTTPError as e: return e.code, {k.lower():v for k,v in e.headers.items()}, e.read().decode('utf8')
st,h,body=raw('/api/status'); s=json.loads(body)
ok(st==200 and s['ok'] and s['database']['ok'] and s['version'] and 'serverErrors24h' in s,'status JSON: database up, version, error count')
ok(not s['selfcheck'] or (s['selfcheck']['ok'] and s['selfcheck']['passed']==s['selfcheck']['total']),'status carries the boot self-check result')
st,h,page=raw('/status')
ok(st==200 and 'text/html' in h['content-type'] and '<script' not in page and "default-src 'none'" in h.get('content-security-policy','') and 'All systems operational' in page and 'الخدمة تعمل' in page,'status page: plain HTML in Arabic and English, no script, strict CSP')
ok('stack' not in page.lower() and '@' not in page,'status page shows no error text or names')
# browser errors are taken in without a session, grouped per kind, and capped per address
import random; msg='TypeError: r330 probe '+''.join(random.choice('abcdefghijklmnop') for _ in range(12))  # letters: digits are grouped together
post=lambda m: raw('/api/client-errors', json.dumps({'message':m,'stack':'at Probe (App.js:1:1)','path':'/x/123','version':'test'}).encode(), {'Content-Type':'application/json'})
ok(post(msg)[0]==204 and post(msg)[0]==204,'browser error accepted without a session (204)')
ok(raw('/api/client-errors', b'{"message":""}', {'Content-Type':'application/json'})[0]==204,'empty report ignored quietly')
# a malformed id in the address is "not found", not a server error
t=register('r330b'); c=lambda *a,**k: call(*a,tok=t,**k)
try: c('/journals/not-a-uuid'); ok(False,'malformed id')
except E as e: ok(str(e)[:3]=='404','a malformed id answers 404 instead of 500')
try: c('/admin/errors'); ok(False,'admin errors open to anyone')
except E as e: ok(str(e)[:3]=='403','the error list is for the system manager only')
# the system manager sees the grouped error
pg=os.environ.get('TEST_PG','postgresql://postgres@127.0.0.1:5433')
st=str(time.time_ns()); email=f'admin{st}@t.sa'
call('/auth/register',{'fullName':'مدير','companyName':'r330 admin '+st,'email':email,'password':'Passw0rd!'})
r=subprocess.run(['psql',pg+f'/{DBN}','-qc',f"UPDATE users SET is_super_admin=true WHERE email='{email}'"],capture_output=True,text=True)
if r.returncode==0:
    ta=call('/auth/login',{'email':email,'password':'Passw0rd!'})['token']
    er=call('/admin/errors?days=1',tok=ta); hit=[x for x in er['rows'] if x['message']==msg]
    ok(hit and hit[0]['count']==2 and hit[0]['source']=='client' and hit[0]['path']=='/x/123','the system manager sees it once, counted twice, with its screen')
    ok(er['last24h'].get('client',0)>=2,'…and the 24-hour total')
    burst='RangeError: burst '+''.join(random.choice('abcdefghijklmnop') for _ in range(10))+' '
    codes=[post(burst+str(i))[0] for i in range(25)]
    n=sum(x['count'] for x in call('/admin/errors?days=1',tok=ta)['rows'] if x['message'].startswith(burst))
    ok(all(c_==204 for c_ in codes) and n<=20,f'one address cannot flood the log ({n} of 25 kept)')
else: print('skip admin checks (no database access):',r.stderr[:120])
print('FAILS',lib.fails)
