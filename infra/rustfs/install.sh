#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

RUSTFS_NAMESPACE="${RUSTFS_NAMESPACE:-rustfs}"
RUSTFS_RELEASE="${RUSTFS_RELEASE:-rustfs}"
RUSTFS_CHART_REPO_NAME="${RUSTFS_CHART_REPO_NAME:-rustfs}"
RUSTFS_CHART_REPO_URL="${RUSTFS_CHART_REPO_URL:-https://charts.rustfs.com}"
RUSTFS_CHART="${RUSTFS_CHART:-rustfs/rustfs}"
RUSTFS_CHART_VERSION="${RUSTFS_CHART_VERSION:-0.8.0}"
RUSTFS_ACCESS_KEY="${RUSTFS_ACCESS_KEY:-neki-rustfs}"
RUSTFS_SECRET_KEY="${RUSTFS_SECRET_KEY:-neki-rustfs-secret}"
RUSTFS_REGION="${RUSTFS_REGION:-us-east-1}"
RUSTFS_BUCKET="${RUSTFS_BUCKET:-neon}"
RUSTFS_ENDPOINT="${RUSTFS_ENDPOINT:-http://${RUSTFS_RELEASE}-svc.${RUSTFS_NAMESPACE}.svc.cluster.local:9000}"
NEON_NAMESPACE="${NEON_NAMESPACE:-neon}"
NEON_BUCKET_SECRET="${NEON_BUCKET_SECRET:-bucket-credentials}"
TIMEOUT="${TIMEOUT:-300s}"
CREATE_BUCKET="${CREATE_BUCKET:-true}"
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

need helm
need kubectl

echo "Adding RustFS Helm repository"
helm repo add "${RUSTFS_CHART_REPO_NAME}" "${RUSTFS_CHART_REPO_URL}"
helm repo update

echo "Installing RustFS ${RUSTFS_CHART_VERSION} into namespace ${RUSTFS_NAMESPACE}"
helm upgrade --install "${RUSTFS_RELEASE}" "${RUSTFS_CHART}" \
  --version "${RUSTFS_CHART_VERSION}" \
  --namespace "${RUSTFS_NAMESPACE}" \
  --create-namespace \
  --values "${SCRIPT_DIR}/values.yaml" \
  --set-string "secret.rustfs.access_key=${RUSTFS_ACCESS_KEY}" \
  --set-string "secret.rustfs.secret_key=${RUSTFS_SECRET_KEY}" \
  --set-string "config.rustfs.region=${RUSTFS_REGION}" \
  --wait \
  --timeout "${TIMEOUT}"

echo "Waiting for RustFS"
rollout_if_present "${RUSTFS_NAMESPACE}" deployment "${RUSTFS_RELEASE}"
rollout_if_present "${RUSTFS_NAMESPACE}" statefulset "${RUSTFS_RELEASE}"

if [[ "${CREATE_BUCKET}" == "true" ]]; then
  echo "Creating RustFS bucket ${RUSTFS_BUCKET}"
  kubectl delete job "${RUSTFS_RELEASE}-create-${RUSTFS_BUCKET}" \
    --namespace "${RUSTFS_NAMESPACE}" \
    --ignore-not-found

  cat <<EOF | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: ${RUSTFS_RELEASE}-create-${RUSTFS_BUCKET}
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
              value: ${RUSTFS_BUCKET}
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
    "job/${RUSTFS_RELEASE}-create-${RUSTFS_BUCKET}"
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
