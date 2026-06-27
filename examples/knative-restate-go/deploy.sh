#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="${IMAGE:-dev.local/knative-restate-go:latest}"
SERVICE="${SERVICE:-knative-restate-go}"
NAMESPACE="${NAMESPACE:-default}"
RESTATE_NAMESPACE="${RESTATE_NAMESPACE:-restate-test}"
RESTATE_SERVICE="${RESTATE_SERVICE:-restate}"
TIMEOUT="${TIMEOUT:-180s}"
ADMIN_PORT="${ADMIN_PORT:-19070}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need curl
need docker
need envsubst
need kubectl

cleanup() {
  if [[ -n "${PORT_FORWARD_PID:-}" ]]; then
    kill "${PORT_FORWARD_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "Building ${IMAGE}"
if docker buildx version >/dev/null 2>&1; then
  docker buildx build --load -t "${IMAGE}" "${SCRIPT_DIR}"
else
  docker build -t "${IMAGE}" "${SCRIPT_DIR}"
fi

echo "Verifying local image ${IMAGE}"
docker image inspect "${IMAGE}" >/dev/null

echo "Configuring Knative to skip tag-to-digest resolution for local image registries"
kubectl patch configmap config-deployment \
  --namespace knative-serving \
  --type merge \
  --patch '{"data":{"registries-skipping-tag-resolving":"dev.local,hello-bun-ts,knative-restate-go,kind.local,ko.local,local.dev"}}'

echo "Deploying Knative Service ${NAMESPACE}/${SERVICE}"
IMAGE="${IMAGE}" envsubst < "${SCRIPT_DIR}/service.yaml" | kubectl apply -f -

echo "Waiting for Knative Service ${NAMESPACE}/${SERVICE}"
kubectl wait "ksvc/${SERVICE}" \
  --namespace "${NAMESPACE}" \
  --for=condition=Ready \
  --timeout="${TIMEOUT}"

SERVICE_URI="http://${SERVICE}.${NAMESPACE}.svc.cluster.local"

if [[ "${RESTATE_NAMESPACE}" == "restate-test" ]]; then
  echo "Allowing Restate to reach Knative service and activator pods"
  kubectl apply -f "${SCRIPT_DIR}/restate-egress.yaml"
fi

echo "Port-forwarding Restate Admin API to localhost:${ADMIN_PORT}"
kubectl port-forward \
  --namespace "${RESTATE_NAMESPACE}" \
  "svc/${RESTATE_SERVICE}" \
  "${ADMIN_PORT}:9070" >/tmp/knative-restate-go-port-forward.log 2>&1 &
PORT_FORWARD_PID="$!"

ADMIN_READY=false
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${ADMIN_PORT}/health" >/dev/null 2>&1; then
    ADMIN_READY=true
    break
  fi
  sleep 1
done

if [[ "${ADMIN_READY}" != "true" ]]; then
  echo "Restate Admin API did not become reachable on localhost:${ADMIN_PORT}" >&2
  cat /tmp/knative-restate-go-port-forward.log >&2 || true
  exit 1
fi

echo "Registering ${SERVICE_URI} with Restate"
curl -fsS "http://127.0.0.1:${ADMIN_PORT}/deployments" \
  -H "content-type: application/json" \
  --data "{\"uri\":\"${SERVICE_URI}\",\"force\":true}" >/dev/null

echo "Registered services:"
curl -fsS "http://127.0.0.1:${ADMIN_PORT}/services" | sed 's/,/,\n/g'

kubectl get "ksvc/${SERVICE}" --namespace "${NAMESPACE}"
