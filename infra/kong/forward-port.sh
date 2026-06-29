#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${NAMESPACE:-kong}"
LOCAL_PORT="${LOCAL_PORT:-8080}"
REMOTE_PORT="${REMOTE_PORT:-80}"
INGRESS_SELECTOR="${INGRESS_SELECTOR:-gateway-operator.konghq.com/dataplane-service-type=ingress}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need kubectl

INGRESS_SERVICE="$(
  kubectl get service \
    --namespace "${NAMESPACE}" \
    --selector "${INGRESS_SELECTOR}" \
    --output 'jsonpath={.items[0].metadata.name}'
)"

if [[ -z "${INGRESS_SERVICE}" ]]; then
  echo "No Kong ingress service found in namespace ${NAMESPACE}" >&2
  echo "Selector: ${INGRESS_SELECTOR}" >&2
  exit 1
fi

echo "Forwarding localhost:${LOCAL_PORT} to ${NAMESPACE}/service/${INGRESS_SERVICE}:${REMOTE_PORT}"
echo "Try: curl -i http://localhost:${LOCAL_PORT}/api/functions/hello-bun-ts"

exec kubectl port-forward \
  --namespace "${NAMESPACE}" \
  "service/${INGRESS_SERVICE}" \
  "${LOCAL_PORT}:${REMOTE_PORT}"
