#!/bin/bash
# Build, push, and deploy OpenClaw gateway to GCE VM.
# Usage: ./deploy.sh [project-id]
set -euo pipefail

PROJECT_ID="${1:-jarvis-ml-dev}"
ZONE="us-west2-a"
VM_NAME="openclaw-gateway"

SHORT_SHA=$(git rev-parse --short=7 HEAD)

echo "=== Building images via Cloud Build (sha=$SHORT_SHA) ==="
gcloud builds submit --project="$PROJECT_ID" --config=cloudbuild.yaml \
  --substitutions="_SHORT_SHA=$SHORT_SHA" .

echo "=== Deploying to $VM_NAME ==="
gcloud compute ssh "$VM_NAME" \
  --zone="$ZONE" \
  --project="$PROJECT_ID" \
  --command="
    set -euo pipefail
    cd /opt/openclaw

    echo 'Pulling latest images ...'
    docker pull gcr.io/$PROJECT_ID/openclaw-gateway:latest
    docker pull gcr.io/$PROJECT_ID/vrm-mock-api:latest

    echo 'Fetching secrets ...'
    ./deploy/fetch-secrets.sh $PROJECT_ID

    echo 'Generating config ...'
    ./deploy/generate-config.sh

    echo 'Starting services ...'
    docker compose -f docker-compose.prod.yml up -d --remove-orphans --force-recreate

    echo 'Waiting for health ...'
    for i in \$(seq 1 12); do
      if curl -sf http://localhost:18789/health 2>/dev/null | grep -q ok; then
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
