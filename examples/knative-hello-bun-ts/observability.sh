#!/usr/bin/env bash
set -euo pipefail

SERVICE="${SERVICE:-hello-bun-ts}"
OTEL_SERVICE_NAME="${OTEL_SERVICE_NAME:-hello-bun-ts}"
NAMESPACE="${NAMESPACE:-default}"
OBSERVABILITY_NAMESPACE="${OBSERVABILITY_NAMESPACE:-observability}"
SINCE="${SINCE:-30m}"
LIMIT="${LIMIT:-20}"
PROMETHEUS_PORT="${PROMETHEUS_PORT:-19090}"
LOKI_PORT="${LOKI_PORT:-13100}"
TEMPO_PORT="${TEMPO_PORT:-13200}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

start_port_forward() {
  local name="$1"
  local port="$2"
  local target="$3"
  local target_port="$4"
  local log_file

  log_file="$(mktemp -t "${name}.port-forward.XXXXXX")"
  kubectl port-forward --namespace "${OBSERVABILITY_NAMESPACE}" "${target}" "${port}:${target_port}" >"${log_file}" 2>&1 &
  local pid="$!"
  PORT_FORWARD_PIDS+=("${pid}")

  for _ in $(seq 1 50); do
    if grep -q "Forwarding from" "${log_file}" >/dev/null 2>&1; then
      return
    fi

    if ! kill -0 "${pid}" >/dev/null 2>&1; then
      echo "Failed to port-forward ${target}. Log:" >&2
      cat "${log_file}" >&2
      exit 1
    fi

    sleep 0.1
  done

  echo "Timed out waiting for port-forward ${target}. Log:" >&2
  cat "${log_file}" >&2
  exit 1
}

cleanup() {
  for pid in "${PORT_FORWARD_PIDS[@]:-}"; do
    kill "${pid}" >/dev/null 2>&1 || true
  done
}

prom_query() {
  local title="$1"
  local query="$2"

  echo
  echo "## ${title}"
  curl --silent --show-error --get "http://127.0.0.1:${PROMETHEUS_PORT}/api/v1/query" \
    --data-urlencode "query=${query}"
  echo
}

loki_query() {
  echo
  echo "## Logs"
  curl --silent --show-error --get "http://127.0.0.1:${LOKI_PORT}/loki/api/v1/query_range" \
    --data-urlencode "query={namespace=\"${NAMESPACE}\",knative_service=\"${SERVICE}\"}" \
    --data-urlencode "limit=${LIMIT}" \
    --data-urlencode "since=${SINCE}" \
    --data-urlencode "direction=backward"
  echo
}

tempo_query() {
  echo
  echo "## Traces"
  curl --silent --show-error --get "http://127.0.0.1:${TEMPO_PORT}/api/search" \
    --data-urlencode "q={resource.service.name=\"${OTEL_SERVICE_NAME}\"}" \
    --data-urlencode "limit=${LIMIT}"
  echo
}

need kubectl
need curl

PORT_FORWARD_PIDS=()
trap cleanup EXIT

start_port_forward prometheus "${PROMETHEUS_PORT}" "svc/prometheus-kube-prometheus-prometheus" 9090
start_port_forward loki "${LOKI_PORT}" "svc/loki-gateway" 80
start_port_forward tempo "${TEMPO_PORT}" "svc/tempo" 3200

echo "# Observability for ${NAMESPACE}/${SERVICE}"
echo "Window: ${SINCE}"

loki_query

prom_query "OpenTelemetry app request metrics" "{__name__=~\"http_server_request_.*\",service_name=\"${OTEL_SERVICE_NAME}\"}"
prom_query "Request rate" "sum(rate(http_server_request_count_total{service_name=\"${OTEL_SERVICE_NAME}\"}[5m]))"
prom_query "CPU cores by pod/container" "sum(rate(container_cpu_usage_seconds_total{namespace=\"${NAMESPACE}\",pod=~\"${SERVICE}-.*\",container!=\"\",container!=\"POD\"}[5m])) by (pod, container)"
prom_query "Memory working set bytes by pod/container" "sum(container_memory_working_set_bytes{namespace=\"${NAMESPACE}\",pod=~\"${SERVICE}-.*\",container!=\"\",container!=\"POD\"}) by (pod, container)"

tempo_query
