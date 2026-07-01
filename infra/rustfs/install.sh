#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

RUSTFS_NAMESPACE="${RUSTFS_NAMESPACE:-rustfs}"
RUSTFS_RELEASE="${RUSTFS_RELEASE:-rustfs}"
RUSTFS_CHART_REPO_NAME="${RUSTFS_CHART_REPO_NAME:-rustfs}"
RUSTFS_CHART_REPO_URL="${RUSTFS_CHART_REPO_URL:-https://charts.rustfs.com}"
RUSTFS_CHART="${RUSTFS_CHART:-rustfs/rustfs}"
RUSTFS_CHART_VERSION="${RUSTFS_CHART_VERSION:-0.8.0}"
RUSTFS_CHART_SOURCE="${RUSTFS_CHART_SOURCE:-auto}"
RUSTFS_CHART_GITHUB_REPO="${RUSTFS_CHART_GITHUB_REPO:-https://github.com/rustfs/rustfs}"
RUSTFS_CHART_GITHUB_REF="${RUSTFS_CHART_GITHUB_REF:-main}"
RUSTFS_ACCESS_KEY="${RUSTFS_ACCESS_KEY:-neki-rustfs}"
RUSTFS_SECRET_KEY="${RUSTFS_SECRET_KEY:-neki-rustfs-secret}"
RUSTFS_REGION="${RUSTFS_REGION:-us-east-1}"
RUSTFS_BUCKET="${RUSTFS_BUCKET:-neon}"
RUSTFS_WORKERS_BUCKET="${RUSTFS_WORKERS_BUCKET:-workers}"
RUSTFS_ENDPOINT="${RUSTFS_ENDPOINT:-http://${RUSTFS_RELEASE}-svc.${RUSTFS_NAMESPACE}.svc.cluster.local:9000}"
NEON_NAMESPACE="${NEON_NAMESPACE:-neon}"
NEON_BUCKET_SECRET="${NEON_BUCKET_SECRET:-bucket-credentials}"
TIMEOUT="${TIMEOUT:-300s}"
CREATE_BUCKET="${CREATE_BUCKET:-true}"
CREATE_WORKERS_BUCKET="${CREATE_WORKERS_BUCKET:-true}"
SYNC_NEON_SECRET="${SYNC_NEON_SECRET:-true}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
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

create_rustfs_bucket() {
  local bucket="$1"

  echo "Creating RustFS bucket ${bucket}"
  kubectl delete job "${RUSTFS_RELEASE}-create-${bucket}" \
    --namespace "${RUSTFS_NAMESPACE}" \
    --ignore-not-found

  cat <<EOF | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: ${RUSTFS_RELEASE}-create-${bucket}
  namespace: ${RUSTFS_NAMESPACE}
spec:
  backoffLimit: 3
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: mc
          image: minio/mc:latest
          imagePullPolicy: IfNotPresent
          env:
            - name: RUSTFS_ENDPOINT
              value: ${RUSTFS_ENDPOINT}
            - name: RUSTFS_BUCKET
              value: ${bucket}
            - name: RUSTFS_ACCESS_KEY
              valueFrom:
                secretKeyRef:
                  name: ${RUSTFS_RELEASE}-secret
                  key: RUSTFS_ACCESS_KEY
            - name: RUSTFS_SECRET_KEY
              valueFrom:
                secretKeyRef:
                  name: ${RUSTFS_RELEASE}-secret
                  key: RUSTFS_SECRET_KEY
          command:
            - /bin/sh
            - -ec
            - |
              mc alias set rustfs "\${RUSTFS_ENDPOINT}" "\${RUSTFS_ACCESS_KEY}" "\${RUSTFS_SECRET_KEY}"
              mc mb --ignore-existing "rustfs/\${RUSTFS_BUCKET}"
EOF

  kubectl wait \
    --namespace "${RUSTFS_NAMESPACE}" \
    --for=condition=complete \
    --timeout="${TIMEOUT}" \
    "job/${RUSTFS_RELEASE}-create-${bucket}"
}

need helm
need kubectl
need curl

CHART_TMP_DIR=""

cleanup() {
  if [[ -n "${CHART_TMP_DIR}" && -d "${CHART_TMP_DIR}" ]]; then
    rm -rf "${CHART_TMP_DIR}"
  fi
}

trap cleanup EXIT

download_github_chart() {
  local archive_url="${RUSTFS_CHART_GITHUB_REPO}/archive/${RUSTFS_CHART_GITHUB_REF}.tar.gz"
  local archive_path
  local chart_path

  CHART_TMP_DIR="$(mktemp -d)"
  archive_path="${CHART_TMP_DIR}/rustfs.tar.gz"

  echo "Downloading RustFS Helm chart from ${archive_url}" >&2
  curl -fsSL "${archive_url}" -o "${archive_path}"
  tar -xzf "${archive_path}" -C "${CHART_TMP_DIR}"

  chart_path="$(find "${CHART_TMP_DIR}" -path "*/helm/rustfs/Chart.yaml" -print -quit)"
  if [[ -z "${chart_path}" ]]; then
    echo "Could not find helm/rustfs/Chart.yaml in ${archive_url}" >&2
    exit 1
  fi

  dirname "${chart_path}"
}

resolve_chart() {
  case "${RUSTFS_CHART_SOURCE}" in
    repo)
      echo "Adding RustFS Helm repository"
      helm repo add --force-update "${RUSTFS_CHART_REPO_NAME}" "${RUSTFS_CHART_REPO_URL}"
      helm repo update
      RUSTFS_CHART_REF="${RUSTFS_CHART}"
      RUSTFS_USE_CHART_VERSION=true
      ;;
    github)
      RUSTFS_CHART_REF="$(download_github_chart)"
      RUSTFS_USE_CHART_VERSION=false
      ;;
    auto)
      echo "Adding RustFS Helm repository"
      if helm repo add --force-update "${RUSTFS_CHART_REPO_NAME}" "${RUSTFS_CHART_REPO_URL}" && helm repo update; then
        RUSTFS_CHART_REF="${RUSTFS_CHART}"
        RUSTFS_USE_CHART_VERSION=true
      else
        echo "RustFS Helm repository is unavailable; falling back to GitHub chart source"
        RUSTFS_CHART_REF="$(download_github_chart)"
        RUSTFS_USE_CHART_VERSION=false
      fi
      ;;
    *)
      echo "Unsupported RUSTFS_CHART_SOURCE=${RUSTFS_CHART_SOURCE}; use auto, repo, or github" >&2
      exit 1
      ;;
  esac
}

resolve_chart

echo "Installing RustFS into namespace ${RUSTFS_NAMESPACE} from ${RUSTFS_CHART_REF}"
HELM_ARGS=(
  upgrade
  --install "${RUSTFS_RELEASE}" "${RUSTFS_CHART_REF}"
  --namespace "${RUSTFS_NAMESPACE}"
  --create-namespace
  --values "${SCRIPT_DIR}/values.yaml"
  --set-string "secret.rustfs.access_key=${RUSTFS_ACCESS_KEY}"
  --set-string "secret.rustfs.secret_key=${RUSTFS_SECRET_KEY}"
  --set-string "config.rustfs.region=${RUSTFS_REGION}"
  --wait
  --timeout "${TIMEOUT}"
)

if [[ "${RUSTFS_USE_CHART_VERSION}" == "true" ]]; then
  HELM_ARGS+=(--version "${RUSTFS_CHART_VERSION}")
fi

helm "${HELM_ARGS[@]}"

echo "Waiting for RustFS"
rollout_if_present "${RUSTFS_NAMESPACE}" deployment "${RUSTFS_RELEASE}"
rollout_if_present "${RUSTFS_NAMESPACE}" statefulset "${RUSTFS_RELEASE}"

if [[ "${CREATE_BUCKET}" == "true" ]]; then
  create_rustfs_bucket "${RUSTFS_BUCKET}"
fi

if [[ "${CREATE_WORKERS_BUCKET}" == "true" && "${RUSTFS_WORKERS_BUCKET}" != "${RUSTFS_BUCKET}" ]]; then
  create_rustfs_bucket "${RUSTFS_WORKERS_BUCKET}"
fi

if [[ "${SYNC_NEON_SECRET}" == "true" ]]; then
  echo "Creating Neon bucket credentials secret ${NEON_BUCKET_SECRET} in namespace ${NEON_NAMESPACE}"
  kubectl create namespace "${NEON_NAMESPACE}" --dry-run=client --output yaml | kubectl apply -f -
  kubectl create secret generic "${NEON_BUCKET_SECRET}" \
    --namespace "${NEON_NAMESPACE}" \
    --from-literal=AWS_ACCESS_KEY_ID="${RUSTFS_ACCESS_KEY}" \
    --from-literal=AWS_SECRET_ACCESS_KEY="${RUSTFS_SECRET_KEY}" \
    --from-literal=AWS_REGION="${RUSTFS_REGION}" \
    --from-literal=AWS_ENDPOINT_URL="${RUSTFS_ENDPOINT}" \
    --from-literal=BUCKET_NAME="${RUSTFS_BUCKET}" \
    --dry-run=client \
    --output yaml | kubectl apply -f -
fi

echo "RustFS status"
kubectl get pods,svc,pvc --namespace "${RUSTFS_NAMESPACE}"

if [[ "${SYNC_NEON_SECRET}" == "true" ]]; then
  echo "Neon bucket credential secret"
  kubectl get secret "${NEON_BUCKET_SECRET}" --namespace "${NEON_NAMESPACE}"
fi

echo "RustFS install complete"
