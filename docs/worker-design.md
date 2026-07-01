# Worker Runtime Design

## Goal

Neki should run Cloudflare Worker-style JavaScript services across a pool of
`workerd` runtime nodes. Kong receives external traffic and sends it to a
routing gateway, which forwards each request to a pod that has the target
worker loaded. A Rust supervisor on each node owns local worker lifecycle:
loading assigned workers, downloading scripts, generating `workerd` config,
publishing status, and restarting `workerd` when required.

The first implementation should support sharded placement: a worker can be
assigned to one pod or a small set of pods, and traffic must be routed to a pod
that actually has that worker loaded. This requires a routing table managed by
the control plane.

## Non-Goals

- Hot-loading arbitrary new worker services into a running `workerd` process.
- Strong isolation for hostile untrusted code inside one `workerd` process.
- One Kong route per worker in the first version.
- A custom JavaScript runtime or custom V8 embedding.

## High-Level Architecture

```text
Client
  -> Kong Gateway
    -> worker-router Service
      -> Rust routing gateway
        -> selected worker-node Pod
          -> Rust supervisor
            -> local manifest API
            -> script downloader
            -> config.capnp renderer
            -> workerd child process
          -> workerd
            -> stable router Worker
            -> one or more app Workers
```

The Rust supervisor is the control point inside each worker-node pod. It should
not be embedded into `workerd`; it should run as the process supervisor that
starts and monitors `workerd`.

## Main Components

### Control Plane

The control plane stores worker and pool desired state.

Suggested data model:

```text
Worker:
  id
  version
  script_url
  sha256
  compatibility_date
  bindings
  limits

Route:
  host
  path_prefix
  methods
  worker_id

Pool:
  id
  namespace
  kubernetes_service
  desired_workers
  replica_count

Assignment:
  pool_id
  node_id
  worker_ids
  route_ids
  generation

RoutingTable:
  generation
  routes:
    host
    path_prefix
    methods
    worker_id
    targets:
      node_id
      pod_ip
      port
      loaded_generation
      weight
      healthy
```

Assignments should be node-level when workers are distributed between pods.
The control plane must publish a routing table that maps each route or worker
ID to the pod endpoints where that worker is currently loaded and healthy.

### Routing Gateway

The routing gateway is a small Rust HTTP proxy in front of worker-node pods.
Kong sends all worker traffic to this gateway. The gateway owns the global
routing table and forwards each request to a pod that has the target worker.

Responsibilities:

- Fetch or watch the routing table from the control plane.
- Match incoming requests by host, method, and longest path prefix.
- Select a healthy target pod for the matched worker.
- Forward the request to the selected worker-node pod.
- Retry another target only when the request is safe to retry.
- Return `404` when no route matches.
- Return `503` when the route exists but no healthy target is available.
- Emit route, worker, target pod, status, and latency logs or metrics.

The gateway should be horizontally scalable. Each gateway replica can keep a
local cached copy of the routing table.

### Rust Supervisor

Each worker-node pod runs one supervisor process. The supervisor is responsible
for local reconciliation.

Responsibilities:

- Fetch the desired assignment for its node.
- Download missing worker scripts.
- Verify each script with `sha256`.
- Write worker files and generated config atomically.
- Render `config.capnp` for `workerd`.
- Start, stop, and restart the `workerd` child process.
- Serve a local manifest API consumed by the router Worker.
- Expose readiness and liveness endpoints.
- Report loaded worker status and current assignment generation.

The supervisor should keep generated runtime state under a writable directory,
for example `/var/lib/neki/workerd`, mounted as `emptyDir`.

### RustFS Worker Storage

Worker JavaScript bundles are stored in RustFS, using its S3-compatible API.
The default worker bucket is `workers`, separate from the Neon bucket used by
database storage.

Worker specs should store immutable RustFS object references:

```text
script_url = "rustfs://workers/workers/hello/2026-07-01.1/worker.js"
sha256 = "..."
```

The supervisor resolves `rustfs://<bucket>/<key>` references into S3
`GetObject` calls against the configured RustFS endpoint.

Runtime configuration:

```text
RUSTFS_ENDPOINT=http://rustfs-svc.rustfs.svc.cluster.local:9000
RUSTFS_ACCESS_KEY=neki-rustfs
RUSTFS_SECRET_KEY=neki-rustfs-secret
RUSTFS_REGION=us-east-1
RUSTFS_WORKERS_BUCKET=workers
```

Download rules:

- Download scripts from RustFS into a temporary file.
- Verify the downloaded bytes against the worker spec `sha256`.
- Atomically rename the verified script into the runtime directory.
- Keep using the last known-good local script if a new download fails.
- Never load a RustFS object without checksum verification.

The RustFS object key should include worker ID and immutable version:

```text
workers/<worker-id>/<version>/worker.js
```

Mutable keys such as `latest/worker.js` should not be used in assignments.

### Worker Upload CLI

The `neki-controlplane` binary includes a CLI for uploading worker bundles to
RustFS:

```bash
cd packages/neki-controlplane
cargo run -- rustfs upload-worker \
  --file ../../examples/workerd-hello/worker.js \
  --worker-id hello \
  --version 2026-07-01.1 \
  --endpoint http://localhost:9000
```

The command uploads to the `workers` bucket by default and prints JSON that can
be stored in the control plane:

```json
{
  "worker_id": "hello",
  "version": "2026-07-01.1",
  "bucket": "workers",
  "key": "workers/hello/2026-07-01.1/worker.js",
  "script_url": "rustfs://workers/workers/hello/2026-07-01.1/worker.js",
  "sha256": "...",
  "size_bytes": 1234,
  "endpoint": "http://localhost:9000"
}
```

If `--version` is omitted, the CLI uses the first 16 hex characters of the
file's SHA-256 digest as the version. The CLI creates the bucket by default.

### workerd

`workerd` runs:

- one stable router Worker
- one or more app Workers

The router Worker receives all HTTP traffic on the public socket. It selects the
target app Worker using route metadata from the supervisor manifest API, then
dispatches the request through a `workerd` service binding.

App Worker services are still config-level state in `workerd`. Adding,
removing, or changing app Worker scripts should be treated as a `workerd`
restart operation.

### Kong

Kong should initially route all worker traffic to the routing gateway Service.

```text
/workers/*
  -> neki-worker-router.default.svc.cluster.local:80
```

Kong should not need to know every worker route in the first version. The Rust
routing gateway owns global route-to-pod selection, and the in-process router
Worker owns final dispatch inside a selected `workerd` process.

Later, Kong can add per-worker or per-domain routes when edge-level policy is
needed:

- custom domains
- route-specific authentication
- rate limits
- request size limits
- tenant-specific plugins

## Dispatch Design

The dispatch layer should separate stable runtime topology from frequently
changing route state.

```text
config.capnp changes:
  - worker added
  - worker removed
  - worker script changed
  - compatibility date changed
  - service binding changed

manifest changes:
  - host mapping changed
  - path prefix changed
  - method mapping changed
  - route enabled or disabled
```

Route changes should not require a `workerd` restart. Worker graph changes can
require a restart.

There are two routing tables:

```text
Global routing table:
  lives in the control plane and routing gateway
  maps external routes to worker-node pod targets

Local manifest:
  lives in each worker-node supervisor
  maps routes loaded on that pod to local workerd service bindings
```

The global routing table must only point to pods that report the target worker
as loaded for the expected worker version and assignment generation.

### Generated workerd Topology

The supervisor generates a `config.capnp` with one router service and one app
service per loaded Worker.

Conceptual shape:

```capnp
using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "router", worker = .routerWorker),
    (name = "worker_hello", worker = .helloWorker),
    (name = "worker_billing", worker = .billingWorker),
  ],

  sockets = [
    (
      name = "http",
      address = "*:8080",
      http = (),
      service = "router"
    ),
  ]
);

const routerWorker :Workerd.Worker = (
  serviceWorkerScript = embed "router.js",
  compatibilityDate = "2025-06-01",
  bindings = [
    (name = "WORKER_HELLO", service = "worker_hello"),
    (name = "WORKER_BILLING", service = "worker_billing"),
  ],
);

const helloWorker :Workerd.Worker = (
  serviceWorkerScript = embed "workers/hello.js",
  compatibilityDate = "2025-06-01",
);
```

Binding names should be derived deterministically from worker IDs and validated
to fit JavaScript identifier constraints.

### Manifest API

The supervisor exposes a local HTTP API on loopback, for example
`127.0.0.1:9000`.

Endpoints:

```text
GET /healthz
GET /readyz
GET /manifest
GET /workers
```

Example manifest:

```json
{
  "generation": "42",
  "routes": [
    {
      "host": "api.example.com",
      "pathPrefix": "/hello",
      "methods": ["GET", "POST"],
      "binding": "WORKER_HELLO",
      "workerId": "hello",
      "workerVersion": "2026-07-01.1"
    }
  ]
}
```

Only routes whose target workers are loaded and healthy should appear in the
manifest. If a worker fails to load, the route should be omitted or marked
unavailable, depending on the failure policy.

For sharded placement, the local manifest is not enough for external routing.
It only describes what the current pod can serve. The routing gateway uses the
global routing table to choose the right pod before traffic reaches this local
router Worker.

### Router Worker

The router Worker should be stable JavaScript checked into the runtime image.
It fetches the manifest from the supervisor and caches it briefly in memory.

Responsibilities:

- Fetch and cache the local manifest.
- Match host, method, and longest path prefix.
- Dispatch to the target service binding.
- Return `404` when no route matches.
- Return `503` when a route exists but the target binding is unavailable.
- Add response headers for runtime debugging, such as worker ID and generation.

Matching should prefer the most specific route:

```text
/api/admin/*
/api/*
/*
```

The router should match `/api/admin/*` before `/api/*`.

## Worker Lifecycle

### Reconcile Loop

The supervisor reconcile loop:

```text
loop:
  desired = fetch node assignment

  download missing scripts to temporary paths
  verify script sha256 values
  atomically install verified scripts

  if loaded worker graph changed:
    render new config.capnp to temporary path
    validate generated config if possible
    restart workerd with new config

  update in-memory manifest
  report loaded worker status to control plane
  publish ready status

  wait for watch event or polling interval
```

### Atomic Writes

Generated files should be written using a temporary file and atomic rename:

```text
workers/hello.js.tmp
workers/hello.js
config.capnp.tmp
config.capnp
```

The supervisor should never expose a partially downloaded script or partially
rendered config to `workerd`.

### Restart Behavior

`workerd` restarts are required when:

- a new app Worker is added
- an app Worker is removed
- an app Worker script changes
- app Worker compatibility settings change
- service bindings change

`workerd` restarts should not be required when:

- a route changes host
- a route changes path prefix
- a route changes allowed methods
- a route is enabled or disabled and the target Worker is already loaded

During restart, readiness should fail so Kubernetes and Kong stop sending new
traffic to the pod. Existing requests may be interrupted in the first version.
Graceful draining can be added later.

With sharded placement, readiness changes must also update the global routing
table. The routing gateway should stop selecting a pod before or immediately
after that pod begins restarting `workerd`.

## Concurrency and Scaling

`workerd` provides dense in-process concurrency using V8 isolates and async
JavaScript execution. This is useful for I/O-heavy Workers because a request can
yield while waiting on network or storage calls.

`workerd` does not provide Kubernetes-style scaling by itself. Scaling should be
handled in layers:

```text
Request concurrency:
  handled inside one workerd process

Pod scaling:
  handled by Kubernetes replicas and HPA/KEDA

Worker placement:
  handled by the Neki control plane

External ingress:
  handled by Kong
```

For the first version, use sharded pools with explicit routing:

```text
pool public-small
  pod-1: hello
  pod-2: billing
  pod-3: auth
```

If a worker needs more capacity, assign it to multiple pods:

```text
pool public-small
  pod-1: hello
  pod-2: hello
  pod-3: billing
```

The routing table for this example maps the `hello` route to `pod-1` and
`pod-2`, while the `billing` route maps to `pod-3`.

This model requires worker-aware routing before requests reach a runtime node.
Kong should still route to one stable Service, but that Service should be the
Neki routing gateway rather than the worker pods directly.

## Kubernetes Deployment Shape

The runtime should use a pinned image containing:

- Rust supervisor binary
- `workerd` binary or pinned package contents
- stable `router.js`
- Cap'n Proto imports required by `workerd`

Example pod shape:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: neki-worker-node
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: neki-worker-node
  template:
    metadata:
      labels:
        app.kubernetes.io/name: neki-worker-node
    spec:
      containers:
        - name: worker-node
          image: neki/worker-node:latest
          args:
            - --pool-id=public-small
            - --node-id=$(POD_NAME)
            - --state-dir=/var/lib/neki/workerd
            - --manifest-listen=127.0.0.1:9000
            - --workerd-listen=0.0.0.0:8080
          env:
            - name: POD_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
          ports:
            - name: http
              containerPort: 8080
            - name: supervisor
              containerPort: 9000
          readinessProbe:
            httpGet:
              path: /readyz
              port: supervisor
          livenessProbe:
            httpGet:
              path: /healthz
              port: supervisor
          volumeMounts:
            - name: runtime
              mountPath: /var/lib/neki/workerd
      volumes:
        - name: runtime
          emptyDir: {}
```

The supervisor API should listen on loopback for the router Worker path. If
Kubernetes probes need to access it directly, expose a separate pod-local port
with careful network policy.

The routing gateway needs a way to reach individual worker-node pods. Use one
of these options:

- direct pod IPs from the routing table
- a headless Service plus pod DNS names
- per-node Services if stricter network policy requires stable Service objects

Direct pod IPs are simplest for the first version, as long as routing table
entries are removed quickly when pods terminate or become unready.

## Security Model

Running multiple Workers inside one `workerd` process is dense but not strong
tenant isolation. Use this model for trusted or semi-trusted Workers first.

Required safeguards:

- Require `sha256` for every downloaded script.
- Prefer immutable script URLs or versioned object keys.
- Restrict script download hosts.
- Run with non-root user.
- Drop Linux capabilities.
- Use read-only root filesystem.
- Store runtime files in `emptyDir`.
- Apply Kubernetes resource requests and limits.
- Use separate pools or pods for higher-risk tenants.

Do not use one shared `workerd` process for hostile untrusted code unless an
additional isolation layer is added, such as VM-backed runtime isolation.

## Observability

The supervisor should emit structured logs and metrics.

Suggested supervisor metrics:

```text
neki_worker_assignment_generation
neki_worker_loaded_total
neki_worker_load_failures_total
neki_worker_script_download_seconds
neki_worker_script_download_failures_total
neki_workerd_restarts_total
neki_workerd_running
```

The router Worker should tag requests with:

- pool ID
- pod name
- assignment generation
- worker ID
- worker version
- route ID
- status code
- latency

The router can expose these as logs initially. Metrics can be added once the
runtime path stabilizes.

The routing gateway should also emit:

- routing table generation
- matched route ID
- selected worker ID
- selected target pod
- target status
- retry count
- upstream latency

## Failure Handling

### Script Download Failure

If a new script version fails to download or verify, the supervisor should keep
serving the currently loaded version and report degraded status for the desired
generation.

### workerd Start Failure

If `workerd` fails to start with the new config, the supervisor should attempt
to roll back to the last known-good config and script set.

### Manifest Fetch Failure

If the router Worker cannot fetch the manifest, it may use a short-lived cached
manifest. Once the cache expires, it should return `503` instead of routing with
stale state indefinitely.

### Worker Missing

If a route points to a worker that is not loaded, the router should return
`503`. The supervisor should avoid publishing such routes in normal operation.

### Stale Routing Table

If the routing gateway has a stale target and forwards to a pod that no longer
has the worker, the pod-local router should return `503`. The gateway should
mark that target suspect, refresh the routing table, and retry another healthy
target only for retry-safe requests.

## Versioning Strategy

Every assignment should have a generation. Every worker should have an immutable
version. Runtime status should report both:

```text
desired_generation
loaded_generation
node_id
pod_ip
worker_id
worker_version
worker_sha256
```

This makes it possible to tell whether a pool is fully converged.

The control plane should only publish a target in the global routing table when
the target pod has reported the expected worker version and loaded generation.

## Implementation Plan

1. Build `neki-worker-node` Rust supervisor.
2. Add local file-based node assignment input for development.
3. Implement script download, checksum verification, and atomic install.
4. Render `config.capnp` for one router Worker and multiple app Workers.
5. Add the stable router Worker and manifest API.
6. Run `workerd` as a child process and wire health/readiness.
7. Report loaded worker status from each node to the control plane.
8. Add the global routing table data model.
9. Build the Rust routing gateway that watches the routing table.
10. Create Kubernetes manifests for worker-node pods and routing gateway pods.
11. Add a Kong route to the routing gateway Service.
12. Replace file-based assignments with control-plane watch/polling.

## Open Questions

- Should routing table updates be delivered by watch, long polling, or a
  streaming protocol?
- Should worker upload also register or update the control-plane Worker record,
  or should upload and registration remain separate commands?
- What is the maximum number of Workers per `workerd` process before startup
  and restart latency becomes unacceptable?
- Should Workers be grouped by trust level, traffic class, or tenant?
- How should graceful draining work during `workerd` restarts?
- Should the routing gateway support sticky routing for stateful Workers, or
  should all Workers be stateless in v1?
