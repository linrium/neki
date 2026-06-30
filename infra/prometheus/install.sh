#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

PROMETHEUS_NAMESPACE="${PROMETHEUS_NAMESPACE:-monitoring}"
PROMETHEUS_RELEASE="${PROMETHEUS_RELEASE:-prometheus}"
PROMETHEUS_CHART_VERSION="${PROMETHEUS_CHART_VERSION:-}"
TIMEOUT="${TIMEOUT:-300s}"
APPLY_SAMPLE_MONITOR="${APPLY_SAMPLE_MONITOR:-false}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

rollout_if_present() {
  local kind="$1"
  local name="$2"

  if kubectl get "${kind}/${name}" --namespace "${PROMETHEUS_NAMESPACE}" >/dev/null 2>&1; then
    kubectl rollout status "${kind}/${name}" \
      --namespace "${PROMETHEUS_NAMESPACE}" \
      --timeout "${TIMEOUT}"
  fi
}

need helm
need kubectl

if [[ "${PROMETHEUS_NAMESPACE}" == "monitoring" ]]; then
  echo "Applying Prometheus setup manifest"
  kubectl apply -f "${SCRIPT_DIR}/setup.yaml"
else
  echo "Creating Prometheus namespace ${PROMETHEUS_NAMESPACE}"
  kubectl create namespace "${PROMETHEUS_NAMESPACE}" --dry-run=client --output yaml | kubectl apply -f -
  kubectl label namespace "${PROMETHEUS_NAMESPACE}" \
    app.kubernetes.io/name=prometheus \
    app.kubernetes.io/part-of=neki \
    --overwrite
fi

echo "Adding Prometheus Community Helm repository"
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

helm_args=(
  upgrade --install "${PROMETHEUS_RELEASE}" prometheus-community/kube-prometheus-stack
  --namespace "${PROMETHEUS_NAMESPACE}"
  --create-namespace
  --values "${SCRIPT_DIR}/values.yaml"
  --wait
  --timeout "${TIMEOUT}"
)

if [[ -n "${PROMETHEUS_CHART_VERSION}" ]]; then
  helm_args+=(--version "${PROMETHEUS_CHART_VERSION}")
fi

echo "Installing kube-prometheus-stack into namespace ${PROMETHEUS_NAMESPACE}"
helm "${helm_args[@]}"

echo "Waiting for Prometheus stack"
rollout_if_present deployment "${PROMETHEUS_RELEASE}-kube-prometheus-operator"
rollout_if_present statefulset "prometheus-${PROMETHEUS_RELEASE}-kube-prometheus-prometheus"
rollout_if_present statefulset "alertmanager-${PROMETHEUS_RELEASE}-kube-prometheus-alertmanager"
rollout_if_present deployment "${PROMETHEUS_RELEASE}-kube-state-metrics"

if [[ "${APPLY_SAMPLE_MONITOR}" == "true" ]]; then
  echo "Applying sample ServiceMonitor"
  kubectl apply --namespace "${PROMETHEUS_NAMESPACE}" -f "${SCRIPT_DIR}/sample-servicemonitor.yaml"
fi

echo "Prometheus stack pods"
kubectl get pods --namespace "${PROMETHEUS_NAMESPACE}"

echo "Prometheus Operator API resources"
kubectl api-resources --api-group='monitoring.coreos.com'

echo "Prometheus install complete"
