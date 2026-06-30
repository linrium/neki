#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

CNPG_OPERATOR_NAMESPACE="${CNPG_OPERATOR_NAMESPACE:-cnpg-system}"
CNPG_OPERATOR_RELEASE="${CNPG_OPERATOR_RELEASE:-cnpg}"
CNPG_OPERATOR_CHART_VERSION="${CNPG_OPERATOR_CHART_VERSION:-}"
POSTGRES_NAMESPACE="${POSTGRES_NAMESPACE:-postgres}"
POSTGRES_RELEASE="${POSTGRES_RELEASE:-postgres}"
CNPG_CLUSTER_CHART_VERSION="${CNPG_CLUSTER_CHART_VERSION:-0.7.0}"
TIMEOUT="${TIMEOUT:-300s}"
APPLY_CLUSTER="${APPLY_CLUSTER:-false}"
CLUSTER_INSTALL_METHOD="${CLUSTER_INSTALL_METHOD:-helm}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

version_args() {
  local version="$1"

  if [[ -n "${version}" ]]; then
    echo "--version" "${version}"
  fi
}

rollout_selector_if_present() {
  local namespace="$1"
  local selector="$2"

  if kubectl get deployment --namespace "${namespace}" --selector "${selector}" --no-headers 2>/dev/null | grep -q .; then
    kubectl rollout status deployment \
      --namespace "${namespace}" \
      --selector "${selector}" \
      --timeout "${TIMEOUT}"
  fi
}

need helm
need kubectl

echo "Adding CloudNativePG Helm repository"
helm repo add cnpg https://cloudnative-pg.github.io/charts
helm repo update

echo "Installing CloudNativePG operator into namespace ${CNPG_OPERATOR_NAMESPACE}"
# shellcheck disable=SC2046
helm upgrade --install "${CNPG_OPERATOR_RELEASE}" cnpg/cloudnative-pg \
  $(version_args "${CNPG_OPERATOR_CHART_VERSION}") \
  --namespace "${CNPG_OPERATOR_NAMESPACE}" \
  --create-namespace \
  --values "${SCRIPT_DIR}/operator-values.yaml" \
  --wait \
  --timeout "${TIMEOUT}"

echo "Waiting for CloudNativePG operator"
rollout_selector_if_present "${CNPG_OPERATOR_NAMESPACE}" "app.kubernetes.io/instance=${CNPG_OPERATOR_RELEASE}"

if [[ "${APPLY_CLUSTER}" == "true" ]]; then
  echo "Creating PostgreSQL namespace ${POSTGRES_NAMESPACE}"
  kubectl create namespace "${POSTGRES_NAMESPACE}" --dry-run=client --output yaml | kubectl apply -f -

  case "${CLUSTER_INSTALL_METHOD}" in
    helm)
      echo "Installing PostgreSQL cluster with cnpg/cluster into namespace ${POSTGRES_NAMESPACE}"
      helm upgrade --install "${POSTGRES_RELEASE}" cnpg/cluster \
        --version "${CNPG_CLUSTER_CHART_VERSION}" \
        --namespace "${POSTGRES_NAMESPACE}" \
        --values "${SCRIPT_DIR}/cluster-values.yaml" \
        --wait \
        --timeout "${TIMEOUT}"
      ;;
    yaml)
      echo "Applying PostgreSQL Cluster manifest into namespace ${POSTGRES_NAMESPACE}"
      kubectl apply --namespace "${POSTGRES_NAMESPACE}" -f "${SCRIPT_DIR}/postgres-cluster.yaml"
      ;;
    *)
      echo "Unsupported CLUSTER_INSTALL_METHOD=${CLUSTER_INSTALL_METHOD}; use helm or yaml" >&2
      exit 1
      ;;
  esac

  echo "PostgreSQL cluster status"
  kubectl get cluster,pods,svc,pvc --namespace "${POSTGRES_NAMESPACE}"
fi

echo "CloudNativePG operator pods"
kubectl get pods --namespace "${CNPG_OPERATOR_NAMESPACE}"

echo "CloudNativePG install complete"
