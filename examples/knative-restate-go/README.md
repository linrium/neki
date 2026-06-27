# Knative Restate Go

Go implementation of the Restate + Knative signup tutorial from:

https://www.restate.dev/blog/building-stateful-serverless-applications-with-knative-and-restate

The example deploys a Knative service that exposes:

- `Signup/Signup`: initializes a user, waits on an activation awakeable, then activates the user.
- `User/{username}/Get`: reads the user state stored in a Restate Virtual Object.

## Prerequisites

- Knative Serving is installed.
- Restate is running in Kubernetes. This repo includes `infra/restate/restate-server.yaml`.
- Docker Desktop Kubernetes can see local Docker images.

## Deploy

From this directory:

```bash
./deploy.sh
```

The script builds `dev.local/knative-restate-go:latest`, deploys a Knative Service, then registers the internal Knative service URL with the Restate Admin API:

```text
http://knative-restate-go.default.svc.cluster.local
```

For the local `restate-test` operator deployment, the script also applies `restate-egress.yaml`. The operator creates default-deny network policies, so Restate needs an explicit egress rule to discover and invoke Knative pods and the Knative activator.

## Invoke

Port-forward Restate ingress:

```bash
kubectl port-forward -n restate-test svc/restate 8080:8080
```

Start a signup request:

```bash
curl -v http://localhost:8080/restate/call/Signup/Signup \
  --json '{
    "username": "ada",
    "name": "Ada",
    "surname": "Lovelace",
    "password": "not-for-production"
  }'
```

The request waits for activation. In another terminal, check the Knative pod logs for the awakeable ID:

```bash
kubectl logs -n default -l serving.knative.dev/service=knative-restate-go -c user-container --tail=50
```

Resolve the awakeable using the command printed in the log:

```bash
curl -X POST http://localhost:8080/restate/awakeables/<awakeable-id>/resolve
```

Read the stored user:

```bash
curl http://localhost:8080/restate/call/User/ada/Get --json '{}'
```
