#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

ISTIO_VERSION="${ISTIO_VERSION:-}"
INSTALL_DIR="${INSTALL_DIR:-${SCRIPT_DIR}/bin}"
TMP_DIR="${TMP_DIR:-}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

cleanup() {
  if [[ -n "${TMP_DIR}" && -d "${TMP_DIR}" ]]; then
    rm -rf "${TMP_DIR}"
  fi
}

need curl
need find
need install
need mktemp

TMP_DIR="$(mktemp -d)"
trap cleanup EXIT

mkdir -p "${INSTALL_DIR}"

echo "Downloading istioctl with the official Istio installer"
if [[ -n "${ISTIO_VERSION}" ]]; then
  (
    cd "${TMP_DIR}"
    curl -L https://istio.io/downloadIstio | ISTIO_VERSION="${ISTIO_VERSION}" sh -
  )
else
  (
    cd "${TMP_DIR}"
    curl -L https://istio.io/downloadIstio | sh -
  )
fi

ISTIOCTL_PATH="$(find "${TMP_DIR}" -path '*/bin/istioctl' -type f | head -n 1)"
if [[ -z "${ISTIOCTL_PATH}" ]]; then
  echo "Downloaded Istio release did not contain bin/istioctl" >&2
  exit 1
fi

install -m 0755 "${ISTIOCTL_PATH}" "${INSTALL_DIR}/istioctl"

echo "Installed ${INSTALL_DIR}/istioctl"
"${INSTALL_DIR}/istioctl" version --remote=false
