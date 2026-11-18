# Screen tests

Playwright (Python, Chromium) against running servers — the same two the API tests use (Saudi edition on :3100,
Egypt edition on :3200). Each suite registers its own establishment and loads the demo data.

- `crawl.py` — every screen of the side menu in Arabic and in English: no page or console error, no sideways
  scrolling, and in English no interface text left in Arabic.
- `en_ui.py` — the English interface: switching language and direction, translated screens and lessons, server
  messages, Excel export, chart labels, the phone layout.
- `r330_ui.py` — amortisation schedules on screen, the Hijri date on printed invoices and vouchers, the status page.

```
pip install playwright openpyxl && python -m playwright install chromium
bash tests/ui/run_all.sh
```

GitHub runs them on every push (`.github/workflows/ci.yml`, job «screens»).
