"""3.51: from the screens — a plan, a subscriber with the live summary, the check-in desk against the quota, a plan
upgrade with its prorated charge, cancellation with a credit note, and the dashboard with MRR."""
import time
from playwright.sync_api import sync_playwright
from ui_lib import *
t = api.call('/auth/register', {'fullName': 'مختبر', 'companyName': 'r351ui ' + str(time.time_ns()), 'email': f"r351ui{time.time_ns()}@t.sa", 'password': 'Passw0rd!'})['token']
call = lambda *a, **k: api.call(*a, tok=t, **k)
cu = call('/partners', {'name': 'نادر الحربي', 'isCustomer': True, 'kind': 'INDIVIDUAL', 'phone': '0507770001'})
with sync_playwright() as pw:
    b = pw.chromium.launch()
    pg, errs = signed_in(b, t)
    pg.on('dialog', lambda dl: dl.accept())
    def pick(scope, ph, text):
        pg.fill(f'{scope} input[placeholder="{ph}"]', text); o = pg.locator(f'{scope} .suggest div', has_text=text).first; o.wait_for(timeout=15000); o.dispatch_event('mousedown'); pg.wait_for_timeout(300)
    pg.goto(B + '/subs')
    try: pg.wait_for_selector('[data-subs-start]', timeout=45000)
    except Exception: pg.reload(); pg.wait_for_selector('[data-subs-start]', timeout=90000)
    ok('ابدأ الاشتراكات' in pg.inner_text('[data-subs-start]'), 'subscriptions dashboard: getting started')
    # plan
    pg.goto(B + '/subs/plans?new=1'); pg.wait_for_selector('[data-plan-name]', timeout=45000)
    pg.fill('[data-plan-name]', 'عضوية شهرية'); pg.fill('[data-plan-price]', '300'); pg.fill('[data-plan-quota]', '2'); pg.fill('[data-plan-overage]', '20'); pg.click('[data-plan-save]')
    pg.wait_for_selector('[data-plan-row="PL-001"]', timeout=20000)
    ok('غير محدود' not in pg.inner_text('[data-plan-row="PL-001"]') and '2' in pg.inner_text('[data-plan-row="PL-001"]'), 'plan saved from the screen with its quota')
    call('/subs/plans', {'name': 'عضوية ذهبية', 'period': 'MONTH', 'price': 450})
    pg.goto(B + '/subs/plans?new=1'); pg.wait_for_selector('[data-plan-period]', timeout=45000); pg.select_option('[data-plan-period]', 'YEAR')
    ok('إيراداً مؤجلاً' in pg.inner_text('.modal'), 'a yearly plan says it is deferred revenue'); pg.locator('.modal button', has_text='إلغاء').first.click()
    # subscriber
    pg.goto(B + '/subs/list?new=1'); pg.wait_for_selector('[data-sub-plan]', timeout=45000)
    pick('.modal', 'ابحث عن العميل', 'نادر الحربي')
    pg.fill('[data-sub-qty]', '1'); pg.wait_for_timeout(300)
    ok('300' in pg.inner_text('[data-sub-summary]') and 'الآن' in pg.inner_text('[data-sub-summary]'), 'live summary: 300 a month, first invoice now')
    pg.click('[data-sub-save]'); pg.wait_for_selector('[data-sub-kpis]', timeout=30000)
    sid = pg.url.split('/subs/')[1]
    s = call(f'/subs/{sid}'); ok(s['status'] == 'ACTIVE' and len(s['invoices']) == 1 and abs(s['invoices'][0]['net'] - 300) < 0.01, 'subscription saved, first invoice 300')
    # check-in desk
    pg.goto(B + '/subs/checkin'); pg.wait_for_selector('[data-checkin-q]', timeout=30000)
    for i in range(2):
        pg.fill('[data-checkin-q]', '0507770001'); pg.click('[data-checkin-go]'); pg.wait_for_selector('[data-checkin-ok]', timeout=15000); pg.wait_for_timeout(400)
    ok('الباقي 0' in pg.inner_text('[data-checkin-left]') and 'استُخدم 2 من 2' in pg.inner_text('[data-checkin-left]'), 'two visits by mobile: 2 of 2, none left')
    pg.fill('[data-checkin-q]', '0507770001'); pg.click('[data-checkin-go]'); pg.wait_for_selector('[data-checkin-ok]', timeout=15000)
    ok('فوق حد الفترة' in pg.inner_text('[data-checkin-ok]'), 'the third: above the quota, charged on the next invoice')
    # upgrade
    pg.goto(B + f'/subs/{sid}'); pg.wait_for_selector('[data-sub-change]', timeout=30000); pg.click('[data-sub-change]')
    pg.wait_for_selector('[data-change-plan]'); pg.select_option('[data-change-plan]', label='عضوية ذهبية — 450.00 شهري') if pg.locator('[data-change-plan] option', has_text='عضوية ذهبية').count() else None
    pg.wait_for_timeout(300); note = pg.inner_text('[data-change-note]')
    ok('ترقية الآن' in note and '150' in note, 'upgrade note: the difference for the days left ' + note[:80])
    pg.click('[data-change-save]'); pg.wait_for_timeout(1500)
    s = call(f'/subs/{sid}'); ok(s['planName'] == 'عضوية ذهبية' and len(s['invoices']) == 2 and abs(s['invoices'][1]['net'] - 150) < 0.01, 'upgraded now with a 150 invoice')
    # cancel now with credit
    pg.click('[data-sub-cancel]'); pg.wait_for_selector('[data-cancel-now]'); pg.click('[data-cancel-now]'); pg.wait_for_selector('[data-cancel-credit]')
    pg.fill('[data-cancel-reason]', 'انتقل'); pg.click('[data-cancel-save]'); pg.wait_for_timeout(2000)
    s = call(f'/subs/{sid}'); cn = [x for x in s['invoices'] if x['kind'] == 'CREDIT_NOTE']
    ok(s['status'] == 'CANCELLED' and len(cn) == 2 and any(x['kind'] == 'INVOICE' and not x['from'] and abs(x['net'] - 20) < 0.01 for x in s['invoices']), 'cancelled: credit notes for the unused days of the period and of the upgrade, the visit above the quota billed (20)')
    ok('ملغى' in pg.inner_text('[data-sub]'), 'the page shows it cancelled')
    # example + dashboard
    call('/subs-example', {})
    pg.goto(B + '/subs'); pg.wait_for_selector('[data-subs-mrr]', timeout=45000)
    d = call('/subs/dashboard'); ok(f"{d['mrr']:,.2f}" in pg.inner_text('[data-subs-mrr]'), 'dashboard: MRR shown ' + str(d['mrr']))
    ok(pg.locator('[data-subs-trend] > div').count() == 6, 'MRR trend: six months')
    pg.goto(B + '/subs/usage'); pg.wait_for_selector('[data-usage-table]', timeout=45000); ok(pg.locator('[data-usage-table] tbody tr').count() >= 5, 'usage report lists the subscribers')
    ok(not errs, 'no page errors ' + str(errs[:2]))
    b.close()
done()
