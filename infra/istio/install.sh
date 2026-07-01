#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

ISTIO_NAMESPACE="${ISTIO_NAMESPACE:-istio-system}"
ISTIO_OPERATOR_FILE="${ISTIO_OPERATOR_FILE:-${SCRIPT_DIR}/istio-operator.yaml}"
ISTIOCTL_AUTO_INSTALL="${ISTIOCTL_AUTO_INSTALL:-true}"
ISTIOCTL_BIN="${ISTIOCTL_BIN:-}"
TIMEOUT="${TIMEOUT:-300s}"
VERIFY="${VERIFY:-true}"
APPLY_INJECTION="${APPLY_INJECTION:-false}"
APP_NAMESPACE="${APP_NAMESPACE:-default}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

resolve_istioctl() {
  if [[ -n "${ISTIOCTL_BIN}" && -x "${ISTIOCTL_BIN}" ]]; then
    return
  fi

  if command -v istioctl >/dev/null 2>&1; then
    ISTIOCTL_BIN="$(command -v istioctl)"
    return
  fi

  if [[ -x "${SCRIPT_DIR}/bin/istioctl" ]]; then
    ISTIOCTL_BIN="${SCRIPT_DIR}/bin/istioctl"
    return
  fi

  if [[ "${ISTIOCTL_AUTO_INSTALL}" != "true" ]]; then
    echo "Missing required command: istioctl" >&2
    echo "Install istioctl or run ./infra/istio/install-istioctl.sh" >&2
    exit 1
  fi

  echo "istioctl not found; installing a local copy into ${SCRIPT_DIR}/bin"
  "${SCRIPT_DIR}/install-istioctl.sh"
  ISTIOCTL_BIN="${SCRIPT_DIR}/bin/istioctl"
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

istioctl_has_command() {
  local command_name="$1"

  "${ISTIOCTL_BIN}" --help 2>/dev/null | grep -Eq "^[[:space:]]+${command_name}[[:space:]]"
}

need kubectl
need grep
resolve_istioctl

echo "Using Kubernetes context: $(kubectl config current-context)"
echo "Using istioctl: $(${ISTIOCTL_BIN} version --remote=false 2>/dev/null | tr '\n' ' ')"

echo "Creating Istio namespace ${ISTIO_NAMESPACE}"
kubectl create namespace "${ISTIO_NAMESPACE}" --dry-run=client --output yaml | kubectl apply -f -

echo "Installing Istio with ${ISTIO_OPERATOR_FILE}"
"${ISTIOCTL_BIN}" install \
  --filename "${ISTIO_OPERATOR_FILE}" \
  --skip-confirmation

echo "Waiting for Istio control plane"
rollout_if_present "${ISTIO_NAMESPACE}" deployment istiod
rollout_if_present "${ISTIO_NAMESPACE}" deployment istio-ingressgateway

if [[ "${VERIFY}" == "true" ]]; then
  if istioctl_has_command verify-install; then
    echo "Verifying Istio install"
    "${ISTIOCTL_BIN}" verify-install --filename "${ISTIO_OPERATOR_FILE}"
  else
    echo "Skipping istioctl verify-install; this istioctl version does not include that command"
  fi
fi

if [[ "${APPLY_INJECTION}" == "true" ]]; then
  echo "Enabling sidecar injection in namespace ${APP_NAMESPACE}"
  kubectl create namespace "${APP_NAMESPACE}" --dry-run=client --output yaml | kubectl apply -f -
  kubectl label namespace "${APP_NAMESPACE}" istio-injection=enabled --overwrite
fi

echo "Istio pods"
kubectl get pods --namespace "${ISTIO_NAMESPACE}"

echo "Istio services"
kubectl get svc --namespace "${ISTIO_NAMESPACE}"

echo "Istio install complete"
