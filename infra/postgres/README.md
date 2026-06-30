# CloudNativePG PostgreSQL

This installs the CloudNativePG operator with Helm and includes two ways to
create a PostgreSQL cluster:

- `cluster-values.yaml` for the official `cnpg/cluster` Helm chart
- `postgres-cluster.yaml` for applying the CloudNativePG `Cluster` CR directly

Based on the official CloudNativePG Helm charts:

- https://github.com/cloudnative-pg/charts/tree/main/charts/cloudnative-pg
- https://github.com/cloudnative-pg/charts/blob/main/charts/cluster/README.md

```bash
./infra/postgres/install.sh
```

The default installer:

- adds the `cnpg` Helm repository `https://cloudnative-pg.github.io/charts`
- installs chart `cnpg/cloudnative-pg`
- uses release `cnpg`
- creates and uses namespace `cnpg-system`
- installs CRDs with the operator chart
- does not create a PostgreSQL cluster unless requested

## Create a PostgreSQL Cluster

Install the operator and create the sample cluster with the official cluster
chart:

```bash
APPLY_CLUSTER=true ./infra/postgres/install.sh
```

Or apply the direct `Cluster` YAML after installing the operator:

```bash
APPLY_CLUSTER=true CLUSTER_INSTALL_METHOD=yaml ./infra/postgres/install.sh
```

The sample cluster creates:

- namespace `postgres`
- a three-instance PostgreSQL 16 cluster
- database `app`
- owner role `app`
- 8Gi persistent volume per instance
- PodMonitor integration for Prometheus Operator based monitoring

Review and adjust the manifests before using them in production, especially:

- `cluster.instances`
- `cluster.storage.size`
- `cluster.storage.storageClass`
- `cluster.resources`
- backup object storage settings
- PostgreSQL parameters
- monitoring labels and PrometheusRule behavior

Backups are disabled by default because the CloudNativePG cluster chart requires
provider-specific object storage settings and credentials. Enable
`backups.enabled` in `cluster-values.yaml` after configuring S3, Azure Blob
Storage, or Google Cloud Storage.

## View and Connect

```bash
kubectl get cluster,pods,svc,pvc --namespace postgres
kubectl get cluster postgres --namespace postgres -o yaml
```

CloudNativePG creates these services for a cluster named `postgres`:

| Endpoint | Address |
| --- | --- |
| Read/write | `postgres-rw.postgres.svc.cluster.local:5432` |
| Read-only | `postgres-ro.postgres.svc.cluster.local:5432` |
| Replicas | `postgres-r.postgres.svc.cluster.local:5432` |

Forward the primary service to localhost:

```bash
kubectl port-forward --namespace postgres svc/postgres-rw 5432:5432
```

Get the generated application password:

```bash
kubectl get secret --namespace postgres postgres-app \
  -o jsonpath='{.data.password}' | base64 -d
```

Connect with `psql`:

```bash
PGPASSWORD="$(kubectl get secret --namespace postgres postgres-app -o jsonpath='{.data.password}' | base64 -d)" \
  psql --host localhost --port 5432 --username app --dbname app
```

## Configuration Knobs

- `CNPG_OPERATOR_NAMESPACE`, default `cnpg-system`
- `CNPG_OPERATOR_RELEASE`, default `cnpg`
- `CNPG_OPERATOR_CHART_VERSION`, default latest available chart
- `POSTGRES_NAMESPACE`, default `postgres`
- `POSTGRES_RELEASE`, default `postgres`
- `CNPG_CLUSTER_CHART_VERSION`, default `0.7.0`
- `TIMEOUT`, default `300s`
- `APPLY_CLUSTER`, default `false`
- `CLUSTER_INSTALL_METHOD`, default `helm`; use `yaml` for `postgres-cluster.yaml`

## Verify

```bash
kubectl get pods --namespace cnpg-system
kubectl get crds | grep postgresql.cnpg.io
kubectl api-resources --api-group=postgresql.cnpg.io
helm status cnpg --namespace cnpg-system
```

If you created the sample cluster:

```bash
kubectl get cluster,pods,pvc --namespace postgres
kubectl describe cluster postgres --namespace postgres
```

## Uninstall

Delete PostgreSQL cluster resources before uninstalling the operator:

```bash
helm uninstall postgres --namespace postgres
# or, if CLUSTER_INSTALL_METHOD=yaml was used:
kubectl delete --namespace postgres -f ./infra/postgres/postgres-cluster.yaml
```

Then uninstall the operator:

```bash
helm uninstall cnpg --namespace cnpg-system
```

Helm does not remove CRDs on uninstall. PVCs and Secrets are intentionally left
in place because deleting them can remove database data and credentials.
