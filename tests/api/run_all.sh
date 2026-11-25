#!/bin/bash
# Runs the API regression against two local servers: Saudi edition on :3100 and Egypt edition on :3200.
# Each suite prints one line per check (✓ / ✗ FAIL); the script exits non-zero if any check fails or a suite crashes.
cd "$(dirname "$0")"
SA="r353_api r352_api r351_api r350_api r349_api r348_api r347_api r346_api r345_api r344_api r343_api r342_api r341_api r340_api r339_api r338_api r337_api r332_api r331_api r330_api r330b_api r327_api r27_api r28_api r28b_api ail_api ins_api r39_api r310_api r311_api r312_api r313_api r314_api r317_api r318r_api r319_api r320_api r321_api r322_api r323_api r324_api r326_iso r326_ai posting_audit final_audit"
EG="r353_api r352_api r351_api r350_api r349_api r348_api r347_api r346_api r345_api r344_api r343_api r342_api r341_api r340_api r339_api r338_api r337_api r332_api r331_api r330_api r330b_api r327_api eg_api r39_api r311_api r312_api r313_api r314_api r317_api r318r_api r319_api r320_api r322_api r323_api r324_api r326_iso posting_audit final_audit"
bad=0; total=0
run() { # edition, base url, suite
  out=$(B="$2" timeout 600 python3 "$3.py" 2>&1); ok=$(echo "$out" | grep -c '^✓'); f=$(echo "$out" | grep -c 'FAIL \|Traceback')
  total=$((total + ok)); echo "$1 $3: $ok passed, $f failed"
  if [ "$f" != 0 ] || [ "$ok" = 0 ]; then bad=1; echo "$out" | grep -B1 -A6 'FAIL \|Traceback\|lib.E' | tail -30; fi
}
for s in $SA; do run SA http://127.0.0.1:3100/api "$s"; done
for s in $EG; do run EG http://127.0.0.1:3200/api "$s"; done
echo "checks passed: $total"; exit $bad
