#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

ISTIO_NAMESPACE="${ISTIO_NAMESPACE:-istio-system}"
ISTIO_OPERATOR_FILE="${ISTIO_OPERATOR_FILE:-${SCRIPT_DIR}/istio-operator.yaml}"
PURGE="${PURGE:-false}"
DELETE_NAMESPACE="${DELETE_NAMESPACE:-false}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need istioctl
need kubectl

if [[ "${PURGE}" == "true" ]]; then
  echo "Purging all Istio resources managed by istioctl"
  istioctl uninstall --purge --skip-confirmation
else
  echo "Uninstalling Istio resources from ${ISTIO_OPERATOR_FILE}"
  istioctl uninstall --filename "${ISTIO_OPERATOR_FILE}" --skip-confirmation
fi

if [[ "${DELETE_NAMESPACE}" == "true" ]]; then
  echo "Deleting namespace ${ISTIO_NAMESPACE}"
  kubectl delete namespace "${ISTIO_NAMESPACE}" --ignore-not-found
fi

echo "Istio uninstall complete"
