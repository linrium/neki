#!/usr/bin/env bash
set -euo pipefail

METRICS_SERVER_URL="${METRICS_SERVER_URL:-https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml}"
TIMEOUT="${TIMEOUT:-180s}"
DOCKER_DESKTOP_COMPAT="${DOCKER_DESKTOP_COMPAT:-true}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

deployment_args() {
  kubectl get deployment metrics-server \
    --namespace kube-system \
    --output 'jsonpath={range .spec.template.spec.containers[0].args[*]}{.}{"\n"}{end}'
}

has_deployment_arg() {
  local arg="$1"

  deployment_args | grep -Fx -- "${arg}" >/dev/null 2>&1
}

add_deployment_arg() {
  local arg="$1"

  if has_deployment_arg "${arg}"; then
    return
  fi

  kubectl patch deployment metrics-server \
    --namespace kube-system \
    --type json \
    --patch "[{\"op\":\"add\",\"path\":\"/spec/template/spec/containers/0/args/-\",\"value\":\"${arg}\"}]"
}

need kubectl
need grep

echo "Installing Kubernetes Metrics Server"
kubectl apply -f "${METRICS_SERVER_URL}"

if [[ "${DOCKER_DESKTOP_COMPAT}" == "true" ]]; then
  echo "Enabling Docker Desktop Metrics Server compatibility"
  add_deployment_arg "--kubelet-insecure-tls"
fi

echo "Waiting for Metrics Server"
kubectl rollout status deployment/metrics-server \
  --namespace kube-system \
  --timeout "${TIMEOUT}"

echo "Metrics Server status"
kubectl get deployment metrics-server --namespace kube-system

echo "Metrics install complete"
