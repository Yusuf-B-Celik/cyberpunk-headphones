#!/usr/bin/env bash
# Capture real browser screenshots of the viewer through the camofox API.
# usage: build/browser_shots.sh [outdir]
set -uo pipefail
OUT="${1:-docs/renders}"
API=http://localhost:9377
USER=shot$RANDOM
mkdir -p "$OUT"

TAB=$(curl -s -X POST "$API/tabs" -H 'content-type: application/json' \
  -d "{\"userId\":\"$USER\",\"sessionKey\":\"shots\",\"url\":\"http://127.0.0.1:8123/index.html\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tabId",""))')
[ -z "$TAB" ] && { echo "no tab"; exit 1; }
echo "tab=$TAB"

js() {
  curl -s -X POST "$API/tabs/$TAB/evaluate?userId=$USER" -H 'content-type: application/json' \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"userId":sys.argv[1],"expression":sys.argv[2]}))' "$USER" "$1")" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print("  js:", str(d.get("result",d.get("error")))[:120])'
}
shot() {
  local name="$1"
  curl -s "$API/tabs/$TAB/screenshot?userId=$USER" -o "$OUT/$name"
  echo "  -> $OUT/$name $(stat -c%s "$OUT/$name" 2>/dev/null) bytes"
}

sleep 9
echo "hero"; shot "web_hero.png"

echo "exploded + shell focus"
js 'const s=document.getElementById("explode"); s.value=55; s.dispatchEvent(new Event("input")); document.querySelector("[data-focus=shell]").click();'
sleep 8; shot "web_exploded.png"

echo "reset, panel lines focus"
js 'document.getElementById("btnReset").click(); document.querySelector("[data-focus=lines]").click();'
sleep 9; shot "web_lines.png"

echo "leather pad focus"
js 'document.querySelector("[data-focus=pad]").click();'
sleep 9; shot "web_pad.png"

echo "wireframe"
js 'document.getElementById("wire").checked=true; document.getElementById("wire").dispatchEvent(new Event("change")); document.getElementById("btnReset").click(); document.getElementById("wire").checked=true; document.getElementById("wire").dispatchEvent(new Event("change"));'
sleep 9; shot "web_wire.png"

echo "clay"
js 'const w=document.getElementById("wire"); w.checked=false; w.dispatchEvent(new Event("change")); const c=document.getElementById("clay"); c.checked=true; c.dispatchEvent(new Event("change"));'
sleep 8; shot "web_clay.png"

curl -s -X DELETE "$API/sessions/$USER" >/dev/null
echo done
