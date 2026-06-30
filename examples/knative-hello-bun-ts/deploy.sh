#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="${SCRIPT_DIR}/k8s"
SERVICE="${SERVICE:-hello-bun-ts}"
NAMESPACE="${NAMESPACE:-default}"
TIMEOUT="${TIMEOUT:-180s}"
IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-dev.local/hello-bun-ts}"
APPLY_DAPR_VAULT="${APPLY_DAPR_VAULT:-false}"

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

  NAMESPACE="${NAMESPACE}" IMAGE="${IMAGE}" envsubst < "${file}" | kubectl apply -f -
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
  --patch '{"data":{"registries-skipping-tag-resolving":"dev.local,hello-bun-ts,kind.local,ko.local,local.dev"}}'

echo "Deploying Knative Service ${NAMESPACE}/${SERVICE}"
echo "Creating namespace ${NAMESPACE}"
kubectl create namespace "${NAMESPACE}" --dry-run=client --output yaml | kubectl apply -f -

echo "Applying Dapr configuration"
apply_template "${K8S_DIR}/configuration.yaml"

if [[ "${APPLY_DAPR_VAULT}" == "true" ]]; then
  if [[ -n "${VAULT_TOKEN:-}" ]]; then
    echo "Creating Dapr Vault token secret in namespace ${NAMESPACE}"
    kubectl create secret generic vault-token \
      --namespace "${NAMESPACE}" \
      --from-literal "token=${VAULT_TOKEN}" \
      --dry-run=client \
      --output yaml | kubectl apply -f -
  elif ! kubectl get secret vault-token --namespace "${NAMESPACE}" >/dev/null 2>&1; then
    echo "VAULT_TOKEN is required when APPLY_DAPR_VAULT=true unless ${NAMESPACE}/vault-token already exists" >&2
    exit 1
  fi

  echo "Applying Dapr Vault secret store component"
  apply_template "${K8S_DIR}/vault-component.yaml"
fi

apply_template "${K8S_DIR}/service.yaml"

echo "Waiting for Knative Service ${NAMESPACE}/${SERVICE}"
kubectl wait "ksvc/${SERVICE}" \
  --namespace "${NAMESPACE}" \
  --for=condition=Ready \
  --timeout="${TIMEOUT}"

kubectl get "ksvc/${SERVICE}" --namespace "${NAMESPACE}"
