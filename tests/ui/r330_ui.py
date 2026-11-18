"""3.30: amortisation schedules on screen, the Hijri date on printed documents, the status page, error reports."""
import datetime
from playwright.sync_api import sync_playwright
from ui_lib import *
t = demo_token('r330ui')
first = datetime.date.today().replace(day=1)
y, m = first.year, first.month - 3
if m <= 0: m += 12; y -= 1
start = f'{y}-{m:02d}-01'
with sync_playwright() as pw:
    b = pw.chromium.launch()
    pg, errs = signed_in(b, t)
    # ── a prepaid expense from the screen ──
    pg.goto(B + '/amortizations'); pg.wait_for_selector('[data-amort]')
    ok('المدفوع مقدماً' in pg.inner_text('.sidebar') or 'المدفوع مقدماً' in pg.inner_text('body'), 'the screen is in the menu under general accounting')
    pg.click('text=＋ جدول جديد'); pg.wait_for_selector('.modal')
    pg.get_by_label('الوصف').fill('تأمين المعرض لستة أشهر')
    pg.get_by_label('المبلغ قبل الضريبة').fill('6000')
    pg.get_by_label('عدد الأشهر').fill('6')
    pg.get_by_label('أول شهر').fill(start)
    pg.fill('.modal input[placeholder="اختر الحساب"]', 'إيجار'); pg.wait_for_selector('.modal .suggest div:not(.muted)'); pg.locator('.modal .suggest div').first.dispatch_event('mousedown')
    pg.fill('.modal input[placeholder="الصندوق أو البنك"]', '1102'); pg.wait_for_selector('.modal .suggest div:not(.muted)'); pg.locator('.modal .suggest div').first.dispatch_event('mousedown')
    ok('القسط الشهري 1,000.00' in pg.inner_text('.modal'), 'monthly instalment shown while typing (1,000.00)')
    pg.click('[data-preview-btn]'); pg.wait_for_selector('[data-amort-preview]')
    pv = pg.inner_text('[data-amort-preview]')
    ok('6,000.00' in pv and '1,000.00' in pv and '6 شهراً' in pv, 'preview: the payment and the first month, nothing saved')
    pg.click('.modal .btn.primary:has-text("حفظ")'); pg.wait_for_selector('[data-schedule]')
    rows = pg.locator('[data-schedule] tbody tr').count()
    ok(rows == 6, f'saved: the schedule opens with its six months ({rows})')
    due = pg.locator('.modal button:has-text("ترحيل المستحق")')
    ok(due.count() == 1 and '(3)' in due.inner_text(), 'three months have ended and are due')
    due.click(); pg.wait_for_timeout(1500)
    posted = pg.locator('[data-schedule] tbody a').count()
    ok(posted == 3, f'posting the due months links each month to its journal entry ({posted})')
    ok('3,000.00' in pg.inner_text('.modal'), 'remaining 3,000.00 after three months')
    pg.locator('.modal [data-schedule] tbody a').first.click(); pg.wait_for_timeout(1500)
    ok('إطفاء' in pg.inner_text('body') and '1,000.00' in pg.inner_text('body'), 'the month entry opens in the journal')
    # ── month-end checklist and the English screen ──
    pg.goto(B + '/closing'); pg.wait_for_timeout(1500)
    ok('إطفاء المصروفات المدفوعة مقدماً' in pg.inner_text('body'), 'the month-end checklist carries the amortisation line')
    # ── the Hijri date on printed documents ──
    pg.goto(B + '/sales/invoices'); pg.wait_for_timeout(1500)
    pg.locator('.tbl tbody tr').first.click(); pg.wait_for_timeout(2000)
    paper = pg.inner_text('.print-doc') if pg.locator('.print-doc').count() else pg.inner_text('body')
    ok('الموافق' in paper and 'هـ' in paper, 'the printed invoice shows the Hijri date beside the Gregorian one')
    pg.goto(B + '/receipts'); pg.wait_for_timeout(1500)
    pg.locator('.tbl tbody tr button:has-text("🖨")').first.click(); pg.wait_for_selector('.modal .print-doc')
    ok('الموافق' in pg.inner_text('.modal .print-doc') and 'هـ' in pg.inner_text('.modal .print-doc'), 'the receipt voucher shows the Hijri date')
    # template option
    pg.goto(B + '/settings/templates'); pg.wait_for_timeout(1500)
    ok(pg.locator('.tp, [data-tpl]').count() > 0, 'templates gallery opens')
    ok(not errs, 'no page errors ' + str(errs[:2]))
    # ── English: the schedule screen and a Hijri date in English ──
    pe, e2 = signed_in(b, t, 'en')
    pe.goto(B + '/amortizations'); pe.wait_for_selector('[data-amort]')
    body = pe.inner_text('[data-amort]')
    ok('Prepaid expenses and deferred revenue' in body or 'deferred revenue' in body.lower(), 'English: the screen is translated')
    ok(not AR.search(re.sub(r'تأمين المعرض لستة أشهر|[ء-ي ]*مصروف[ء-ي ]*', '', pe.inner_text('[data-amort] thead'))), 'English: table headings translated')
    ok(not e2, 'English: no page errors ' + str(e2[:2]))
    # ── status page and a browser error report ──
    st = pe.request.get(B + '/status'); ok(st.status == 200 and 'All systems operational' in st.text(), 'status page opens')
    r = pe.request.post(B + '/api/client-errors', data={'message': 'ui probe', 'path': '/x'}); ok(r.status == 204, 'browser error report accepted')
    b.close()
done()
