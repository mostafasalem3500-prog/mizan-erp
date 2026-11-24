"""3.42: credit limit measured on the net for a party that is both customer and supplier — the setting, the hint in the
partner form, and the message a credit sale gets when the net goes over the limit."""
import time
from playwright.sync_api import sync_playwright
from ui_lib import *
EG = PORT == '3200'; R = 0.14 if EG else 0.15
t = api.call('/auth/register', {'fullName': 'مختبر', 'companyName': 'r342ui ' + str(time.time_ns()), 'email': f"r342ui{time.time_ns()}@t.sa", 'password': 'Passw0rd!'})['token']
call = lambda *a, **k: api.call(*a, tok=t, **k)
d = time.strftime('%Y-%m-%d')
ADDR = {'street': 'طريق الملك فهد', 'buildingNo': '1234', 'district': 'العليا', 'city': 'الرياض', 'postalCode': '12211', 'phone': '0501234567'}
both = call('/partners', {'name': 'الرواد العامة', 'isCustomer': True, 'isSupplier': True, 'kind': 'COMPANY', 'vatNumber': '310122393500003' if not EG else '300000002', 'creditLimit': 50000, **ADDR})
P = call('/products', {'name': 'خدمة', 'sku': 'S1', 'type': 'SERVICE', 'salePrice': 100, 'purchasePrice': 50, 'taxCode': 'S'})
def inv(direction, net, post=True):
    x = call('/invoices', {'direction': direction, 'kind': 'INVOICE', 'date': d, 'partnerId': both['id'], 'lines': [{'productId': P['id'], 'qty': round(net / 100, 4), 'unitPrice': 100, 'taxCode': 'S'}]})
    return call(f"/invoices/{x['id']}/post", {}) if post else x
inv('PURCHASE', 23000 / (1 + R)); inv('SALE', 54000 / (1 + R))
over = inv('SALE', 20000 / (1 + R), post=False)
with sync_playwright() as pw:
    b = pw.chromium.launch()
    pg, errs = signed_in(b, t)
    pg.goto(B + '/settings'); pg.wait_for_selector('[data-credit-netting]', timeout=90000)
    ok(pg.input_value('[data-credit-netting]') == 'NET', 'settings: net is the default')
    pg.goto(B + f"/customers/{both['id']}"); pg.wait_for_timeout(2500)
    ed = pg.locator('button', has_text='تعديل').first
    if ed.count():
        ed.click(); pg.wait_for_selector('.modal', timeout=20000)
        ok('ما له عندنا كمورد' in pg.inner_text('.modal'), 'partner form: the credit-limit hint says the limit is on the net')
        pg.keyboard.press('Escape')
    else: ok(False, 'partner form opened')
    # a draft that takes the net over the limit: the message shows the three figures
    pg.goto(B + f"/doc/{over['id']}"); pg.wait_for_timeout(2500)
    pg.on('dialog', lambda dl: (msgs.append(dl.message), dl.dismiss() if 'حد الائتمان' in dl.message else dl.accept()))
    msgs = []
    pg.locator('button', has_text='ترحيل').first.click(); pg.wait_for_timeout(2500)
    txt = ' '.join(msgs) + pg.inner_text('body')
    ok('وله عندنا كمورد' in txt and 'فالصافي' in txt, 'posting over the net limit: the message shows what they owe, what we owe them and the net')
    ok(call(f"/invoices/{over['id']}")['status'] == 'DRAFT', 'and the invoice stays a draft')
    ok(not errs, 'no page errors ' + str(errs[:2]))
    b.close()
done()
