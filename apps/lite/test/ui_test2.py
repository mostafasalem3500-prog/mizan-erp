"""ميزان لايت 1.1 من الشاشات: المستخدمون والقفل بالرمز، صلاحيات الكاشير، الورديات وعجز الصندوق وتقرير الإغلاق،
مرتجع المشتريات، وقارئ الباركود بالكاميرا (كاميرا وهمية تعرض باركود EAN-13 لصنف تجريبي)."""
import os
from playwright.sync_api import sync_playwright
HERE=os.path.dirname(os.path.abspath(__file__)); URL='file://'+os.path.join(HERE,'..','dist','index.html')
os.makedirs(os.path.join(HERE,'shots'),exist_ok=True)
errs=[];n=0
def ok(c,m):
    global n;n+=1;print(('✓ ' if c else '✗ FAIL ')+m)
    if not c: errs.append(m)
# باركود EAN-13 لصنف «ماء 330 مل» في البيانات التجريبية (628100000000 + 2 ثم رقم الفحص)
L=['3211','2221','2122','1411','1132','1231','1114','1312','1213','3112'];PAR=['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL']
def check(c12):
    s=sum(int(c12[-1-i])*(3 if i%2==0 else 1) for i in range(12)); return c12+str((10-s%10)%10)
def bits(code):
    def wb(ws,dark):
        o=[]
        for w in ws:
            o+= [1 if dark else 0]*w; dark=not dark
        return o
    f=int(code[0]);b=[1,0,1]
    for i in range(1,7):
        w=[int(x) for x in L[int(code[i])]]
        if PAR[f][i-1]=='G': w=w[::-1]
        b+=wb(w,False)
    b+=[0,1,0,1,0]
    for i in range(7,13): b+=wb([int(x) for x in L[int(code[i])]],True)
    return b+[1,0,1]
CODE=check('628100000002'); B=bits(CODE)
W,H,MOD=640,480,4; x0=(W-len(B)*MOD)//2
row=bytes([30 if (0<=(x-x0)//MOD<len(B) and B[(x-x0)//MOD]) else 225 for x in range(W)])
Y=b''.join(row if 140<=y<340 else bytes([225])*W for y in range(H)); UV=bytes([128])*(W*H//4)
y4m=os.path.join(HERE,'shots','barcode.y4m')
with open(y4m,'wb') as f:
    f.write(f'YUV4MPEG2 W{W} H{H} F10:1 Ip A1:1 C420jpeg\n'.encode())
    for _ in range(6): f.write(b'FRAME\n'+Y+UV+UV)
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-video-capture='+y4m])
    for mode,(w,h) in {'phone':(390,800),'desktop':(1366,860)}.items():
        ctx=b.new_context(viewport={'width':w,'height':h},locale='ar-SA');ctx.grant_permissions(['camera']);pg=ctx.new_page()
        pg.on('pageerror',lambda e,mode=mode: errs.append(mode+' pageerror: '+str(e)))
        pg.on('console',lambda m,mode=mode: errs.append(mode+' console: '+m.text) if m.type=='error' else None)
        pg.goto(URL);pg.wait_for_selector('.wiz');pg.click(f'[data-act=pick-mode][data-m={mode}]');pg.click('[data-act=setup-demo]');pg.wait_for_selector('.kpi')
        go=lambda name: pg.evaluate(f'document.querySelector("[data-act=go][data-to={name}]")&&document.querySelector("[data-act=go][data-to={name}]").click()')
        def pick_nav(name): pg.evaluate(f'(()=>{{const a=[...document.querySelectorAll("[data-nav={name}]")].find(x=>x.offsetParent);a&&a.click()}})()')
        # ═══ الكاميرا في نقطة البيع ═══
        pick_nav('pos');pg.wait_for_selector('[data-scan-pos]');pg.click('[data-scan-pos]');pg.wait_for_selector('#scanner')
        pg.wait_for_function('document.querySelector("#scan-got")&&document.querySelector("#scan-got").textContent.includes("ماء")',timeout=20000)
        ok('ماء 330 مل' in pg.inner_text('#scan-got'),mode+': الكاميرا قرأت '+CODE+' وأضافت «ماء 330 مل» للسلة')
        pg.screenshot(path=os.path.join(HERE,'shots',f'{mode}-11-scan.png'))
        pg.click('#scanner .btn[data-act=scan-stop]');ok(pg.query_selector('#scanner') is None and pg.evaluate('Mizan.state.products.find(p=>p.barcode==="'+CODE+'").name')=='ماء 330 مل','إغلاق القارئ يوقف الكاميرا')
        ok(pg.evaluate('document.querySelectorAll("#pos-cart .cl").length')>=1,mode+': الصنف في السلة')
        # ═══ المستخدمون والقفل ═══
        go('settings') if mode=='desktop' else (pick_nav('more'),go('settings'))
        pg.click('[data-act=set-t][data-v=users]');pg.click('[data-act=user-edit][data-first]')
        pg.fill('[name=name]','المالك');pg.fill('[name=pin]','9999');pg.fill('[name=pin2]','9999');pg.click('[data-act=user-save]')
        pg.wait_for_selector('[data-users]');pg.click('[data-act=user-edit]:not([data-id])')
        pg.fill('[name=name]','سالم');pg.select_option('[name=role]','cashier');pg.fill('[name=pin]','1234');pg.fill('[name=pin2]','1234');pg.click('[data-act=user-save]')
        ok(pg.evaluate('Mizan.state.users.length')==2 and pg.evaluate('JSON.stringify(Mizan.state.users).indexOf("1234")')<0,mode+': مالك وكاشير، والرمز غير محفوظ نصاً')
        pg.check('#set-shift [name=requireShift]');pg.click('[data-act=shift-set-save]');ok(pg.evaluate('Mizan.state.settings.requireShift'),'البيع يتطلب وردية')
        pg.click('[data-lock]');pg.wait_for_selector('.lock');pg.screenshot(path=os.path.join(HERE,'shots',f'{mode}-12-lock.png'))
        for k in '0000': pg.click(f'[data-act=pin-key][data-k="{k}"]')
        pg.click('[data-act=pin-key][data-k=OK]');ok(pg.query_selector('.lock') is not None,mode+': رمز خاطئ يبقى مقفلاً')
        for k in '1234': pg.click(f'[data-act=pin-key][data-k="{k}"]')
        pg.wait_for_selector('#top [data-lock]');ok(pg.evaluate('Mizan.user.name')=='سالم',mode+': دخل الكاشير برمزه')
        vis=pg.evaluate('[...document.querySelectorAll("#nav [data-nav]")].filter(a=>a.style.display!=="none").map(a=>a.dataset.nav)')
        ok('accounting' not in vis and 'reports' not in vis and 'settings' not in vis and 'pos' in vis and 'shifts' in vis,mode+': قائمة الكاشير '+str(vis))
        pg.evaluate('document.dispatchEvent(new Event("x"))');pg.evaluate('(()=>{const a=document.createElement("a");a.setAttribute("data-act","go");a.setAttribute("data-to","accounting");document.body.appendChild(a);a.click();a.remove()})()')
        ok('المحاسبة' not in pg.inner_text('#top h1'),mode+': لا يصل الكاشير للمحاسبة ولو برابط مباشر')
        # ═══ الوردية ═══
        pick_nav('pos');pg.wait_for_selector('.tile');pg.click('.tile[data-act=pos-add]')
        if mode=='phone': pg.click('#cartbar')
        ok('لا توجد وردية مفتوحة' in pg.inner_text('#pos-cart'),'تنبيه فتح الوردية في السلة')
        pg.click('#pos-cart [data-act=shift-open]');pg.fill('[name=float]','100');pg.click('[data-act=shift-open-ok]')
        if mode in('phone',): pg.click('#cartbar')
        pg.click('[data-act=pos-pay]');pg.wait_for_selector('.paym');pg.click('[data-act=pay-ok]')
        if pg.query_selector('[data-act=confirm-yes]'): pg.click('[data-act=confirm-yes]')
        pg.wait_for_selector('#doc-pv .paper');pg.click('#modal [data-act=close]')
        last=pg.evaluate('Mizan.state.docs[Mizan.state.docs.length-1]');ok(last['by']=='سالم' and last['shift']==pg.evaluate('Mizan.openShift().id'),mode+': الفاتورة باسم الكاشير وفي ورديته')
        exp=pg.evaluate('Mizan.shiftSummary().expected')
        pick_nav('shifts') if mode=='desktop' else go('shifts')
        if mode=='phone': pg.evaluate('document.querySelector("[data-act=go][data-to=shifts]")&&document.querySelector("[data-act=go][data-to=shifts]").click()')
        pg.wait_for_selector('[data-shift-open]');ok(f"{exp/100:,.2f}" in pg.inner_text('[data-shift-expected]'),mode+': المتوقع في الدرج '+str(exp/100))
        pg.click('[data-act=shift-close]');pg.fill('[name=counted]',f"{(exp-500)/100:.2f}");pg.wait_for_timeout(100);ok('عجز 5.00' in pg.inner_text('#shift-diff'),'يظهر العجز قبل الإغلاق')
        pg.click('[data-act=shift-close-ok]');pg.wait_for_selector('#modal .paper')
        ok('تقرير إغلاق الوردية' in pg.inner_text('#modal .paper') and 'العجز' in pg.inner_text('#modal .paper'),mode+': تقرير الإغلاق (Z) بالعجز')
        pg.screenshot(path=os.path.join(HERE,'shots',f'{mode}-13-zreport.png'))
        ok(pg.evaluate('Mizan.state.journals.some(j=>j.src&&j.src.t==="shift"&&j.lines.some(l=>l.a==="5210"&&l.dr===500))'),mode+': قيد العجز على «عجز وزيادة الصندوق»')
        pg.click('#modal [data-act=close]')
        # ═══ المالك: مرتجع المشتريات ═══
        pg.click('[data-lock]');pg.wait_for_selector('.lock')
        for k in '9999': pg.click(f'[data-act=pin-key][data-k="{k}"]')
        pg.wait_for_selector('#top [data-lock]');ok(pg.evaluate('Mizan.user.role')=='owner',mode+': دخل المالك')
        pick_nav('docs');pg.click('[data-act=docs-t][data-v=pur]');pg.click('#docs-list [data-act=open-doc]');pg.wait_for_selector('[data-act=doc-pret]')
        pg.click('[data-act=doc-pret]');pg.fill('#modal [name=q0]','1');nd=pg.evaluate('Mizan.state.docs.length');pg.click('[data-act=pret-ok]');pg.wait_for_selector('#doc-pv .paper')
        ok(pg.evaluate('Mizan.state.docs.length')==nd+1 and pg.evaluate('Mizan.state.docs[Mizan.state.docs.length-1].t')=='pret' and 'إشعار مدين' in pg.inner_text('#doc-pv'),mode+': مرتجع المشتريات بإشعار مدين')
        pg.click('#modal [data-act=close]')
        # ═══ الكاميرا في نموذج الصنف ═══
        pick_nav('products') if mode=='desktop' else pick_nav('products');pg.click('#top [data-act=edit-product]');pg.click('[data-scan-prod]')
        pg.wait_for_function('document.querySelector("#modal [name=barcode]").value.length===13',timeout=20000)
        ok(pg.input_value('#modal [name=barcode]')==CODE and pg.query_selector('#scanner') is None,mode+': الكاميرا ملأت خانة الباركود في نموذج الصنف')
        pg.click('#modal [data-act=close]')
        ok(pg.evaluate('Mizan.integrity().every(x=>x.ok)'),mode+': فحص الدفاتر سليم '+str(pg.evaluate('Mizan.integrity().filter(x=>!x.ok).map(x=>x.name)')))
        # يبقى المستخدمون والقفل بعد إعادة الفتح
        pg.wait_for_timeout(400);pg.reload();pg.wait_for_selector('.lock');ok(True,mode+': بعد إعادة الفتح يُطلب الرمز')
        ctx.close()
    b.close()
print('checks',n,'| problems',len(errs));[print(' ',e) for e in errs[:20]]
