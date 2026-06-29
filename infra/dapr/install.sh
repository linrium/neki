#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DAPR_NAMESPACE="${DAPR_NAMESPACE:-dapr-system}"
DAPR_RELEASE="${DAPR_RELEASE:-dapr}"
DAPR_CHART_VERSION="${DAPR_CHART_VERSION:-1.17}"
TIMEOUT="${TIMEOUT:-300s}"
ENABLE_HA="${ENABLE_HA:-false}"
APPLY_CONFIGURATION="${APPLY_CONFIGURATION:-false}"
APP_NAMESPACE="${APP_NAMESPACE:-default}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

rollout_if_present() {
  local kind="$1"
  local name="$2"

  if kubectl get "${kind}/${name}" --namespace "${DAPR_NAMESPACE}" >/dev/null 2>&1; then
    kubectl rollout status "${kind}/${name}" \
      --namespace "${DAPR_NAMESPACE}" \
      --timeout "${TIMEOUT}"
  fi
}

need helm
need kubectl

helm_args=(
  upgrade --install "${DAPR_RELEASE}" dapr/dapr
  --version "${DAPR_CHART_VERSION}"
  --namespace "${DAPR_NAMESPACE}"
  --create-namespace
  --values "${SCRIPT_DIR}/values.yaml"
  --wait
  --timeout "${TIMEOUT}"
)

if [[ "${ENABLE_HA}" == "true" ]]; then
  helm_args+=(--values "${SCRIPT_DIR}/values-ha.yaml")
fi

echo "Adding Dapr Helm repository"
helm repo add dapr https://dapr.github.io/helm-charts/
helm repo update

echo "Installing Dapr ${DAPR_CHART_VERSION} into namespace ${DAPR_NAMESPACE}"
helm "${helm_args[@]}"

echo "Waiting for Dapr control plane"
rollout_if_present deployment dapr-operator
rollout_if_present deployment dapr-sidecar-injector
rollout_if_present deployment dapr-sentry
rollout_if_present deployment dapr-placement
rollout_if_present statefulset dapr-placement-server
rollout_if_present statefulset dapr-scheduler-server

if [[ "${APPLY_CONFIGURATION}" == "true" ]]; then
  echo "Applying Dapr application configuration to namespace ${APP_NAMESPACE}"
  kubectl create namespace "${APP_NAMESPACE}" --dry-run=client --output yaml | kubectl apply -f -
  kubectl apply --namespace "${APP_NAMESPACE}" -f "${SCRIPT_DIR}/configuration.yaml"
fi

echo "Dapr control plane pods"
kubectl get pods --namespace "${DAPR_NAMESPACE}"

echo "Dapr install complete"
