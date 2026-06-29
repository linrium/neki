#!/usr/bin/env bash
set -euo pipefail

REDIS_OPERATOR_NAMESPACE="${REDIS_OPERATOR_NAMESPACE:-ot-operators}"
REDIS_OPERATOR_RELEASE="${REDIS_OPERATOR_RELEASE:-redis-operator}"
TIMEOUT="${TIMEOUT:-180s}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need helm
need kubectl

echo "Adding Opstree Helm repository"
helm repo add ot-helm https://ot-container-kit.github.io/helm-charts/
helm repo update

echo "Installing Redis Operator into namespace ${REDIS_OPERATOR_NAMESPACE}"
helm upgrade --install "${REDIS_OPERATOR_RELEASE}" ot-helm/redis-operator \
  --namespace "${REDIS_OPERATOR_NAMESPACE}" \
  --create-namespace \
  --set featureGates.GenerateConfigInInitContainer=true \
  --wait \
  --timeout "${TIMEOUT}"

echo "Waiting for Redis Operator"
kubectl rollout status deployment/redis-operator \
  --namespace "${REDIS_OPERATOR_NAMESPACE}" \
  --timeout "${TIMEOUT}"

echo "Redis Operator status"
kubectl get pods --namespace "${REDIS_OPERATOR_NAMESPACE}"

echo "Redis Operator install complete"
