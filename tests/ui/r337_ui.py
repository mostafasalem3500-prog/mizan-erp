"""3.37: leases (right-of-use) on screen, signed-in devices on «my account», the 12-month trend in the written report."""
import datetime
from playwright.sync_api import sync_playwright
from ui_lib import *
EG = PORT == '3200'
t = demo_token('r337ui')
d = datetime.date.today()
y, m = d.year, d.month - 3
if m <= 0: m += 12; y -= 1
start = f'{y}-{m:02d}-01'
with sync_playwright() as pw:
    b = pw.chromium.launch()
    pg, errs = signed_in(b, t)
    pg.goto(B + '/leases'); pg.wait_for_selector('[data-leases]', timeout=60000)
    ok('عقود الإيجار (حق الاستخدام)' in pg.inner_text('.sidebar'), 'the screen is in the menu under general accounting')
    if not EG:
        ok(pg.locator('[data-framework="IFRS_SMES"]').count() == 1 and pg.locator('[data-new-lease]').is_disabled(), 'Saudi establishment on IFRS for SMEs: Section 20 explained, new lease disabled')
        pg.once('dialog', lambda dl: dl.accept()); pg.click('[data-set-ifrs]'); pg.wait_for_selector('[data-framework="IFRS"]')
        ok(pg.locator('[data-new-lease]').is_enabled(), 'after switching to full IFRS a lease can be recorded')
    pg.click('[data-new-lease]'); pg.wait_for_selector('.modal')
    pg.get_by_label('وصف العقد').fill('إيجار المعرض — 3 سنوات')
    pg.get_by_label('تاريخ بداية العقد').fill(start)
    pg.get_by_label('مدة العقد بالأشهر').fill('36')
    pg.get_by_label('قيمة الدفعة (قبل الضريبة)').fill('5000')
    pg.get_by_label('معدل الخصم السنوي %').fill('5')
    pg.click('[data-lease-preview]'); pg.wait_for_selector('[data-lease-measure]')
    mtxt = pg.inner_text('[data-lease-measure]')
    ok('167,787.17' in mtxt and '180,000.00' in mtxt, 'measurement preview: present value 167,787.17 of 180,000 of payments')
    pg.click('[data-lease-save]'); pg.wait_for_selector('[data-lease-list]')
    ok(pg.locator('[data-lease-list] tbody tr').count() == 1, 'the lease is listed')
    pg.locator('[data-lease-list] tbody tr').first.click(); pg.wait_for_selector('[data-lease-schedule]')
    ok(pg.locator('[data-lease-schedule] tbody tr').count() == 36 and pg.locator('[data-lease-payments] tbody tr').count() == 36, 'schedule: 36 months and 36 payments')
    pg.click('[data-lease-run]'); pg.wait_for_timeout(1500)
    ok(pg.locator('[data-lease-schedule] tbody a').count() == 3, 'three ended months posted, each linked to its entry')
    pg.click('[data-lease-pay]'); pg.wait_for_selector('[data-lease-payform]')
    ok(pg.locator('[data-lease-paysave]').is_disabled(), 'no payment account yet: the save button waits for one')
    pg.fill('[data-lease-payform] input[placeholder="الصندوق أو البنك"]', '1102'); pg.wait_for_selector('[data-lease-payform] .suggest div:not(.muted)'); pg.locator('[data-lease-payform] .suggest div').first.dispatch_event('mousedown')
    pg.click('[data-lease-payform] button:has-text("%")'); pg.wait_for_timeout(200)
    pg.click('[data-lease-paysave]'); pg.wait_for_timeout(1500)
    ok(pg.locator('[data-lease-payments] tbody a').count() == 1, 'first payment recorded with its VAT')
    ok(not errs, 'no page errors ' + str(errs[:2]))
    # ── signed-in devices ──
    pg.goto(B + '/account'); pg.wait_for_selector('[data-sessions]', timeout=30000)
    ok(pg.locator('[data-session="current"]').count() == 1, 'my account lists the signed-in devices and marks this one')
    # ── trend in the written report ──
    pg.goto(B + '/financial-report'); pg.wait_for_selector('[data-fin-report]', timeout=60000)
    ok(pg.locator('[data-section="trend"] svg rect').count() == 12, 'written report: 12-month trend chart')
    ok(not errs, 'no page errors ' + str(errs[:2]))
    # ── English ──
    pe, e2 = signed_in(b, t, 'en')
    pe.goto(B + '/leases'); pe.wait_for_selector('[data-leases]', timeout=60000)
    ok(not AR.search(pe.inner_text('[data-leases] .card-h')) and not AR.search(pe.inner_text('[data-lease-list] thead')), 'English: leases screen translated')
    pe.goto(B + '/account'); pe.wait_for_selector('[data-sessions]')
    ok(not AR.search(pe.inner_text('[data-sessions] thead')), 'English: devices table translated')
    ok(not e2, 'English: no page errors ' + str(e2[:2]))
    b.close()
done()
