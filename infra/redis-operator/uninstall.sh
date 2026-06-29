#!/usr/bin/env bash
set -euo pipefail

REDIS_OPERATOR_NAMESPACE="${REDIS_OPERATOR_NAMESPACE:-ot-operators}"
REDIS_OPERATOR_RELEASE="${REDIS_OPERATOR_RELEASE:-redis-operator}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need helm

helm uninstall "${REDIS_OPERATOR_RELEASE}" --namespace "${REDIS_OPERATOR_NAMESPACE}"
