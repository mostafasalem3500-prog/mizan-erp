"""English interface: language switch, direction, translated screens, Excel export, server messages, phone layout."""
import os, re, io
from playwright.sync_api import sync_playwright
from ui_lib import *
T=demo_token('en')
with sync_playwright() as pw:
    b=pw.chromium.launch(); ctx=b.new_context(viewport={'width':1366,'height':900},accept_downloads=True); pg=ctx.new_page()
    errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto(B+'/login'); pg.wait_for_timeout(1500)
    ok(pg.evaluate("document.documentElement.dir")=='rtl','Arabic is the default (rtl)')
    btn=pg.locator('[data-lang-toggle]'); ok(btn.count()==1 and btn.inner_text().strip()=='English','login page has the English button')
    btn.click(); pg.wait_for_load_state(); pg.wait_for_timeout(1500)
    ok(pg.evaluate("[document.documentElement.dir,document.documentElement.lang].join()")=='ltr,en','English switches the page to ltr/en')
    body=pg.inner_text('body')
    ok('Sign in' in body or 'Log in' in body, 'login page is in English')
    ok(not AR.search(re.sub(r'العربية','',body)),'no Arabic left on the login page')
    pg.evaluate("t=>localStorage.setItem('mz_token',t)",T)
    pg.goto(B+'/'); pg.wait_for_timeout(2500)
    side=pg.inner_text('.sidebar nav') if pg.locator('.sidebar nav').count() else pg.inner_text('.sidebar')
    ok('Dashboard' in side and 'Final accounts' in side,'side menu in English')
    ok(not AR.search(side),'no Arabic in the side menu labels')
    for path,txt in [('/expenses?new=1','Record expense'),('/learn','Learning centre'),('/final-accounts','Final accounts and financial statements'),('/notes','Notes'),('/quick','Record'),('/account','Two-step verification')]:
        pg.goto(B+path); pg.wait_for_timeout(1500)
        ok(txt in pg.inner_text('body'),f'{path} shows “{txt}”')
    # lesson text keeps its bold parts after translation
    pg.goto(B+'/learn'); pg.wait_for_timeout(1200); pg.get_by_text('A quick tour of the program').first.click(); pg.wait_for_timeout(600)
    ok(pg.locator('.learn-item.open b, .learn-steps b').count()>0 or 'Search the menu' in pg.inner_text('body'),'lesson steps translated with their bold parts')
    # server message comes back in English
    pg.goto(B+'/account'); pg.wait_for_timeout(1500)
    pw_inputs=pg.locator('input[type=password]')
    if pw_inputs.count()>=3:
        pw_inputs.nth(0).fill('Wrong-pass-1'); pw_inputs.nth(1).fill('NewPass-2026x'); pw_inputs.nth(2).fill('NewPass-2026x')
        pg.locator('button', has_text='Change password').first.click(); pg.wait_for_timeout(1500)
        t=pg.inner_text('body'); ok('The current password is incorrect' in t,'server error shown in English')
    else: ok(False,'password form found')
    # Excel export reads left to right with English headers
    pg.goto(B+'/reports/trial-balance'); pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(800)
    try:
        with pg.expect_download(timeout=30000) as dl: pg.click('button:has-text("Excel")')
        f='/tmp/mizan_en_tb.xlsx'; dl.value.save_as(f); print('file:',dl.value.suggested_filename); import openpyxl; wb=openpyxl.load_workbook(f); ws=wb.active
        heads=[c.value for c in ws[5] if c.value]
        ok(heads and not any(AR.search(str(h)) for h in heads),'Excel headers in English: '+', '.join(map(str,heads[:4])))
        ok(ws.sheet_view.rightToLeft in (False,None),'Excel sheet reads left to right')
        ok(not AR.search(str(ws['A2'].value or '')),'Excel title in English: '+str(ws['A2'].value))
    except Exception as e: ok(False,'Excel export: '+str(e)[:120])
    # month names on the dashboard chart
    pg.goto(B+'/'); pg.wait_for_timeout(2000)
    lbl=' '.join(pg.locator('.bar-chart .lbl').all_inner_texts())
    ok(lbl and not AR.search(lbl),'chart month names in English: '+lbl[:40])
    # back to Arabic
    pg.locator('[data-lang-toggle]').first.click(); pg.wait_for_load_state(); pg.wait_for_timeout(2000)
    ok(pg.evaluate("document.documentElement.dir")=='rtl','العربية switches back to rtl')
    ok('لوحة' in pg.inner_text('.sidebar'),'side menu back in Arabic')
    # phone layout in English: menu hidden until the burger opens it
    m=b.new_context(viewport={'width':390,'height':844}); mp=m.new_page()
    mp.goto(B+'/login?lang=en'); mp.evaluate("t=>localStorage.setItem('mz_token',t)",T); mp.goto(B+'/'); mp.wait_for_timeout(2000)
    x=mp.evaluate("document.querySelector('.sidebar').getBoundingClientRect().right")
    ok(x<=1,'phone: side menu off-screen to the left (right edge %s)'%x)
    mp.locator('.burger').first.click(); mp.wait_for_timeout(500)
    x=mp.evaluate("document.querySelector('.sidebar').getBoundingClientRect().left")
    ok(abs(x)<2,'phone: burger opens the menu from the left')
    ok(mp.evaluate("document.documentElement.scrollWidth<=document.documentElement.clientWidth+2"),'phone: no sideways scrolling')
    ok(not errs,'no page errors '+str(errs[:2]))
    b.close()
done()
