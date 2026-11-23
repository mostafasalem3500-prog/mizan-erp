"""3.40: the cashier's stock override, reversing a posted return and seeing who issued it, staff number, card-terminal
settlement, e-store settlement and profit (Saudi edition), evidence on a justified auditor note."""
import re, os, tempfile
from playwright.sync_api import sync_playwright
from ui_lib import *
EG = PORT == '3200'
t = demo_token('r340ui')
call = lambda *a, **k: api.call(*a, tok=t, **k)
me = call('/users')[0]
z = call('/products', {'name': 'صنف تخطي الرصيد', 'sku': 'OVR-340', 'type': 'STOCK', 'salePrice': 20, 'purchasePrice': 12, 'taxCode': 'S'})
with sync_playwright() as pw:
    b = pw.chromium.launch()
    pg, errs = signed_in(b, t)
    seen = []
    pg.on('dialog', lambda dl: (seen.append(dl.message), dl.accept()))
    # ── staff number and the oversell setting ──
    pg.goto(B + '/settings/users')
    try: pg.wait_for_selector('[data-staff-no]', timeout=60000)
    except Exception: pg.reload(); pg.wait_for_selector('[data-staff-no]', timeout=90000)
    pg.fill('[data-staff-no]', '2044'); pg.locator('[data-staff-no]').first.blur(); pg.wait_for_timeout(1500)
    ok(call('/users')[0]['staffNo'] == '2044', 'staff number typed in the users screen is saved')
    pg.goto(B + '/settings'); pg.wait_for_selector('[data-oversell]', timeout=60000)
    ok(pg.input_value('[data-oversell]') == 'ASK', 'default: the cashier may override after confirming')
    # ── POS: zero stock → confirmation → sold ──
    pg.goto(B + '/pos'); pg.wait_for_selector('.auth, .pos .items', timeout=60000)
    if pg.locator('.auth').count(): pg.fill('.auth input[type=number]', '0'); pg.click('.auth .btn.primary')
    pg.wait_for_selector('.pos .items .item')
    pg.fill('.pos .search input', 'صنف تخطي الرصيد'); pg.wait_for_timeout(500)
    pg.locator('.pos .items .item', has_text='صنف تخطي الرصيد').first.click(); pg.wait_for_timeout(300)
    pg.click('button:has-text("الدفع")'); pg.wait_for_selector('.modal'); pg.locator('.modal .m-f .btn.primary, .modal button:has-text("تأكيد")').last.click(); pg.wait_for_selector('.thermal', timeout=20000)
    ok(any('الرصيد المسجل' in m for m in seen), 'zero stock: the cashier is asked to confirm before the sale goes on')
    inv = [r for r in call('/invoices?direction=SALE&kind=INVOICE&limit=5')['rows'] if r.get('oversold') and r.get('issuerNo') == '2044']  # the sample data carries its own example under staff number 1001
    ok(len(inv) == 1 and inv[0]['issuerNo'] == '2044', 'after confirming the sale is posted, flagged, and carries the staff number')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    # ── who issued a return; reversing it ──
    orig = [r for r in call('/invoices?direction=SALE&kind=INVOICE&status=POSTED&limit=200')['rows'] if r['channel'] != 'POS' and r['paymentStatus'] != 'PAID' and float(r['amountPaid']) == 0][0]
    full = call(f"/invoices/{orig['id']}"); ln = [l for l in full['lines'] if l.get('productId')][0]
    cn = call('/invoices', {'direction': 'SALE', 'kind': 'CREDIT_NOTE', 'date': full['date'][:10] if False else __import__('datetime').date.today().isoformat(), 'partnerId': full['partnerId'], 'originId': full['id'], 'reason': 'اختبار', 'lines': [{'productId': ln['productId'], 'qty': 1, 'unitPrice': float(ln['unitPrice']), 'taxCode': ln['taxCode']}]})
    cn = call(f"/invoices/{cn['id']}/post", {})
    pg.goto(B + '/sales/credit-notes'); pg.wait_for_selector('table.tbl tbody tr', timeout=60000)
    ok('المستخدم' in pg.inner_text('table.tbl thead') and pg.locator('[data-issuer]').first.inner_text().strip() != '', 'the returns list names the user behind each document')
    pg.goto(B + f"/doc/{cn['id']}"); pg.wait_for_selector('[data-reverse-return]', timeout=60000)
    ok(pg.locator('[data-doc-issuer]').count() == 1, 'the return shows who issued it')
    pg.click('[data-reverse-return]'); pg.wait_for_selector('[data-reverse-reason]')
    ok('إشعار مدين' in pg.inner_text('.modal') and pg.locator('[data-reverse-save]').is_disabled(), 'the dialog explains the debit note and needs a reason')
    pg.fill('[data-reverse-reason]', 'سُجّل بالخطأ'); pg.click('[data-reverse-save]'); pg.wait_for_timeout(2500)
    after = call(f"/invoices/{cn['id']}")
    ok(bool(after['reversedBy']) and 'إشعار مدين' in pg.inner_text('body'), 'reversed from the screen: a debit note is issued and opened')
    # ── card settlement ──
    pg.goto(B + '/bank/card-settlement'); pg.wait_for_selector('[data-clearing="CARD"]', timeout=60000); pg.wait_for_timeout(800)
    ok('تسوية أجهزة الشبكة والبطاقات' in pg.inner_text('.sidebar'), 'card settlement is in the cash & banks menu')
    v0 = call('/clearing/CARD')
    ok(len(v0['open']) > 0 and 'مطابق' in pg.inner_text('[data-unexplained]'), 'open card sales listed and tied to the ledger balance')
    boxes = pg.locator('[data-open] tbody input[type=checkbox]'); boxes.nth(0).check(); boxes.nth(1).check()
    pg.click('[data-settle]'); pg.wait_for_selector('[data-settle-save]')
    pg.locator('[data-bank] .input, [data-bank] input').first.click(); pg.wait_for_timeout(700)
    opt = pg.locator('.modal .picker-list .picker-item, .modal [role=option], .modal .dropdown li').first
    if opt.count(): opt.click()
    else: pg.keyboard.press('ArrowDown'); pg.keyboard.press('Enter')
    pg.wait_for_timeout(300)
    two = round(v0['open'][0]['open'] + v0['open'][1]['open'], 2)
    pg.fill('[data-net]', str(round(two - 3.45, 2))); pg.click('[data-settle-save]'); pg.wait_for_timeout(2500)
    v1 = call('/clearing/CARD')
    ok(len(v1['open']) == len(v0['open']) - 2 and abs(v1['batches'][0]['fees'] + v1['batches'][0]['feeVat'] - 3.45) < 0.011 and abs(v1['unexplained']) < 0.011, 'two sales settled from the screen: fee from the amount received, list still equals the ledger')
    ok(pg.locator('[data-batches] tbody tr').count() >= 1, 'the deposit appears in the deposits tab')
    # a statement file with one unknown transaction
    o = v1['open'][0]
    path = os.path.join(tempfile.mkdtemp(), 'stmt.csv')
    open(path, 'w', encoding='utf-8').write(f"reference,date,amount,fee\n{o['number']},{o['date']},{o['open']},1.20\nRRN-NOPE,{o['date']},77.00,0.60\n")
    pg.set_input_files('input[type=file]', path); pg.wait_for_selector('[data-col="ref"]', timeout=20000)
    ok(pg.input_value('[data-col="ref"]') == '0' and pg.input_value('[data-col="gross"]') == '2' and pg.input_value('[data-col="fee"]') == '3', 'statement columns recognised from their headers')
    pg.locator('[data-bank] .input, [data-bank] input').first.click(); pg.wait_for_timeout(700)
    opt = pg.locator('.modal .picker-list .picker-item, .modal [role=option], .modal .dropdown li').first
    if opt.count(): opt.click()
    else: pg.keyboard.press('ArrowDown'); pg.keyboard.press('Enter')
    pg.wait_for_timeout(300); pg.click('[data-settle-save]'); pg.wait_for_timeout(2500)
    v2 = call('/clearing/CARD')
    ok(len(v2['unmatched']) == len(v1['unmatched']) + 1 and len(v2['open']) == len(v1['open']) - 1, 'file: the known sale is settled, the unknown transaction is listed and not posted')
    ok(pg.locator('[data-unmatched] tbody tr').count() == len(v2['unmatched']), 'and shown under "in the statement but not in the system"')
    # ── auditor: optional file on a justification ──
    pg.goto(B + '/auditor'); pg.wait_for_selector('[data-audit-score]', timeout=60000)
    if pg.locator('[data-dismiss]').count():
        pg.locator('[data-dismiss]').first.click(); pg.wait_for_selector('[data-dismiss-file]')
        pg.fill('[data-dismiss-note]', 'راجعت المستند الأصلي')
        ok(not pg.locator('[data-dismiss-save]').is_disabled(), 'a justification can be saved with no file (optional)')
        pg.set_input_files('[data-dismiss-file]', path); pg.click('[data-dismiss-save]'); pg.wait_for_timeout(2500)
        sc = call('/auditor/scan') if False else None
        pg.reload(); pg.wait_for_selector('[data-audit-score]', timeout=60000); pg.wait_for_timeout(800)
        box = pg.locator('label', has_text='المبرَّرة').locator('input')
        if box.count(): box.first.check(); pg.wait_for_timeout(1200)
        ok(pg.locator('[data-dismiss-att]').count() >= 1 or 'stmt.csv' in pg.inner_text('body'), 'the attached evidence shows next to the justified note')
    if not EG:
        ok('المتاجر الإلكترونية' in pg.inner_text('.sidebar'), 'e-stores have their own menu section')
        pg.goto(B + '/estore/settlement'); pg.wait_for_selector('[data-clearing="SALLA"]', timeout=60000)
        ok('متجر سلة' in pg.inner_text('body') and 'متجر زد' in pg.inner_text('body'), 'platform settlement: Salla and Zid tabs')
        pg.goto(B + '/estore/profit'); pg.wait_for_selector('[data-estore-profit] .mini-kpis', timeout=60000)
        ok('صافي الربح' in pg.inner_text('body') and 'عمولات المنصات' in pg.inner_text('body'), 'order profitability screen opens')
    else:
        ok('المتاجر الإلكترونية' not in pg.inner_text('.sidebar'), 'no e-store section in the Egyptian menu')
    ok(not errs, 'no page errors ' + str(errs[:2]))
    pe, e2 = signed_in(b, t, lang='en'); AR = re.compile('[؀-ۿ]')
    for path_ in ['/bank/card-settlement'] + ([] if EG else ['/estore/settlement', '/estore/profit']):
        pe.goto(B + path_); pe.wait_for_selector('.card-h', timeout=60000); pe.wait_for_timeout(1200)
        heads = ' '.join(pe.locator('.card-h').all_inner_texts()) + ' '.join(pe.locator('.kpi .label').all_inner_texts())
        ok(not AR.search(heads), f'English: {path_} headers translated ' + ''.join(AR.findall(heads))[:30])
    ok(not e2, 'English: no page errors ' + str(e2[:2]))
    b.close()
done()
