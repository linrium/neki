#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

OBSERVABILITY_NAMESPACE="${OBSERVABILITY_NAMESPACE:-observability}"
PROMETHEUS_RELEASE="${PROMETHEUS_RELEASE:-prometheus}"
LOKI_RELEASE="${LOKI_RELEASE:-loki}"
TEMPO_RELEASE="${TEMPO_RELEASE:-tempo}"
ALLOY_RELEASE="${ALLOY_RELEASE:-alloy}"
TIMEOUT="${TIMEOUT:-600s}"
APPLY_KNATIVE_MONITORS="${APPLY_KNATIVE_MONITORS:-true}"

PROMETHEUS_CHART_VERSION="${PROMETHEUS_CHART_VERSION:-}"
LOKI_CHART_VERSION="${LOKI_CHART_VERSION:-}"
TEMPO_CHART_VERSION="${TEMPO_CHART_VERSION:-}"
ALLOY_CHART_VERSION="${ALLOY_CHART_VERSION:-}"

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

rollout_if_present() {
  local kind="$1"
  local name="$2"

  if kubectl get "${kind}/${name}" --namespace "${OBSERVABILITY_NAMESPACE}" >/dev/null 2>&1; then
    kubectl rollout status "${kind}/${name}" \
      --namespace "${OBSERVABILITY_NAMESPACE}" \
      --timeout "${TIMEOUT}"
  fi
}

need helm
need kubectl

echo "Adding Helm repositories"
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update

echo "Creating namespace ${OBSERVABILITY_NAMESPACE}"
kubectl create namespace "${OBSERVABILITY_NAMESPACE}" --dry-run=client --output yaml | kubectl apply -f -

echo "Installing Prometheus stack into namespace ${OBSERVABILITY_NAMESPACE}"
# shellcheck disable=SC2046
helm upgrade --install "${PROMETHEUS_RELEASE}" prometheus-community/kube-prometheus-stack \
  $(version_args "${PROMETHEUS_CHART_VERSION}") \
  --namespace "${OBSERVABILITY_NAMESPACE}" \
  --values "${SCRIPT_DIR}/prometheus-values.yaml" \
  --wait \
  --timeout "${TIMEOUT}"

echo "Installing Loki into namespace ${OBSERVABILITY_NAMESPACE}"
# shellcheck disable=SC2046
helm upgrade --install "${LOKI_RELEASE}" grafana/loki \
  $(version_args "${LOKI_CHART_VERSION}") \
  --namespace "${OBSERVABILITY_NAMESPACE}" \
  --values "${SCRIPT_DIR}/loki-values.yaml" \
  --wait \
  --timeout "${TIMEOUT}"

echo "Installing Tempo into namespace ${OBSERVABILITY_NAMESPACE}"
# shellcheck disable=SC2046
helm upgrade --install "${TEMPO_RELEASE}" grafana/tempo \
  $(version_args "${TEMPO_CHART_VERSION}") \
  --namespace "${OBSERVABILITY_NAMESPACE}" \
  --values "${SCRIPT_DIR}/tempo-values.yaml" \
  --wait \
  --timeout "${TIMEOUT}"

echo "Installing Alloy into namespace ${OBSERVABILITY_NAMESPACE}"
# shellcheck disable=SC2046
helm upgrade --install "${ALLOY_RELEASE}" grafana/alloy \
  $(version_args "${ALLOY_CHART_VERSION}") \
  --namespace "${OBSERVABILITY_NAMESPACE}" \
  --values "${SCRIPT_DIR}/alloy-values.yaml" \
  --wait \
  --timeout "${TIMEOUT}"

if [[ "${APPLY_KNATIVE_MONITORS}" == "true" ]]; then
  echo "Applying Knative and Dapr ServiceMonitors"
  kubectl apply -f "${SCRIPT_DIR}/knative-servicemonitors.yaml"
fi

echo "Waiting for observability rollouts"
rollout_if_present deployment "${PROMETHEUS_RELEASE}-grafana"
rollout_if_present deployment "${PROMETHEUS_RELEASE}-kube-state-metrics"
rollout_if_present deployment "${PROMETHEUS_RELEASE}-kube-prometheus-operator"
rollout_if_present statefulset "prometheus-${PROMETHEUS_RELEASE}-kube-prometheus-prometheus"
rollout_if_present statefulset "${LOKI_RELEASE}"
rollout_if_present deployment "${LOKI_RELEASE}-gateway"
rollout_if_present deployment "${TEMPO_RELEASE}"
rollout_if_present daemonset "${ALLOY_RELEASE}"

echo "Observability pods"
kubectl get pods --namespace "${OBSERVABILITY_NAMESPACE}"

echo "Observability install complete"
