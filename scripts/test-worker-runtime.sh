#!/usr/bin/env bash
#
# Test the Neki worker runtime stack.
#
# This script verifies that the worker runtime is correctly deployed and
# functional. It performs two kinds of tests:
#
#   Phase 1 - Kubernetes deployment checks (cluster must be running):
#     - Verifies Deployments, Services, Secrets, and HTTPRoutes exist
#     - Verifies pods are Ready
#     - Queries the supervisor manifest API
#
#   Phase 2 - End-to-end worker test (requires RustFS port-forward):
#     - Uploads the hello worker bundle to RustFS
#     - Creates an assignment ConfigMap
#     - Restarts worker-node to pick up the assignment
#     - Sends traffic through workerd and the routing gateway
#     - Verifies the response and debugging headers
#
# Usage:
#   ./scripts/test-worker-runtime.sh              # run all phases
#   ./scripts/test-worker-runtime.sh --phase=deploy    # only deployment checks
#   ./scripts/test-worker-runtime.sh --phase=e2e       # only end-to-end
#
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

NAMESPACE="${NAMESPACE:-neki}"
RUSTFS_NAMESPACE="${RUSTFS_NAMESPACE:-rustfs}"
WORKER_NODE_NAME="${WORKER_NODE_NAME:-neki-worker-node}"
WORKER_ROUTER_NAME="${WORKER_ROUTER_NAME:-neki-worker-router}"
RUSTFS_SECRET="${RUSTFS_SECRET:-neki-rustfs-credentials}"
KONG_NAMESPACE="${KONG_NAMESPACE:-kong}"

RUSTFS_LOCAL_PORT="${RUSTFS_LOCAL_PORT:-19000}"
WORKER_NODE_PORT="${WORKER_NODE_PORT:-18080}"
WORKER_ROUTER_PORT="${WORKER_ROUTER_PORT:-18081}"
SUPERVISOR_PORT="${SUPERVISOR_PORT:-19001}"

WORKER_ID="${WORKER_ID:-hello}"
WORKER_VERSION="${WORKER_VERSION:-$(date +%Y-%m-%d).1}"
WORKER_FILE="${REPO_ROOT}/examples/workerd-hello/worker.js"

RUSTFS_ACCESS_KEY="${RUSTFS_ACCESS_KEY:-neki-rustfs}"
RUSTFS_SECRET_KEY="${RUSTFS_SECRET_KEY:-neki-rustfs-secret}"
RUSTFS_ENDPOINT="${RUSTFS_ENDPOINT:-http://localhost:${RUSTFS_LOCAL_PORT}}"

PHASE="${PHASE:-all}"

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
ok()   { echo "  PASS  $*"; }
fail() { echo "  FAIL  $*"; }

# Track port-forward PIDs for cleanup
PORT_FORWARD_PIDS=()
cleanup_port_forwards() {
  if [[ ${#PORT_FORWARD_PIDS[@]} -gt 0 ]]; then
    log "Cleaning up port-forwards"
    for pid in "${PORT_FORWARD_PIDS[@]}"; do
      kill "${pid}" 2>/dev/null || true
    done
  fi
}
trap cleanup_port_forwards EXIT

start_port_forward() {
  local name="$1"
  local namespace="$2"
  local target="$3"
  local local_port="$4"
  local remote_port="$5"

  # Kill anything already listening on the local port
  lsof -ti ":${local_port}" 2>/dev/null | xargs kill 2>/dev/null || true

  log "Port-forwarding ${name}: localhost:${local_port} -> ${namespace}/${target}:${remote_port}"
  kubectl port-forward --namespace "${namespace}" "${target}" "${local_port}:${remote_port}" >/dev/null 2>&1 &
  local pid=$!
  PORT_FORWARD_PIDS+=("${pid}")

  # Wait for the port to be available
  local attempts=0
  while ! nc -z 127.0.0.1 "${local_port}" 2>/dev/null; do
    attempts=$((attempts + 1))
    if [[ ${attempts} -ge 30 ]]; then
      fail "port-forward ${name} did not come up after 30s"
      return 1
    fi
    sleep 1
  done
  ok "port-forward ${name} ready on :${local_port}"
}

assert_status_code() {
  local expected="$1"
  local url="$2"
  local label="$3"
  local code

  code=$(curl --silent --output /dev/null --write-out '%{http_code}' "${url}" 2>/dev/null || echo "000")
  if [[ "${code}" == "${expected}" ]]; then
    ok "${label}: HTTP ${code}"
    return 0
  else
    fail "${label}: expected HTTP ${expected}, got ${code}"
    return 1
  fi
}

assert_contains() {
  local url="$1"
  local pattern="$2"
  local label="$3"
  local body

  body=$(curl --silent "${url}" 2>/dev/null || echo "")
  if echo "${body}" | grep -q "${pattern}"; then
    ok "${label}: response contains '${pattern}'"
    return 0
  else
    fail "${label}: response does not contain '${pattern}'"
    echo "       got: ${body:0:200}"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------

for arg in "$@"; do
  case "${arg}" in
    --phase=*)  PHASE="${arg#*=}" ;;
    --phase)    shift; PHASE="$1" ;;
    -h|--help)
      grep '^#' "${BASH_SOURCE[0]}" | head -n 30
      exit 0
      ;;
    *) echo "Unknown argument: ${arg}" >&2; exit 1 ;;
  esac
done

need kubectl
need curl

# Test result tracking
TESTS_PASSED=0
TESTS_FAILED=0

run_test() {
  if "$@"; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

# ---------------------------------------------------------------------------
# Phase 1: Deployment checks
# ---------------------------------------------------------------------------

test_deployments_exist() {
  log "Phase 1: Kubernetes deployment checks"

  # Worker-node Deployment
  if kubectl get deployment "${WORKER_NODE_NAME}" --namespace "${NAMESPACE}" >/dev/null 2>&1; then
    ok "Deployment ${NAMESPACE}/${WORKER_NODE_NAME} exists"
  else
    fail "Deployment ${NAMESPACE}/${WORKER_NODE_NAME} not found"
    return 1
  fi

  # Worker-router Deployment
  if kubectl get deployment "${WORKER_ROUTER_NAME}" --namespace "${NAMESPACE}" >/dev/null 2>&1; then
    ok "Deployment ${NAMESPACE}/${WORKER_ROUTER_NAME} exists"
  else
    fail "Deployment ${NAMESPACE}/${WORKER_ROUTER_NAME} not found"
    return 1
  fi
}

test_services_exist() {
  # Worker-node Service
  if kubectl get service "${WORKER_NODE_NAME}" --namespace "${NAMESPACE}" >/dev/null 2>&1; then
    ok "Service ${NAMESPACE}/${WORKER_NODE_NAME} exists"
  else
    fail "Service ${NAMESPACE}/${WORKER_NODE_NAME} not found"
    return 1
  fi

  # Worker-router Service
  if kubectl get service "${WORKER_ROUTER_NAME}" --namespace "${NAMESPACE}" >/dev/null 2>&1; then
    ok "Service ${NAMESPACE}/${WORKER_ROUTER_NAME} exists"
  else
    fail "Service ${NAMESPACE}/${WORKER_ROUTER_NAME} not found"
    return 1
  fi
}

test_secret_exists() {
  if kubectl get secret "${RUSTFS_SECRET}" --namespace "${NAMESPACE}" >/dev/null 2>&1; then
    ok "Secret ${NAMESPACE}/${RUSTFS_SECRET} exists"
  else
    fail "Secret ${NAMESPACE}/${RUSTFS_SECRET} not found"
    return 1
  fi
}

test_pods_ready() {
  local node_ready router_ready

  node_ready=$(kubectl get deployment "${WORKER_NODE_NAME}" \
    --namespace "${NAMESPACE}" \
    --output jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  if [[ "${node_ready}" -ge 1 ]] 2>/dev/null; then
    ok "worker-node pods ready: ${node_ready}"
  else
    fail "worker-node has no ready pods"
    return 1
  fi

  router_ready=$(kubectl get deployment "${WORKER_ROUTER_NAME}" \
    --namespace "${NAMESPACE}" \
    --output jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  if [[ "${router_ready}" -ge 1 ]] 2>/dev/null; then
    ok "worker-router pods ready: ${router_ready}"
  else
    fail "worker-router has no ready pods"
    return 1
  fi
}

test_httproute_exists() {
  if kubectl get httproute neki-worker-router --namespace "${KONG_NAMESPACE}" >/dev/null 2>&1; then
    ok "HTTPRoute ${KONG_NAMESPACE}/neki-worker-router exists"
  else
    # Try to auto-apply it if the Kong namespace exists
    if kubectl get namespace "${KONG_NAMESPACE}" >/dev/null 2>&1; then
      log "HTTPRoute not found, applying from infra/kong/neki-worker-route.yaml"
      if kubectl apply -f "${REPO_ROOT}/infra/kong/neki-worker-route.yaml" >/dev/null 2>&1; then
        ok "HTTPRoute ${KONG_NAMESPACE}/neki-worker-router created"
      else
        fail "Could not apply HTTPRoute (Kong Gateway may not exist yet)"
        return 0 # non-fatal: Kong is optional infrastructure
      fi
    else
      log "Kong namespace '${KONG_NAMESPACE}' not found, skipping HTTPRoute check"
      return 0 # non-fatal: Kong is not installed
    fi
  fi
}

test_supervisor_manifest() {
  log "Querying supervisor manifest API"

  # Port-forward to the pod directly since the Service only exposes port 80
  local pod_name
  pod_name=$(kubectl get pods --namespace "${NAMESPACE}" \
    --selector "app.kubernetes.io/name=neki-worker-node" \
    --output jsonpath='{.items[0].metadata.name}' 2>/dev/null)

  if [[ -z "${pod_name}" ]]; then
    fail "no worker-node pod found"
    return 1
  fi

  start_port_forward "worker-node-supervisor" "${NAMESPACE}" \
    "pod/${pod_name}" "${SUPERVISOR_PORT}" 9000 || return 1

  # Health
  run_test assert_status_code 200 "http://localhost:${SUPERVISOR_PORT}/healthz" "supervisor /healthz"

  # Manifest endpoint responds (may be 503 if no workers loaded yet)
  local manifest_code
  manifest_code=$(curl --silent --output /dev/null --write-out '%{http_code}' \
    "http://localhost:${SUPERVISOR_PORT}/manifest" 2>/dev/null || echo "000")

  if [[ "${manifest_code}" == "200" ]]; then
    ok "supervisor /manifest returns 200 (workers loaded)"
  elif [[ "${manifest_code}" == "503" ]]; then
    ok "supervisor /manifest returns 503 (no workers loaded yet, expected for fresh deploy)"
  else
    fail "supervisor /manifest returned unexpected HTTP ${manifest_code}"
    return 1
  fi

  # Workers endpoint
  run_test assert_status_code 200 "http://localhost:${SUPERVISOR_PORT}/workers" "supervisor /workers"
}

run_phase_deploy() {
  log "=========================================="
  log "Phase 1: Deployment checks"
  log "=========================================="
  echo ""

  run_test test_deployments_exist
  run_test test_services_exist
  run_test test_secret_exists
  run_test test_pods_ready
  run_test test_httproute_exists
  run_test test_supervisor_manifest
}

# ---------------------------------------------------------------------------
# Phase 2: End-to-end worker test
# ---------------------------------------------------------------------------

upload_worker_bundle() {
  log "Uploading worker bundle to RustFS"

  if [[ ! -f "${WORKER_FILE}" ]]; then
    fail "worker file not found: ${WORKER_FILE}"
    return 1
  fi

  local cp_dir="${REPO_ROOT}/packages/neki-controlplane"
  if [[ ! -d "${cp_dir}/target" ]]; then
    log "Building neki-controlplane CLI"
    (cd "${cp_dir}" && cargo build --quiet 2>/dev/null)
  fi

  start_port_forward "rustfs" "${RUSTFS_NAMESPACE}" \
    "svc/rustfs-svc" "${RUSTFS_LOCAL_PORT}" 9000 || return 1

  log "Uploading ${WORKER_FILE} as worker_id=${WORKER_ID} version=${WORKER_VERSION}"

  UPLOAD_OUTPUT=$(cd "${cp_dir}" && cargo run --quiet -- rustfs upload-worker \
    --file "${WORKER_FILE}" \
    --worker-id "${WORKER_ID}" \
    --version "${WORKER_VERSION}" \
    --endpoint "http://localhost:${RUSTFS_LOCAL_PORT}" \
    --access-key "${RUSTFS_ACCESS_KEY}" \
    --secret-key "${RUSTFS_SECRET_KEY}" 2>/dev/null)

  if [[ $? -ne 0 ]]; then
    fail "failed to upload worker bundle"
    return 1
  fi

  UPLOAD_SHA256=$(echo "${UPLOAD_OUTPUT}" | grep -o '"sha256": *"[^"]*"' | head -1 | sed 's/.*"sha256": *"//;s/"$//')
  UPLOAD_SCRIPT_URL=$(echo "${UPLOAD_OUTPUT}" | grep -o '"script_url": *"[^"]*"' | head -1 | sed 's/.*"script_url": *"//;s/"$//')

  if [[ -z "${UPLOAD_SHA256}" || "${UPLOAD_SHA256}" == "" ]]; then
    fail "could not parse sha256 from upload output"
    return 1
  fi

  ok "worker uploaded: sha256=${UPLOAD_SHA256:0:16}..."
  ok "script_url=${UPLOAD_SCRIPT_URL}"
  return 0
}

apply_assignment_configmap() {
  log "Applying assignment ConfigMap to ${NAMESPACE}/${WORKER_NODE_NAME}-assignment"

  local assignment_json
  assignment_json=$(cat <<EOF
{
  "pool_id": "${POOL_ID:-public-small}",
  "node_id": "assigned",
  "generation": "1",
  "workers": [
    {
      "worker_id": "${WORKER_ID}",
      "version": "${WORKER_VERSION}",
      "script_url": "${UPLOAD_SCRIPT_URL}",
      "sha256": "${UPLOAD_SHA256}",
      "compatibility_date": "${COMPATIBILITY_DATE:-2025-06-01}"
    }
  ],
  "routes": [
    {
      "host": "*",
      "path_prefix": "/${WORKER_ID}",
      "methods": ["GET", "POST"],
      "worker_id": "${WORKER_ID}"
    },
    {
      "host": "*",
      "path_prefix": "/healthz",
      "methods": ["GET"],
      "worker_id": "${WORKER_ID}"
    }
  ]
}
EOF
)

  echo "${assignment_json}" | kubectl create configmap "${WORKER_NODE_NAME}-assignment" \
    --namespace "${NAMESPACE}" \
    --from-file=assignment.json=/dev/stdin \
    --dry-run=client --output yaml | kubectl apply -f -

  ok "assignment ConfigMap applied"

  # Restart the deployment to pick up the new assignment
  log "Restarting worker-node to pick up new assignment"
  kubectl rollout restart "deployment/${WORKER_NODE_NAME}" \
    --namespace "${NAMESPACE}"

  kubectl rollout status "deployment/${WORKER_NODE_NAME}" \
    --namespace "${NAMESPACE}" \
    --timeout "${TIMEOUT:-120s}"

  ok "worker-node restarted with new assignment"
}

run_phase_e2e() {
  log "=========================================="
  log "Phase 2: End-to-end worker test"
  log "=========================================="
  echo ""

  # Step 1: Upload worker bundle
  run_test upload_worker_bundle

  if [[ ${TESTS_FAILED} -gt 0 ]]; then
    fail "Worker upload failed, skipping remaining e2e tests"
    return
  fi

  # Step 2: Apply assignment
  log "Applying assignment to worker-node"
  run_test apply_assignment_configmap

  # Step 3: Wait for worker to be loaded
  log "Waiting for worker to be loaded"

  # Establish supervisor port-forward (the pod was recreated during rollout)
  local supervisor_pod
  supervisor_pod=$(kubectl get pods --namespace "${NAMESPACE}" \
    --selector "app.kubernetes.io/name=neki-worker-node" \
    --output jsonpath='{.items[0].metadata.name}' 2>/dev/null)

  # Kill any existing supervisor port-forward and start a fresh one
  start_port_forward "worker-node-supervisor-e2e" "${NAMESPACE}" \
    "pod/${supervisor_pod}" "${SUPERVISOR_PORT}" 9000 || true

  local manifest_ready=false
  for i in $(seq 1 30); do
    local code
    code=$(curl --silent --output /dev/null --write-out '%{http_code}' \
      "http://localhost:${SUPERVISOR_PORT}/readyz" 2>/dev/null || echo "000")
    if [[ "${code}" == "200" ]]; then
      manifest_ready=true
      break
    fi
    sleep 2
  done

  if [[ "${manifest_ready}" == "true" ]]; then
    ok "supervisor reports ready"
  else
    fail "supervisor did not become ready after 60s"
  fi

  # Step 4: Verify manifest has the hello worker
  local manifest_body
  manifest_body=$(curl --silent "http://localhost:${SUPERVISOR_PORT}/manifest" 2>/dev/null || echo "")
  if echo "${manifest_body}" | grep -q "${WORKER_ID}"; then
    ok "manifest contains worker '${WORKER_ID}'"
  else
    fail "manifest does not contain worker '${WORKER_ID}'"
    echo "       manifest: ${manifest_body:0:300}"
  fi

  # Step 5: Send traffic through workerd
  # Port-forward to the pod directly on port 8080
  local http_pod
  http_pod=$(kubectl get pods --namespace "${NAMESPACE}" \
    --selector "app.kubernetes.io/name=neki-worker-node" \
    --output jsonpath='{.items[0].metadata.name}' 2>/dev/null)

  start_port_forward "worker-node-http" "${NAMESPACE}" \
    "pod/${http_pod}" "${WORKER_NODE_PORT}" 8080 || true

  log "Testing workerd HTTP (port ${WORKER_NODE_PORT})"

  # Give workerd a few seconds to start
  sleep 3

  run_test assert_status_code 200 \
    "http://localhost:${WORKER_NODE_PORT}/${WORKER_ID}" \
    "workerd GET /${WORKER_ID}"

  run_test assert_contains \
    "http://localhost:${WORKER_NODE_PORT}/${WORKER_ID}" \
    "workerd" \
    "workerd response body"

  run_test assert_status_code 200 \
    "http://localhost:${WORKER_NODE_PORT}/healthz" \
    "workerd GET /healthz"

  # Step 6: Check debugging headers (use GET -D, not HEAD, since route may not allow HEAD)
  local headers
  headers=$(curl --silent -D - \
    "http://localhost:${WORKER_NODE_PORT}/${WORKER_ID}" -o /dev/null 2>/dev/null || echo "")
  if echo "${headers}" | grep -qi "x-neki-worker"; then
    ok "response includes x-neki-worker header"
  else
    fail "response missing x-neki-worker header"
    echo "       headers: ${headers:0:300}"
  fi

  # Step 7: Test unmatched route returns 404
  run_test assert_status_code 404 \
    "http://localhost:${WORKER_NODE_PORT}/nonexistent-path-12345" \
    "workerd unmatched path 404"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

log "Neki worker runtime test"
log "Namespace:  ${NAMESPACE}"
log "Phase:      ${PHASE}"
echo ""

case "${PHASE}" in
  all)
    run_phase_deploy
    echo ""
    run_phase_e2e
    ;;
  deploy)
    run_phase_deploy
    ;;
  e2e)
    run_phase_e2e
    ;;
  *)
    fail "Unknown phase: ${PHASE}. Use: all, deploy, or e2e"
    exit 1
    ;;
esac

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
log "=========================================="
log "Results"
log "=========================================="
echo "  Passed: ${TESTS_PASSED}"
echo "  Failed: ${TESTS_FAILED}"
echo ""

if [[ ${TESTS_FAILED} -eq 0 ]]; then
  ok "All tests passed"
  exit 0
else
  fail "${TESTS_FAILED} test(s) failed"
  exit 1
fi
