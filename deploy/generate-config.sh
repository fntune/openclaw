#!/bin/bash
# Generate final openclaw.json from template + env secrets.
# Expects /opt/openclaw/.env to exist (run fetch-secrets.sh first).
set -euo pipefail

ENV_FILE="/opt/openclaw/.env"
TEMPLATE="/opt/openclaw/config/openclaw.vrm.json5"
OUTPUT="/mnt/openclaw-data/.openclaw/openclaw.json"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found — run fetch-secrets.sh first" >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$ENV_FILE"
export OPENCLAW_GATEWAY_TOKEN
export GOOGLE_API_KEY MODEL_PRIMARY
export SLACK_BOT_TOKEN SLACK_APP_TOKEN
export VRM_ADMIN_API_URL VRM_ADMIN_API_KEY
export JARVIS_URL JARVIS_API_KEY
export MCP_MINER_URL MCP_MINER_API_KEY

# Run render script inside the gateway container (Node.js not on host)
docker run --rm \
  --user "1000:1000" \
  --env-file "$ENV_FILE" \
  -v /opt/openclaw/deploy:/opt/openclaw/deploy:ro \
  -v /opt/openclaw/config:/opt/openclaw/config:ro \
  -v /mnt/openclaw-data/.openclaw:/mnt/openclaw-data/.openclaw \
  gcr.io/jarvis-ml-dev/openclaw-gateway:latest \
  node /opt/openclaw/deploy/render-config.mjs "$TEMPLATE" "$OUTPUT"
echo "Config written to $OUTPUT"
