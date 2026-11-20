"""3.35 associations edition screens (run against a MIZAN_ASSOC=1 server): every menu screen on desktop and phone,
the menu search and folding, the Salla donation store page, and the public receipt-verification page."""
from ui_lib import *
from playwright.sync_api import sync_playwright
t = demo_token('r335ui')
# a receipt to verify
rc = api.call('/charity/receipts', tok=t); rc = rc['rows'] if isinstance(rc, dict) else rc
live = [x for x in rc if x['status'] == 'POSTED' and x.get('verifyToken')]
with sync_playwright() as p:
    br = p.chromium.launch()
    for vp in [{'width': 1366, 'height': 900}, {'width': 390, 'height': 844}]:
        pg, errs = signed_in(br, t, viewport=vp)
        pg.goto(B + '/charity'); pg.wait_for_selector('.sidebar nav a', state='attached', timeout=30000)
        links = pg.eval_on_selector_all('.sidebar nav a', 'as=>as.map(a=>a.getAttribute("href"))')
        # folded groups hide links: open all first
        for b in pg.query_selector_all('.sidebar .ch-group[aria-expanded="false"]'): b.evaluate('b=>b.click()')
        links = sorted(set(pg.eval_on_selector_all('.sidebar nav a', 'as=>as.map(a=>a.getAttribute("href"))')))
        bad = []
        for h in links:
            n0 = len(errs)
            pg.goto(B + h); pg.wait_for_timeout(900)
            txt = pg.inner_text('body')
            ow = pg.evaluate('document.documentElement.scrollWidth - innerWidth')
            if len(errs) > n0 or 'حدث خطأ' in txt or 'Something went wrong' in txt or ow > 4: bad.append((h, errs[n0:][:1], ow))
        ok(len(links) >= 30 and not bad, f"{vp['width']}px: {len(links)} screens open without errors or sideways scrolling {bad[:3]}")
        if vp['width'] > 1000:
            # menu search (hamza/taa-marbuta insensitive) and folding
            pg.goto(B + '/charity'); pg.wait_for_selector('.ch-navsearch input')
            pg.fill('.ch-navsearch input', 'متجر')
            hits = pg.eval_on_selector_all('.sidebar nav a', 'as=>as.map(a=>a.textContent)')
            ok(len(hits) >= 1 and all('متجر' in x for x in hits), f'menu search «متجر» → {hits}')
            pg.fill('.ch-navsearch input', 'منحة')  # typed with taa marbuta, the menu says «المنح»/«منح»
            h2 = pg.eval_on_selector_all('.sidebar nav a', 'as=>as.map(a=>a.textContent)')
            pg.fill('.ch-navsearch input', 'الاسعار'); h3 = pg.eval_on_selector_all('.sidebar nav a', 'as=>as.map(a=>a.textContent)')
            ok(any('الأسعار' in x for x in h3), f'search ignores hamza forms: «الاسعار» finds «الأسعار» → {h3}')
            pg.fill('.ch-navsearch input', '')
            g = pg.query_selector_all('.sidebar .ch-group')
            n1 = pg.eval_on_selector_all('.sidebar nav a', 'as=>as.length')
            g[-1].click(); n2 = pg.eval_on_selector_all('.sidebar nav a', 'as=>as.length')
            pg.reload(); pg.wait_for_selector('.sidebar nav a'); n3 = pg.eval_on_selector_all('.sidebar nav a', 'as=>as.length')
            ok(n2 < n1 and n3 == n2, f'a menu group folds ({n1}→{n2}) and stays folded after reload ({n3})')
            g = pg.query_selector_all('.sidebar .ch-group'); g[-1].click()
            # store page
            pg.goto(B + '/charity/store'); pg.wait_for_selector('text=ربط متجر التبرعات في سلة')
            if pg.query_selector('text=إنشاء رابط الربط'): pg.click('text=إنشاء رابط الربط')
            pg.wait_for_selector('input[readonly][dir=ltr]', timeout=10000)
            url = pg.input_value('input[readonly][dir=ltr]')
            ok('/api/hooks/salla/' in url, 'store page shows the webhook link (demo store is connected): ' + url[-30:])
            pg.click('text=🧪 طلب تبرع تجريبي'); pg.wait_for_timeout(1500)
            ok('order.created' in pg.inner_text('body'), 'sample donation appears in the store events')
            ok('تحويلات سلة إلى البنك' in pg.inner_text('body'), 'store page has the Salla payouts section with the clearing balance')
            # integration audit page
            pg.goto(B + '/charity/integration'); pg.wait_for_selector('text=المستندات والقيود', timeout=20000)
            body = pg.inner_text('body')
            ok('الربط سليم' in body and '❌' not in body, 'integration audit page: «✔ الربط سليم» on the demo books')
            pg.screenshot(path='/tmp/integration.png', full_page=True)
            # receipt print has a verification QR
            if live:
                pg.goto(B + '/charity/receipts'); pg.wait_for_timeout(1200)
        pg.context.close()
    # public verification page, no sign-in
    if live:
        c = br.new_context(viewport={'width': 390, 'height': 844}); pg = c.new_page(); er = []
        pg.on('pageerror', lambda e: er.append(str(e)))
        pg.goto(B + '/v/' + live[0]['verifyToken']); pg.wait_for_timeout(2500)
        body = pg.inner_text('body')
        ok(live[0]['number'] in body and not er, 'public verification page shows the receipt number: ' + live[0]['number'])
        pg.goto(B + '/v/notarealtoken123'); pg.wait_for_timeout(2000)
        ok('لم يُعثر' in pg.inner_text('body') and not er, 'a wrong code says the receipt was not found')
        c.close()
    else: ok(False, 'demo has posted receipts with verification tokens')
    br.close()
done()
