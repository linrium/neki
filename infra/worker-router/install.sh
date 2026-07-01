#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

NAMESPACE="${NAMESPACE:-neki}"
NAME="${NAME:-neki-worker-router}"
ROUTER_IMAGE="${ROUTER_IMAGE:-neki/worker-router:latest}"
IMAGE_PULL_POLICY="${IMAGE_PULL_POLICY:-Never}"
REPLICAS="${REPLICAS:-2}"
REFRESH_SECS="${REFRESH_SECS:-5}"
TIMEOUT="${TIMEOUT:-180s}"

export NAMESPACE NAME ROUTER_IMAGE IMAGE_PULL_POLICY REPLICAS REFRESH_SECS

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

apply_template() {
  local file="$1"
  envsubst '${NAMESPACE} ${NAME} ${ROUTER_IMAGE} ${IMAGE_PULL_POLICY} ${REPLICAS} ${REFRESH_SECS}' \
    < "${file}" | kubectl apply -f -
}

need kubectl
need envsubst

echo "Creating namespace ${NAMESPACE}"
kubectl create namespace "${NAMESPACE}" --dry-run=client --output yaml | kubectl apply -f -

echo "Applying neki-worker-router Deployment and Service"
apply_template "${SCRIPT_DIR}/deployment.yaml"
apply_template "${SCRIPT_DIR}/service.yaml"

echo "Waiting for Deployment ${NAMESPACE}/${NAME}"
kubectl rollout status "deployment/${NAME}" \
  --namespace "${NAMESPACE}" \
  --timeout "${TIMEOUT}"

kubectl get deployment,service --namespace "${NAMESPACE}" \
  --selector "app.kubernetes.io/name=neki-worker-router,app.kubernetes.io/instance=${NAME}"
