# Running and Testing Worker Runtime

This guide covers building, running, and testing the Neki worker runtime
locally and on Kubernetes.

## Prerequisites

| Tool | Purpose | Install |
|------|---------|---------|
| Rust 1.85+ | Build supervisor and gateway | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Node.js 22+ | Run `workerd` locally | [nodejs.org](https://nodejs.org) |
| workerd | JavaScript runtime | `npm install -g workerd` |
| RustFS (or MinIO) | Script storage for local dev | see [infra/rustfs](../infra/rustfs/README.md) |
| kubectl + cluster | Kubernetes deployment | depends on environment |
| envsubst | Template K8s manifests | `brew install gettext` (macOS) |
| curl | Test endpoints | usually pre-installed |

Check your environment:

```bash
rustc --version
node --version
npx workerd --version 2>/dev/null || npm install -g workerd
kubectl version --client
```

---

## Architecture Recap

```
Client -> Kong -> neki-worker-router (gateway) -> neki-worker-node pod
                                                    -> Rust supervisor
                                                      -> manifest API (:9000)
                                                      -> workerd child (:8080)
                                                        -> router.js
                                                        -> app workers
```

Two Rust binaries plus a stable JavaScript router worker:

| Crate | Binary | Role |
|-------|--------|------|
| `packages/neki-worker-node` | `neki-worker-node` | Supervisor: downloads scripts, generates config, manages workerd |
| `packages/neki-worker-router` | `neki-worker-router` | Gateway: routes external traffic to the right pod |
| `packages/neki-worker-node/assets/router.js` | (embedded in workerd) | In-process router: dispatches to app worker service bindings |

---

## 1. Build

### 1.1 Build the Rust binaries

```bash
# Supervisor
cd packages/neki-worker-node
cargo build --release
# Binary: target/release/neki-worker-node

# Gateway
cd packages/neki-worker-router
cargo build --release
# Binary: target/release/neki-worker-router
```

### 1.2 Run unit tests

```bash
cd packages/neki-worker-node
cargo test
```

Expected output:

```
running 3 tests
test reconcile::tests::test_binding_generation ... ok
test reconcile::tests::test_graph_changed_new_worker ... ok
test reconcile::tests::test_graph_not_changed_same_state ... ok

test result: ok. 3 passed; 0 failed
```

### 1.3 Build Docker images (optional, for Kubernetes)

```bash
docker build -t neki/worker-node:latest packages/neki-worker-node
docker build -t neki/worker-router:latest packages/neki-worker-router
```

---

## 2. Local Development (no Kubernetes)

This section runs the full stack on your machine using file-based assignment
and a local RustFS/MinIO instance.

### 2.1 Start a local S3-compatible store

Use MinIO for local development:

```bash
docker run -d --name minio \
  -p 9000:9000 \
  -e MINIO_ROOT_USER=neki-rustfs \
  -e MINIO_ROOT_PASSWORD=neki-rustfs-secret \
  minio/minio server /data
```

Create the `workers` bucket:

```bash
docker run --rm --network host minio/mc \
  alias set local http://localhost:9000 neki-rustfs neki-rustfs-secret
docker run --rm --network host minio/mc \
  mb local/workers
```

### 2.2 Upload a worker bundle

```bash
cd packages/neki-controlplane
cargo run -- rustfs upload-worker \
  --file ../../examples/workerd-hello/worker.js \
  --worker-id hello \
  --version 2026-07-01.1 \
  --endpoint http://localhost:9000
```

This prints JSON like:

```json
{
  "worker_id": "hello",
  "version": "2026-07-01.1",
  "bucket": "workers",
  "key": "workers/hello/2026-07-01.1/worker.js",
  "script_url": "rustfs://workers/workers/hello/2026-07-01.1/worker.js",
  "sha256": "abcd1234...",
  "size_bytes": 794,
  "endpoint": "http://localhost:9000"
}
```

Copy the `sha256` value; you need it for the assignment file.

### 2.3 Create the assignment file

Edit `examples/worker-node/assignment.json` and replace
`REPLACE_WITH_ACTUAL_SHA256` with the real SHA-256 from step 2.2.

```json
{
  "pool_id": "public-small",
  "node_id": "local",
  "generation": "1",
  "workers": [
    {
      "worker_id": "hello",
      "version": "2026-07-01.1",
      "script_url": "rustfs://workers/workers/hello/2026-07-01.1/worker.js",
      "sha256": "<real sha256 here>",
      "compatibility_date": "2025-06-01"
    }
  ],
  "routes": [
    {
      "host": "*",
      "path_prefix": "/hello",
      "methods": ["GET", "POST"],
      "worker_id": "hello"
    }
  ]
}
```

### 2.4 Run the supervisor

```bash
cd packages/neki-worker-node

RUSTFS_ENDPOINT=http://localhost:9000 \
RUSTFS_ACCESS_KEY=neki-rustfs \
RUSTFS_SECRET_KEY=neki-rustfs-secret \
NEKI_ROUTER_JS=./assets/router.js \
NEKI_WORKERD_BIN=workerd \
NEKI_STATE_DIR=/tmp/neki-worker \
NEKI_MANIFEST_LISTEN=127.0.0.1:9001 \
NEKI_WORKERD_LISTEN=0.0.0.0:8080 \
NEKI_ASSIGNMENT_FILE=../../examples/worker-node/assignment.json \
NEKI_RECONCILE_INTERVAL_SECS=5 \
cargo run -- \
  --pool-id=public-small \
  --node-id=local \
  --state-dir=/tmp/neki-worker \
  --manifest-listen=127.0.0.1:9001 \
  --workerd-listen=0.0.0.0:8080 \
  --workerd-bin=workerd \
  --router-js=./assets/router.js \
  --assignment-file=../../examples/worker-node/assignment.json \
  --reconcile-interval-secs=5
```

The supervisor will:
1. Read the assignment file
2. Download `worker.js` from RustFS at `localhost:9000`
3. Verify SHA-256
4. Write `/tmp/neki-worker/config.capnp` and `/tmp/neki-worker/workers/hello.js`
5. Copy `router.js` into `/tmp/neki-worker/router.js`
6. Start `workerd serve /tmp/neki-worker/config.capnp`

### 2.5 Verify the supervisor

Check the manifest API:

```bash
# Liveness
curl http://127.0.0.1:9001/healthz
# -> ok

# Readiness (returns 503 until workers are loaded)
curl -i http://127.0.0.1:9001/readyz

# Manifest
curl http://127.0.0.1:9001/manifest | jq .
```

Expected manifest:

```json
{
  "generation": "1",
  "node_id": "local",
  "pool_id": "public-small",
  "routes": [
    {
      "host": "*",
      "path_prefix": "/hello",
      "methods": ["GET", "POST"],
      "binding": "WORKER_HELLO",
      "workerId": "hello",
      "workerVersion": "2026-07-01.1"
    }
  ],
  "workers": [
    {
      "worker_id": "hello",
      "version": "2026-07-01.1",
      "sha256": "abcd1234...",
      "binding": "WORKER_HELLO",
      "loaded": true
    }
  ]
}
```

### 2.6 Send traffic through workerd

```bash
# Should route to the hello worker via router.js
curl http://localhost:8080/hello
curl http://localhost:8080/hello/echo -X POST -d '{"key":"value"}'

# Unmatched path returns 404 from router.js
curl -i http://localhost:8080/nonexistent
```

The response includes debugging headers added by router.js:

```
x-neki-generation: 1
x-neki-node: local
x-neki-worker: hello
x-neki-worker-version: 2026-07-01.1
```

### 2.7 Run the routing gateway (optional)

In a second terminal:

```bash
cd packages/neki-worker-router

cargo run -- \
  --listen=0.0.0.0:8081 \
  --routing-table-file=../../examples/worker-node/routing-table.json \
  --routing-table-refresh-secs=5
```

The example routing table points `/hello` to `127.0.0.1:8080` (the workerd
port from step 2.4).

Send traffic through the gateway:

```bash
curl http://localhost:8081/hello
```

### 2.8 Test reconciliation (hot route update)

Edit `examples/worker-node/assignment.json` and change the route:

```json
    "path_prefix": "/hello/v2",
```

Wait up to `reconcile-interval-secs` seconds. The supervisor will update the
manifest without restarting workerd (route-only change). Verify:

```bash
curl http://127.0.0.1:9001/manifest | jq '.routes[0].pathPrefix'
# "/hello/v2"

curl http://localhost:8080/hello/v2
# -> hello worker response
```

### 2.9 Test reconciliation (worker graph change)

Edit `examples/worker-node/assignment.json` and bump the worker version:

```json
    "version": "2026-07-01.2",
    "script_url": "rustfs://workers/workers/hello/2026-07-01.2/worker.js",
    "sha256": "<new sha256>"
```

Upload the new version first:

```bash
cd packages/neki-controlplane
cargo run -- rustfs upload-worker \
  --file ../../examples/workerd-hello/worker.js \
  --worker-id hello \
  --version 2026-07-01.2 \
  --endpoint http://localhost:9000
```

On the next reconcile tick, the supervisor will:
1. Detect the version change
2. Download and verify the new script
3. Regenerate `config.capnp`
4. Restart workerd

Watch the logs for:

```
INFO restarting workerd: download=true, graph_changed=true, ...
INFO workerd restarted with new state generation=1 workers=1
```

### 2.10 Inspect generated files

```bash
ls /tmp/neki-worker/
# config.capnp  router.js  workers/

cat /tmp/neki-worker/config.capnp
cat /tmp/neki-worker/workers/hello.js
```

---

## 3. Kubernetes Deployment

### 3.1 Prerequisites

Ensure RustFS is installed in the cluster:

```bash
./infra/rustfs/install.sh
kubectl get pods -n rustfs
```

Ensure the `workers` bucket exists (the RustFS installer creates it by
default; verify with the MinIO console at `localhost:9001` after port-forward).

### 3.2 Build and push images

```bash
docker build -t neki/worker-node:latest packages/neki-worker-node
docker build -t neki/worker-router:latest packages/neki-worker-router

# Push to your registry
docker tag neki/worker-node:latest <registry>/neki-worker-node:latest
docker push <registry>/neki-worker-node:latest

docker tag neki/worker-router:latest <registry>/neki-worker-router:latest
docker push <registry>/neki-worker-router:latest
```

### 3.3 Create the RustFS credentials secret

```bash
RUSTFS_ACCESS_KEY=neki-rustfs \
RUSTFS_SECRET_KEY=neki-rustfs-secret \
NAMESPACE=neki \
NAME=neki-rustfs-credentials \
envsubst < infra/worker-node/rustfs-secret.yaml | kubectl apply -f -
```

### 3.4 Deploy the worker-node

```bash
NODE_IMAGE=<registry>/neki-worker-node:latest \
./infra/worker-node/install.sh
```

Verify:

```bash
kubectl get pods,svc -n neki -l app.kubernetes.io/name=neki-worker-node
kubectl logs -n neki -l app.kubernetes.io/name=neki-worker-node --tail=20
```

### 3.5 Deploy the routing gateway

```bash
ROUTER_IMAGE=<registry>/neki-worker-router:latest \
./infra/worker-router/install.sh
```

Verify:

```bash
kubectl get pods,svc -n neki -l app.kubernetes.io/name=neki-worker-router
```

### 3.6 Add the Kong route

```bash
kubectl apply -f infra/kong/neki-worker-route.yaml
```

This creates an HTTPRoute so Kong sends `/workers/*` to the gateway.

### 3.7 Upload a worker and test end-to-end

Port-forward RustFS and upload:

```bash
kubectl port-forward -n rustfs svc/rustfs-svc 9000:9000 &

cd packages/neki-controlplane
cargo run -- rustfs upload-worker \
  --file ../../examples/workerd-hello/worker.js \
  --worker-id hello \
  --version 2026-07-01.1 \
  --endpoint http://localhost:9000
```

The assignment file mechanism is for local development. In Kubernetes the
supervisor expects assignments from the control plane (future work). For now,
you can mount a ConfigMap with the assignment JSON and point
`NEKI_ASSIGNMENT_FILE` at it for testing.

Port-forward the worker-node service and test:

```bash
kubectl port-forward -n neki svc/neki-worker-node 8080:80 &
curl http://localhost:8080/hello
```

Port-forward the gateway and test:

```bash
kubectl port-forward -n neki svc/neki-worker-router 8081:80 &
curl http://localhost:8081/hello
```

---

## 4. Troubleshooting

### workerd fails to start

Check the supervisor logs:

```bash
# Local
RUST_LOG=debug cargo run -- ... 2>&1 | grep workerd

# Kubernetes
kubectl logs -n neki -l app.kubernetes.io/name=neki-worker-node --tail=50
```

Common causes:
- `workerd` binary not found: ensure `--workerd-bin` points to the right path
- Malformed `config.capnp`: inspect the generated file at `$STATE_DIR/config.capnp`
- Missing Cap'n Proto imports: workerd needs `/workerd/workerd.capnp` available

### SHA-256 mismatch on download

The supervisor refuses to load scripts whose checksum does not match. Ensure
the `sha256` in the assignment matches the value printed by `upload-worker`.

To re-compute:

```bash
sha256sum examples/workerd-hello/worker.js
```

### Manifest API returns 503

The readiness endpoint returns 503 until at least one worker is loaded. Check:

```bash
curl http://127.0.0.1:9001/workers | jq .
```

If `workers` is empty, the assignment file is missing or the download failed.
Check logs for download errors.

### Router returns 503 (binding unavailable)

This means the route matched in the manifest but the service binding is not
available in the workerd config. The config.capnp may be stale. Check that
the generated config includes the expected worker service entry.

### Gateway returns 404

The gateway did not match any route. Verify the routing table:

```bash
# Local: inspect the JSON file
cat examples/worker-node/routing-table.json | jq .

# Verify host, path_prefix, and methods match your request
```

### Gateway returns 503 (no healthy target)

All targets are marked unhealthy or the targets list is empty. Update the
routing table JSON with the correct pod IPs and `healthy: true`.

### Cleaning up local state

```bash
# Remove generated runtime files
rm -rf /tmp/neki-worker

# Stop local MinIO
docker stop minio && docker rm minio

# Uninstall from Kubernetes
helm uninstall rustfs --namespace rustfs
kubectl delete namespace neki
```

---

## 5. Configuration Reference

### neki-worker-node flags and env vars

| Flag | Env var | Default | Description |
|------|---------|---------|-------------|
| `--pool-id` | `NEKI_POOL_ID` | `default` | Pool this node belongs to |
| `--node-id` | `NEKI_NODE_ID` | `local` | Unique node identifier |
| `--state-dir` | `NEKI_STATE_DIR` | `/var/lib/neki/workerd` | Runtime files directory |
| `--manifest-listen` | `NEKI_MANIFEST_LISTEN` | `127.0.0.1:9000` | Manifest API bind address |
| `--workerd-listen` | `NEKI_WORKERD_LISTEN` | `0.0.0.0:8080` | workerd HTTP bind address |
| `--workerd-bin` | `NEKI_WORKERD_BIN` | `workerd` | Path to workerd binary |
| `--router-js` | `NEKI_ROUTER_JS` | `/opt/neki/router.js` | Path to stable router.js |
| `--assignment-file` | `NEKI_ASSIGNMENT_FILE` | (none) | Local assignment JSON (dev mode) |
| `--reconcile-interval-secs` | `NEKI_RECONCILE_INTERVAL_SECS` | `10` | Reconcile poll interval |
| `--compatibility-date` | `NEKI_COMPATIBILITY_DATE` | `2025-06-01` | workerd compatibility date |
| `--pod-ip` | `NEKI_POD_IP` | (none) | Pod IP for routing table |
| `--pod-port` | `NEKI_POD_PORT` | `8080` | Pod port for routing table |
| `--rustfs-endpoint` | `RUSTFS_ENDPOINT` | `http://rustfs-svc...` | RustFS S3 endpoint |
| `--rustfs-access-key` | `RUSTFS_ACCESS_KEY` | `neki-rustfs` | RustFS access key |
| `--rustfs-secret-key` | `RUSTFS_SECRET_KEY` | `neki-rustfs-secret` | RustFS secret key |
| `--rustfs-region` | `RUSTFS_REGION` | `us-east-1` | RustFS region |
| `--rustfs-workers-bucket` | `RUSTFS_WORKERS_BUCKET` | `workers` | Bucket for worker bundles |

### neki-worker-router flags and env vars

| Flag | Env var | Default | Description |
|------|---------|---------|-------------|
| `--listen` | `NEKI_GATEWAY_LISTEN` | `0.0.0.0:80` | Gateway listen address |
| `--routing-table-file` | `NEKI_ROUTING_TABLE_FILE` | (none) | Local routing table JSON (dev mode) |
| `--routing-table-refresh-secs` | `NEKI_ROUTING_TABLE_REFRESH_SECS` | `5` | Refresh interval |

### Assignment JSON schema

```json
{
  "pool_id": "string",
  "node_id": "string",
  "generation": "string",
  "workers": [
    {
      "worker_id": "string",
      "version": "string",
      "script_url": "rustfs://<bucket>/<key>",
      "sha256": "<hex digest>",
      "compatibility_date": "YYYY-MM-DD"
    }
  ],
  "routes": [
    {
      "host": "* | example.com",
      "path_prefix": "/path",
      "methods": ["GET", "POST"],
      "worker_id": "string"
    }
  ]
}
```

### Routing table JSON schema

```json
{
  "generation": "string",
  "routes": [
    {
      "host": "* | example.com",
      "path_prefix": "/path",
      "methods": ["GET", "POST"],
      "worker_id": "string",
      "targets": [
        {
          "node_id": "string",
          "pod_ip": "10.0.0.1",
          "port": 8080,
          "weight": 1,
          "healthy": true
        }
      ]
    }
  ]
}
```

### Log level

Set `RUST_LOG` to control verbosity:

```bash
RUST_LOG=info cargo run -- ...      # default
RUST_LOG=debug cargo run -- ...     # detailed
RUST_LOG=trace cargo run -- ...     # very verbose
RUST_LOG=neki_worker_node=debug cargo run -- ...  # filter by crate
```
