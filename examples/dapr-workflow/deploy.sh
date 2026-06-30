#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SERVICE="${SERVICE:-dapr-workflow}"
NAMESPACE="${NAMESPACE:-default}"
TIMEOUT="${TIMEOUT:-180s}"
IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-dev.local/dapr-workflow}"
IMAGE_PULL_POLICY="${IMAGE_PULL_POLICY:-Always}"
REDIS_HOST="${REDIS_HOST:-redis.${NAMESPACE}.svc.cluster.local:6379}"
REDIS_PASSWORD="${REDIS_PASSWORD:-}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

random_tag() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  else
    printf '%s-%s%s\n' "$(date +%s)" "${RANDOM}" "${RANDOM}"
  fi
}

apply_template() {
  local file="$1"

  NAMESPACE="${NAMESPACE}" \
    IMAGE="${IMAGE}" \
    IMAGE_PULL_POLICY="${IMAGE_PULL_POLICY}" \
    REDIS_HOST="${REDIS_HOST}" \
    REDIS_PASSWORD="${REDIS_PASSWORD}" \
    envsubst < "${file}" | kubectl apply -f -
}

IMAGE_TAG="${IMAGE_TAG:-$(random_tag)}"
IMAGE="${IMAGE:-${IMAGE_REPOSITORY}:${IMAGE_TAG}}"

need docker
need kubectl
need envsubst

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
  --patch '{"data":{"registries-skipping-tag-resolving":"dev.local,dapr-workflow,kind.local,ko.local,local.dev"}}'

echo "Creating namespace ${NAMESPACE}"
kubectl create namespace "${NAMESPACE}" --dry-run=client --output yaml | kubectl apply -f -

echo "Using existing Redis at ${REDIS_HOST}"
echo "Deploying Dapr workflow resources"
apply_template "${SCRIPT_DIR}/k8s/configuration.yaml"
apply_template "${SCRIPT_DIR}/k8s/statestore.yaml"
apply_template "${SCRIPT_DIR}/k8s/pubsub-component.yaml"

echo "Deploying Knative Service ${NAMESPACE}/${SERVICE}"
apply_template "${SCRIPT_DIR}/service.yaml"

echo "Waiting for Knative Service ${NAMESPACE}/${SERVICE}"
kubectl wait "ksvc/${SERVICE}" \
  --namespace "${NAMESPACE}" \
  --for=condition=Ready \
  --timeout="${TIMEOUT}"

kubectl get "ksvc/${SERVICE}" --namespace "${NAMESPACE}"
