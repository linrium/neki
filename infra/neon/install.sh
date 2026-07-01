#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

NEON_OPERATOR_REPO="${NEON_OPERATOR_REPO:-https://github.com/lovablelabs/neon-operator.git}"
NEON_OPERATOR_REF="${NEON_OPERATOR_REF:-8f516af7b12c0631d9c0d49f8fe121782a3bd1c6}"
NEON_OPERATOR_SRC="${NEON_OPERATOR_SRC:-/private/tmp/neon-operator}"
NEON_OPERATOR_NAMESPACE="${NEON_OPERATOR_NAMESPACE:-neon}"
IMG_OPERATOR="${IMG_OPERATOR:-neon-operator:dev}"
IMAGE_PULL_POLICY="${IMAGE_PULL_POLICY:-IfNotPresent}"
CONTAINER_TOOL="${CONTAINER_TOOL:-docker}"
TIMEOUT="${TIMEOUT:-300s}"
BUILD_OPERATOR_IMAGE="${BUILD_OPERATOR_IMAGE:-false}"
PUSH_OPERATOR_IMAGE="${PUSH_OPERATOR_IMAGE:-false}"
APPLY_SECRETS="${APPLY_SECRETS:-false}"
APPLY_CLUSTER="${APPLY_CLUSTER:-false}"
APPLY_STORAGE_NODES="${APPLY_STORAGE_NODES:-false}"
APPLY_PROJECT="${APPLY_PROJECT:-false}"
APPLY_BRANCH="${APPLY_BRANCH:-false}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

ensure_operator_source() {
  if [[ -d "${NEON_OPERATOR_SRC}/.git" ]]; then
    echo "Updating neon-operator source at ${NEON_OPERATOR_SRC}"
    git -C "${NEON_OPERATOR_SRC}" fetch --depth 1 origin "${NEON_OPERATOR_REF}"
    git -C "${NEON_OPERATOR_SRC}" checkout --detach FETCH_HEAD
  else
    echo "Cloning neon-operator ${NEON_OPERATOR_REF} into ${NEON_OPERATOR_SRC}"
    git clone --depth 1 "${NEON_OPERATOR_REPO}" "${NEON_OPERATOR_SRC}"
    git -C "${NEON_OPERATOR_SRC}" fetch --depth 1 origin "${NEON_OPERATOR_REF}"
    git -C "${NEON_OPERATOR_SRC}" checkout --detach FETCH_HEAD
  fi
}

rollout_if_present() {
  local namespace="$1"
  local kind="$2"
  local name="$3"

  if kubectl get "${kind}/${name}" --namespace "${namespace}" >/dev/null 2>&1; then
    kubectl rollout status "${kind}/${name}" \
      --namespace "${namespace}" \
      --timeout "${TIMEOUT}"
  fi
}

need git
need kubectl

if [[ "${BUILD_OPERATOR_IMAGE}" == "true" || "${PUSH_OPERATOR_IMAGE}" == "true" ]]; then
  need "${CONTAINER_TOOL}"
fi

ensure_operator_source

if [[ "${BUILD_OPERATOR_IMAGE}" == "true" ]]; then
  echo "Building neon-operator image ${IMG_OPERATOR}"
  "${CONTAINER_TOOL}" build \
    --tag "${IMG_OPERATOR}" \
    --file "${NEON_OPERATOR_SRC}/Dockerfile.operator" \
    "${NEON_OPERATOR_SRC}"
fi

if [[ "${PUSH_OPERATOR_IMAGE}" == "true" ]]; then
  echo "Pushing neon-operator image ${IMG_OPERATOR}"
  "${CONTAINER_TOOL}" push "${IMG_OPERATOR}"
fi

echo "Creating namespace ${NEON_OPERATOR_NAMESPACE}"
kubectl create namespace "${NEON_OPERATOR_NAMESPACE}" --dry-run=client --output yaml | kubectl apply -f -

echo "Installing neon-operator CRDs and controller with image ${IMG_OPERATOR}"
OVERLAY_DIR="${NEON_OPERATOR_SRC}/.neki-deploy"
mkdir -p "${OVERLAY_DIR}"
cat >"${OVERLAY_DIR}/kustomization.yaml" <<EOF
resources:
  - ../config/default
patches:
  - path: manager-image-patch.yaml
    target:
      kind: Deployment
      name: controller-manager
EOF
cat >"${OVERLAY_DIR}/manager-image-patch.yaml" <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: controller-manager
spec:
  template:
    spec:
      containers:
        - name: manager
          image: ${IMG_OPERATOR}
          imagePullPolicy: ${IMAGE_PULL_POLICY}
EOF
kubectl kustomize "${OVERLAY_DIR}" | kubectl apply -f -

echo "Waiting for neon-operator controller"
rollout_if_present "${NEON_OPERATOR_NAMESPACE}" deployment neon-controller-manager

if [[ "${APPLY_SECRETS}" == "true" ]]; then
  echo "Applying Neon secret templates to namespace ${NEON_OPERATOR_NAMESPACE}"
  kubectl apply --namespace "${NEON_OPERATOR_NAMESPACE}" -f "${SCRIPT_DIR}/secrets.example.yaml"
fi

if [[ "${APPLY_CLUSTER}" == "true" ]]; then
  echo "Applying Neon Cluster sample to namespace ${NEON_OPERATOR_NAMESPACE}"
  kubectl apply --namespace "${NEON_OPERATOR_NAMESPACE}" -f "${SCRIPT_DIR}/cluster.yaml"
fi

if [[ "${APPLY_STORAGE_NODES}" == "true" ]]; then
  echo "Applying Neon Pageserver and Safekeeper samples to namespace ${NEON_OPERATOR_NAMESPACE}"
  kubectl apply --namespace "${NEON_OPERATOR_NAMESPACE}" -f "${SCRIPT_DIR}/pageserver.yaml"
  kubectl apply --namespace "${NEON_OPERATOR_NAMESPACE}" -f "${SCRIPT_DIR}/safekeepers.yaml"
fi

if [[ "${APPLY_PROJECT}" == "true" ]]; then
  echo "Applying Neon Project sample to namespace ${NEON_OPERATOR_NAMESPACE}"
  kubectl apply --namespace "${NEON_OPERATOR_NAMESPACE}" -f "${SCRIPT_DIR}/project.yaml"
fi

if [[ "${APPLY_BRANCH}" == "true" ]]; then
  echo "Applying Neon Branch sample to namespace ${NEON_OPERATOR_NAMESPACE}"
  kubectl apply --namespace "${NEON_OPERATOR_NAMESPACE}" -f "${SCRIPT_DIR}/branch.yaml"
fi

echo "Neon operator pods"
kubectl get pods --namespace "${NEON_OPERATOR_NAMESPACE}"

echo "Neon operator install complete"
