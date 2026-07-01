# neki-worker-node

Rust supervisor for running Cloudflare `workerd` across a pool of nodes.

Each worker-node pod runs:

- **Rust supervisor** (`neki-worker-node`) that owns the local worker lifecycle
- **workerd** as a child process, managed by the supervisor

The supervisor:

1. Reads the desired assignment (file-based in dev mode)
2. Downloads scripts from RustFS with SHA-256 verification
3. Renders `config.capnp` with router + app worker services
4. Starts/restarts `workerd` when the worker graph changes
5. Serves a manifest API on loopback

## Install

```bash
./infra/worker-node/install.sh
```

## Configuration Knobs

- `NAMESPACE`, default `neki`
- `NAME`, default `neki-worker-node`
- `POOL_ID`, default `public-small`
- `NODE_IMAGE`, default `neki/worker-node:latest`
- `REPLICAS`, default `3`
- `RECONCILE_INTERVAL_SECS`, default `10`
- `COMPATIBILITY_DATE`, default `2025-06-01`
- `RUSTFS_ENDPOINT`, default `http://rustfs-svc.rustfs.svc.cluster.local:9000`
- `RUSTFS_SECRET`, default `neki-rustfs-credentials`
- `RUSTFS_WORKERS_BUCKET`, default `workers`

## Verify

```bash
kubectl get pods,svc -n neki -l app.kubernetes.io/name=neki-worker-node
kubectl port-forward -n neki svc/neki-worker-node 9000:9000
curl http://localhost:9000/manifest
```
