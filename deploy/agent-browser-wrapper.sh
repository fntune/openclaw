#!/bin/bash
# Wrapper for /usr/bin/agent-browser that auto-restores saved state on 'open'.
# Install: cp to /usr/local/bin/agent-browser && chmod +x /usr/local/bin/agent-browser
# /usr/local/bin precedes /usr/bin in PATH, so this intercepts all calls.
#
# When a saved state file exists for the target domain:
#   - Fresh daemon: injects --state <file> (loaded at launch)
#   - Running daemon: restores cookies via `cookies set` before navigating
set -euo pipefail

REAL=/usr/bin/agent-browser
STATE_DIR=/home/ubuntu/.steel/states

# Fast path: no args → pass through
if [[ $# -eq 0 ]]; then
  exec "$REAL"
fi

# Scan args for 'open' command, URL, and existing --state flag
cmd=""
url=""
has_state=false
cmd_idx=-1
args=("$@")

for i in "${!args[@]}"; do
  arg="${args[$i]}"
  case "$arg" in
    --state) has_state=true ;;
    open|goto|navigate)
      if [[ -z "$cmd" ]]; then
        cmd="open"
        cmd_idx=$((i + 1))
      fi
      ;;
    http://*|https://*)
      [[ -z "$url" ]] && url="$arg"
      ;;
  esac
done

# Only intercept 'open' commands without an explicit --state
if [[ "$cmd" == "open" && "$has_state" == "false" && -n "$url" ]]; then
  domain=$(echo "$url" | sed -E 's|^https?://||; s|/.*||' | awk -F. '{print $(NF-1)"."$NF}')

  if [[ -n "$domain" ]]; then
    state_file="$STATE_DIR/${domain}.json"
    if [[ -f "$state_file" ]]; then
      # Check if daemon is already running
      if "$REAL" get url &>/dev/null; then
        # Daemon running: restore cookies from state file, then open normally
        python3 -c "
import json, subprocess, sys

with open('$state_file') as f:
    state = json.load(f)

ok = 0
for c in state.get('cookies', []):
    cmd = ['$REAL', 'cookies', 'set', c['name'], c['value']]
    # Playwright wants domain OR url, not both
    if c.get('domain'):
        cmd += ['--domain', c['domain']]
    else:
        cmd += ['--url', '$url']
    if c.get('path'):
        cmd += ['--path', c['path']]
    if c.get('httpOnly'):
        cmd += ['--httpOnly']
    if c.get('secure'):
        cmd += ['--secure']
    if c.get('sameSite') and c['sameSite'] != 'None':
        cmd += ['--sameSite', c['sameSite']]
    if c.get('expires', -1) > 0:
        cmd += ['--expires', str(int(c['expires']))]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode == 0:
        ok += 1
    else:
        print(f'  cookie {c[\"name\"]}: {r.stderr.decode().strip()}', file=sys.stderr)

print(f'Restored {ok}/{len(state.get(\"cookies\", []))} cookies from $state_file', file=sys.stderr)
" 2>&1 | head -5 >&2
        exec "$REAL" "$@"
      else
        # Fresh daemon: inject --state before the open subcommand
        new_args=()
        idx=1
        for arg in "$@"; do
          if [[ $idx -eq $cmd_idx ]]; then
            new_args+=("--state" "$state_file")
          fi
          new_args+=("$arg")
          ((idx++))
        done
        exec "$REAL" "${new_args[@]}"
      fi
    fi
  fi
fi

# Default: pass through unchanged
exec "$REAL" "$@"
