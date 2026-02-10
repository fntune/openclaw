#!/bin/bash
# Deploy admin agent to openclaw-sourabh VM.
# Reuses Docker images built by deploy.sh — does NOT rebuild.
# Usage: ./deploy-admin.sh [project-id]
set -euo pipefail

PROJECT_ID="${1:-jarvis-ml-dev}"
ZONE="asia-south2-a"
VM_NAME="openclaw-sourabh"

echo "=== Deploying admin agent to $VM_NAME ==="
gcloud compute ssh "$VM_NAME" \
  --zone="$ZONE" \
  --project="$PROJECT_ID" \
  --ssh-flag="-F /dev/null" \
  --command="
    set -euo pipefail
    cd /opt/openclaw

    echo 'Pulling latest gateway image ...'
    docker pull gcr.io/$PROJECT_ID/openclaw-gateway:latest

    echo 'Fetching secrets ...'
    ./deploy/fetch-secrets-admin.sh $PROJECT_ID

    echo 'Generating config ...'
    ./deploy/generate-config-admin.sh

    echo 'Starting services ...'
    docker compose -f docker-compose.prod.yml up -d --remove-orphans --force-recreate

    echo 'Waiting for health ...'
    for i in \$(seq 1 12); do
      if curl -s http://localhost:18789/health 2>/dev/null | grep -q status; then
        echo '=== Gateway healthy ==='
        docker compose -f docker-compose.prod.yml ps
        exit 0
      fi
      sleep 5
    done
    echo '=== FAILED: health check timeout ==='
    docker compose -f docker-compose.prod.yml logs --tail=50 openclaw-gateway
    exit 1
  "
