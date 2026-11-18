"""3.31: allowance for doubtful debts on screen, the Hijri date under date fields, response times for the system manager."""
import os, subprocess, time
from playwright.sync_api import sync_playwright
from ui_lib import *
t = demo_token('r331ui')
with sync_playwright() as pw:
    b = pw.chromium.launch()
    pg, errs = signed_in(b, t)
    # ── the provision matrix ──
    pg.goto(B + '/ecl'); pg.wait_for_selector('[data-matrix]')
    ok('مخصص الديون المشكوك فيها' in pg.inner_text('.sidebar'), 'the screen is in the menu')
    rows = pg.locator('[data-matrix] tbody tr').count()
    ok(rows == 5, f'five age bands ({rows})')
    ok(pg.locator('[data-ecl-entry]').count() == 1 and 'مصروف الديون المشكوك' in pg.inner_text('[data-ecl-entry]'), 'the adjusting entry is shown before posting')
    kpi = lambda: pg.inner_text('.kpi >> nth=0')
    before = kpi()
    pg.get_by_label('نسبة 1–30 يوماً').fill('60'); pg.wait_for_timeout(1200)
    ok(kpi() != before, 'changing a band rate recalculates the requirement')
    # ── the Hijri date under the date field ──
    hj = pg.locator('[data-hijri]')
    ok(hj.count() >= 1 and 'هـ' in hj.first.inner_text(), 'the date field shows the Hijri date under it')
    pg.once('dialog', lambda d: d.accept())
    pg.click('[data-ecl-post]'); pg.wait_for_selector('[data-ecl-runs]')
    ok(pg.locator('[data-ecl-runs] tbody tr').count() == 1 and pg.locator('[data-ecl-entry]').count() == 0, 'posted: the run is listed and nothing is left to post')
    pg.locator('[data-ecl-runs] tbody a').first.click(); pg.wait_for_timeout(1500)
    ok('مخصص الديون المشكوك' in pg.inner_text('body'), 'the run opens its journal entry')
    # ── demo data carries amortisation schedules ──
    pg.goto(B + '/amortizations'); pg.wait_for_selector('[data-amort]'); pg.wait_for_timeout(800)
    body = pg.inner_text('[data-amort]')
    ok('تأمين المركبات' in body and 'عقد صيانة سنوي' in body, 'demo data has a prepaid and a deferred-revenue schedule')
    ok(not errs, 'no page errors ' + str(errs[:2]))
    # ── English ──
    pe, e2 = signed_in(b, t, 'en')
    pe.goto(B + '/ecl'); pe.wait_for_selector('[data-matrix]')
    head = pe.inner_text('[data-matrix] thead') + pe.inner_text('[data-matrix] tbody td:first-child >> nth=0')
    ok(not AR.search(head), 'English: matrix headings and bands translated ' + head[:80])
    ok('doubtful' in pe.inner_text('[data-ecl]').lower(), 'English: the screen title is translated')
    ok(not e2, 'English: no page errors ' + str(e2[:2]))
    # ── response times for the system manager (needs database access to make one) ──
    pgurl = os.environ.get('TEST_PG', 'postgresql://postgres@127.0.0.1:5433'); db = 'mizan_eg' if PORT == '3200' else 'mizan'
    st = str(time.time_ns()); email = f'uiadm{st}@t.sa'
    api.call('/auth/register', {'fullName': 'مدير', 'companyName': 'ui admin ' + st, 'email': email, 'password': 'Passw0rd!'})
    if subprocess.run(['psql', f'{pgurl}/{db}', '-qc', f"UPDATE users SET is_super_admin=true WHERE email='{email}'"], capture_output=True).returncode == 0:
        ta = api.call('/auth/login', {'email': email, 'password': 'Passw0rd!'})['token']
        pa, e3 = signed_in(b, ta)
        pa.goto(B + '/admin'); pa.wait_for_selector('[data-admin-perf]', timeout=20000)
        ok(pa.locator('[data-admin-perf] tbody tr').count() > 0 and '/api/' in pa.inner_text('[data-admin-perf]'), 'system manager: slowest routes table')
        ok(not e3, 'admin: no page errors ' + str(e3[:2]))
    else: print('skip admin screen (no database access)')
    b.close()
done()
