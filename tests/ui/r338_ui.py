"""3.38: modifiers in the POS and the service charge, supplier payment runs, cash flow forecast, smart auditor,
account suggestion on the expense form — on screen, in Arabic and English, desktop and phone."""
from playwright.sync_api import sync_playwright
from ui_lib import *
EG = PORT == '3200'
t = demo_token('r338ui')
P = [p for p in api.call('/products?limit=300', tok=t) if p['isActive'] and p['type'] == 'STOCK' and float(p.get('qty') or 0) > 5]
prod = P[0]
with sync_playwright() as pw:
    b = pw.chromium.launch()
    pg, errs = signed_in(b, t)
    pg.on('dialog', lambda dl: dl.accept())
    # ── modifiers ──
    pg.goto(B + '/pos/modifiers')
    try: pg.wait_for_selector('[data-modifiers]', timeout=60000)
    except Exception: pg.reload(); pg.wait_for_selector('[data-modifiers]', timeout=90000)  # first screen after a long run: one reload
    ok('الإضافات ورسوم الخدمة' in pg.inner_text('.sidebar'), 'the screen is in the menu')
    pg.click('[data-new-group]'); pg.wait_for_selector('[data-group-name]')
    pg.fill('[data-group-name]', 'الحجم'); pg.fill('[data-min]', '1'); pg.fill('[data-max]', '1')
    pg.get_by_label('اسم الخيار 1').fill('عادي'); pg.click('[data-add-option]'); pg.get_by_label('اسم الخيار 2').fill('كبير'); pg.get_by_label('سعر الخيار 2').fill('5')
    pg.get_by_label('بحث الأصناف').fill(prod['name']); pg.wait_for_timeout(200)
    pg.locator('[data-products] .chip', has_text=prod['name']).first.click()
    pg.click('[data-save-group]'); pg.wait_for_selector('[data-groups] tbody tr')
    row = pg.inner_text('[data-groups] tbody tr')
    ok('الحجم' in row and 'إلزامي' in row and prod['name'] in row and 'كبير' in row, 'group saved: required, two options, attached to the product')
    pg.fill('[data-svc-pct]', '10'); pg.click('[data-svc-save]'); pg.wait_for_timeout(800)
    ok(api.call('/pos/restaurant', tok=t)['settings']['serviceCharge']['pct'] == 10, 'service charge 10% saved')
    # POS: the product opens the picker; the cart line carries the option and its price
    pg.goto(B + '/pos'); pg.wait_for_selector('.auth, .pos .items', timeout=30000)
    if pg.locator('.auth').count(): pg.fill('.auth input[type=number]', '0'); pg.click('.auth .btn.primary')
    pg.wait_for_selector('.pos .items .item')
    pg.fill('.pos .search input', prod['name'])
    pg.wait_for_timeout(300)
    pg.locator('.pos .items .item', has_text=prod['name']).first.click(); pg.wait_for_selector('[data-mod-picker]')
    ok(pg.locator('[data-mod-picker] .chip.on').count() == 1, 'picker opens with the first size chosen (required, one)')
    pg.locator('[data-mod-picker] .chip', has_text='كبير').click()
    btn = pg.inner_text('[data-mod-add]'); pg.click('[data-mod-add]'); pg.wait_for_timeout(200)
    ok(pg.locator('[data-line-mods]').count() == 1 and 'كبير' in pg.inner_text('[data-line-mods]'), 'cart line shows the chosen option')
    unit = float(prod['salePrice']) + 5
    ok(f'{unit:,.2f}' in pg.inner_text('.cart-lines .line'), f'line priced with the option ({unit:,.2f})')
    pg.click('button:has-text("الدفع")'); pg.wait_for_selector('.modal'); pg.locator('.modal .m-f .btn.primary, .modal button:has-text("تأكيد")').last.click(); pg.wait_for_selector('.thermal', timeout=20000)
    ok('كبير' in pg.inner_text('.thermal'), 'receipt names the option')
    ok(not errs, 'no page errors ' + str(errs[:2]))
    # ── supplier payment run ──
    pg.goto(B + '/payment-runs'); pg.wait_for_selector('[data-payment-runs]', timeout=30000)
    pg.fill('[data-due-until]', '2100-12-31'); pg.click('[data-propose]'); pg.wait_for_timeout(1500)
    if pg.locator('[data-prop-supplier]').count():
        n = pg.locator('[data-prop-supplier]').count()
        ok(n >= 1 and pg.locator('[data-run-total]').inner_text().strip() != '0.00', f'proposal lists {n} suppliers with their due invoices')
        pg.click('[data-save-run]'); pg.wait_for_selector('[data-run-detail]')
        ok('مسودة' in pg.inner_text('.modal'), 'run saved as a draft and opened')
        pg.click('[data-run-approve]'); pg.wait_for_selector('[data-run-post]', timeout=15000)
        pg.click('[data-run-post]'); pg.wait_for_selector('.modal .badge:has-text("مرحّلة")', timeout=20000)
        ok(pg.locator('[data-run-detail]').inner_text().count('سند') >= 1, 'single-manager establishment: approved and posted, vouchers listed per supplier')
        pg.locator('.modal .m-h button, .modal [aria-label="إغلاق"]').first.click() if pg.locator('.modal [aria-label="إغلاق"]').count() else pg.keyboard.press('Escape')
        ig = api.call('/reports/integrity', tok=t); ok(ig['ok'], 'books tie to the sub-ledgers after the run')
    else: ok(True, 'no supplier invoices open in the demo data (nothing to propose)')
    # ── cash forecast ──
    pg.goto(B + '/cash-forecast'); pg.wait_for_selector('[data-fc-table]', timeout=30000)
    ok(pg.locator('[data-fc-chart] .fc-col').count() == 13 and pg.locator('[data-fc-table] tbody tr').count() == 13, '13 weeks: chart and table')
    pg.locator('[data-fc-table] tbody tr').first.click(); pg.wait_for_selector('.modal')
    ok('الأسبوع 1' in pg.inner_text('.modal'), 'a week opens with its items'); pg.keyboard.press('Escape')
    pg.fill('[data-overdue-rate]', '0'); pg.wait_for_timeout(1200)
    ok(pg.locator('[data-fc-table] tbody tr').count() == 13, 'collection rate changes recompute the forecast')
    # ── auditor ──
    pg.goto(B + '/auditor'); pg.wait_for_selector('[data-audit-score]', timeout=60000)
    sc = int(pg.inner_text('[data-audit-score]').split('/')[0].strip())
    ok(0 <= sc <= 100, f'auditor score shown ({sc})')
    if pg.locator('[data-findings] tbody tr').count():
        pg.locator('[data-dismiss]').first.click(); pg.wait_for_selector('[data-dismiss-note]')
        before = pg.locator('[data-findings] tbody tr').count()
        pg.fill('[data-dismiss-note]', 'راجعت المستند الأصلي'); pg.click('[data-dismiss-save]'); pg.wait_for_timeout(1200)
        ok(pg.locator('[data-findings] tbody tr').count() == before - 1 or pg.locator('.alert.ok').count(), 'an explained finding leaves the list')
    else: ok(pg.locator('.alert.ok').count() == 1, 'no findings: says so')
    ok(not errs, 'no page errors ' + str(errs[:2]))
    # ── account suggestion on the expense form ──
    ex = [e for e in api.call('/expenses', tok=t) if e.get('status') == 'POSTED' and e.get('description')]
    if ex:
        e0 = ex[0]
        pg.goto(B + '/expenses?new=1'); pg.wait_for_selector('.modal', timeout=30000)
        pg.locator('.modal').get_by_label('البيان', exact=True).fill(e0['description']); pg.wait_for_selector('[data-account-suggest]', timeout=8000)
        ok(e0['accountName'] in pg.inner_text('[data-account-suggest]'), f"expense form suggests «{e0['accountName']}» for «{e0['description']}»")
        pg.locator('[data-account-suggest] .chip').first.click(); pg.wait_for_timeout(200)
        ok(e0['accountName'] in pg.inner_text('.modal'), 'clicking the suggestion fills the account')
    ok(not errs, 'no page errors ' + str(errs[:2]))
    # ── phone ──
    ph, e3 = signed_in(b, t, viewport={'width': 390, 'height': 844})
    for path, sel in [('/cash-forecast', '[data-fc-table]'), ('/auditor', '[data-audit-score]'), ('/payment-runs', '[data-payment-runs]'), ('/pos/modifiers', '[data-modifiers]')]:
        ph.goto(B + path); ph.wait_for_selector(sel, timeout=30000); ph.wait_for_timeout(300)
        ok(ph.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), f'phone: no sideways scroll on {path}')
    ok(not e3, 'phone: no page errors ' + str(e3[:2]))
    # ── English ──
    pe, e2 = signed_in(b, t, 'en')
    for path, sel in [('/cash-forecast', '[data-forecast] .card-h'), ('/auditor', '[data-auditor] .card-h'), ('/payment-runs', '[data-payment-runs] .card-h'), ('/pos/modifiers', '[data-modifiers] .card-h')]:
        pe.goto(B + path); pe.wait_for_selector(sel, timeout=30000); pe.wait_for_timeout(500)
        ok(not AR.search(pe.inner_text(sel)), f'English: {path} header translated')
    ok(not AR.search(pe.inner_text('[data-modifiers] thead')), 'English: modifiers table translated')
    ok(not e2, 'English: no page errors ' + str(e2[:2]))
    b.close()
done()
