#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

REDPANDA_OPERATOR_NAMESPACE="${REDPANDA_OPERATOR_NAMESPACE:-redpanda-system}"
REDPANDA_OPERATOR_RELEASE="${REDPANDA_OPERATOR_RELEASE:-redpanda-controller}"
REDPANDA_OPERATOR_CHART_VERSION="${REDPANDA_OPERATOR_CHART_VERSION:-26.1.6}"
REDPANDA_NAMESPACE="${REDPANDA_NAMESPACE:-redpanda}"
CERT_MANAGER_NAMESPACE="${CERT_MANAGER_NAMESPACE:-cert-manager}"
CERT_MANAGER_RELEASE="${CERT_MANAGER_RELEASE:-cert-manager}"
CERT_MANAGER_CHART_VERSION="${CERT_MANAGER_CHART_VERSION:-v1.20.3}"
TIMEOUT="${TIMEOUT:-300s}"
INSTALL_CERT_MANAGER="${INSTALL_CERT_MANAGER:-true}"
APPLY_CLUSTER="${APPLY_CLUSTER:-false}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

rollout_if_present() {
  local namespace="$1"
  local kind="$2"
  local name="$3"

  if kubectl get "${kind}/${name}" --namespace "${namespace}" >/dev/null 2>&1; then
    kubectl rollout status "${kind}/${name}" \
      --namespace "${namespace}" \
      --timeout "${TIMEOUT}"
  fi
}

need helm
need kubectl

if [[ "${INSTALL_CERT_MANAGER}" == "true" ]]; then
  echo "Adding Jetstack Helm repository"
  helm repo add jetstack https://charts.jetstack.io

  echo "Installing cert-manager ${CERT_MANAGER_CHART_VERSION} into namespace ${CERT_MANAGER_NAMESPACE}"
  helm upgrade --install "${CERT_MANAGER_RELEASE}" jetstack/cert-manager \
    --version "${CERT_MANAGER_CHART_VERSION}" \
    --namespace "${CERT_MANAGER_NAMESPACE}" \
    --create-namespace \
    --set crds.enabled=true \
    --wait \
    --timeout "${TIMEOUT}"

  echo "Waiting for cert-manager"
  rollout_if_present "${CERT_MANAGER_NAMESPACE}" deployment cert-manager
  rollout_if_present "${CERT_MANAGER_NAMESPACE}" deployment cert-manager-cainjector
  rollout_if_present "${CERT_MANAGER_NAMESPACE}" deployment cert-manager-webhook
fi

echo "Adding Redpanda Helm repository"
helm repo add redpanda https://charts.redpanda.com
helm repo update

echo "Installing Redpanda Operator ${REDPANDA_OPERATOR_CHART_VERSION} into namespace ${REDPANDA_OPERATOR_NAMESPACE}"
helm upgrade --install "${REDPANDA_OPERATOR_RELEASE}" redpanda/operator \
  --version "${REDPANDA_OPERATOR_CHART_VERSION}" \
  --namespace "${REDPANDA_OPERATOR_NAMESPACE}" \
  --create-namespace \
  --values "${SCRIPT_DIR}/operator-values.yaml" \
  --wait \
  --timeout "${TIMEOUT}"

echo "Waiting for Redpanda Operator"
rollout_if_present "${REDPANDA_OPERATOR_NAMESPACE}" deployment "${REDPANDA_OPERATOR_RELEASE}-operator"
rollout_if_present "${REDPANDA_OPERATOR_NAMESPACE}" deployment redpanda-operator

if [[ "${APPLY_CLUSTER}" == "true" ]]; then
  echo "Applying Redpanda cluster to namespace ${REDPANDA_NAMESPACE}"
  kubectl create namespace "${REDPANDA_NAMESPACE}" --dry-run=client --output yaml | kubectl apply -f -
  kubectl apply --namespace "${REDPANDA_NAMESPACE}" -f "${SCRIPT_DIR}/redpanda-cluster.yaml"

  echo "Waiting for Redpanda StatefulSet"
  rollout_if_present "${REDPANDA_NAMESPACE}" statefulset redpanda
fi

echo "Redpanda Operator pods"
kubectl get pods --namespace "${REDPANDA_OPERATOR_NAMESPACE}"

if [[ "${APPLY_CLUSTER}" == "true" ]]; then
  echo "Redpanda cluster status"
  kubectl get redpanda,pods,pvc --namespace "${REDPANDA_NAMESPACE}"
fi

echo "Redpanda Operator install complete"
