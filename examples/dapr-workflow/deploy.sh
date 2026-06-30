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
KAFKA_BROKERS="${KAFKA_BROKERS:-redpanda-0.redpanda.redpanda.svc.cluster.local:9093}"
KAFKA_CONSUMER_GROUP="${KAFKA_CONSUMER_GROUP:-dapr-workflow}"
KAFKA_AUTH_TYPE="${KAFKA_AUTH_TYPE:-certificate}"
KAFKA_DISABLE_TLS="${KAFKA_DISABLE_TLS:-false}"
KAFKA_SKIP_VERIFY="${KAFKA_SKIP_VERIFY:-false}"
KAFKA_VERSION="${KAFKA_VERSION:-2.0.0}"
SYNC_KAFKA_CA_SECRET="${SYNC_KAFKA_CA_SECRET:-true}"
KAFKA_CA_SECRET_NAMESPACE="${KAFKA_CA_SECRET_NAMESPACE:-redpanda}"
KAFKA_CA_SECRET_NAME="${KAFKA_CA_SECRET_NAME:-redpanda-default-root-certificate}"
KAFKA_CA_SECRET_KEY="${KAFKA_CA_SECRET_KEY:-ca.crt}"
KAFKA_LOCAL_CA_SECRET_NAME="${KAFKA_LOCAL_CA_SECRET_NAME:-redpanda-default-root-certificate}"

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
    KAFKA_BROKERS="${KAFKA_BROKERS}" \
    KAFKA_CONSUMER_GROUP="${KAFKA_CONSUMER_GROUP}" \
    KAFKA_AUTH_TYPE="${KAFKA_AUTH_TYPE}" \
    KAFKA_DISABLE_TLS="${KAFKA_DISABLE_TLS}" \
    KAFKA_SKIP_VERIFY="${KAFKA_SKIP_VERIFY}" \
    KAFKA_VERSION="${KAFKA_VERSION}" \
    KAFKA_LOCAL_CA_SECRET_NAME="${KAFKA_LOCAL_CA_SECRET_NAME}" \
    KAFKA_CA_SECRET_KEY="${KAFKA_CA_SECRET_KEY}" \
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
echo "Using existing Kafka/Redpanda brokers at ${KAFKA_BROKERS}"

if [[ "${SYNC_KAFKA_CA_SECRET}" == "true" ]]; then
  echo "Copying Kafka CA secret ${KAFKA_CA_SECRET_NAMESPACE}/${KAFKA_CA_SECRET_NAME} to ${NAMESPACE}/${KAFKA_LOCAL_CA_SECRET_NAME}"
  kubectl get secret "${KAFKA_CA_SECRET_NAME}" \
    --namespace "${KAFKA_CA_SECRET_NAMESPACE}" \
    --output "jsonpath={.data.${KAFKA_CA_SECRET_KEY//./\\.}}" |
    base64 --decode |
    kubectl create secret generic "${KAFKA_LOCAL_CA_SECRET_NAME}" \
      --namespace "${NAMESPACE}" \
      --from-file="${KAFKA_CA_SECRET_KEY}=/dev/stdin" \
      --dry-run=client \
      --output yaml |
    kubectl apply -f -
fi

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
