# workerd Hello

Simple Cloudflare `workerd` example for Kubernetes.

## Deploy

```bash
./examples/workerd-hello/deploy.sh
```

The script creates a ConfigMap from `config.capnp` and `worker.js`, then reuses
the generic manifests in `infra/workerd`.

Override the namespace or service name:

```bash
NAMESPACE=default NAME=workerd-hello ./examples/workerd-hello/deploy.sh
```

Pin the `workerd` npm package used by the pod:

```bash
WORKERD_NPM_VERSION=1.20250617.0 ./examples/workerd-hello/deploy.sh
```

## Invoke

```bash
kubectl port-forward -n workerd svc/workerd-hello 8080:80
curl -i http://localhost:8080/
curl -i http://localhost:8080/healthz
curl -i http://localhost:8080/api/echo
```

## Run Locally

If Node.js is installed:

```bash
npx --yes workerd@latest serve config.capnp
curl -i http://localhost:8080/
```
