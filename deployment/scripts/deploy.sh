#!/usr/bin/env bash
# Deploy contract for a cost-shaped Cloud Run pair.
# Prints the commands and stops, unless CONFIRM_DEPLOY=1 and PROJECT are both set.
# Does not create a GPU, a Vector Search replica, or a minimum instance.
# The script that builds and deploys is deployment/scripts/deploy.ps1.
set -euo pipefail

PROJECT="${PROJECT:-}"
REGION="${REGION:-us-central1}"
TAG="${TAG:-scaffold}"

if [[ -z "$PROJECT" ]]; then
  echo "Set PROJECT to the explicit Google Cloud project id." >&2
  exit 1
fi

IMAGE="$REGION-docker.pkg.dev/$PROJECT/saathi/api:$TAG"

cat <<EOF
Image: $IMAGE

Billing shape:
  request-based CPU (--cpu-throttling), so idle time is not billed
  startup CPU boost (--cpu-boost), so cold start does not need a warm instance
  min instances 0
  API concurrency 8, max 3, timeout 600s, 1 vCPU, 512Mi
  worker concurrency 1, max 1, 1 vCPU, 1Gi
  no GPU

API:
  gcloud run deploy saathi-api \\
    --project $PROJECT --region $REGION --image $IMAGE \\
    --allow-unauthenticated --cpu-throttling --cpu-boost \\
    --min-instances 0 --max-instances 3 --concurrency 8 \\
    --timeout 600 --cpu 1 --memory 512Mi \\
    --set-env-vars APP_MODULE=main:app

Worker:
  gcloud run deploy saathi-worker \\
    --project $PROJECT --region $REGION --image $IMAGE \\
    --no-allow-unauthenticated --cpu-throttling --cpu-boost \\
    --min-instances 0 --max-instances 1 --concurrency 1 \\
    --cpu 1 --memory 1Gi \\
    --set-env-vars APP_MODULE=worker:app
EOF

if [[ "${CONFIRM_DEPLOY:-}" != "1" ]]; then
  echo "Not deployed. Re-run with CONFIRM_DEPLOY=1 after the image exists."
  exit 0
fi

echo "CONFIRM_DEPLOY=1 was set, but this scaffold does not build or push the image yet." >&2
exit 1
