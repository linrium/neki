#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

INSTALL_VAULT_SERVER="${INSTALL_VAULT_SERVER:-true}"
VAULT_NAMESPACE="${VAULT_NAMESPACE:-vault}"
VAULT_RELEASE="${VAULT_RELEASE:-vault}"
VAULT_CHART_VERSION="${VAULT_CHART_VERSION:-0.33.0}"
VAULT_DEV_ROOT_TOKEN="${VAULT_DEV_ROOT_TOKEN:-root}"
VSO_NAMESPACE="${VSO_NAMESPACE:-vault-secrets-operator}"
VSO_RELEASE="${VSO_RELEASE:-vault-secrets-operator}"
VSO_CHART_VERSION="${VSO_CHART_VERSION:-1.4.0}"
TIMEOUT="${TIMEOUT:-300s}"
APPLY_EXAMPLE="${APPLY_EXAMPLE:-false}"
APP_NAMESPACE="${APP_NAMESPACE:-default}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

rollout_selector_if_present() {
  local namespace="$1"
  local selector="$2"

  if kubectl get deployment --namespace "${namespace}" --selector "${selector}" --no-headers 2>/dev/null | grep -q .; then
    kubectl rollout status deployment \
      --namespace "${namespace}" \
      --selector "${selector}" \
      --timeout "${TIMEOUT}"
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

echo "Adding HashiCorp Helm repository"
helm repo add hashicorp https://helm.releases.hashicorp.com
helm repo update

if [[ "${INSTALL_VAULT_SERVER}" == "true" ]]; then
  echo "Installing Vault server ${VAULT_CHART_VERSION} in dev mode into namespace ${VAULT_NAMESPACE}"
  helm upgrade --install "${VAULT_RELEASE}" hashicorp/vault \
    --version "${VAULT_CHART_VERSION}" \
    --namespace "${VAULT_NAMESPACE}" \
    --create-namespace \
    --values "${SCRIPT_DIR}/server-values.yaml" \
    --set "server.dev.devRootToken=${VAULT_DEV_ROOT_TOKEN}" \
    --wait \
    --timeout "${TIMEOUT}"

  echo "Waiting for Vault server"
  rollout_if_present "${VAULT_NAMESPACE}" statefulset "${VAULT_RELEASE}"
fi

echo "Installing Vault Secrets Operator ${VSO_CHART_VERSION} into namespace ${VSO_NAMESPACE}"
helm upgrade --install "${VSO_RELEASE}" hashicorp/vault-secrets-operator \
  --version "${VSO_CHART_VERSION}" \
  --namespace "${VSO_NAMESPACE}" \
  --create-namespace \
  --values "${SCRIPT_DIR}/operator-values.yaml" \
  --wait \
  --timeout "${TIMEOUT}"

echo "Waiting for Vault Secrets Operator"
rollout_selector_if_present "${VSO_NAMESPACE}" "app.kubernetes.io/instance=${VSO_RELEASE}"

if [[ "${APPLY_EXAMPLE}" == "true" ]]; then
  echo "Applying sample Vault secret sync resources to namespace ${APP_NAMESPACE}"
  kubectl create namespace "${APP_NAMESPACE}" --dry-run=client --output yaml | kubectl apply -f -
  kubectl apply --namespace "${APP_NAMESPACE}" -f "${SCRIPT_DIR}/vault-static-secret.yaml"

  echo "Vault Secrets Operator sample resources"
  kubectl get serviceaccount,vaultconnection,vaultauth,vaultstaticsecret --namespace "${APP_NAMESPACE}"
fi

echo "Vault Secrets Operator pods"
kubectl get pods --namespace "${VSO_NAMESPACE}"

if [[ "${INSTALL_VAULT_SERVER}" == "true" ]]; then
  echo "Vault server pods"
  kubectl get pods --namespace "${VAULT_NAMESPACE}"
fi

echo "Vault Secrets Operator install complete"
