#!/usr/bin/env bash
set -euo pipefail

PROMETHEUS_NAMESPACE="${PROMETHEUS_NAMESPACE:-monitoring}"
PROMETHEUS_RELEASE="${PROMETHEUS_RELEASE:-prometheus}"
PROMETHEUS_LOCAL_PORT="${PROMETHEUS_LOCAL_PORT:-9090}"
ALERTMANAGER_LOCAL_PORT="${ALERTMANAGER_LOCAL_PORT:-9093}"
FORWARD_ALERTMANAGER="${FORWARD_ALERTMANAGER:-true}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need kubectl

echo "Forwarding Prometheus to http://localhost:${PROMETHEUS_LOCAL_PORT}"
kubectl port-forward \
  --namespace "${PROMETHEUS_NAMESPACE}" \
  "service/${PROMETHEUS_RELEASE}-kube-prometheus-prometheus" \
  "${PROMETHEUS_LOCAL_PORT}:9090" &

if [[ "${FORWARD_ALERTMANAGER}" == "true" ]]; then
  echo "Forwarding Alertmanager to http://localhost:${ALERTMANAGER_LOCAL_PORT}"
  kubectl port-forward \
    --namespace "${PROMETHEUS_NAMESPACE}" \
    "service/${PROMETHEUS_RELEASE}-kube-prometheus-alertmanager" \
    "${ALERTMANAGER_LOCAL_PORT}:9093" &
fi

wait
