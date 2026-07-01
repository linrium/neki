#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

NAMESPACE="${NAMESPACE:-neki}"
NAME="${NAME:-neki-worker-node}"
POOL_ID="${POOL_ID:-public-small}"
NODE_IMAGE="${NODE_IMAGE:-neki/worker-node:latest}"
IMAGE_PULL_POLICY="${IMAGE_PULL_POLICY:-Never}"
REPLICAS="${REPLICAS:-3}"
RECONCILE_INTERVAL_SECS="${RECONCILE_INTERVAL_SECS:-10}"
COMPATIBILITY_DATE="${COMPATIBILITY_DATE:-2025-06-01}"
RUSTFS_ENDPOINT="${RUSTFS_ENDPOINT:-http://rustfs-svc.rustfs.svc.cluster.local:9000}"
RUSTFS_SECRET="${RUSTFS_SECRET:-neki-rustfs-credentials}"
RUSTFS_REGION="${RUSTFS_REGION:-us-east-1}"
RUSTFS_WORKERS_BUCKET="${RUSTFS_WORKERS_BUCKET:-workers}"
ASSIGNMENT_CM="${ASSIGNMENT_CM:-${NAME}-assignment}"
ASSIGNMENT_FILE="${ASSIGNMENT_FILE:-}"
WORKER_ID="${WORKER_ID:-hello}"
WORKER_VERSION="${WORKER_VERSION:-}"
WORKER_SCRIPT_URL="${WORKER_SCRIPT_URL:-}"
WORKER_SHA256="${WORKER_SHA256:-}"
TIMEOUT="${TIMEOUT:-180s}"

export NAMESPACE NAME POOL_ID NODE_IMAGE IMAGE_PULL_POLICY REPLICAS RECONCILE_INTERVAL_SECS
export COMPATIBILITY_DATE RUSTFS_ENDPOINT RUSTFS_SECRET RUSTFS_REGION RUSTFS_WORKERS_BUCKET
export ASSIGNMENT_CM

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

apply_template() {
  local file="$1"
  envsubst '${NAMESPACE} ${NAME} ${POOL_ID} ${NODE_IMAGE} ${IMAGE_PULL_POLICY} ${REPLICAS} ${RECONCILE_INTERVAL_SECS} ${COMPATIBILITY_DATE} ${RUSTFS_ENDPOINT} ${RUSTFS_SECRET} ${RUSTFS_REGION} ${RUSTFS_WORKERS_BUCKET} ${ASSIGNMENT_CM}' \
    < "${file}" | kubectl apply -f -
}

need kubectl
need envsubst

echo "Creating namespace ${NAMESPACE}"
kubectl create namespace "${NAMESPACE}" --dry-run=client --output yaml | kubectl apply -f -

# ---------------------------------------------------------------------------
# Assignment ConfigMap
# ---------------------------------------------------------------------------

create_assignment_cm() {
  local assignment_json

  if [[ -n "${ASSIGNMENT_FILE}" && -f "${ASSIGNMENT_FILE}" ]]; then
    echo "Creating assignment ConfigMap from ${ASSIGNMENT_FILE}"
    kubectl create configmap "${ASSIGNMENT_CM}" \
      --namespace "${NAMESPACE}" \
      --from-file=assignment.json="${ASSIGNMENT_FILE}" \
      --dry-run=client --output yaml | kubectl apply -f -
    return
  fi

  if [[ -z "${WORKER_SCRIPT_URL}" || -z "${WORKER_SHA256}" ]]; then
    echo "WORKER_SCRIPT_URL/WORKER_SHA256 not set, creating empty assignment ConfigMap"
    assignment_json='{"pool_id":"'"${POOL_ID}"'","node_id":"assigned","generation":"1","workers":[],"routes":[]}'
  else
    local version="${WORKER_VERSION}"
    if [[ -z "${version}" ]]; then
      version="$(date +%Y-%m-%d).1"
    fi
    echo "Creating assignment ConfigMap for worker '${WORKER_ID}' version '${version}'"
    assignment_json=$(cat <<EOF
{
  "pool_id": "${POOL_ID}",
  "node_id": "assigned",
  "generation": "1",
  "workers": [
    {
      "worker_id": "${WORKER_ID}",
      "version": "${version}",
      "script_url": "${WORKER_SCRIPT_URL}",
      "sha256": "${WORKER_SHA256}",
      "compatibility_date": "${COMPATIBILITY_DATE}"
    }
  ],
  "routes": [
    {
      "host": "*",
      "path_prefix": "/${WORKER_ID}",
      "methods": ["GET", "POST"],
      "worker_id": "${WORKER_ID}"
    },
    {
      "host": "*",
      "path_prefix": "/healthz",
      "methods": ["GET"],
      "worker_id": "${WORKER_ID}"
    }
  ]
}
EOF
)
  fi

  echo "${assignment_json}" | kubectl create configmap "${ASSIGNMENT_CM}" \
    --namespace "${NAMESPACE}" \
    --from-file=assignment.json=/dev/stdin \
    --dry-run=client --output yaml | kubectl apply -f -
}

create_assignment_cm

echo "Applying neki-worker-node Deployment and Service"
apply_template "${SCRIPT_DIR}/deployment.yaml"
apply_template "${SCRIPT_DIR}/service.yaml"

echo "Waiting for Deployment ${NAMESPACE}/${NAME}"
kubectl rollout status "deployment/${NAME}" \
  --namespace "${NAMESPACE}" \
  --timeout "${TIMEOUT}"

kubectl get deployment,service --namespace "${NAMESPACE}" \
  --selector "app.kubernetes.io/name=neki-worker-node,app.kubernetes.io/instance=${NAME}"
