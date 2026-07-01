#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

NAMESPACE="${NAMESPACE:-workerd}"
NAME="${NAME:-workerd-hello}"
CONFIG_MAP="${CONFIG_MAP:-${NAME}-config}"
TIMEOUT="${TIMEOUT:-180s}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need kubectl

echo "Creating namespace ${NAMESPACE}"
kubectl create namespace "${NAMESPACE}" --dry-run=client --output yaml | kubectl apply -f -

echo "Applying workerd ConfigMap ${NAMESPACE}/${CONFIG_MAP}"
kubectl create configmap "${CONFIG_MAP}" \
  --namespace "${NAMESPACE}" \
  --from-file=config.capnp="${SCRIPT_DIR}/config.capnp" \
  --from-file=worker.js="${SCRIPT_DIR}/worker.js" \
  --dry-run=client \
  --output yaml | kubectl apply -f -

echo "Deploying workerd example ${NAMESPACE}/${NAME}"
NAMESPACE="${NAMESPACE}" \
NAME="${NAME}" \
CONFIG_MAP="${CONFIG_MAP}" \
TIMEOUT="${TIMEOUT}" \
APPLY_DEFAULT_CONFIG=false \
"${REPO_ROOT}/infra/workerd/install.sh"
