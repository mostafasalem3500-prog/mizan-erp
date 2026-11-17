import json, urllib.request, time, os
B=os.environ.get('B','http://127.0.0.1:3100/api')
class E(Exception): pass
def call(p, body=None, m=None, tok=None):
    r=urllib.request.Request(B+p, data=json.dumps(body).encode() if body is not None else None, method=m or ('POST' if body is not None else 'GET'), headers={'Content-Type':'application/json', **({'Authorization':'Bearer '+tok} if tok else {})})
    try:
        with urllib.request.urlopen(r) as x: return json.loads(x.read() or b'null')
    except urllib.error.HTTPError as e:
        raise E(f"{e.code} {p}: {e.read().decode()[:300]}")
def register(prefix='t'):
    st=str(time.time_ns())
    return call('/auth/register',{'fullName':'مختبر','companyName':prefix+' '+st,'email':f'{prefix}{st}@t.sa','password':'Passw0rd!'})['token']
fails=[]
def ok(c,name):
    print(('✓ ' if c else '✗ FAIL ')+name)
    if not c: fails.append(name)
def near(a,b,e=0.011): return abs(float(a)-float(b))<e
