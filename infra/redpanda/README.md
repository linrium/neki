# Redpanda Operator

This installs the Redpanda Operator with Helm, following Redpanda's Kubernetes
production deployment path:

- https://docs.redpanda.com/streaming/current/deploy/redpanda/kubernetes/k-production-deployment/

```bash
./infra/redpanda/install.sh
```

The default installer:

- installs `jetstack/cert-manager` chart `v1.20.3` into `cert-manager`
- adds the Redpanda Helm repository `https://charts.redpanda.com`
- installs `redpanda/operator` chart `26.1.6`
- uses release `redpanda-controller`
- creates and uses namespace `redpanda-system`
- pulls Redpanda and Redpanda Operator images from `docker.io/redpandadata` to avoid
  `docker.redpanda.com` mirror/rate-limit pull failures
- waits for cert-manager and operator rollouts
- does not create a Redpanda cluster unless requested

## Create a Redpanda Cluster

`infra/redpanda/redpanda-cluster.yaml` defines a single-broker Redpanda cluster
using the Operator CRD:

```yaml
apiVersion: cluster.redpanda.com/v1alpha2
kind: Redpanda
```

Apply it during install:

```bash
APPLY_CLUSTER=true ./infra/redpanda/install.sh
```

Or apply it after the operator is installed:

```bash
kubectl create namespace redpanda --dry-run=client --output yaml | kubectl apply -f -
kubectl apply --namespace redpanda -f ./infra/redpanda/redpanda-cluster.yaml
```

Review and adjust the manifest before applying it to a production cluster,
especially:

- `statefulset.replicas`
- `storage.persistentVolume.size`
- `storage.persistentVolume.storageClass`
- `resources`
- `image.repository`
- listener TLS and external access settings
- Console exposure and authentication

## View and Connect

The cluster is created with `external.enabled: false` and TLS on every
listener, so it is reachable from inside the Kubernetes cluster by default, or
from your machine through `kubectl port-forward`.

### View the cluster

```bash
kubectl get redpanda,pods,svc,pvc --namespace redpanda
kubectl get redpanda redpanda --namespace redpanda -o yaml | less
kubectl get console --namespace redpanda
```

`Redpanda` reaches `Ready` once all broker Pods are up. `Console` is its own
resource (`kind: Console`, also `cluster.redpanda.com/v1alpha2`) created by the
operator when `console.enabled: true`.

### Run rpk inside the cluster (zero setup)

The easiest way to interact with Redpanda is `rpk` running inside a broker Pod,
because it uses the internal addresses and TLS trust store already:

```bash
kubectl exec --namespace redpanda -it redpanda-0 -- rpk cluster info
kubectl exec --namespace redpanda -it redpanda-0 -- rpk topic list
kubectl exec --namespace redpanda -it redpanda-0 -- rpk topic create test --partitions 3 --replicas 3
kubectl exec --namespace redpanda -it redpanda-0 -- rpk topic produce test
kubectl exec --namespace redpanda -it redpanda-0 -- rpk topic consume test
```

### Connect from your machine

Forward the broker and Console ports to localhost:

```bash
./infra/redpanda/forward-port.sh
```

This exposes:

| Endpoint | Address |
| --- | --- |
| Kafka API (TLS) | `localhost:9093` |
| Admin API (TLS) | `localhost:9644` |
| Schema Registry (TLS) | `localhost:8081` |
| Console UI | http://localhost:8080 |

Open http://localhost:8080 in a browser for the Redpanda Console UI.

### Connect with rpk over the forwarded port

Because TLS is enabled and brokers advertise their in-cluster DNS names, you
need to (a) trust the cluster CA and (b) point those advertised hostnames at
localhost. Grab the CA cert:

```bash
kubectl get secret --namespace redpanda | grep root-certificate
kubectl get secret redpanda-root-certificate --namespace redpanda \
  -o jsonpath='{.data.ca\.crt}' | base64 -d > /tmp/redpanda-ca.crt
```

Map the broker hostname to localhost (adjust to match `rpk cluster info`):

```bash
sudo tee -a /etc/hosts <<'EOF'
127.0.0.1 redpanda-0.redpanda.redpanda.svc.cluster.local
EOF
```

Then:

```bash
rpk cluster info \
  --brokers localhost:9093 \
  --tls-enabled \
  --tls-truststore-file /tmp/redpanda-ca.crt
```

### Forward script knobs

- `NAMESPACE`, default `redpanda`
- `BROKER_SERVICE`, default `redpanda`
- `CONSOLE_SERVICE`, default `redpanda-console`
- `FORWARD_CONSOLE`, default `true`
- `KAFKA_LOCAL_PORT`, `ADMIN_LOCAL_PORT`, `SCHEMA_LOCAL_PORT`, `CONSOLE_LOCAL_PORT`

## Configuration Knobs

- `REDPANDA_OPERATOR_NAMESPACE`, default `redpanda-system`
- `REDPANDA_OPERATOR_RELEASE`, default `redpanda-controller`
- `REDPANDA_OPERATOR_CHART_VERSION`, default `26.1.6`
- `REDPANDA_NAMESPACE`, default `redpanda`
- `CERT_MANAGER_NAMESPACE`, default `cert-manager`
- `CERT_MANAGER_RELEASE`, default `cert-manager`
- `CERT_MANAGER_CHART_VERSION`, default `v1.20.3`
- `TIMEOUT`, default `300s`
- `INSTALL_CERT_MANAGER`, default `true`
- `APPLY_CLUSTER`, default `false`

## Verify

```bash
kubectl get pods --namespace redpanda-system
kubectl api-resources --api-group='cluster.redpanda.com'
kubectl get redpanda,pods,pvc --namespace redpanda
kubectl get certificate --namespace redpanda
helm status redpanda-controller --namespace redpanda-system
```

The Redpanda docs list these operator CRDs under
`cluster.redpanda.com/v1alpha2`: `Redpanda`, `Schema`, `Topic`, and `User`.

## Uninstall

Uninstall the operator only:

```bash
./infra/redpanda/uninstall.sh
```

Delete Redpanda custom resources before uninstalling the operator:

```bash
DELETE_CLUSTER=true ./infra/redpanda/uninstall.sh
```

Uninstall cert-manager as well:

```bash
UNINSTALL_CERT_MANAGER=true ./infra/redpanda/uninstall.sh
```

Helm does not remove CRDs on uninstall. PVCs and Secrets are also intentionally
left in place because deleting them can remove broker data and credentials.
