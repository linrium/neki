#!/usr/bin/env bash
set -euo pipefail

OBSERVABILITY_NAMESPACE="${OBSERVABILITY_NAMESPACE:-observability}"
PROMETHEUS_PORT="${PROMETHEUS_PORT:-19090}"
LOKI_PORT="${LOKI_PORT:-13100}"
TEMPO_PORT="${TEMPO_PORT:-13200}"
PROMETHEUS_TARGET="${PROMETHEUS_TARGET:-svc/prometheus-kube-prometheus-prometheus}"
LOKI_TARGET="${LOKI_TARGET:-svc/loki-gateway}"
TEMPO_TARGET="${TEMPO_TARGET:-svc/tempo}"

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
      echo "${name}: http://127.0.0.1:${port} -> ${OBSERVABILITY_NAMESPACE}/${target}:${target_port}"
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

need kubectl

PORT_FORWARD_PIDS=()
trap cleanup EXIT

echo "# Forwarding observability services from namespace ${OBSERVABILITY_NAMESPACE}"
start_port_forward prometheus "${PROMETHEUS_PORT}" "${PROMETHEUS_TARGET}" 9090
start_port_forward loki "${LOKI_PORT}" "${LOKI_TARGET}" 80
start_port_forward tempo "${TEMPO_PORT}" "${TEMPO_TARGET}" 3200

cat <<EOF

Ports are ready:
  Prometheus  http://127.0.0.1:${PROMETHEUS_PORT}
  Loki        http://127.0.0.1:${LOKI_PORT}
  Tempo       http://127.0.0.1:${TEMPO_PORT}

Use Ctrl-C to stop port-forwarding.
EOF

wait
