#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
OPERATOR_VERSION="${OPERATOR_VERSION:-knative-v1.22.2}"
OPERATOR_URL="https://github.com/knative/operator/releases/download/${OPERATOR_VERSION}/operator.yaml"
TIMEOUT="${TIMEOUT:-180s}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

wait_for_deployment() {
  local namespace="$1"
  local deployment="$2"

  kubectl rollout status "deployment/${deployment}" \
    --namespace "${namespace}" \
    --timeout "${TIMEOUT}"
}

need kubectl

echo "Installing Knative Operator ${OPERATOR_VERSION}"
kubectl apply -f "${OPERATOR_URL}"

echo "Waiting for Knative Operator"
wait_for_deployment knative-operator knative-operator
wait_for_deployment knative-operator operator-webhook

echo "Installing Knative Serving"
kubectl apply -f "${SCRIPT_DIR}/serving.yaml"

echo "Installing Knative Eventing"
kubectl apply -f "${SCRIPT_DIR}/eventing.yaml"

echo "Waiting for Knative Serving"
wait_for_deployment knative-serving activator
wait_for_deployment knative-serving autoscaler
wait_for_deployment knative-serving autoscaler-hpa
wait_for_deployment knative-serving controller
wait_for_deployment knative-serving webhook
wait_for_deployment knative-serving net-kourier-controller
wait_for_deployment knative-serving 3scale-kourier-gateway

echo "Waiting for Knative Eventing"
wait_for_deployment knative-eventing eventing-controller
wait_for_deployment knative-eventing eventing-webhook
wait_for_deployment knative-eventing imc-controller
wait_for_deployment knative-eventing imc-dispatcher
wait_for_deployment knative-eventing job-sink
wait_for_deployment knative-eventing mt-broker-controller
wait_for_deployment knative-eventing mt-broker-filter
wait_for_deployment knative-eventing mt-broker-ingress

echo "Knative Serving status"
kubectl get KnativeServing knative-serving --namespace knative-serving

echo "Knative Eventing status"
kubectl get KnativeEventing knative-eventing --namespace knative-eventing

echo "Knative install complete"
