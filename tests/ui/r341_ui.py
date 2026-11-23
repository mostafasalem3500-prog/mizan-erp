"""3.41: «＋ عميل جديد» and «＋ مورد جديد» in the menu, recurring rent / recurring expense from the menu and from the
cash-flow forecast, and the rent column filled by a recurring rent."""
import re
from playwright.sync_api import sync_playwright
from ui_lib import *
EG = PORT == '3200'
t = api.call('/auth/register', {'fullName': 'مختبر', 'companyName': 'r341ui ' + str(__import__('time').time_ns()), 'email': f"r341ui{__import__('time').time_ns()}@t.sa", 'password': 'Passw0rd!'})['token']
call = lambda *a, **k: api.call(*a, tok=t, **k)
K = {x.get('systemKey'): x for x in call('/accounts')['rows'] if x.get('systemKey')}
import datetime
D = lambda n: (datetime.date.today() + datetime.timedelta(days=n)).isoformat()
call('/journals', {'date': D(-70), 'memo': 'رأس المال', 'lines': [{'accountId': K['BANK']['id'], 'debit': 200000, 'credit': 0}, {'accountId': K['CAPITAL']['id'], 'debit': 0, 'credit': 200000}]})
for n in (60, 30, 5): call('/expenses', {'date': D(-n), 'accountId': K['RENT']['id'], 'amount': 4000, 'taxCode': 'S', 'payAccountId': K['BANK']['id'], 'payee': 'المالك', 'description': 'إيجار'})
with sync_playwright() as pw:
    b = pw.chromium.launch()
    pg, errs = signed_in(b, t)
    pg.goto(B + '/')
    try: pg.wait_for_selector('.sidebar', timeout=60000)
    except Exception: pg.reload(); pg.wait_for_selector('.sidebar', timeout=90000)
    def open_group(label):
        g = pg.locator('.sidebar .nav-group, .sidebar button, .sidebar a', has_text=label).first
        g.click(); pg.wait_for_timeout(300)
    # ── ＋ customer / ＋ supplier from the menu ──
    open_group('المبيعات')
    a = pg.locator('.sidebar a.action', has_text='عميل جديد')
    ok(a.count() == 1, '«＋ عميل جديد» is in the sales menu')
    a.first.click(); pg.wait_for_selector('.modal', timeout=20000)
    ok('عميل' in pg.inner_text('.modal') and '/customers' in pg.url, 'it opens the new-customer form on the customers screen')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    if pg.locator('.modal').count(): pg.locator('.modal button', has_text='إلغاء').first.click()
    open_group('المشتريات')
    a = pg.locator('.sidebar a.action', has_text='مورد جديد')
    ok(a.count() == 1, '«＋ مورد جديد» is in the purchases menu')
    a.first.click(); pg.wait_for_selector('.modal', timeout=20000)
    ok('مورد' in pg.inner_text('.modal') and '/suppliers' in pg.url, 'it opens the new-supplier form on the suppliers screen')
    if pg.locator('.modal button', has_text='إلغاء').count(): pg.locator('.modal button', has_text='إلغاء').first.click()
    # ── forecast: the empty rent column is explained, then filled ──
    pg.goto(B + '/cash-forecast'); pg.wait_for_selector('[data-fc-table]', timeout=60000)
    ok('عمود الإيجار فارغ' in pg.inner_text('[data-forecast]') and pg.locator('[data-fc-rent]').count() == 1, 'forecast: says why the rent column is empty and offers «＋ إيجار دوري»')
    pg.click('[data-fc-rent]'); pg.wait_for_selector('[data-recurring-save]')
    pg.wait_for_timeout(1500)
    m = pg.inner_text('.modal')
    ok('إيجار دوري' in m and pg.input_value('[data-recurring-amount]') in ('4000', '4000.00') and K['RENT']['nameAr'] in m and K['BANK']['nameAr'] in m, 'the form comes filled: rent account, the bank, and the average rent from the books (4,000)')
    ok(not pg.locator('[data-recurring-save]').is_disabled(), 'ready to save as is')
    pg.click('[data-recurring-save]'); pg.wait_for_timeout(2500)
    f = call('/reports/cash-forecast?weeks=13'); rent = round(sum(x['out']['leases'] for x in f['buckets']), 2)
    ok(rent > 0 and f['assumptions']['rentTemplates'] == 1, f'saved: the forecast rent column now carries {rent:,.2f}')
    ok('عمود الإيجار فارغ' not in pg.inner_text('[data-forecast]'), 'and the remark disappears from the screen')
    pg.click('[data-fc-rexp]'); pg.wait_for_selector('[data-recurring-save]'); pg.wait_for_timeout(800)
    ok('مصروف دوري' in pg.inner_text('.modal') and pg.locator('[data-recurring-save]').is_disabled(), 'recurring expense form: cannot be saved before the account and amount are chosen')
    pg.locator('.modal button', has_text='إلغاء').first.click()
    # ── from the menu ──
    open_group('المصروفات')
    ok(pg.locator('.sidebar a.action', has_text='إيجار دوري').count() == 1 and pg.locator('.sidebar a.action', has_text='مصروف دوري').count() == 1, '«＋ إيجار دوري» and «＋ مصروف دوري» are in the expenses menu')
    pg.locator('.sidebar a.action', has_text='إيجار دوري').first.click(); pg.wait_for_selector('[data-recurring-save]', timeout=20000)
    ok('/recurring' in pg.url and 'إيجار دوري' in pg.inner_text('.modal'), 'the menu shortcut opens the recurring-rent form')
    pg.locator('.modal button', has_text='إلغاء').first.click(); pg.wait_for_timeout(300)
    ok('إيجار شهري' in pg.inner_text('body'), 'the rent saved from the forecast is listed among the recurring items')
    ok(not errs, 'no page errors ' + str(errs[:2]))
    pe, e2 = signed_in(b, t, lang='en'); AR = re.compile('[؀-ۿ]')
    pe.goto(B + '/cash-forecast'); pe.wait_for_selector('[data-fc-recurring]', timeout=60000); pe.wait_for_timeout(1000)
    ok(not AR.search(pe.inner_text('[data-fc-recurring]')), 'English: the recurring strip is translated ' + ''.join(AR.findall(pe.inner_text('[data-fc-recurring]')))[:30])
    ok(not e2, 'English: no page errors ' + str(e2[:2]))
    b.close()
done()
