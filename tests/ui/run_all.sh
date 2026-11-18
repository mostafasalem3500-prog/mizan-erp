#!/bin/bash
# Screen tests (Playwright, Chromium) against the two local servers: Saudi edition on :3100, Egypt edition on :3200.
# Each suite prints one line per check (✓ / ✗ FAIL); the script exits non-zero if any check fails or a suite crashes.
cd "$(dirname "$0")"
bad=0; total=0
run() { # edition, port, suite
  out=$(PORT="$2" timeout 1200 python3 "$3.py" 2>&1); ok=$(echo "$out" | grep -c '^✓'); f=$(echo "$out" | grep -c 'FAIL \|Traceback\|Error:')
  total=$((total + ok)); echo "$1 $3: $ok passed, $f failed"
  if [ "$f" != 0 ] || [ "$ok" = 0 ]; then bad=1; echo "$out" | grep -B1 -A8 'FAIL \|Traceback\|Error:' | tail -40; fi
}
run SA 3100 crawl
run EG 3200 crawl
run SA 3100 en_ui
run SA 3100 r330_ui
run SA 3100 r331_ui
echo "screen checks passed: $total"; exit $bad
