#!/usr/bin/env bash
# GitHub OAuth device flow -> installs the token for the gh CLI and git.
# Writes the token only into ~/.config/gh/hosts.yml (never to stdout).
set -uo pipefail
CLIENT=178c6fc778ccc68e1d6a
SCOPE="repo,read:org,gist,workflow"
OUT=/tmp/gh_device_flow.json

RESP=$(curl -s -X POST -H "Accept: application/json" \
  -d "client_id=$CLIENT&scope=$SCOPE" https://github.com/login/device/code)
DEVICE_CODE=$(python3 -c 'import json,sys;print(json.loads(sys.argv[1])["device_code"])' "$RESP")
USER_CODE=$(python3 -c 'import json,sys;print(json.loads(sys.argv[1])["user_code"])' "$RESP")
INTERVAL=$(python3 -c 'import json,sys;print(json.loads(sys.argv[1]).get("interval",5))' "$RESP")
VERIFY=$(python3 -c 'import json,sys;print(json.loads(sys.argv[1])["verification_uri"])' "$RESP")
printf '{"user_code":"%s","verification_uri":"%s","interval":%s}\n' "$USER_CODE" "$VERIFY" "$INTERVAL" > "$OUT"
echo "CODE=$USER_CODE  URL=$VERIFY"

for _ in $(seq 1 200); do
  sleep "$INTERVAL"
  POLL=$(curl -s -X POST -H "Accept: application/json" \
    -d "client_id=$CLIENT&device_code=${DEVICE_CODE}&grant_type=urn:ietf:params:oauth:grant-type:device_code" \
    https://github.com/login/oauth/access_token)
  case "$POLL" in
    *access_token*)
      TOKEN=$(python3 -c 'import json,sys;print(json.loads(sys.argv[1])["access_token"])' "$POLL")
      LOGIN=$(curl -s -H "Authorization: token $TOKEN" https://api.github.com/user \
        | python3 -c 'import json,sys;print(json.load(sys.stdin)["login"])')
      mkdir -p ~/.config/gh
      printf 'github.com:\n    users:\n        %s:\n            oauth_token: %s\n    git_protocol: https\n    oauth_token: %s\n    user: %s\n' \
        "$LOGIN" "$TOKEN" "$TOKEN" "$LOGIN" > ~/.config/gh/hosts.yml
      chmod 600 ~/.config/gh/hosts.yml
      unset TOKEN
      gh auth setup-git >/dev/null 2>&1
      echo "LOGIN_COMPLETE user=$LOGIN"
      gh auth status 2>&1 | sed 's/gh[opusr]_[A-Za-z0-9]*/<redacted>/'
      exit 0 ;;
    *authorization_pending*) : ;;
    *slow_down*) INTERVAL=$((INTERVAL+5)) ;;
    *expired_token*) echo "CODE_EXPIRED"; exit 1 ;;
    *access_denied*) echo "USER_DENIED"; exit 1 ;;
    *) echo "UNEXPECTED"; echo "$POLL" | head -c 200; exit 1 ;;
  esac
done
echo "TIMEOUT"; exit 1
