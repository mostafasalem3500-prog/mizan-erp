import sys,json
from playwright.sync_api import sync_playwright
URL='file:///home/claude/mizan-lite/dist/index.html'
errs=[];n=0
def ok(c,m):
    global n;n+=1
    if not c: errs.append('FAIL: '+m)
with sync_playwright() as p:
    b=p.chromium.launch()
    for mode,(w,h) in {'phone':(390,800),'handheld':(360,640),'tablet':(1024,700),'desktop':(1440,860)}.items():
        ctx=b.new_context(viewport={'width':w,'height':h},locale='ar-SA');pg=ctx.new_page()
        pg.on('console',lambda m,mode=mode: errs.append(mode+' console: '+m.text) if m.type=='error' else None)
        pg.on('pageerror',lambda e,mode=mode: errs.append(mode+' pageerror: '+str(e)))
        pg.goto(URL);pg.wait_for_selector('.wiz')
        pg.screenshot(path=f'shots/{mode}-0-setup.png')
        pg.click(f'[data-act=pick-mode][data-m={mode}]')
        pg.click('[data-act=setup-demo]');pg.wait_for_selector('.kpi')
        ok(('m-'+mode) in pg.evaluate('document.documentElement.className'),mode+' class')
        def noflow(tag):
            o=pg.evaluate('(()=>{const v=document.querySelector("#app");return v.scrollWidth-v.clientWidth})()')
            ok(o<=1,f'{mode} overflow {tag}: {o}')
        pg.screenshot(path=f'shots/{mode}-1-home.png');noflow('home')
        # البيع
        pg.evaluate('document.querySelector("[data-nav=pos]").click()');pg.wait_for_selector('.tile')
        tiles=pg.query_selector_all('.tile[data-act=pos-add]');tiles[0].click();tiles[0].click();tiles[3].click();tiles[6].click()
        pg.screenshot(path=f'shots/{mode}-2-pos.png');noflow('pos')
        if mode in('phone','handheld'):
            pg.click('#cartbar');pg.screenshot(path=f'shots/{mode}-3-cart.png')
        before=pg.evaluate('Mizan.state.docs.length')
        pg.click('[data-act=pos-pay]');pg.wait_for_selector('.paym');pg.click('.quick button:nth-child(2)')
        pg.screenshot(path=f'shots/{mode}-4-pay.png')
        pg.click('[data-act=pay-ok]')
        if pg.query_selector('[data-act=confirm-yes]'): pg.click('[data-act=confirm-yes]')
        pg.wait_for_selector('#doc-pv .paper')
        ok(pg.evaluate('Mizan.state.docs.length')==before+1,mode+' sale posted')
        ok(pg.query_selector('#doc-pv .qr svg') is not None,mode+' qr')
        pg.screenshot(path=f'shots/{mode}-5-receipt.png')
        pg.click('[data-act=doc-tpl][data-t=a4classic]');pg.screenshot(path=f'shots/{mode}-6-a4.png')
        # مرتجع
        pg.click('[data-act=doc-return]');pg.click('[data-act=ret-all]');pg.click('[data-act=ret-ok]');pg.wait_for_selector('#doc-pv .paper')
        ok(pg.evaluate('Mizan.state.docs[Mizan.state.docs.length-1].t')=='sret',mode+' return')
        pg.click('[data-act=close]')
        # بقية الشاشات
        for name in ['docs','products','parties','money','accounting','reports','settings','guide','more']:
            pg.evaluate(f'document.querySelector("[data-act=go][data-to={name}]") ? document.querySelector("[data-act=go][data-to={name}]").click() : null')
            pg.wait_for_timeout(120);noflow(name)
            if mode in('phone','desktop'): pg.screenshot(path=f'shots/{mode}-p-{name}.png')
        pg.evaluate('document.querySelector("[data-act=go][data-to=reports]").click()')
        for t in ['sales','income','balance','trial','vat','stock','check']:
            pg.click(f'[data-act=rep-t][data-v={t}]');noflow('rep-'+t)
            if mode=='phone' and t in('income','vat','check'): pg.screenshot(path=f'shots/{mode}-r-{t}.png')
        ok(pg.evaluate('Mizan.integrity().every(x=>x.ok)'),mode+' integrity')
        pg.evaluate('document.querySelector("[data-act=go][data-to=settings]").click()')
        for t in ['dev','tpl','data','upd']:
            pg.click(f'[data-act=set-t][data-v={t}]');noflow('set-'+t)
            if mode in('phone','tablet'): pg.screenshot(path=f'shots/{mode}-s-{t}.png')
        # نوافذ الإدخال: صنف، مصروف، سند، شراء، قيد
        pg.evaluate('document.querySelector("[data-act=go][data-to=products]").click()');pg.click('#top [data-act=edit-product]')
        pg.fill('[name=name]','صنف اختبار');pg.fill('[name=price]','11.50');pg.fill('[name=cost]','7');pg.fill('[name=stock]','4');
        if mode=='phone': pg.screenshot(path='shots/phone-m-product.png')
        pg.click('[data-act=save-product]')
        ok(pg.evaluate('Mizan.state.products.some(p=>p.name=="صنف اختبار"&&p.stock==4)'),mode+' product')
        pg.evaluate('document.querySelector("[data-act=go][data-to=money]").click()');pg.click('[data-act=new-expense]');pg.fill('[name=amount]','115');pg.check('[name=hasVat]');pg.click('[data-act=exp-ok]')
        pg.click('[data-act=new-voucher][data-k=in]');pg.fill('[name=amount]','1000');pg.click('[data-act=vch-ok]')
        pg.evaluate('document.querySelector("[data-act=go][data-to=docs]").click()');pg.click('[data-act=new-purchase]')
        pg.select_option('[data-in=pur-l][data-k=pid]',index=3);pg.fill('[data-in=pur-l][data-k=qty]','5')
        if mode=='tablet': pg.screenshot(path='shots/tablet-m-purchase.png')
        nd=pg.evaluate('Mizan.state.docs.length');pg.click('[data-act=pur-ok]');ok(pg.evaluate('Mizan.state.docs.length')==nd+1,mode+' purchase')
        ok(pg.evaluate('Mizan.integrity().every(x=>x.ok)'),mode+' integrity2')
        # الحفظ يبقى بعد إعادة التحميل
        cnt=pg.evaluate('Mizan.state.journals.length');pg.wait_for_timeout(500);pg.reload();pg.wait_for_selector('.kpi')
        ok(pg.evaluate('Mizan.state.journals.length')==cnt,mode+' persistence '+pg.evaluate('Mizan.storage()'))
        # طباعة: وسائط الطباعة تُظهر المستند فقط
        pg.evaluate('document.querySelector("[data-act=go][data-to=docs]").click()');pg.click('[data-act=open-doc]');pg.evaluate('window.print=function(){window.__p=1}');pg.click('[data-act=doc-print]');pg.wait_for_timeout(150)
        pg.emulate_media(media='print');ok(pg.evaluate('getComputedStyle(document.querySelector("#stage")).display')=='none' and pg.evaluate('document.querySelector("#print-root .paper")!==null') and pg.evaluate('window.__p')==1,mode+' print')
        if mode=='desktop': pg.pdf(path='shots/receipt.pdf',prefer_css_page_size=True)
        pg.emulate_media(media='screen');ctx.close()
    b.close()
print('checks',n,'| problems',len(errs));[print(' ',e) for e in errs[:30]]
