#!/usr/bin/env bash
set -euo pipefail

VAULT_ENGINE_PATH="${VAULT_ENGINE_PATH:-secret}"
DAPR_VAULT_PREFIX="${DAPR_VAULT_PREFIX:-dapr}"
SECRET_NAME="${SECRET_NAME:-hello-bun-ts}"
SECRET_MESSAGE="${SECRET_MESSAGE:-hello from vault}"
VAULT_POLICY_NAME="${VAULT_POLICY_NAME:-hello-bun-ts-dapr}"
VAULT_TOKEN_TTL="${VAULT_TOKEN_TTL:-24h}"
WRITE_K8S_SECRET="${WRITE_K8S_SECRET:-false}"
NAMESPACE="${NAMESPACE:-default}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need vault

if [[ -z "${VAULT_ADDR:-}" ]]; then
  echo "VAULT_ADDR is required. For local port-forwarding, set VAULT_ADDR=http://127.0.0.1:8200" >&2
  exit 1
fi

if [[ "${WRITE_K8S_SECRET}" == "true" ]]; then
  need kubectl
fi

if ! vault status >/dev/null; then
  echo "Vault is not reachable at ${VAULT_ADDR}" >&2
  exit 1
fi

if ! vault token lookup >/dev/null; then
  echo "Vault authentication failed. Set VAULT_TOKEN to an admin token before running this script." >&2
  exit 1
fi

if ! vault secrets list -format=json | grep -q "\"${VAULT_ENGINE_PATH}/\""; then
  echo "Enabling KV v2 secrets engine at ${VAULT_ENGINE_PATH}/"
  vault secrets enable -path="${VAULT_ENGINE_PATH}" kv-v2
fi

SECRET_PATH="${DAPR_VAULT_PREFIX}/${SECRET_NAME}"
POLICY_DATA_PATH="${VAULT_ENGINE_PATH}/data/${SECRET_PATH}"
POLICY_METADATA_PATH="${VAULT_ENGINE_PATH}/metadata/${SECRET_PATH}"

echo "Writing Vault secret ${VAULT_ENGINE_PATH}/${SECRET_PATH}"
vault kv put "${VAULT_ENGINE_PATH}/${SECRET_PATH}" message="${SECRET_MESSAGE}" >/dev/null

echo "Writing Vault policy ${VAULT_POLICY_NAME}"
vault policy write "${VAULT_POLICY_NAME}" - <<EOF
path "${POLICY_DATA_PATH}" {
  capabilities = ["read"]
}

path "${POLICY_METADATA_PATH}" {
  capabilities = ["read"]
}
EOF

echo "Creating scoped Vault token for Dapr"
APP_VAULT_TOKEN="$(vault token create -policy="${VAULT_POLICY_NAME}" -ttl="${VAULT_TOKEN_TTL}" -field=token)"

if [[ "${WRITE_K8S_SECRET}" == "true" ]]; then
  echo "Writing Kubernetes Secret ${NAMESPACE}/vault-token"
  kubectl create secret generic vault-token \
    --namespace "${NAMESPACE}" \
    --from-literal "token=${APP_VAULT_TOKEN}" \
    --dry-run=client \
    --output yaml | kubectl apply -f -
fi

cat <<EOF

Vault realm initialized for ${SECRET_NAME}.

Use this token when deploying:
  VAULT_TOKEN=${APP_VAULT_TOKEN} APPLY_DAPR_VAULT=true ./deploy.sh

Or write it directly to Kubernetes next time:
  WRITE_K8S_SECRET=true ./init-vault.sh
EOF
