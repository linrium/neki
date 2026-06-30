#!/usr/bin/env bash
set -euo pipefail

PROMETHEUS_NAMESPACE="${PROMETHEUS_NAMESPACE:-monitoring}"
PROMETHEUS_RELEASE="${PROMETHEUS_RELEASE:-prometheus}"
DELETE_SAMPLE_MONITOR="${DELETE_SAMPLE_MONITOR:-false}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need helm
need kubectl

if [[ "${DELETE_SAMPLE_MONITOR}" == "true" ]]; then
  echo "Deleting sample ServiceMonitor"
  kubectl delete \
    --namespace "${PROMETHEUS_NAMESPACE}" \
    -f "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/sample-servicemonitor.yaml" \
    --ignore-not-found
fi

echo "Uninstalling Prometheus stack"
helm uninstall "${PROMETHEUS_RELEASE}" --namespace "${PROMETHEUS_NAMESPACE}"

echo "Prometheus stack uninstall complete"
