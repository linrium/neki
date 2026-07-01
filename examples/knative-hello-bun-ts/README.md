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

## Dapr Vault secret

The Knative service is annotated for Dapr sidecar injection and reads a secret
through Dapr's HashiCorp Vault secret store component.

Initialize the example's Vault setup:

```bash
export VAULT_ADDR=http://127.0.0.1:8200
./init-vault.sh
```

The script enables KV v2 at `secret/` if needed, writes
`secret/dapr/hello-bun-ts`, creates a read-only policy, and prints a scoped
Vault token for Dapr. Use the printed token to deploy:

```bash
VAULT_TOKEN=<printed-token> APPLY_DAPR_VAULT=true ./deploy.sh
```

Or let the init script write Kubernetes Secret `vault-token` directly:

```bash
WRITE_K8S_SECRET=true ./init-vault.sh
APPLY_DAPR_VAULT=true ./deploy.sh
```

The deploy script creates Kubernetes Secret `vault-token`, applies
`k8s/configuration.yaml` and `k8s/vault-component.yaml`, then deploys the
Knative service. On each `/` request the app calls Dapr at
`/v1.0/secrets/vault/hello-bun-ts`, logs the loaded secret, and returns it in
the JSON response.

The service sets `dapr.io/metrics-port: "9091"` because Knative's queue-proxy
can already bind port `9090` in the same pod.

Defaults in `k8s/vault-component.yaml`:

```text
vaultAddr=http://vault.vault.svc.cluster.local:8200
enginePath=secret
vaultKVPrefix=dapr
vaultValueType=map
```

## Create Postgres from neki-console

Open the neki-console service detail page for `hello-bun-ts`, then choose the
**Postgres** tab. The form creates a CloudNativePG `Cluster`, lets you choose
the database username, generates a random password on the server, writes the
connection fields to the linked Dapr Vault component, and reloads the Knative
service template so a new pod can read the updated Vault secret through Dapr.

For this example, keep the default Vault secret name `hello-bun-ts`; the app
already reads that Dapr secret on each `/` request through:

```text
DAPR_SECRET_STORE=vault
DAPR_SECRET_NAME=hello-bun-ts
```

The Vault payload written by the console includes:

```text
postgresHost
postgresPort
postgresDatabase
postgresUsername
postgresPassword
```

The `/` response lists the Dapr Vault secret keys, marks which keys are required
for Postgres, and reports the connection check result without exposing the
password.

## Create Neon from neki-console

Open the neki-console service detail page for `hello-bun-ts`, then choose the
**Databases** tab. The form creates a RustFS bucket, a Neon `Project`, a Neon
`Branch`, writes the Neon connection fields to the same Dapr Vault secret, and
reloads the Knative service template.

For the Docker Desktop Neon setup, keep the defaults:

```text
Neon namespace=neon
Neon cluster=neki-neon
Postgres version=17
RustFS namespace=rustfs
RustFS endpoint=http://rustfs-svc.rustfs.svc.cluster.local:9000
Vault secret name=hello-bun-ts
```

The console writes the standard `postgres*` keys plus `DATABASE_URL`,
`neonProject`, `neonBranch`, and `rustfsBucket`. Local Neon accepts an empty
`postgresPassword`, and this example allows that when checking the connection.

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
