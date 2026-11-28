"""Shared helpers for the screen tests: a fresh establishment with the demo data loaded, and a browser signed in to it."""
import os, sys, time, json, re
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'api'))
import lib as api
PORT = os.environ.get('PORT', '3100')
B = 'http://127.0.0.1:' + PORT
api.B = B + '/api'
AR = re.compile(r'[ء-ي]')
fails = []
def ok(c, name):
    print(('✓ ' if c else '✗ FAIL ') + name)
    if not c: fails.append(name)
def demo_token(prefix='ui'):
    """Registers an establishment and loads the six months of demo data (same generator as the reviewer's demo)."""
    t = api.register(prefix)
    api.call('/demo/load', {}, tok=t)
    for _ in range(200):
        s = api.call('/demo/status', tok=t)
        if s.get('demoLoaded') and not (s.get('demoJob') or {}).get('running'): return t
        time.sleep(1.5)
    raise SystemExit('demo data did not load')
_pages = []
def _diagnose(etype, value, tb):
    """A test that dies (usually a screen that never appeared) says where each page was: address, what it showed, what was still loading."""
    try:
        for pg, pending, errs in _pages:
            print('── page at failure:', pg.url)
            try: print('   shows:', ' '.join(pg.evaluate("document.body ? document.body.innerText.slice(0, 400) : '(no body)'").split())[:400])
            except Exception as e: print('   (page not readable:', str(e)[:120], ')')
            print('   still loading:', [u[-90:] for u in list(pending)[:12]])
            print('   console errors:', errs[:5])
            try: print('   service worker:', pg.evaluate("navigator.serviceWorker && navigator.serviceWorker.controller ? navigator.serviceWorker.controller.state : 'none'"), '| navigations:', pg.evaluate("performance.getEntriesByType('navigation').length + ' ' + (performance.getEntriesByType('navigation')[0] || {}).type"))
            except Exception: pass
    except Exception: pass
    sys.__excepthook__(etype, value, tb)
sys.excepthook = _diagnose
def signed_in(browser, token, lang=None, **ctx):
    c = browser.new_context(viewport=ctx.pop('viewport', {'width': 1366, 'height': 900}), **ctx)
    pg = c.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pending = set()
    pg.on('request', lambda r: pending.add(r.url)); pg.on('requestfinished', lambda r: pending.discard(r.url)); pg.on('requestfailed', lambda r: pending.discard(r.url))
    _pages.append((pg, pending, errs))
    pg.goto(B + '/login' + (f'?lang={lang}' if lang else ''))
    pg.evaluate("t=>localStorage.setItem('mz_token',t)", token)
    return pg, errs
def done():
    print('FAILS', fails)
