#!/usr/bin/env bash
set -euo pipefail

REDPANDA_OPERATOR_NAMESPACE="${REDPANDA_OPERATOR_NAMESPACE:-redpanda-system}"
REDPANDA_OPERATOR_RELEASE="${REDPANDA_OPERATOR_RELEASE:-redpanda-controller}"
REDPANDA_NAMESPACE="${REDPANDA_NAMESPACE:-redpanda}"
CERT_MANAGER_NAMESPACE="${CERT_MANAGER_NAMESPACE:-cert-manager}"
CERT_MANAGER_RELEASE="${CERT_MANAGER_RELEASE:-cert-manager}"
DELETE_CLUSTER="${DELETE_CLUSTER:-false}"
UNINSTALL_CERT_MANAGER="${UNINSTALL_CERT_MANAGER:-false}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need helm
need kubectl

if [[ "${DELETE_CLUSTER}" == "true" ]]; then
  echo "Deleting Redpanda custom resources from namespace ${REDPANDA_NAMESPACE}"
  kubectl delete users --namespace "${REDPANDA_NAMESPACE}" --all --ignore-not-found
  kubectl delete topics --namespace "${REDPANDA_NAMESPACE}" --all --ignore-not-found
  kubectl delete schemas --namespace "${REDPANDA_NAMESPACE}" --all --ignore-not-found
  kubectl delete redpanda --namespace "${REDPANDA_NAMESPACE}" --all --ignore-not-found
  kubectl delete console --namespace "${REDPANDA_NAMESPACE}" --all --ignore-not-found
fi

echo "Uninstalling Redpanda Operator"
helm uninstall "${REDPANDA_OPERATOR_RELEASE}" --namespace "${REDPANDA_OPERATOR_NAMESPACE}"

if [[ "${UNINSTALL_CERT_MANAGER}" == "true" ]]; then
  echo "Uninstalling cert-manager"
  helm uninstall "${CERT_MANAGER_RELEASE}" --namespace "${CERT_MANAGER_NAMESPACE}"
fi
