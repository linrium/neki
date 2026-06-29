# Dapr Knative Pub/Sub Routing

Minimal Bun + Knative version of Dapr's pub/sub routing sample.

Based on the official Dapr sample:

- https://github.com/dapr/samples/blob/master/pub-sub-routing/README.md

The sample publishes inventory CloudEvents through the local Dapr sidecar:

- `type: "widget"` routes to `POST /widgets`
- `type: "gadget"` routes to `POST /gadgets`
- all other messages route to `POST /products`

Redis is created by the Opstree Redis Operator and used as the Dapr pub/sub
broker. Knative `min-scale` is set to `1` because a pub/sub subscriber needs a
warm pod to receive messages.

## Prerequisites

- Dapr installed in the cluster, for example `./infra/dapr/install.sh`
- Knative Serving installed, for example `./infra/knative/install.sh`
- Kong Gateway installed with the Knative function route, for example `./infra/kong/install.sh`
- Redis Operator installed, for example `./infra/redis-operator/install.sh`
- Docker
- `kubectl`
- `envsubst`

## Deploy

From this directory:

```bash
./deploy.sh
```

The script builds `dev.local/dapr-knative-pubsub:<random-tag>`, creates a Redis
standalone custom resource, deploys the Dapr Component, the Dapr Subscription,
and the Knative Service.

The Knative Service uses `imagePullPolicy: Always` by default because Docker
Desktop Kubernetes can resolve locally built `dev.local/*` images through its
container runtime. Override it if your cluster needs a different policy:

```bash
IMAGE_PULL_POLICY=IfNotPresent ./deploy.sh
```

Override the generated tag:

```bash
IMAGE_TAG=debug ./deploy.sh
```

Override the full image:

```bash
IMAGE=dev.local/dapr-knative-pubsub:debug ./deploy.sh
```

Deploy to another namespace:

```bash
NAMESPACE=pubsub-demo ./deploy.sh
```

## Invoke

Port-forward Kong Gateway:

```bash
./infra/kong/forward-port.sh
```

Kong exposes Knative services through the path-style route
`/api/functions/<function_name>`. For this example:

```bash
FUNCTION_URL=http://localhost:8080/api/functions/dapr-knative-pubsub
```

Publish a widget:

```bash
curl -s "${FUNCTION_URL}/publish" \
  -H "Content-Type: application/json" \
  --data @messages/widget.json
```

Publish a gadget:

```bash
curl -s "${FUNCTION_URL}/publish" \
  -H "Content-Type: application/json" \
  --data @messages/gadget.json
```

Publish a default-routed product:

```bash
curl -s "${FUNCTION_URL}/publish" \
  -H "Content-Type: application/json" \
  --data @messages/thingamajig.json
```

Watch the app logs:

```bash
kubectl logs -n default -l serving.knative.dev/service=dapr-knative-pubsub -c user-container -f
```

You should see `WIDGET`, `GADGET`, and `PRODUCT default` log lines.

## Files

- `src/server.ts`: Bun HTTP service and publish endpoint
- `k8s/redis.yaml`: Opstree Redis standalone custom resource
- `k8s/pubsub-component.yaml`: Dapr Redis pub/sub component
- `k8s/subscription.yaml`: Dapr routing rules
- `service.yaml`: Knative Service with Dapr sidecar annotations

The service sets `dapr.io/metrics-port: "9092"` to avoid Dapr's default metrics
port `9090`, which conflicts with Knative queue-proxy.
