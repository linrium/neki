# Observability

This installs a local Kubernetes observability stack:

- Prometheus and Grafana with `prometheus-community/kube-prometheus-stack`
- Loki with `grafana/loki`
- Tempo with `grafana/tempo`
- Alloy with `grafana/alloy`

All components install into the `observability` namespace by default.

```bash
./infra/observability/install.sh
```

## How the stack connects

- Alloy tails Kubernetes pod logs from node log files and sends them to Loki.
- Alloy discovers pods with `prometheus.io/scrape: "true"` and remote-writes their metrics to Prometheus.
- Alloy exposes OTLP gRPC on port `4317` and OTLP HTTP on port `4318`, then forwards OTLP metrics to Prometheus and OTLP traces to Tempo.
- Grafana is installed with Prometheus, Loki, and Tempo data sources.
- `knative-servicemonitors.yaml` adds ServiceMonitors for Knative Serving, Knative Eventing, and Dapr control plane metrics.

## Send workload telemetry to Alloy

Point OpenTelemetry SDKs or collectors at the Alloy service:

```text
OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy.observability.svc.cluster.local:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

For gRPC:

```text
OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy.observability.svc.cluster.local:4317
OTEL_EXPORTER_OTLP_PROTOCOL=grpc
```

For Knative services, set those environment variables on the `Service` template.
Alloy will also add Knative labels such as `knative_service` to logs and scraped
metrics when the Kubernetes labels are present.

## Scrape pod metrics

Add Prometheus annotations to pods or Knative service templates:

```yaml
metadata:
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "9090"
    prometheus.io/path: /metrics
```

## Access Grafana

```bash
kubectl port-forward --namespace observability svc/prometheus-grafana 3000:80
```

Open `http://localhost:3000`.

- Username: `admin`
- Password: `prom-operator`

## Configuration knobs

- `OBSERVABILITY_NAMESPACE`, default `observability`
- `PROMETHEUS_RELEASE`, default `prometheus`
- `LOKI_RELEASE`, default `loki`
- `TEMPO_RELEASE`, default `tempo`
- `ALLOY_RELEASE`, default `alloy`
- `TIMEOUT`, default `600s`
- `APPLY_KNATIVE_MONITORS`, default `true`
- `PROMETHEUS_CHART_VERSION`, optional
- `LOKI_CHART_VERSION`, optional
- `TEMPO_CHART_VERSION`, optional
- `ALLOY_CHART_VERSION`, optional

Pin chart versions when you need reproducible installs:

```bash
PROMETHEUS_CHART_VERSION=75.0.0 \
LOKI_CHART_VERSION=6.30.0 \
TEMPO_CHART_VERSION=1.23.0 \
ALLOY_CHART_VERSION=1.1.0 \
./infra/observability/install.sh
```

## Verify

```bash
kubectl get pods --namespace observability
kubectl get servicemonitors --namespace observability
helm status prometheus --namespace observability
helm status loki --namespace observability
helm status tempo --namespace observability
helm status alloy --namespace observability
```

Check Alloy logs if telemetry is missing:

```bash
kubectl logs --namespace observability daemonset/alloy
```
