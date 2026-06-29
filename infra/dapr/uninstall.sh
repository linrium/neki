#!/usr/bin/env bash
set -euo pipefail

DAPR_NAMESPACE="${DAPR_NAMESPACE:-dapr-system}"
DAPR_RELEASE="${DAPR_RELEASE:-dapr}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need helm

helm uninstall "${DAPR_RELEASE}" --namespace "${DAPR_NAMESPACE}"
