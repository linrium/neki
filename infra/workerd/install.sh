#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

NAMESPACE="${NAMESPACE:-workerd}"
NAME="${NAME:-workerd}"
CONFIG_MAP="${CONFIG_MAP:-workerd-config}"
WORKERD_NPM_VERSION="${WORKERD_NPM_VERSION:-latest}"
NODE_IMAGE="${NODE_IMAGE:-node:22-bookworm-slim}"
REPLICAS="${REPLICAS:-1}"
SERVICE_PORT="${SERVICE_PORT:-80}"
CONTAINER_PORT="${CONTAINER_PORT:-8080}"
TIMEOUT="${TIMEOUT:-180s}"
APPLY_DEFAULT_CONFIG="${APPLY_DEFAULT_CONFIG:-true}"

export NAMESPACE
export NAME
export CONFIG_MAP
export WORKERD_NPM_VERSION
export NODE_IMAGE
export REPLICAS
export SERVICE_PORT
export CONTAINER_PORT

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

apply_template() {
  local file="$1"

  envsubst '${NAMESPACE} ${NAME} ${CONFIG_MAP} ${WORKERD_NPM_VERSION} ${NODE_IMAGE} ${REPLICAS} ${SERVICE_PORT} ${CONTAINER_PORT}' \
    < "${file}" | kubectl apply -f -
}

need kubectl
need envsubst

echo "Creating namespace ${NAMESPACE}"
kubectl create namespace "${NAMESPACE}" --dry-run=client --output yaml | kubectl apply -f -

if [[ "${APPLY_DEFAULT_CONFIG}" == "true" ]]; then
  echo "Applying default workerd ConfigMap ${NAMESPACE}/${CONFIG_MAP}"
  apply_template "${SCRIPT_DIR}/configmap.yaml"
fi

echo "Applying workerd Deployment and Service ${NAMESPACE}/${NAME}"
apply_template "${SCRIPT_DIR}/deployment.yaml"
apply_template "${SCRIPT_DIR}/service.yaml"

echo "Waiting for workerd Deployment ${NAMESPACE}/${NAME}"
kubectl rollout status "deployment/${NAME}" \
  --namespace "${NAMESPACE}" \
  --timeout "${TIMEOUT}"

kubectl get deployment,service --namespace "${NAMESPACE}" \
  --selector "app.kubernetes.io/name=workerd,app.kubernetes.io/instance=${NAME}"
