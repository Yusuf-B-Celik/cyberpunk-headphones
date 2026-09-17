#!/usr/bin/env bash
# Drive the local viewer through the camofox API and print the self-test report.
# usage: build/browser_test.sh [url]
set -uo pipefail
URL="${1:-http://127.0.0.1:8123/index.html?selftest=1}"
API=http://localhost:9377
USER=qa$RANDOM
TAB=$(curl -s -X POST "$API/tabs" -H 'content-type: application/json' \
  -d "{\"userId\":\"$USER\",\"sessionKey\":\"viewer\",\"url\":\"$URL\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tabId",""))')
if [ -z "$TAB" ]; then echo "no tab created"; exit 1; fi
echo "tab=$TAB user=$USER"

for i in $(seq 1 40); do
  sleep 1
  OUT=$(curl -s -X POST "$API/tabs/$TAB/evaluate?userId=$USER" -H 'content-type: application/json' \
    -d '{"userId":"'"$USER"'","expression":"document.getElementById(\"diag\")?document.getElementById(\"diag\").textContent:\"PENDING\""}' \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("result","")[:200000])')
  case "$OUT" in
    SELFTEST*) echo "$OUT" > /tmp/selftest.txt; break ;;
    *) echo "  waiting (${i}s): ${OUT:0:60}" ;;
  esac
done

if [ ! -s /tmp/selftest.txt ]; then echo "NO REPORT"; exit 1; fi
python3 - <<'PY'
import json
raw = open('/tmp/selftest.txt').read()[len('SELFTEST '):]
j = json.loads(raw)
print("ok:", j['ok'], " errors:", j['errors'])
print("pixels:", j.get('pixels'))
for s in j['steps']:
    print(" ", s.pop('name'), s)
PY
