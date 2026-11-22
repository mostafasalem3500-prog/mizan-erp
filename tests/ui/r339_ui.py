"""3.39: payroll remittances (both editions); Egypt — annual obligations (simplified regime, solidarity contribution,
legal reserve), salary-tax report, the simplified-regime switch, and the invoice editor showing the edition's VAT rate."""
import re
from playwright.sync_api import sync_playwright
from ui_lib import *
EG = PORT == '3200'
t = demo_token('r339ui')
num = lambda s: float(re.sub(r'[^\d.\-]', '', s) or 0)
with sync_playwright() as pw:
    b = pw.chromium.launch()
    pg, errs = signed_in(b, t)
    pg.on('dialog', lambda dl: dl.accept())
    # ── remittances ──
    pg.goto(B + '/payroll/remittances')
    try: pg.wait_for_selector('table.tbl tbody tr', timeout=60000)
    except Exception: pg.reload(); pg.wait_for_selector('table.tbl tbody tr', timeout=90000)
    ok('توريد التأمينات واستقطاعات الرواتب' in pg.inner_text('.sidebar'), 'remittances are in the payroll menu')
    body = pg.inner_text('main') if pg.locator('main').count() else pg.inner_text('body')
    ok('يوم 15 من الشهر التالي' in body and 'التأمينات الاجتماعية' in body, 'screen explains the deadline and lists the insurance of each month')
    ok(('ضريبة كسب العمل' in body) == EG, 'salary tax rows only in the Egyptian edition')
    s0 = api.call('/payroll/remittances', tok=t); first = [r for r in s0['rows'] if r['items'] and r['items'][0]['outstanding'] > 0][-1]
    row = pg.locator('table.tbl tbody tr', has_text=first['period']).first
    row.locator('button', has_text='توريد').click(); pg.wait_for_selector('.modal')
    ok(f"عن شهر {first['period']}" in pg.inner_text('.modal'), 'the remit dialog names the month')
    pg.locator('.modal input').first.click(); pg.wait_for_timeout(600)
    opt = pg.locator('.modal .picker-list .picker-item, .modal [role=option], .modal .dropdown li').first
    if opt.count(): opt.click()
    else: pg.keyboard.press('ArrowDown'); pg.keyboard.press('Enter')
    pg.wait_for_timeout(300); pg.locator('.modal .btn.primary').click(); pg.wait_for_timeout(1500)
    s1 = api.call('/payroll/remittances', tok=t); it = [r for r in s1['rows'] if r['period'] == first['period']][0]['items'][0]
    ok(it['outstanding'] == 0 and len(s1['remittances']) == 1, 'remitted from the screen: the month is cleared and logged')
    ok('سجل التوريدات' in pg.inner_text('body'), 'the remittance log appears')
    # ── the invoice editor uses the edition's VAT rate ──
    pg.goto(B + '/sales/invoices?new=INVOICE'); pg.wait_for_selector('.modal table tbody tr', timeout=60000)
    ins = pg.locator('.modal table tbody tr').first.locator('input')
    ins.nth(1).fill('خدمة'); ins.nth(3).fill('1000'); pg.wait_for_timeout(400)
    txt = pg.inner_text('.modal')
    ok(('140.00' in txt and '1,140.00' in txt) if EG else ('150.00' in txt and '1,150.00' in txt), f"invoice editor previews VAT at {'14' if EG else '15'}%")
    if EG:
        pg.goto(B + '/tax/eg-compliance'); pg.wait_for_selector('table.tbl', timeout=60000)
        body = pg.inner_text('body')
        ok('النظام الضريبي المبسط' in body and 'المساهمة التكافلية' in body and 'الاحتياطي القانوني' in body, 'annual obligations: the three sections')
        ok('19,300' in body and '16,700' in body and '2.5 في الألف' in body, 'figures in force listed (insurance limits per year, solidarity rate)')
        ok('غير مفعَّل' in body, 'simplified regime shown as not enabled')
        y = api.call('/tax/solidarity', tok=t)
        if y['amount'] > 0:
            pg.locator('button', has_text='ترحيل المساهمة').click(); pg.wait_for_timeout(1500)
            ok(api.call('/tax/solidarity', tok=t)['posted'] is not None, 'solidarity contribution posted from the screen')
        pg.goto(B + '/tax/salary-tax-report'); pg.wait_for_selector('table.tbl tbody tr', timeout=60000)
        body = pg.inner_text('body')
        ok('الضريبة المستحقة' in body and 'الفرق' in body, 'salary-tax report opens on the annual settlement')
        pg.locator('select').nth(1).select_option('1') if pg.locator('select').count() > 1 else None; pg.wait_for_timeout(1200)
        ok('نموذج 4' in pg.inner_text('body'), 'quarter view carries the Form 4 note')
        pg.goto(B + '/settings'); pg.wait_for_selector('text=النظام الضريبي', timeout=60000)
        pg.locator('label.check', has_text='النظام الضريبي المبسط').locator('input').check(); pg.locator('button', has_text='حفظ').first.click(); pg.wait_for_timeout(1500)
        co = api.call('/auth/me', tok=t)['company']
        ok(co.get('egSimplified') is True and co['vatPeriod'] == 'QUARTERLY', 'simplified regime switched on in settings: quarterly VAT')
        pg.goto(B + '/tax/income-tax'); pg.wait_for_selector('text=النظام الضريبي المبسط', timeout=60000)
        ok('من حجم الأعمال' in pg.inner_text('body'), 'income-tax screen computes on turnover')
        pg.goto(B + '/payroll/settlements'); pg.wait_for_timeout(2500)
        ok('بعد الستين' in pg.inner_text('body') and 'المادة 85' not in pg.inner_text('body'), 'settlement screen states the Egyptian rule, not the Saudi articles')
    else:
        ok('الالتزامات السنوية' not in pg.inner_text('.sidebar'), 'Egyptian screens are not in the Saudi menu')
        pg.goto(B + '/settings'); pg.wait_for_timeout(2500)
        ok('النظام الضريبي المبسط' not in pg.inner_text('body'), 'no simplified-regime switch in the Saudi settings')
    ok(not errs, 'no page errors ' + str(errs[:2]))
    # English
    pe, e2 = signed_in(b, t, lang='en'); AR = re.compile('[؀-ۿ]')
    for path in ['/payroll/remittances'] + (['/tax/eg-compliance', '/tax/salary-tax-report'] if EG else []):
        pe.goto(B + path); pe.wait_for_selector('.card-h', timeout=60000); pe.wait_for_timeout(1200)
        heads = ' '.join(pe.locator('.card-h').all_inner_texts()) + ' '.join(pe.locator('thead').all_inner_texts())
        ok(not AR.search(heads), f'English: {path} headers translated ' + ''.join(AR.findall(heads))[:30])
    ok(not e2, 'English: no page errors ' + str(e2[:2]))
    b.close()
done()
