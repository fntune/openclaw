#!/bin/bash
# Periodic browser state saver.
# Saves cookies + localStorage + sessionStorage via agent-browser CDP.
# Run from cron every 60s: * * * * * /opt/openclaw/deploy/browser-state-saver.sh
set -euo pipefail

AB=/usr/bin/agent-browser
STATE_DIR=/home/ubuntu/.steel/states
mkdir -p "$STATE_DIR"

# Check if browser is reachable
url=$("$AB" get url 2>/dev/null) || exit 0
[[ -z "$url" || "$url" == "about:blank" ]] && exit 0

# Extract root domain (e.g. www.swiggy.com → swiggy.com)
domain=$(echo "$url" | sed -E 's|^https?://||; s|/.*||' | awk -F. '{print $(NF-1)"."$NF}')
[[ -z "$domain" ]] && exit 0

# Only save if there are cookies (i.e. we have meaningful state)
cookie_count=$("$AB" cookies get --json 2>/dev/null \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('data',d).get('cookies',d if isinstance(d,list) else [])))" 2>/dev/null) || cookie_count=0

if [[ "$cookie_count" -gt 0 ]]; then
  state_file="$STATE_DIR/${domain}.json"
  "$AB" state save "$state_file" 2>/dev/null
  # Also save a latest symlink for convenience
  ln -sf "$state_file" "$STATE_DIR/_latest.json" 2>/dev/null
fi
