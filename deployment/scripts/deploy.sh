#!/usr/bin/env bash
# Deploy Saathi. Same steps as deployment/scripts/deploy.ps1.
#
# One project, saathi-511717, for Cloud Run, Artifact Registry, Cloud Tasks,
# Hosting, Auth, and Firestore. GOOGLE_CLOUD_PROJECT in .env overrides the default.
# FIREBASE_PROJECT_ID is accepted only when it is that same project.
#
# The image is built with Cloud Build from api/Dockerfile and pushed to
# us-central1-docker.pkg.dev/saathi-511717/saathi/api. One image, two services:
# APP_MODULE=main:app (public) and APP_MODULE=worker:app (private).
#
# Usage, from the repo root:
#   deployment/scripts/deploy.sh --dry-run
#   deployment/scripts/deploy.sh
#   deployment/scripts/deploy.sh --target web
#   deployment/scripts/deploy.sh --target api
#
# --target web rebuilds the site and deploys Hosting. It does not build the image.
# --target api builds and deploys Cloud Run only.
# Default is both. --dry-run prints the plan and does not call Cloud Build or Firebase.
#
# Requires gcloud already logged in. Firebase CLI is used if it is on PATH,
# otherwise npx firebase-tools (needs `npx firebase-tools login` once).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SIGNING_SECRET="saathi-link-signing"

GCP_PROJECT="saathi-511717"
FIREBASE_PROJECT="saathi-511717"
REGION="us-central1"
TAG="latest"
TARGET="all"
SKIP_FIRESTORE=0
DRY_RUN=0
PROJECT_SET=0
FIREBASE_SET=0

usage() {
  sed -n '2,22p' "$0"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET="${2:-}"
      shift 2
      ;;
    --project)
      GCP_PROJECT="${2:-}"
      PROJECT_SET=1
      shift 2
      ;;
    --firebase-project)
      FIREBASE_PROJECT="${2:-}"
      FIREBASE_SET=1
      shift 2
      ;;
    --region)
      REGION="${2:-}"
      shift 2
      ;;
    --tag)
      TAG="${2:-}"
      shift 2
      ;;
    --skip-firestore)
      SKIP_FIRESTORE=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

case "$TARGET" in
  all|web|api) ;;
  *)
    echo "--target must be all, web, or api." >&2
    exit 1
    ;;
esac

env_or() {
  local key="$1" fallback="$2" line value
  line=""
  if [[ -f "$ROOT/.env" ]]; then
    line="$(grep -E "^${key}=" "$ROOT/.env" | tail -n 1 || true)"
  fi
  if [[ -z "$line" ]]; then
    printf '%s' "$fallback"
    return
  fi
  value="${line#*=}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  if [[ ${#value} -ge 2 ]]; then
    local quote="${value:0:1}" end="${value: -1}"
    if [[ ( "$quote" == '"' || "$quote" == "'" ) && "$quote" == "$end" ]]; then
      value="${value:1:${#value}-2}"
    fi
  fi
  if [[ -n "$value" ]]; then
    printf '%s' "$value"
  else
    printf '%s' "$fallback"
  fi
}

yaml_quote() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

write_env_file() {
  local path="$1"
  shift
  : >"$path"
  local pair key value
  for pair in "$@"; do
    key="${pair%%=*}"
    value="${pair#*=}"
    printf '%s: %s\n' "$key" "$(yaml_quote "$value")" >>"$path"
  done
}

run_gcloud() {
  echo "gcloud $*"
  if [[ "$DRY_RUN" == "1" ]]; then
    return 0
  fi
  gcloud "$@"
}

run_url() {
  local service="$1" url
  url="$(gcloud run services describe "$service" --project "$GCP_PROJECT" --region "$REGION" --format "value(status.url)")"
  url="${url//$'\r'/}"
  url="${url#"${url%%[![:space:]]*}"}"
  url="${url%"${url##*[![:space:]]}"}"
  if [[ -z "$url" ]]; then
    echo "Could not read the URL for Cloud Run service $service." >&2
    return 1
  fi
  printf '%s' "$url"
}

if [[ "$PROJECT_SET" == "0" ]]; then
  GCP_PROJECT="$(env_or GOOGLE_CLOUD_PROJECT "$GCP_PROJECT")"
fi
if [[ "$FIREBASE_SET" == "0" ]]; then
  FIREBASE_PROJECT="$(env_or FIREBASE_PROJECT_ID "$FIREBASE_PROJECT")"
fi
if [[ "$FIREBASE_PROJECT" != "$GCP_PROJECT" ]]; then
  echo "FIREBASE_PROJECT_ID ($FIREBASE_PROJECT) is not $GCP_PROJECT. Hosting, Auth, and Firestore use $GCP_PROJECT." >&2
  FIREBASE_PROJECT="$GCP_PROJECT"
fi

SERVICE_ACCOUNT="backend-dev@${GCP_PROJECT}.iam.gserviceaccount.com"
IMAGE="${REGION}-docker.pkg.dev/${GCP_PROJECT}/saathi/api:${TAG}"
HOSTING_URL="$(env_or WEB_ORIGIN "https://${FIREBASE_PROJECT}.web.app")"
if [[ "$HOSTING_URL" != https://* ]]; then
  HOSTING_URL="https://${FIREBASE_PROJECT}.web.app"
fi

EXTRACT_MODEL="$(env_or EXTRACT_MODEL "gemini-2.5-flash")"
INSIGHT_MODEL="$(env_or INSIGHT_MODEL "gemini-2.5-flash")"
EMBED_MODEL="$(env_or EMBED_MODEL "text-multilingual-embedding-002")"
TASK_QUEUE="$(env_or TASK_QUEUE "saathi-pipeline")"
UPLOADS_BUCKET="$(env_or UPLOADS_BUCKET "${GCP_PROJECT}-media")"
REQUIRE_HOUSEHOLD_AUTH="$(env_or REQUIRE_HOUSEHOLD_AUTH "true")"
DEMO_ENABLED="$(env_or DEMO_ENABLED "true")"

echo ""
echo "Saathi deploy"
echo "  Cloud project   $GCP_PROJECT"
echo "  Firebase        $FIREBASE_PROJECT"
echo "  Region          $REGION"
echo "  Image           $IMAGE"
echo "  Hosting         $HOSTING_URL"
echo "  Target          $TARGET"
if [[ "$DRY_RUN" == "1" ]]; then
  echo "  Mode            dry run"
fi
echo ""

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud was not found. Install the Google Cloud SDK and run 'gcloud auth login'." >&2
  exit 1
fi

ACTIVE_ACCOUNT="$(gcloud auth list --filter="status:ACTIVE" --format="value(account)" | head -n 1 | tr -d '[:space:]')"
if [[ -z "$ACTIVE_ACCOUNT" ]]; then
  echo "gcloud is not logged in. Run 'gcloud auth login'." >&2
  exit 1
fi
echo "  Account         $ACTIVE_ACCOUNT"

DEPLOY_API=0
DEPLOY_WEB=0
[[ "$TARGET" == "all" || "$TARGET" == "api" ]] && DEPLOY_API=1
[[ "$TARGET" == "all" || "$TARGET" == "web" ]] && DEPLOY_WEB=1
API_URL=""
ENV_FILES=()
cleanup() {
  if [[ ${#ENV_FILES[@]} -gt 0 ]]; then
    rm -f "${ENV_FILES[@]}"
  fi
}
trap cleanup EXIT

if [[ "$DEPLOY_API" == "1" ]]; then
  echo "Building $IMAGE from api/ ..."
  run_gcloud builds submit "$ROOT/api" --project "$GCP_PROJECT" --tag "$IMAGE"

  KNOWN_WORKER_URL=""
  if KNOWN_WORKER_URL="$(run_url saathi-worker 2>/dev/null)"; then
    :
  else
    KNOWN_WORKER_URL=""
  fi

  # LINK_SIGNING_SECRET comes from Secret Manager (setup_cloud.ps1 creates it), never from .env.
  SECRET_ARGS=()
  set +e
  gcloud secrets describe "$SIGNING_SECRET" --project "$GCP_PROJECT" --format "value(name)" >/dev/null 2>&1
  secret_status=$?
  set -e
  if [[ "$secret_status" -eq 0 ]]; then
    SECRET_ARGS=(--set-secrets "LINK_SIGNING_SECRET=${SIGNING_SECRET}:latest")
  else
    echo "Secret $SIGNING_SECRET not found. Run deployment/scripts/setup_cloud.ps1 first; private file links will not work." >&2
  fi

  echo "Deploying saathi-worker ..."
  WORKER_PAIRS=(
    "GOOGLE_CLOUD_PROJECT=$GCP_PROJECT"
    "FIREBASE_PROJECT_ID=$FIREBASE_PROJECT"
    "CLOUD_REGION=$REGION"
    "GOOGLE_GENAI_USE_VERTEXAI=true"
    "EXTRACT_MODEL=$EXTRACT_MODEL"
    "INSIGHT_MODEL=$INSIGHT_MODEL"
    "EMBED_MODEL=$EMBED_MODEL"
    "APP_MODULE=worker:app"
    "TASK_QUEUE=$TASK_QUEUE"
    "UPLOADS_BUCKET=$UPLOADS_BUCKET"
    "REQUIRE_HOUSEHOLD_AUTH=$REQUIRE_HOUSEHOLD_AUTH"
    "TASK_INVOKER_EMAIL=$SERVICE_ACCOUNT"
    "WEB_ORIGIN=$HOSTING_URL"
  )
  if [[ -n "$KNOWN_WORKER_URL" ]]; then
    WORKER_PAIRS+=("WORKER_URL=$KNOWN_WORKER_URL")
  fi

  WORKER_FILE="$(mktemp "${TMPDIR:-/tmp}/saathi-worker-env.XXXXXX.yaml")"
  ENV_FILES+=("$WORKER_FILE")
  if [[ "$DRY_RUN" != "1" ]]; then
    write_env_file "$WORKER_FILE" "${WORKER_PAIRS[@]}"
  fi
  echo "  worker env keys: ${WORKER_PAIRS[*]%%=*}"
  run_gcloud run deploy saathi-worker \
    --project "$GCP_PROJECT" \
    --region "$REGION" \
    --image "$IMAGE" \
    --service-account "$SERVICE_ACCOUNT" \
    --no-allow-unauthenticated \
    --cpu-throttling \
    --cpu-boost \
    --min-instances 0 \
    --max-instances 1 \
    --concurrency 1 \
    --timeout 300 \
    --cpu 1 \
    --memory 1Gi \
    --port 8080 \
    --env-vars-file "$WORKER_FILE" \
    "${SECRET_ARGS[@]}"
  run_gcloud run services add-iam-policy-binding saathi-worker \
    --project "$GCP_PROJECT" \
    --region "$REGION" \
    --member "serviceAccount:$SERVICE_ACCOUNT" \
    --role roles/run.invoker

  WORKER_URL="$(run_url saathi-worker)"
  echo "Worker URL: $WORKER_URL"
  if [[ -z "$KNOWN_WORKER_URL" ]]; then
    run_gcloud run services update saathi-worker \
      --project "$GCP_PROJECT" --region "$REGION" \
      --update-env-vars "WORKER_URL=$WORKER_URL"
  fi

  echo "Deploying saathi-api ..."
  API_PAIRS=(
    "GOOGLE_CLOUD_PROJECT=$GCP_PROJECT"
    "FIREBASE_PROJECT_ID=$FIREBASE_PROJECT"
    "CLOUD_REGION=$REGION"
    "GOOGLE_GENAI_USE_VERTEXAI=true"
    "EXTRACT_MODEL=$EXTRACT_MODEL"
    "INSIGHT_MODEL=$INSIGHT_MODEL"
    "EMBED_MODEL=$EMBED_MODEL"
    "APP_MODULE=main:app"
    "DEMO_ENABLED=$DEMO_ENABLED"
    "TASK_QUEUE=$TASK_QUEUE"
    "WORKER_URL=$WORKER_URL"
    "TASK_INVOKER_EMAIL=$SERVICE_ACCOUNT"
    "UPLOADS_BUCKET=$UPLOADS_BUCKET"
    "REQUIRE_HOUSEHOLD_AUTH=$REQUIRE_HOUSEHOLD_AUTH"
    "WEB_ORIGIN=$HOSTING_URL"
  )
  API_FILE="$(mktemp "${TMPDIR:-/tmp}/saathi-api-env.XXXXXX.yaml")"
  ENV_FILES+=("$API_FILE")
  if [[ "$DRY_RUN" != "1" ]]; then
    write_env_file "$API_FILE" "${API_PAIRS[@]}"
  fi
  echo "  api env keys: ${API_PAIRS[*]%%=*}"
  run_gcloud run deploy saathi-api \
    --project "$GCP_PROJECT" \
    --region "$REGION" \
    --image "$IMAGE" \
    --service-account "$SERVICE_ACCOUNT" \
    --allow-unauthenticated \
    --cpu-throttling \
    --cpu-boost \
    --min-instances 0 \
    --max-instances 3 \
    --concurrency 8 \
    --timeout 600 \
    --cpu 1 \
    --memory 512Mi \
    --port 8080 \
    --env-vars-file "$API_FILE" \
    "${SECRET_ARGS[@]}"

  API_URL="$(run_url saathi-api)"
  echo "API URL: $API_URL"
fi

if [[ "$DEPLOY_WEB" == "1" ]]; then
  if [[ -z "$API_URL" ]]; then
    echo "Reading the existing API URL ..."
    API_URL="$(run_url saathi-api)"
  fi
  echo "Web build will call $API_URL"

  if [[ ! -f "$ROOT/firebase.json" ]]; then
    echo "Missing $ROOT/firebase.json" >&2
    exit 1
  fi
  if [[ ! -f "$ROOT/.firebaserc" ]]; then
    echo "Missing $ROOT/.firebaserc" >&2
    exit 1
  fi

  if [[ ! -d "$ROOT/web/node_modules" ]]; then
    echo "Installing web dependencies ..."
    if [[ "$DRY_RUN" != "1" ]]; then
      npm ci --prefix "$ROOT/web"
    fi
  fi

  echo "Building the web app ..."
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "npm run build --prefix web   (VITE_API_URL=$API_URL)"
  else
    VITE_API_URL="$API_URL" npm run build --prefix "$ROOT/web"
  fi

  if command -v firebase >/dev/null 2>&1; then
    FIREBASE=(firebase)
  else
    if ! command -v npx >/dev/null 2>&1; then
      echo "firebase and npx were not found on PATH." >&2
      exit 1
    fi
    FIREBASE=(npx --yes firebase-tools)
  fi

  echo "Deploying Firebase Hosting to $FIREBASE_PROJECT ..."
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "${FIREBASE[*]} deploy --only hosting --project $FIREBASE_PROJECT --non-interactive"
  else
    ( cd "$ROOT" && "${FIREBASE[@]}" deploy --only hosting --project "$FIREBASE_PROJECT" --non-interactive )
  fi

  if [[ "$SKIP_FIRESTORE" != "1" ]]; then
    echo "Deploying Firestore rules to $FIREBASE_PROJECT ..."
    if [[ "$DRY_RUN" == "1" ]]; then
      echo "${FIREBASE[*]} deploy --only firestore:rules,firestore:indexes --project $FIREBASE_PROJECT --non-interactive"
    else
      ( cd "$ROOT" && "${FIREBASE[@]}" deploy --only firestore:rules,firestore:indexes --project "$FIREBASE_PROJECT" --non-interactive )
    fi
  fi
  echo "Site: $HOSTING_URL"
fi

echo ""
echo "Done."
if [[ "$DEPLOY_WEB" == "1" ]]; then
  echo "Open $HOSTING_URL"
fi
if [[ -n "$API_URL" ]]; then
  echo "API  ${API_URL}/health"
fi
