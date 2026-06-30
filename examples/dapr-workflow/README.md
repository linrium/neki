# Dapr Workflow Order Processing on Knative

Minimal TypeScript + Bun port of Dapr's Python order-processing workflow sample:

- https://github.com/dapr/samples/tree/master/workflow-orderprocessing-python

The original sample uses five Python services. This version keeps the workflow
behavior but simplifies it into one Knative Service:

- `POST /orders` starts a Dapr Workflow instance.
- The workflow runs inventory, payment, and shipping activities.
- Orders with `total >= 1000` wait for a `manager_approval` external event.
- Activities publish order notifications through Dapr pub/sub.
- The same Knative function subscribes to notifications and logs them.
- The app exports OpenTelemetry logs, metrics, and traces to Alloy.

The example reuses an existing Opstree Redis Operator-managed Redis instance for
both Dapr Workflow state and Dapr pub/sub. Knative `min-scale` is set to `1`
because the workflow worker and pub/sub subscriber need a warm pod.

## Prerequisites

- Dapr installed in the cluster, for example `./infra/dapr/install.sh`
- Knative Serving installed, for example `./infra/knative/install.sh`
- Kong Gateway installed with the Knative function route, for example `./infra/kong/install.sh`
- Redis Operator installed, for example `./infra/redis/install.sh`
- An existing Redis instance managed by the Redis Operator
- Observability stack installed, for example `./infra/observability/install.sh`
- Docker
- `kubectl`
- `envsubst`

## Deploy

From this directory:

```bash
./deploy.sh
```

The script builds `dev.local/dapr-workflow:<random-tag>`, applies the Dapr state
store, pub/sub component, Dapr `Configuration`, and deploys the Knative Service.
It does not create Redis.

By default, Dapr connects to an existing same-namespace Redis service named
`redis`:

```text
redis.${NAMESPACE}.svc.cluster.local:6379
```

Point the example at a different operator-managed Redis service when needed:

```bash
REDIS_HOST=redis.shared-cache.svc.cluster.local:6379 ./deploy.sh
```

If your Redis requires a password:

```bash
REDIS_HOST=redis.shared-cache.svc.cluster.local:6379 \
REDIS_PASSWORD='your-password' \
./deploy.sh
```

The Knative Service uses `imagePullPolicy: Always` by default because Docker
Desktop Kubernetes can resolve locally built `dev.local/*` images through its
container runtime. Override it if your cluster needs a different policy:

```bash
IMAGE_PULL_POLICY=IfNotPresent ./deploy.sh
```

Deploy to another namespace:

```bash
NAMESPACE=workflow-demo ./deploy.sh
```

## Invoke

Port-forward Kong Gateway from the repository root:

```bash
./infra/kong/forward-port.sh
```

Kong exposes Knative services through the path-style route
`/api/functions/<function_name>`. For this example:

```bash
FUNCTION_URL=http://localhost:8080/api/functions/dapr-workflow
```

Start an order that completes without approval:

```bash
curl -s -i "${FUNCTION_URL}/orders" \
  -H "Content-Type: application/json" \
  --data @orders/auto-approved.json
```

Start an order that waits for approval:

```bash
curl -s -i "${FUNCTION_URL}/orders" \
  -H "Content-Type: application/json" \
  --data @orders/needs-approval.json
```

The response includes the workflow instance ID:

```json
{
  "id": "order-riley-6ff2a8ce",
  "statusUrl": "/orders/order-riley-6ff2a8ce",
  "approvalUrl": "/orders/order-riley-6ff2a8ce/approve"
}
```

Check status:

```bash
ORDER_ID=order-riley-6ff2a8ce
curl -s "${FUNCTION_URL}/orders/${ORDER_ID}"
```

Approve the order:

```bash
curl -s -i "${FUNCTION_URL}/orders/${ORDER_ID}/approve" \
  -H "Content-Type: application/json" \
  --data @orders/approval.json
```

Reject the order:

```bash
curl -s -i "${FUNCTION_URL}/orders/${ORDER_ID}/approve" \
  -H "Content-Type: application/json" \
  -d '{"approver":"Chris","approved":false}'
```

Watch app logs:

```bash
kubectl logs -n default -l serving.knative.dev/service=dapr-workflow -c user-container -f
```

You should see workflow start messages, `NOTIFY` activity logs, and
`NOTIFICATION RECEIVED` pub/sub subscriber logs.

## Smoke test

After deploying the example and port-forwarding Kong, run the guided smoke test:

```bash
./test.sh
```

The script prints each step as it calls the function URL, starts an
auto-approved order, waits for it to complete, starts a high-value order, waits
for `waiting_for_approval`, sends the approval event, and waits for completion.

The default target is:

```text
http://localhost:8080/api/functions/dapr-workflow
```

Override it when needed:

```bash
FUNCTION_URL=http://localhost:8080/api/functions/dapr-workflow ./test.sh
```

## Observability

The app uses the OpenTelemetry SDK to export logs, metrics, and traces to Alloy
over OTLP HTTP:

```text
http://alloy.observability.svc.cluster.local:4318
```

The Knative template sets:

```text
OTEL_SERVICE_NAME=dapr-workflow
OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy.observability.svc.cluster.local:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_METRIC_EXPORT_INTERVAL=5000
```

The Dapr `Configuration` also sends Dapr sidecar traces to Alloy over OTLP gRPC:

```yaml
tracing:
  samplingRate: "1"
  otel:
    endpointAddress: alloy.observability.svc.cluster.local:4317
    isSecure: false
    protocol: grpc
```

After running orders, check all three signals plus CPU and memory:

```bash
./observability.sh
```

In Grafana:

- Loki: query `{knative_service="dapr-workflow"}`
- Prometheus: query `http_server_request_count_total{service_name="dapr-workflow"}`
- Tempo: search for service `dapr-workflow`

## Files

- `src/server.ts`: Bun HTTP function, workflow client, and Dapr subscription endpoint
- `src/workflow.ts`: Dapr workflow and activities
- `src/telemetry.ts`: OpenTelemetry logs, metrics, and traces to Alloy
- `k8s/statestore.yaml`: Dapr Redis state store with `actorStateStore: true`
- `k8s/pubsub-component.yaml`: Dapr Redis pub/sub component
- `service.yaml`: Knative Service with Dapr sidecar annotations

The service sets `dapr.io/metrics-port: "9092"` to avoid Dapr's default metrics
port `9090`, which conflicts with Knative queue-proxy.
