#!/usr/bin/env bash
set -euo pipefail

# Forwards Redpanda broker (Kafka, Admin, Schema Registry) and Console ports to
# localhost so you can reach the cluster from your machine. External access is
# disabled in the cluster manifest, so port-forwarding is the local entry point.

NAMESPACE="${NAMESPACE:-redpanda}"
BROKER_SERVICE="${BROKER_SERVICE:-redpanda}"
CONSOLE_SERVICE="${CONSOLE_SERVICE:-redpanda-console}"

KAFKA_LOCAL_PORT="${KAFKA_LOCAL_PORT:-9093}"
ADMIN_LOCAL_PORT="${ADMIN_LOCAL_PORT:-9644}"
SCHEMA_LOCAL_PORT="${SCHEMA_LOCAL_PORT:-8081}"
CONSOLE_LOCAL_PORT="${CONSOLE_LOCAL_PORT:-8080}"

FORWARD_CONSOLE="${FORWARD_CONSOLE:-true}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need kubectl

if ! kubectl get service "${BROKER_SERVICE}" --namespace "${NAMESPACE}" >/dev/null 2>&1; then
  echo "No service \"${BROKER_SERVICE}\" found in namespace ${NAMESPACE}" >&2
  echo "Is the Redpanda cluster applied? Try: APPLY_CLUSTER=true ./infra/redpanda/install.sh" >&2
  exit 1
fi

PIDS=()
cleanup() {
  for pid in "${PIDS[@]:-}"; do
    kill "${pid}" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT INT TERM

echo "Forwarding broker ${NAMESPACE}/service/${BROKER_SERVICE}"
kubectl port-forward \
  --namespace "${NAMESPACE}" \
  "service/${BROKER_SERVICE}" \
  "${KAFKA_LOCAL_PORT}:9093" \
  "${ADMIN_LOCAL_PORT}:9644" \
  "${SCHEMA_LOCAL_PORT}:8081" \
  >/dev/null 2>&1 &
PIDS+=("$!")

if [[ "${FORWARD_CONSOLE}" == "true" ]] && \
   kubectl get service "${CONSOLE_SERVICE}" --namespace "${NAMESPACE}" >/dev/null 2>&1; then
  echo "Forwarding console ${NAMESPACE}/service/${CONSOLE_SERVICE}"
  kubectl port-forward \
    --namespace "${NAMESPACE}" \
    "service/${CONSOLE_SERVICE}" \
    "${CONSOLE_LOCAL_PORT}:8080" \
    >/dev/null 2>&1 &
  PIDS+=("$!")
fi

echo
echo "Redpanda is reachable on localhost:"
echo "  Kafka API (TLS):        localhost:${KAFKA_LOCAL_PORT}"
echo "  Admin API (TLS):        localhost:${ADMIN_LOCAL_PORT}"
echo "  Schema Registry (TLS):  localhost:${SCHEMA_LOCAL_PORT}"
if [[ "${FORWARD_CONSOLE}" == "true" ]] && \
   kubectl get service "${CONSOLE_SERVICE}" --namespace "${NAMESPACE}" >/dev/null 2>&1; then
  echo "  Console UI (browser):   http://localhost:${CONSOLE_LOCAL_PORT}"
fi
echo
echo "Quick check from inside the cluster (no TLS/advertised-address setup):"
echo "  kubectl exec -n ${NAMESPACE} -it ${BROKER_SERVICE}-0 -- rpk cluster info"
echo
echo "Ctrl-C to stop."

wait
