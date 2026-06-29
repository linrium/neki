# Dapr

This installs the Dapr control plane on Kubernetes with Helm.

Based on Dapr's official Kubernetes deployment tutorial:

- https://v1-18.docs.dapr.io/operations/hosting/kubernetes/kubernetes-deploy/

```bash
./infra/dapr/install.sh
```

The default install follows the official Helm path:

- adds the official Dapr Helm repository `https://dapr.github.io/helm-charts/`
- installs the `dapr/dapr` chart as release `dapr`
- pins the chart version to `1.17`
- creates and uses the `dapr-system` namespace
- waits for the Helm release and control plane rollout
- keeps mTLS enabled
- keeps Prometheus metrics enabled
- leaves high availability disabled for local development by default

## High availability

Install with three control plane replicas where the Dapr chart supports HA:

```bash
ENABLE_HA=true ./infra/dapr/install.sh
```

This adds `infra/dapr/values-ha.yaml`, which sets:

```yaml
global:
  ha:
    enabled: true
    replicaCount: 3
```

## Application configuration

`infra/dapr/configuration.yaml` defines a reusable Dapr `Configuration` named
`neki-dapr-config`. It enables metrics and tracing sampling for application
sidecars that reference it.

Apply it to the `default` namespace during installation:

```bash
APPLY_CONFIGURATION=true ./infra/dapr/install.sh
```

Or choose another application namespace:

```bash
APP_NAMESPACE=my-apps APPLY_CONFIGURATION=true ./infra/dapr/install.sh
```

Reference the configuration from a Dapr-enabled workload:

```yaml
metadata:
  annotations:
    dapr.io/enabled: "true"
    dapr.io/app-id: "my-service"
    dapr.io/app-port: "8080"
    dapr.io/config: "neki-dapr-config"
```

## Configuration knobs

- `DAPR_NAMESPACE`, default `dapr-system`
- `DAPR_RELEASE`, default `dapr`
- `DAPR_CHART_VERSION`, default `1.17`
- `TIMEOUT`, default `300s`
- `ENABLE_HA`, default `false`
- `APPLY_CONFIGURATION`, default `false`
- `APP_NAMESPACE`, default `default`

## Verify

```bash
kubectl get pods --namespace dapr-system
helm status dapr --namespace dapr-system
kubectl get crds | grep dapr.io
```

The official tutorial expects the `dapr-operator`, `dapr-placement`,
`dapr-sidecar-injector`, and `dapr-sentry` pods to be running in
`dapr-system`.

## Uninstall

```bash
./infra/dapr/uninstall.sh
```

Equivalent Helm command:

```bash
helm uninstall dapr --namespace dapr-system
```
