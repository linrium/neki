# workerd

Reusable Kubernetes Deployment and Service for running Cloudflare `workerd`.

`workerd` runs Cloudflare Worker-style JavaScript and Wasm services from a
Cap'n Proto config file. This setup expects a ConfigMap containing at least:

- `config.capnp`
- any files referenced by `embed`, for example `worker.js`

Install the default sample runtime:

```bash
./infra/workerd/install.sh
```

Deploy the example Worker from `examples/workerd-hello`:

```bash
./examples/workerd-hello/deploy.sh
```

## Configuration Knobs

- `NAMESPACE`, default `workerd`
- `NAME`, default `workerd`
- `CONFIG_MAP`, default `workerd-config`
- `WORKERD_NPM_VERSION`, default `latest`
- `NODE_IMAGE`, default `node:22-bookworm-slim`
- `REPLICAS`, default `1`
- `SERVICE_PORT`, default `80`
- `CONTAINER_PORT`, default `8080`
- `TIMEOUT`, default `180s`

Use a pinned npm package version for repeatable deployments:

```bash
WORKERD_NPM_VERSION=1.20250617.0 ./infra/workerd/install.sh
```

## Verify

```bash
kubectl get deploy,svc -n workerd
kubectl port-forward -n workerd svc/workerd 8080:80
curl -i http://localhost:8080/
```

## Notes

The Deployment uses `npx --yes workerd@${WORKERD_NPM_VERSION}` so the cluster
must be able to reach the npm registry when the pod starts. For production,
build and pin an application image that already contains `workerd`.

Cloudflare's upstream README warns that `workerd` is not a hardened sandbox by
itself. Do not run untrusted Worker code with this plain Deployment unless the
pod is isolated by an additional sandbox such as a VM-backed runtime.
