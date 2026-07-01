#!/usr/bin/env bash
#
# Install the full Neki worker runtime stack on Kubernetes.
#
# This script orchestrates the entire deployment:
#   1. RustFS (S3-compatible object storage for worker bundles)
#   2. RustFS credentials secret for worker-node pods
#   3. neki-worker-node Deployment + Service (supervisor + workerd)
#   4. neki-worker-router Deployment + Service (routing gateway)
#   5. Kong HTTPRoute (/workers -> routing gateway)
#
# Usage:
#   ./scripts/install-worker-runtime.sh
#
# Override defaults with environment variables. See configuration knobs below.
#
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

# ---------------------------------------------------------------------------
# Configuration knobs
# ---------------------------------------------------------------------------

# General
NAMESPACE="${NAMESPACE:-neki}"
TIMEOUT="${TIMEOUT:-300s}"
SKIP_RUSTFS="${SKIP_RUSTFS:-false}"
SKIP_KONG_ROUTE="${SKIP_KONG_ROUTE:-false}"
IMAGE_PULL_POLICY="${IMAGE_PULL_POLICY:-Never}"

# RustFS
RUSTFS_NAMESPACE="${RUSTFS_NAMESPACE:-rustfs}"
RUSTFS_ACCESS_KEY="${RUSTFS_ACCESS_KEY:-neki-rustfs}"
RUSTFS_SECRET_KEY="${RUSTFS_SECRET_KEY:-neki-rustfs-secret}"
RUSTFS_REGION="${RUSTFS_REGION:-us-east-1}"
RUSTFS_WORKERS_BUCKET="${RUSTFS_WORKERS_BUCKET:-workers}"
RUSTFS_ENDPOINT="${RUSTFS_ENDPOINT:-http://rustfs-svc.${RUSTFS_NAMESPACE}.svc.cluster.local:9000}"

# Worker-node
WORKER_NODE_NAME="${WORKER_NODE_NAME:-neki-worker-node}"
NODE_IMAGE="${NODE_IMAGE:-neki/worker-node:latest}"
POOL_ID="${POOL_ID:-public-small}"
NODE_REPLICAS="${NODE_REPLICAS:-3}"
RECONCILE_INTERVAL_SECS="${RECONCILE_INTERVAL_SECS:-10}"
COMPATIBILITY_DATE="${COMPATIBILITY_DATE:-2025-06-01}"
RUSTFS_SECRET="${RUSTFS_SECRET:-neki-rustfs-credentials}"
WORKER_ID="${WORKER_ID:-hello}"
WORKER_VERSION="${WORKER_VERSION:-$(date +%Y-%m-%d).1}"
WORKER_FILE="${WORKER_FILE:-${REPO_ROOT}/examples/workerd-hello/worker.js}"

# Worker-router
WORKER_ROUTER_NAME="${WORKER_ROUTER_NAME:-neki-worker-router}"
ROUTER_IMAGE="${ROUTER_IMAGE:-neki/worker-router:latest}"
ROUTER_REPLICAS="${ROUTER_REPLICAS:-2}"
REFRESH_SECS="${REFRESH_SECS:-5}"

# Kong
KONG_NAMESPACE="${KONG_NAMESPACE:-kong}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: Missing required command: $1" >&2
    exit 1
  fi
}

log()  { echo "--- $*"; }
ok()   { echo "OK:   $*"; }
fail() { echo "FAIL: $*" >&2; }

apply_rustfs_secret() {
  log "Applying RustFS credentials secret ${NAMESPACE}/${RUSTFS_SECRET}"

  export NAMESPACE
  export RUSTFS_ACCESS_KEY
  export RUSTFS_SECRET_KEY

  NAME="${RUSTFS_SECRET}" \
  NAMESPACE="${NAMESPACE}" \
  RUSTFS_ACCESS_KEY="${RUSTFS_ACCESS_KEY}" \
  RUSTFS_SECRET_KEY="${RUSTFS_SECRET_KEY}" \
  envsubst '${NAMESPACE} ${NAME} ${RUSTFS_ACCESS_KEY} ${RUSTFS_SECRET_KEY}' \
    < "${REPO_ROOT}/infra/worker-node/rustfs-secret.yaml" \
    | kubectl apply -f -
}

apply_kong_route() {
  log "Applying Kong HTTPRoute /workers -> ${WORKER_ROUTER_NAME}"

  # The HTTPRoute references the Service by name in the gateway namespace.
  # If the gateway lives in a different namespace than the Service, a
  # ReferenceGrant would be needed. For now we assume Kong and the gateway
  # Service can reach each other.
  kubectl apply -f "${REPO_ROOT}/infra/kong/neki-worker-route.yaml"
}

# Load a Docker image into the Kubernetes cluster's containerd image store.
# Supports Docker Desktop (docker-desktop node), kind, and minikube.
load_image_into_cluster() {
  local image="$1"

  # Docker Desktop: the node is named "docker-desktop" or "desktop-control-plane"
  local node_name
  node_name=$(kubectl get nodes --output jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

  if docker exec "${node_name}" true >/dev/null 2>&1; then
    log "Loading ${image} into Docker Desktop VM (${node_name})"
    docker save "${image}" | docker exec -i "${node_name}" \
      ctr --namespace=k8s.io image import - 2>/dev/null
    ok "Loaded ${image} into ${node_name}"
  elif command -v kind >/dev/null 2>&1; then
    log "Loading ${image} into kind cluster"
    kind load docker-image "${image}"
    ok "Loaded ${image} into kind"
  elif command -v minikube >/dev/null 2>&1; then
    log "Loading ${image} into minikube"
    minikube image load "${image}"
    ok "Loaded ${image} into minikube"
  else
    log "Could not auto-load ${image} into cluster (no docker exec, kind, or minikube found)"
    log "If using a remote registry, set SKIP_BUILD=true and push manually"
  fi
}

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------

need kubectl
need envsubst

log "Checking cluster connectivity"
if ! kubectl cluster-info >/dev/null 2>&1; then
  fail "Cannot connect to Kubernetes cluster"
  exit 1
fi
ok "Connected to cluster"

# ---------------------------------------------------------------------------
# Step 0: Build Docker images for local cluster
# ---------------------------------------------------------------------------

if [[ "${SKIP_BUILD}" != "true" ]]; then
  need docker

  log "Building Docker image ${NODE_IMAGE}"
  docker buildx build --output type=docker -t "${NODE_IMAGE}" \
    "${REPO_ROOT}/packages/neki-worker-node"
  ok "Built ${NODE_IMAGE}"

  log "Building Docker image ${ROUTER_IMAGE}"
  docker buildx build --output type=docker -t "${ROUTER_IMAGE}" \
    "${REPO_ROOT}/packages/neki-worker-router"
  ok "Built ${ROUTER_IMAGE}"

  # Load images into the Kubernetes cluster's containerd image store.
  # Docker Desktop on macOS/Windows runs Kubernetes inside a Linux VM with its
  # own containerd namespace ("k8s.io"). Images built by Docker are not
  # automatically visible to Kubernetes pods.
  load_image_into_cluster "${NODE_IMAGE}"
  load_image_into_cluster "${ROUTER_IMAGE}"
else
  log "SKIP_BUILD=true, skipping Docker image builds"
fi

# ---------------------------------------------------------------------------
# Step 1: RustFS
# ---------------------------------------------------------------------------

if [[ "${SKIP_RUSTFS}" == "true" ]]; then
  log "SKIP_RUSTFS=true, skipping RustFS installation"
else
  if kubectl get namespace "${RUSTFS_NAMESPACE}" >/dev/null 2>&1 && \
     kubectl get pods --namespace "${RUSTFS_NAMESPACE}" \
       --selector "app.kubernetes.io/instance=rustfs" \
       --output jsonpath='{.items[*].metadata.name}' 2>/dev/null | grep -q .; then
    ok "RustFS already installed in ${RUSTFS_NAMESPACE}"
  else
    log "Installing RustFS"
    RUSTFS_ACCESS_KEY="${RUSTFS_ACCESS_KEY}" \
    RUSTFS_SECRET_KEY="${RUSTFS_SECRET_KEY}" \
    RUSTFS_WORKERS_BUCKET="${RUSTFS_WORKERS_BUCKET}" \
      bash "${REPO_ROOT}/infra/rustfs/install.sh"
    ok "RustFS installed"
  fi
fi

# ---------------------------------------------------------------------------
# Step 2: RustFS credentials secret
# ---------------------------------------------------------------------------

log "Creating namespace ${NAMESPACE}"
kubectl create namespace "${NAMESPACE}" --dry-run=client --output yaml | kubectl apply -f -

apply_rustfs_secret
ok "RustFS credentials secret applied"

# ---------------------------------------------------------------------------
# Step 2b: Upload hello worker bundle to RustFS
# ---------------------------------------------------------------------------

WORKER_SCRIPT_URL=""
WORKER_SHA256=""

if [[ "${SKIP_WORKER_UPLOAD}" != "true" ]]; then
  need cargo

  log "Port-forwarding RustFS for upload"
  kubectl port-forward --namespace "${RUSTFS_NAMESPACE}" svc/rustfs-svc 19000:9000 >/dev/null 2>&1 &
  local_pf_pid=$!
  sleep 3

  if ! nc -z 127.0.0.1 19000 2>/dev/null; then
    fail "RustFS port-forward did not come up, skipping worker upload"
    kill "${local_pf_pid}" 2>/dev/null || true
  else
    log "Uploading ${WORKER_FILE} to RustFS as worker_id=${WORKER_ID} version=${WORKER_VERSION}"

    UPLOAD_OUTPUT=$(cd "${REPO_ROOT}/packages/neki-controlplane" && cargo run --quiet -- rustfs upload-worker \
      --file "${WORKER_FILE}" \
      --worker-id "${WORKER_ID}" \
      --version "${WORKER_VERSION}" \
      --endpoint "http://localhost:19000" \
      --access-key "${RUSTFS_ACCESS_KEY}" \
      --secret-key "${RUSTFS_SECRET_KEY}" 2>/dev/null)

    WORKER_SHA256=$(echo "${UPLOAD_OUTPUT}" | grep -o '"sha256": *"[^"]*"' | head -1 | sed 's/.*"sha256": *"//;s/"$//')
    WORKER_SCRIPT_URL=$(echo "${UPLOAD_OUTPUT}" | grep -o '"script_url": *"[^"]*"' | head -1 | sed 's/.*"script_url": *"//;s/"$//')

    if [[ -n "${WORKER_SHA256}" ]]; then
      ok "Worker uploaded: ${WORKER_SCRIPT_URL} (sha256=${WORKER_SHA256:0:16}...)"
    else
      fail "Worker upload failed, deployment will use empty assignment"
    fi

    kill "${local_pf_pid}" 2>/dev/null || true
  fi
fi

# ---------------------------------------------------------------------------
# Step 3: neki-worker-node
# ---------------------------------------------------------------------------

log "Installing neki-worker-node"

NAMESPACE="${NAMESPACE}" \
NAME="${WORKER_NODE_NAME}" \
POOL_ID="${POOL_ID}" \
NODE_IMAGE="${NODE_IMAGE}" \
IMAGE_PULL_POLICY="${IMAGE_PULL_POLICY}" \
REPLICAS="${NODE_REPLICAS}" \
RECONCILE_INTERVAL_SECS="${RECONCILE_INTERVAL_SECS}" \
COMPATIBILITY_DATE="${COMPATIBILITY_DATE}" \
RUSTFS_ENDPOINT="${RUSTFS_ENDPOINT}" \
RUSTFS_SECRET="${RUSTFS_SECRET}" \
RUSTFS_REGION="${RUSTFS_REGION}" \
RUSTFS_WORKERS_BUCKET="${RUSTFS_WORKERS_BUCKET}" \
WORKER_ID="${WORKER_ID}" \
WORKER_VERSION="${WORKER_VERSION}" \
WORKER_SCRIPT_URL="${WORKER_SCRIPT_URL}" \
WORKER_SHA256="${WORKER_SHA256}" \
TIMEOUT="${TIMEOUT}" \
  bash "${REPO_ROOT}/infra/worker-node/install.sh"

ok "neki-worker-node installed"

# ---------------------------------------------------------------------------
# Step 4: neki-worker-router
# ---------------------------------------------------------------------------

log "Installing neki-worker-router"

NAMESPACE="${NAMESPACE}" \
NAME="${WORKER_ROUTER_NAME}" \
ROUTER_IMAGE="${ROUTER_IMAGE}" \
IMAGE_PULL_POLICY="${IMAGE_PULL_POLICY}" \
REPLICAS="${ROUTER_REPLICAS}" \
REFRESH_SECS="${REFRESH_SECS}" \
TIMEOUT="${TIMEOUT}" \
  bash "${REPO_ROOT}/infra/worker-router/install.sh"

ok "neki-worker-router installed"

# ---------------------------------------------------------------------------
# Step 5: Kong HTTPRoute
# ---------------------------------------------------------------------------

if [[ "${SKIP_KONG_ROUTE}" == "true" ]]; then
  log "SKIP_KONG_ROUTE=true, skipping Kong HTTPRoute"
else
  if kubectl get namespace "${KONG_NAMESPACE}" >/dev/null 2>&1; then
    apply_kong_route
    ok "Kong HTTPRoute applied"
  else
    log "Kong namespace '${KONG_NAMESPACE}' not found, skipping HTTPRoute"
    log "Apply it later with: kubectl apply -f infra/kong/neki-worker-route.yaml"
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
log "Installation complete"
echo ""
kubectl get deployment,service,secret --namespace "${NAMESPACE}" \
  --output wide 2>/dev/null || true
echo ""

if [[ "${SKIP_KONG_ROUTE}" != "true" ]]; then
  echo "Kong HTTPRoute:"
  kubectl get httproute --namespace "${KONG_NAMESPACE}" \
    --output wide 2>/dev/null || true
fi

echo ""
log "Next steps:"
echo "  1. Upload a worker bundle:"
echo "     cd packages/neki-controlplane"
echo "     kubectl port-forward -n ${RUSTFS_NAMESPACE} svc/rustfs-svc 9000:9000 &"
echo "     cargo run -- rustfs upload-worker --file ../../examples/workerd-hello/worker.js --worker-id hello --endpoint http://localhost:9000"
echo ""
echo "  2. Test with:"
echo "     ./scripts/test-worker-runtime.sh"
