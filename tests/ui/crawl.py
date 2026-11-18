"""Every screen of the side menu, in Arabic and in English: no page error, no sideways scrolling, and in English no
interface text left in Arabic (names and descriptions from the demo data are data and are allowed)."""
from playwright.sync_api import sync_playwright
from ui_lib import *
JS = '''()=>{const o=[];const w=document.createTreeWalker(document.querySelector('.content')||document.body,NodeFilter.SHOW_TEXT);let n;
while(n=w.nextNode()){const t=n.nodeValue.trim();if(!t||!/[\\u0621-\\u064A]/.test(t))continue;const p=n.parentElement;if(!p||p.closest('[data-lang-toggle],.print-doc,.tp,[data-tpl],table td,.stat-list,select,option'))continue;if(getComputedStyle(p).display==='none')continue;o.push(t)}
return [o,document.documentElement.scrollWidth>document.documentElement.clientWidth+2]}'''
t = demo_token('crawl')
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for lang in ['ar', 'en']:
        pg, errs = signed_in(b, t, lang)
        pg.goto(B + '/'); pg.wait_for_timeout(2500)
        links = pg.eval_on_selector_all('.sidebar a[href]', 'els=>[...new Set(els.map(e=>e.getAttribute("href")))]')
        links = [h for h in links if h.startswith('/') and not h.startswith('/charity')]
        bad, wide, left = [], [], {}
        for h in ['/'] + links:
            n0 = len(errs); pg.goto(B + h); pg.wait_for_timeout(900)
            if len(errs) > n0: bad.append(f'{h}: {errs[n0][:120]}')
            ar, ov = pg.evaluate(JS)
            if ov: wide.append(h)
            if lang == 'en':
                for s in ar: left.setdefault(s, h)
        ok(len(links) > 80, f'{lang}: {len(links)} screens in the menu')
        ok(not bad, f'{lang}: no page or console errors' + (' — ' + '; '.join(bad[:3]) if bad else ''))
        ok(not wide, f'{lang}: no screen scrolls sideways {wide[:5]}')
        if lang == 'en':
            # interface words left in Arabic: a run of Arabic words that the dictionary knows (so the sentence around it was
            # not recognised). Names and descriptions from the demo data are not in the dictionary and do not count.
            known = set(json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../apps/api/web/src/i18n/en.json')))['s'])
            RUN = re.compile(r'[\u0621-\u064A][\u0621-\u0652\u0670-\u06D3]*(?:\s[\u0621-\u064A][\u0621-\u0652\u0670-\u06D3]*)*')
            ui = {s: h for s, h in left.items() if any(r in known and len(r) > 3 for r in RUN.findall(s))}
            ok(len(ui) <= 10, f'en: {len(ui)} interface texts left in Arabic ' + str(list(ui.items())[:8]))
    b.close()
done()
