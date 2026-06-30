#!/usr/bin/env bash
set -euo pipefail

VAULT_NAMESPACE="${VAULT_NAMESPACE:-vault}"
VAULT_TARGET="${VAULT_TARGET:-svc/vault}"
VAULT_LOCAL_PORT="${VAULT_LOCAL_PORT:-8200}"
VAULT_TARGET_PORT="${VAULT_TARGET_PORT:-8200}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need kubectl

if ! kubectl get namespace "${VAULT_NAMESPACE}" >/dev/null 2>&1; then
  echo "Vault namespace '${VAULT_NAMESPACE}' was not found." >&2
  echo "Install Vault server first, or set VAULT_NAMESPACE to the namespace that contains Vault." >&2
  exit 1
fi

if ! kubectl get "${VAULT_TARGET}" --namespace "${VAULT_NAMESPACE}" >/dev/null 2>&1; then
  echo "Vault target '${VAULT_TARGET}' was not found in namespace '${VAULT_NAMESPACE}'." >&2
  echo "Set VAULT_TARGET to the Vault service or pod to forward, for example VAULT_TARGET=svc/my-vault." >&2
  exit 1
fi

cat <<EOF
Forwarding Vault:
  http://127.0.0.1:${VAULT_LOCAL_PORT} -> ${VAULT_NAMESPACE}/${VAULT_TARGET}:${VAULT_TARGET_PORT}

In another shell, run:
  export VAULT_ADDR=http://127.0.0.1:${VAULT_LOCAL_PORT}

Use Ctrl-C to stop port-forwarding.
EOF

kubectl port-forward \
  --namespace "${VAULT_NAMESPACE}" \
  "${VAULT_TARGET}" \
  "${VAULT_LOCAL_PORT}:${VAULT_TARGET_PORT}"

