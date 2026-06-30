#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${NAMESPACE:-kong}"
GATEWAY_CONFIGURATION="${GATEWAY_CONFIGURATION:-kong-configuration}"
GATEWAY="${GATEWAY:-kong}"
TIMEOUT="${TIMEOUT:-180s}"
INGRESS_SELECTOR="${INGRESS_SELECTOR:-gateway-operator.konghq.com/dataplane-service-type=ingress}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

timeout_seconds() {
  local value="$1"

  if [[ "${value}" =~ ^[0-9]+s$ ]]; then
    echo "${value%s}"
    return
  fi

  if [[ "${value}" =~ ^[0-9]+$ ]]; then
    echo "${value}"
    return
  fi

  echo "TIMEOUT must be a number of seconds, for example 180s" >&2
  exit 1
}

ingress_service_name() {
  kubectl get service \
    --namespace "${NAMESPACE}" \
    --selector "${INGRESS_SELECTOR}" \
    --output 'jsonpath={.items[0].metadata.name}'
}

ingress_service_type() {
  local service="$1"

  kubectl get service "${service}" \
    --namespace "${NAMESPACE}" \
    --output 'jsonpath={.spec.type}'
}

ingress_service_address() {
  local service="$1"

  kubectl get service "${service}" \
    --namespace "${NAMESPACE}" \
    --output 'jsonpath={.status.loadBalancer.ingress[0].hostname}{.status.loadBalancer.ingress[0].ip}'
}

ingress_service_http_port() {
  local service="$1"
  local port

  port="$(
    kubectl get service "${service}" \
      --namespace "${NAMESPACE}" \
      --output 'jsonpath={.spec.ports[?(@.name=="http")].port}'
  )"

  if [[ -z "${port}" ]]; then
    port="$(
      kubectl get service "${service}" \
        --namespace "${NAMESPACE}" \
        --output 'jsonpath={.spec.ports[0].port}'
    )"
  fi

  echo "${port}"
}

wait_for_ingress_service() {
  local deadline
  local service

  deadline=$((SECONDS + $(timeout_seconds "${TIMEOUT}")))

  echo "Waiting for Kong ingress service" >&2
  while (( SECONDS < deadline )); do
    service="$(ingress_service_name)"
    if [[ -n "${service}" ]]; then
      echo "${service}"
      return
    fi

    sleep 2
  done

  echo "Timed out waiting for Kong ingress service" >&2
  kubectl get service --namespace "${NAMESPACE}" --selector "${INGRESS_SELECTOR}" >&2 || true
  exit 1
}

wait_for_load_balancer() {
  local service="$1"
  local deadline
  local address

  deadline=$((SECONDS + $(timeout_seconds "${TIMEOUT}")))

  echo "Waiting for ${service} to become LoadBalancer with a local address" >&2
  while (( SECONDS < deadline )); do
    if [[ "$(ingress_service_type "${service}")" == "LoadBalancer" ]]; then
      address="$(ingress_service_address "${service}")"
      if [[ -n "${address}" ]]; then
        echo "${address}"
        return
      fi
    fi

    sleep 2
  done

  echo "Timed out waiting for ${service} to become a ready LoadBalancer" >&2
  kubectl get service "${service}" --namespace "${NAMESPACE}" >&2 || true
  exit 1
}

need kubectl

if ! kubectl get gatewayconfiguration.gateway-operator.konghq.com "${GATEWAY_CONFIGURATION}" --namespace "${NAMESPACE}" >/dev/null 2>&1; then
  echo "Kong GatewayConfiguration ${NAMESPACE}/${GATEWAY_CONFIGURATION} was not found." >&2
  echo "Run ./infra/kong/install.sh first." >&2
  exit 1
fi

echo "Configuring Kong ingress service as LoadBalancer"
kubectl patch gatewayconfiguration.gateway-operator.konghq.com "${GATEWAY_CONFIGURATION}" \
  --namespace "${NAMESPACE}" \
  --type merge \
  --patch '{"spec":{"dataPlaneOptions":{"network":{"services":{"ingress":{"type":"LoadBalancer"}}}}}}'

INGRESS_SERVICE="$(wait_for_ingress_service)"
LOCAL_ADDRESS="$(wait_for_load_balancer "${INGRESS_SERVICE}")"
HTTP_PORT="$(ingress_service_http_port "${INGRESS_SERVICE}")"

kubectl wait gateway/"${GATEWAY}" \
  --namespace "${NAMESPACE}" \
  --for=condition=Programmed=True \
  --timeout "${TIMEOUT}" >/dev/null || true

if [[ "${HTTP_PORT}" == "80" ]]; then
  LOCAL_URL="http://localhost"
else
  LOCAL_URL="http://localhost:${HTTP_PORT}"
fi

echo "Kong ingress service ${NAMESPACE}/${INGRESS_SERVICE} is exposed at ${LOCAL_ADDRESS}."
echo "Use: ${LOCAL_URL}"
