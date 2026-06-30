# Knative Hello Bun TypeScript

Minimal Bun TypeScript HTTP service for Knative Serving.

## Run Locally

```bash
bun src/server.ts
```

## Build Image

```bash
docker build -t hello-bun-ts:latest .
```

## Deploy

From this directory:

```bash
./deploy.sh
```

The script builds `dev.local/hello-bun-ts:<random-tag>`, configures Knative to
skip tag-to-digest resolution for `dev.local`, and deploys the service with
`imagePullPolicy: Never` so Docker Desktop Kubernetes uses the local image.

Override just the generated tag if needed:

```bash
IMAGE_TAG=debug ./deploy.sh
```

Override the full image if needed:

```bash
IMAGE=dev.local/hello-bun-ts:debug ./deploy.sh
```

If the revision reports `ErrImageNeverPull`, Kubernetes cannot see an image with
the exact name from the manifest. Re-run `./deploy.sh`; it builds with
`docker buildx build --load` when available and verifies the image exists locally:

```bash
docker image inspect dev.local/hello-bun-ts:<random-tag>
```

## Invoke

Wait until the service is ready:

```bash
kubectl wait ksvc/hello-bun-ts -n default --for=condition=Ready --timeout=180s
```

Port-forward Kourier:

```bash
kubectl port-forward -n knative-serving svc/kourier 8080:80
```

Use the host from the Knative Service URL:

```bash
HOST=$(kubectl get ksvc hello-bun-ts -n default -o jsonpath='{.status.url}' | sed 's#http://##')
curl -H "Host: ${HOST}" http://localhost:8080/
```

## Observability

The service uses the OpenTelemetry SDK to export logs, metrics, and traces to
Alloy over OTLP HTTP:

```text
http://alloy.observability.svc.cluster.local:4318
```

The Knative template sets:

```text
OTEL_SERVICE_NAME=hello-bun-ts
OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy.observability.svc.cluster.local:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_METRIC_EXPORT_INTERVAL=5000
```

After invoking the service, check:

```bash
kubectl logs -n default -l serving.knative.dev/service=hello-bun-ts -c user-container
kubectl port-forward --namespace observability svc/prometheus-grafana 3000:80
```

In Grafana:

- Loki: query `{knative_service="hello-bun-ts"}`
- Prometheus: query `http_server_request_count_total{service_name="hello-bun-ts"}`
- Tempo: search for service `hello-bun-ts`

Or fetch all three signals plus CPU and memory from the command line:

```bash
./observability.sh
```
