#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
GATEWAY_API_VERSION="${GATEWAY_API_VERSION:-v1.5.1}"
KONG_OPERATOR_CHART_VERSION="${KONG_OPERATOR_CHART_VERSION:-1.3.0}"
KONG_OPERATOR_IMAGE_TAG="${KONG_OPERATOR_IMAGE_TAG:-2.2.0}"
TIMEOUT="${TIMEOUT:-180s}"
INSTALL_ECHO="${INSTALL_ECHO:-true}"
ECHO_SERVICE_URL="${ECHO_SERVICE_URL:-https://developer.konghq.com/manifests/kic/echo-service.yaml}"
REQUIRE_GATEWAY_PROGRAMMED="${REQUIRE_GATEWAY_PROGRAMMED:-false}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

gateway_condition_status() {
  local condition="$1"

  kubectl get gateway/kong \
    --namespace kong \
    --output "jsonpath={.status.conditions[?(@.type=='${condition}')].status}"
}

gateway_address() {
  kubectl get gateway/kong \
    --namespace kong \
    --output 'jsonpath={.status.addresses[0].value}'
}

ingress_service_name() {
  kubectl get service \
    --namespace kong \
    --selector gateway-operator.konghq.com/dataplane-service-type=ingress \
    --output 'jsonpath={.items[0].metadata.name}'
}

ingress_service_type() {
  kubectl get service \
    --namespace kong \
    --selector gateway-operator.konghq.com/dataplane-service-type=ingress \
    --output 'jsonpath={.items[0].spec.type}'
}

ingress_service_node_port() {
  kubectl get service \
    --namespace kong \
    --selector gateway-operator.konghq.com/dataplane-service-type=ingress \
    --output 'jsonpath={.items[0].spec.ports[?(@.name=="http")].nodePort}'
}

wait_for_resource_by_selector() {
  local resource="$1"
  local selector="$2"
  local description="$3"
  local deadline

  deadline=$((SECONDS + ${TIMEOUT%s}))

  echo "Waiting for ${description} to be created"
  while (( SECONDS < deadline )); do
    if [[ -n "$(kubectl get "${resource}" --namespace kong --selector "${selector}" --output 'jsonpath={.items[0].metadata.name}')" ]]; then
      return
    fi

    sleep 2
  done

  echo "Timed out waiting for ${description} to be created" >&2
  kubectl get "${resource}" --namespace kong --selector "${selector}" >&2 || true
  exit 1
}

wait_for_gateway_ready() {
  kubectl wait gateway/kong \
    --namespace kong \
    --for=condition=Accepted=True \
    --timeout "${TIMEOUT}"

  wait_for_resource_by_selector \
    deployment \
    gateway-operator.konghq.com/managed-by=dataplane \
    "Kong DataPlane deployment"

  kubectl wait deployment \
    --namespace kong \
    --selector gateway-operator.konghq.com/managed-by=dataplane \
    --for=condition=Available=True \
    --timeout "${TIMEOUT}"

  wait_for_resource_by_selector \
    service \
    gateway-operator.konghq.com/dataplane-service-type=ingress \
    "Kong ingress service"

  if [[ "$(gateway_condition_status Programmed)" == "True" ]]; then
    return
  fi

  if [[ "${REQUIRE_GATEWAY_PROGRAMMED}" == "true" ]]; then
    kubectl wait gateway/kong \
      --namespace kong \
      --for=condition=Programmed=True \
      --timeout "${TIMEOUT}"
    return
  fi

  echo "Gateway accepted and DataPlane is available, but Gateway is not Programmed=True yet."
  echo "This usually means the LoadBalancer service is still waiting for an external address."
  kubectl get service \
    --namespace kong \
    --selector gateway-operator.konghq.com/dataplane-service-type=ingress
}

need helm
need kubectl

echo "Installing Gateway API CRDs ${GATEWAY_API_VERSION}"
kubectl apply \
  --server-side \
  -f "https://github.com/kubernetes-sigs/gateway-api/releases/download/${GATEWAY_API_VERSION}/standard-install.yaml"

echo "Installing Kong Operator ${KONG_OPERATOR_IMAGE_TAG}"
helm repo add kong https://charts.konghq.com
helm repo update
helm upgrade --install kong-operator kong/kong-operator \
  --version "${KONG_OPERATOR_CHART_VERSION}" \
  --namespace kong-system \
  --create-namespace \
  --set "image.tag=${KONG_OPERATOR_IMAGE_TAG}" \
  --set "gwapi-standard-crds.enabled=false" \
  --set "gwapi-experimental-crds.enabled=false"

echo "Waiting for Kong Operator"
kubectl wait \
  --namespace kong-system \
  --for=condition=Available=true \
  --timeout "${TIMEOUT}" \
  deployment/kong-operator-kong-operator-controller-manager

echo "Provisioning Kong Gateway"
kubectl apply -f "${SCRIPT_DIR}/gateway.yaml"
wait_for_gateway_ready

if [[ "${INSTALL_ECHO}" == "true" ]]; then
  echo "Installing echo backend"
  kubectl apply -f "${ECHO_SERVICE_URL}" --namespace kong

  echo "Installing echo HTTPRoute"
  kubectl apply -f "${SCRIPT_DIR}/echo-route.yaml"
fi

echo "Kong Gateway status"
kubectl get gateway kong --namespace kong
kubectl get service \
  --namespace kong \
  --selector gateway-operator.konghq.com/dataplane-service-type=ingress

INGRESS_SERVICE="$(ingress_service_name)"
INGRESS_SERVICE_TYPE="$(ingress_service_type)"

if [[ "${INGRESS_SERVICE_TYPE}" == "NodePort" ]]; then
  echo "Gateway ingress is exposed as NodePort $(ingress_service_node_port)."
  echo "For local testing, use port-forwarding:"
  echo "kubectl port-forward --namespace kong service/${INGRESS_SERVICE} 8080:80"
  echo "Then test with: curl -i http://localhost:8080/echo"
elif [[ -z "$(gateway_address)" ]]; then
  echo "Gateway has no external address yet. For local clusters, use port-forwarding:"
  echo "kubectl port-forward --namespace kong service/${INGRESS_SERVICE} 8080:80"
  echo "Then test with: curl -i http://localhost:8080/echo"
fi

echo "Kong install complete"
