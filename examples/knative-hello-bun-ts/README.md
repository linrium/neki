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

Override the generated image if needed:

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
