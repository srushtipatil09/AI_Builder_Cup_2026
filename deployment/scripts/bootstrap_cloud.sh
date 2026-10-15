#!/usr/bin/env bash
# Enables the Google APIs this prototype needs. Does not deploy the app.
# Usage: PROJECT=your-project-id ./deployment/scripts/bootstrap_cloud.sh
set -euo pipefail

if [[ -z "${PROJECT:-}" ]]; then
  echo "Set PROJECT to the explicit Google Cloud project id." >&2
  exit 1
fi

gcloud config set project "$PROJECT"
gcloud services enable \
  run.googleapis.com \
  aiplatform.googleapis.com \
  firestore.googleapis.com \
  bigquery.googleapis.com \
  cloudtasks.googleapis.com \
  cloudscheduler.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  fcm.googleapis.com \
  secretmanager.googleapis.com

echo "APIs enabled for $PROJECT. Record the project id in docs/ENVIRONMENT.md."
echo "Create a monthly budget alert in Billing. The alert warns. It does not stop spend."
echo "The hard stops are the counters in api/src/saathi/cost.py."
