#!/usr/bin/env bash
set -euo pipefail

KONG_NAMESPACE="${KONG_NAMESPACE:-${NAMESPACE:-kong}}"
KONG_LOCAL_PORT="${KONG_LOCAL_PORT:-${LOCAL_PORT:-8080}}"
KONG_REMOTE_PORT="${KONG_REMOTE_PORT:-${REMOTE_PORT:-80}}"
KONG_INGRESS_SELECTOR="${KONG_INGRESS_SELECTOR:-${INGRESS_SELECTOR:-gateway-operator.konghq.com/dataplane-service-type=ingress}}"

OBSERVABILITY_NAMESPACE="${OBSERVABILITY_NAMESPACE:-observability}"
PROMETHEUS_PORT="${PROMETHEUS_PORT:-19090}"
LOKI_PORT="${LOKI_PORT:-13100}"
TEMPO_PORT="${TEMPO_PORT:-13200}"
PROMETHEUS_TARGET="${PROMETHEUS_TARGET:-svc/prometheus-kube-prometheus-prometheus}"
LOKI_TARGET="${LOKI_TARGET:-svc/loki-gateway}"
TEMPO_TARGET="${TEMPO_TARGET:-svc/tempo}"

VAULT_NAMESPACE="${VAULT_NAMESPACE:-vault}"
VAULT_TARGET="${VAULT_TARGET:-svc/vault}"
VAULT_LOCAL_PORT="${VAULT_LOCAL_PORT:-8200}"
VAULT_TARGET_PORT="${VAULT_TARGET_PORT:-8200}"

NEON_NAMESPACE="${NEON_NAMESPACE:-neon}"
NEON_TARGET="${NEON_TARGET:-svc/main-postgres}"
NEON_LOCAL_PORT="${NEON_LOCAL_PORT:-55433}"
NEON_TARGET_PORT="${NEON_TARGET_PORT:-55433}"

RUSTFS_NAMESPACE="${RUSTFS_NAMESPACE:-rustfs}"
RUSTFS_TARGET="${RUSTFS_TARGET:-svc/rustfs-svc}"
RUSTFS_API_LOCAL_PORT="${RUSTFS_API_LOCAL_PORT:-9000}"
RUSTFS_API_TARGET_PORT="${RUSTFS_API_TARGET_PORT:-9000}"
RUSTFS_CONSOLE_LOCAL_PORT="${RUSTFS_CONSOLE_LOCAL_PORT:-9001}"
RUSTFS_CONSOLE_TARGET_PORT="${RUSTFS_CONSOLE_TARGET_PORT:-9001}"

PORT_FORWARD_PIDS=()
READY_LINES=()
READY_NOTES=()

usage() {
  cat <<EOF
Usage: $0 [all|kong|observability|vault|neon|rustfs ...]

Default: all

Environment overrides:
  Kong:          KONG_NAMESPACE, KONG_LOCAL_PORT, KONG_REMOTE_PORT, KONG_INGRESS_SELECTOR
                 Legacy NAMESPACE, LOCAL_PORT, REMOTE_PORT, INGRESS_SELECTOR are also honored.
  Observability: OBSERVABILITY_NAMESPACE, PROMETHEUS_PORT, LOKI_PORT, TEMPO_PORT,
                 PROMETHEUS_TARGET, LOKI_TARGET, TEMPO_TARGET
  Vault:         VAULT_NAMESPACE, VAULT_TARGET, VAULT_LOCAL_PORT, VAULT_TARGET_PORT
  Neon:          NEON_NAMESPACE, NEON_TARGET, NEON_LOCAL_PORT, NEON_TARGET_PORT
  RustFS:        RUSTFS_NAMESPACE, RUSTFS_TARGET,
                 RUSTFS_API_LOCAL_PORT, RUSTFS_API_TARGET_PORT,
                 RUSTFS_CONSOLE_LOCAL_PORT, RUSTFS_CONSOLE_TARGET_PORT
EOF
}

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

cleanup() {
  for pid in "${PORT_FORWARD_PIDS[@]:-}"; do
    kill "${pid}" >/dev/null 2>&1 || true
  done
}

require_namespace() {
  local name="$1"
  local namespace="$2"

  if ! kubectl get namespace "${namespace}" >/dev/null 2>&1; then
    echo "${name} namespace '${namespace}' was not found." >&2
    exit 1
  fi
}

require_target() {
  local name="$1"
  local namespace="$2"
  local target="$3"

  if ! kubectl get "${target}" --namespace "${namespace}" >/dev/null 2>&1; then
    echo "${name} target '${target}' was not found in namespace '${namespace}'." >&2
    exit 1
  fi
}

start_port_forward() {
  local name="$1"
  local namespace="$2"
  local target="$3"
  shift 3
  local log_file

  log_file="$(mktemp -t "${name}.port-forward.XXXXXX")"
  kubectl port-forward --namespace "${namespace}" "${target}" "$@" >"${log_file}" 2>&1 &
  local pid="$!"
  PORT_FORWARD_PIDS+=("${pid}")

  for _ in {1..50}; do
    if grep -q "Forwarding from" "${log_file}" >/dev/null 2>&1; then
      echo "${name}: ${namespace}/${target} [$*]"
      return
    fi

    if ! kill -0 "${pid}" >/dev/null 2>&1; then
      echo "Failed to port-forward ${namespace}/${target}. Log:" >&2
      cat "${log_file}" >&2
      exit 1
    fi

    sleep 0.1
  done

  echo "Timed out waiting for port-forward ${namespace}/${target}. Log:" >&2
  cat "${log_file}" >&2
  exit 1
}

add_ready_line() {
  READY_LINES+=("  $1")
}

add_ready_note() {
  READY_NOTES+=("$1")
}

start_kong() {
  local ingress_service

  require_namespace Kong "${KONG_NAMESPACE}"
  ingress_service="$(
    kubectl get service \
      --namespace "${KONG_NAMESPACE}" \
      --selector "${KONG_INGRESS_SELECTOR}" \
      --output 'jsonpath={.items[0].metadata.name}'
  )"

  if [[ -z "${ingress_service}" ]]; then
    echo "No Kong ingress service found in namespace ${KONG_NAMESPACE}" >&2
    echo "Selector: ${KONG_INGRESS_SELECTOR}" >&2
    exit 1
  fi

  start_port_forward kong "${KONG_NAMESPACE}" "service/${ingress_service}" "${KONG_LOCAL_PORT}:${KONG_REMOTE_PORT}"
  add_ready_line "Kong           http://127.0.0.1:${KONG_LOCAL_PORT}"
  add_ready_note "Kong example:
  curl -i http://127.0.0.1:${KONG_LOCAL_PORT}/api/functions/hello-bun-ts"
}

start_observability() {
  require_namespace Observability "${OBSERVABILITY_NAMESPACE}"
  require_target Prometheus "${OBSERVABILITY_NAMESPACE}" "${PROMETHEUS_TARGET}"
  require_target Loki "${OBSERVABILITY_NAMESPACE}" "${LOKI_TARGET}"
  require_target Tempo "${OBSERVABILITY_NAMESPACE}" "${TEMPO_TARGET}"

  start_port_forward prometheus "${OBSERVABILITY_NAMESPACE}" "${PROMETHEUS_TARGET}" "${PROMETHEUS_PORT}:9090"
  start_port_forward loki "${OBSERVABILITY_NAMESPACE}" "${LOKI_TARGET}" "${LOKI_PORT}:80"
  start_port_forward tempo "${OBSERVABILITY_NAMESPACE}" "${TEMPO_TARGET}" "${TEMPO_PORT}:3200"
  add_ready_line "Prometheus     http://127.0.0.1:${PROMETHEUS_PORT}"
  add_ready_line "Loki           http://127.0.0.1:${LOKI_PORT}"
  add_ready_line "Tempo          http://127.0.0.1:${TEMPO_PORT}"
}

start_vault() {
  require_namespace Vault "${VAULT_NAMESPACE}"
  require_target Vault "${VAULT_NAMESPACE}" "${VAULT_TARGET}"

  start_port_forward vault "${VAULT_NAMESPACE}" "${VAULT_TARGET}" "${VAULT_LOCAL_PORT}:${VAULT_TARGET_PORT}"
  add_ready_line "Vault          http://127.0.0.1:${VAULT_LOCAL_PORT}"
  add_ready_note "Vault:
  export VAULT_ADDR=http://127.0.0.1:${VAULT_LOCAL_PORT}"
}

start_neon() {
  require_namespace Neon "${NEON_NAMESPACE}"
  require_target Neon "${NEON_NAMESPACE}" "${NEON_TARGET}"

  start_port_forward neon "${NEON_NAMESPACE}" "${NEON_TARGET}" "${NEON_LOCAL_PORT}:${NEON_TARGET_PORT}"
  add_ready_line "Neon           postgres://cloud_admin@127.0.0.1:${NEON_LOCAL_PORT}/postgres?sslmode=disable"
}

start_rustfs() {
  require_namespace RustFS "${RUSTFS_NAMESPACE}"
  require_target RustFS "${RUSTFS_NAMESPACE}" "${RUSTFS_TARGET}"

  start_port_forward rustfs "${RUSTFS_NAMESPACE}" "${RUSTFS_TARGET}" \
    "${RUSTFS_API_LOCAL_PORT}:${RUSTFS_API_TARGET_PORT}" \
    "${RUSTFS_CONSOLE_LOCAL_PORT}:${RUSTFS_CONSOLE_TARGET_PORT}"
  add_ready_line "RustFS API     http://127.0.0.1:${RUSTFS_API_LOCAL_PORT}"
  add_ready_line "RustFS Console http://127.0.0.1:${RUSTFS_CONSOLE_LOCAL_PORT}"
}

print_ready() {
  printf '\nPorts are ready:\n'
  printf '%s\n' "${READY_LINES[@]}"

  if [[ "${#READY_NOTES[@]}" -gt 0 ]]; then
    printf '\n'
    printf '%s\n\n' "${READY_NOTES[@]}"
  fi

  printf 'Use Ctrl-C to stop port-forwarding.\n'
}

start_group() {
  case "$1" in
    kong)
      start_kong
      ;;
    observability)
      start_observability
      ;;
    vault)
      start_vault
      ;;
    neon)
      start_neon
      ;;
    rustfs)
      start_rustfs
      ;;
    all)
      start_kong
      start_observability
      start_vault
      start_neon
      start_rustfs
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown port-forward group: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
}

if [[ "$#" -eq 0 ]]; then
  set -- all
fi

if [[ "$1" == "-h" || "$1" == "--help" || "$1" == "help" ]]; then
  usage
  exit 0
fi

need kubectl
trap cleanup EXIT

for group in "$@"; do
  start_group "${group}"
done

print_ready
wait
