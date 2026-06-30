# Prometheus Operator

This installs Prometheus Operator on Kubernetes with the community
`kube-prometheus-stack` Helm chart.

It follows the Prometheus Operator installation guidance:

- https://prometheus-operator.dev/docs/getting-started/installation/

```bash
./infra/prometheus/install.sh
```

The default installer:

- applies `infra/prometheus/setup.yaml`
- adds the Prometheus Community Helm repository
  `https://prometheus-community.github.io/helm-charts`
- installs `prometheus-community/kube-prometheus-stack`
- uses release `prometheus`
- creates and uses namespace `monitoring`
- installs Prometheus Operator CRDs through Helm
- installs Prometheus, Alertmanager, kube-state-metrics, and node-exporter
- disables Grafana
- waits for the core deployments and StatefulSets
- leaves sample application monitoring disabled unless requested

## Pin the Helm chart

By default the installer uses the latest chart available from the configured Helm
repository. Pin a chart version for reproducible installs:

```bash
PROMETHEUS_CHART_VERSION=<version> ./infra/prometheus/install.sh
```

Check available versions with:

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm search repo prometheus-community/kube-prometheus-stack --versions
```

## Values

`infra/prometheus/values.yaml` keeps the stack useful for local and shared
development:

- Prometheus retention is `7d`
- scrape and rule evaluation intervals are `30s`
- ServiceMonitors, PodMonitors, Probes, and PrometheusRules can be discovered
  across namespaces
- Grafana is disabled
- kube-state-metrics and node-exporter are enabled

Review and adjust this file before production use, especially:

- Prometheus retention and storage
- Alertmanager receivers and routes
- ServiceMonitor and PodMonitor namespace selectors
- resource requests and limits

## Monitor an app

`infra/prometheus/sample-servicemonitor.yaml` shows the expected shape for an app
that exposes metrics on a named service port:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
```

Apply the sample during install:

```bash
APPLY_SAMPLE_MONITOR=true ./infra/prometheus/install.sh
```

Or apply it later:

```bash
kubectl apply --namespace monitoring -f ./infra/prometheus/sample-servicemonitor.yaml
```

For it to match a real service, the service in the `default` namespace must have:

```yaml
metadata:
  labels:
    app.kubernetes.io/name: sample-app
spec:
  ports:
    - name: http-metrics
      port: 8080
```

## View Prometheus and Alertmanager

Forward the UIs to localhost:

```bash
./infra/prometheus/forward-port.sh
```

This exposes:

| UI | Address |
| --- | --- |
| Prometheus | http://localhost:9090 |
| Alertmanager | http://localhost:9093 |

## Configuration knobs

- `PROMETHEUS_NAMESPACE`, default `monitoring`
- `PROMETHEUS_RELEASE`, default `prometheus`
- `PROMETHEUS_CHART_VERSION`, default empty, which uses the latest chart
- `TIMEOUT`, default `300s`
- `APPLY_SAMPLE_MONITOR`, default `false`
- `PROMETHEUS_LOCAL_PORT`, default `9090`
- `ALERTMANAGER_LOCAL_PORT`, default `9093`
- `FORWARD_ALERTMANAGER`, default `true`

## Verify

```bash
kubectl get pods --namespace monitoring
kubectl api-resources --api-group='monitoring.coreos.com'
kubectl get prometheus,alertmanager,servicemonitor,podmonitor --namespace monitoring
helm status prometheus --namespace monitoring
```

Prometheus Operator should provide CRDs such as `Prometheus`, `Alertmanager`,
`ServiceMonitor`, `PodMonitor`, `Probe`, and `PrometheusRule`.

## Uninstall

```bash
./infra/prometheus/uninstall.sh
```

Delete the sample ServiceMonitor as well:

```bash
DELETE_SAMPLE_MONITOR=true ./infra/prometheus/uninstall.sh
```

Helm does not remove CRDs on uninstall. Any PersistentVolumeClaims created by
production storage settings should be reviewed and deleted separately.
