"""3.46: cost per size and add-on in the recipe window, the food-cost report, the option editor with a recipe factor and an
ingredient, and the till's appearance settings and best-sellers section."""
import time
from playwright.sync_api import sync_playwright
from ui_lib import *
t = api.call('/auth/register', {'fullName': 'مختبر', 'companyName': 'r346ui ' + str(time.time_ns()), 'email': f"r346ui{time.time_ns()}@t.sa", 'password': 'Passw0rd!'})['token']
call = lambda *a, **k: api.call(*a, tok=t, **k)
call('/preps/example', {})
with sync_playwright() as pw:
    b = pw.chromium.launch()
    pg, errs = signed_in(b, t)
    pg.on('dialog', lambda dl: dl.accept())
    # food-cost report
    pg.goto(B + '/recipes?tab=cost')
    try: pg.wait_for_selector('[data-fc-dishes]', timeout=45000)
    except Exception: pg.reload(); pg.wait_for_selector('[data-fc-dishes]', timeout=90000)
    g = pg.inner_text('[data-fc-gauge]'); tx = pg.inner_text('[data-fc-dishes]')
    ok('32.37%' in g and 'المستهدف 30%' in g, 'food-cost report: the gauge shows 32.37% against the 30% target')
    ok(pg.locator('[data-fc-dishes] tbody tr').count() == 3 and 'دبل' in tx and 'ثومية إضافية' in tx and pg.locator('[data-fc-dishes] .pct-bar').count() == 4, 'one line per size and add-on sold, each with its cost bar')
    pg.locator('.tabs button, [role=tab]', has_text='المكونات وأين ذهبت').first.click(); pg.wait_for_selector('[data-fc-ing]')
    ok('صدور دجاج' in pg.inner_text('[data-fc-ing]') and pg.locator('[data-fc-ing] .fc-split').count() >= 5, 'ingredients tab: where each raw material went, from the stock card')
    pg.fill('[data-fc-target]', '35'); pg.locator('[data-fc-target]').blur(); pg.wait_for_timeout(1500)
    ok('المستهدف 35%' in pg.inner_text('[data-fc-gauge]') and 'ضمن المستهدف' in pg.inner_text('[data-fc-gauge]'), 'changing the target to 35% turns the gauge to «within target»')
    # cost per size in the recipe window
    pg.goto(B + '/recipes'); pg.wait_for_selector('[data-recipe-list]', timeout=60000)
    pg.locator('[data-recipe-list] tbody tr', has_text='ساندوتش').first.click(); pg.wait_for_selector('[data-variant-costs]', timeout=20000)
    v = pg.inner_text('[data-variant-costs]')
    ok('دبل' in v and 'الوصفة × 1.6' in v and 'ثومية إضافية' in v and '21.00' in v, 'recipe window: cost of the double (recipe × 1.6, price 21) and of the extra garlic sauce')
    pg.keyboard.press('Escape')
    # option editor
    pg.goto(B + '/pos/modifiers'); pg.wait_for_timeout(2500)
    pg.locator('tr, .card', has_text='حجم الساندوتش').locator('button', has_text='تعديل').first.click() if pg.locator('button', has_text='تعديل').count() else pg.locator('tbody tr', has_text='حجم الساندوتش').first.click()
    pg.wait_for_selector('[data-options]', timeout=20000)
    ok(pg.locator('[data-opt-factor]').nth(1).input_value() == '1.6' and pg.locator('[data-opt-comp]').count() == 2, 'option editor: the recipe factor (1.6 for the double) and an ingredient column')
    pg.keyboard.press('Escape')
    # till appearance
    pg.goto(B + '/pos/setup'); pg.wait_for_selector('[data-pos-look]', timeout=60000)
    pg.click('[data-look="tile-L"]'); pg.wait_for_timeout(900); pg.click('[data-look="cats-SIDE"]'); pg.wait_for_timeout(900); pg.click('[data-look-color="#be123c"]'); pg.wait_for_timeout(900)
    ui = call('/pos/ui')
    ok(ui['ui']['tile'] == 'L' and ui['ui']['cats'] == 'SIDE' and ui['ui']['accent'] == '#be123c' and len(ui['top']) == 1, 'appearance saved: large tiles, sections at the side, a brand colour; one best seller so far')
    pg.goto(B + '/pos'); pg.wait_for_selector('.auth, .pos .items', timeout=60000)
    if pg.locator('.auth').count(): pg.fill('.auth input[type=number]', '0'); pg.click('.auth .btn.primary')
    pg.wait_for_selector('.pos .items .item'); pg.wait_for_timeout(1200)
    cls = pg.get_attribute('.pos', 'class'); col = pg.evaluate("getComputedStyle(document.querySelector('.pos')).getPropertyValue('--primary').trim()")
    ok('tile-L' in cls and 'cats-side' in cls and col == '#be123c', 'the till opens with the chosen look')
    pg.click('[data-pos-top]'); pg.wait_for_timeout(400)
    ok(pg.locator('.pos .items .item').count() == 1 and 'ساندوتش' in pg.inner_text('.pos .items'), '«الأكثر مبيعاً» shows the best seller only')
    w = pg.evaluate("document.querySelector('.pos .cats').getBoundingClientRect().width")
    ok(w < 200, 'sections sit in a side column')
    ok(not errs, 'no page errors ' + str(errs[:2]))
    b.close()
done()
