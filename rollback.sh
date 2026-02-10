#!/bin/bash
# Rollback to a previous image by Cloud Build short SHA.
# Usage: ./rollback.sh <short-sha> [project-id]
set -euo pipefail

SHA="${1:?Usage: rollback.sh <short-sha> [project-id]}"
PROJECT_ID="${2:-jarvis-ml-dev}"
ZONE="us-west2-a"
VM_NAME="openclaw-gateway"

echo "=== Rolling back to SHA=$SHA ==="

gcloud compute ssh "$VM_NAME" \
  --zone="$ZONE" \
  --project="$PROJECT_ID" \
  --command="
    set -euo pipefail
    cd /opt/openclaw

    echo 'Pulling images for SHA=$SHA ...'
    docker pull gcr.io/$PROJECT_ID/openclaw-gateway:$SHA
    docker pull gcr.io/$PROJECT_ID/vrm-mock-api:$SHA

    # Tag as latest so compose picks them up
    docker tag gcr.io/$PROJECT_ID/openclaw-gateway:$SHA gcr.io/$PROJECT_ID/openclaw-gateway:latest
    docker tag gcr.io/$PROJECT_ID/vrm-mock-api:$SHA gcr.io/$PROJECT_ID/vrm-mock-api:latest

    # Re-fetch secrets (in case they changed) and regenerate config
    ./deploy/fetch-secrets.sh $PROJECT_ID
    ./deploy/generate-config.sh

    docker compose -f docker-compose.prod.yml up -d --remove-orphans --force-recreate

    echo 'Waiting for health ...'
    for i in \$(seq 1 12); do
      if curl -sf http://localhost:18789/health 2>/dev/null | grep -q ok; then
        echo '=== Rollback healthy ==='
        docker compose -f docker-compose.prod.yml ps
        exit 0
      fi
      sleep 5
    done
    echo '=== FAILED: health check timeout ==='
    docker compose -f docker-compose.prod.yml logs --tail=50 openclaw-gateway
    exit 1
  "
