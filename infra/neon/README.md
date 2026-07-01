# Neon Operator

This installs the upstream `lovablelabs/neon-operator` from source because the
project currently has no published release or Helm chart.

The local installer pins upstream commit:

```text
8f516af7b12c0631d9c0d49f8fe121782a3bd1c6
```

The active CRDs in that commit use:

- API group `neon.oltp.molnett.org`
- version `v1alpha1`
- resource kinds `Cluster`, `Project`, `Branch`, `Pageserver`, `Safekeeper`

## Prerequisites

- Kubernetes 1.28+
- `kubectl` and `git`
- Docker or another container tool when building or pushing the image
- S3-compatible object storage
- A PostgreSQL database for the Neon storage controller
- A built operator image available to the cluster

The included `secrets.example.yaml` shows the required secret keys. Replace all
placeholder values before applying it to a real cluster.

For a local S3-compatible backend, install RustFS first:

```bash
./infra/rustfs/install.sh
```

That installer creates the `neon` bucket and updates
`neon/bucket-credentials` with the RustFS endpoint and credentials.

## Install The Operator

For Docker Desktop Kubernetes with a local image:

```bash
BUILD_OPERATOR_IMAGE=true \
IMG_OPERATOR=neon-operator:dev \
IMAGE_PULL_POLICY=IfNotPresent \
./infra/neon/install.sh
```

Docker Desktop Kubernetes can use images from the local Docker image store. Do
not use `imagePullPolicy: Always` for this path, because Kubernetes will try to
pull the tag from a registry.

To use a registry image instead:

```bash
BUILD_OPERATOR_IMAGE=true \
PUSH_OPERATOR_IMAGE=true \
IMG_OPERATOR=registry.example.com/neki/neon-operator:8f516af \
IMAGE_PULL_POLICY=Always \
./infra/neon/install.sh
```

For any other remote cluster, use the same pattern:

```bash
BUILD_OPERATOR_IMAGE=true \
PUSH_OPERATOR_IMAGE=true \
IMG_OPERATOR=registry.example.com/neki/neon-operator:8f516af \
IMAGE_PULL_POLICY=Always \
./infra/neon/install.sh
```

If you already built and pushed the image:

```bash
IMG_OPERATOR=registry.example.com/neki/neon-operator:8f516af \
./infra/neon/install.sh
```

## Create A Neon Cluster

First create real secrets:

```bash
kubectl create namespace neon --dry-run=client --output yaml | kubectl apply -f -
kubectl apply --namespace neon -f ./infra/neon/secrets.example.yaml
```

If you use the included CloudNativePG sample cluster from `infra/postgres`, copy
its generated app connection URI into the Neon storage-controller secret:

```bash
kubectl get secret postgres-cluster-app --namespace postgres -o jsonpath='{.data.uri}' \
  | xargs -I{} kubectl patch secret storage-controller-database --namespace neon \
      --type merge -p '{"data":{"uri":"{}"}}'
```

Then apply resources in order:

```bash
kubectl apply --namespace neon -f ./infra/neon/cluster.yaml
kubectl apply --namespace neon -f ./infra/neon/pageserver.yaml
kubectl apply --namespace neon -f ./infra/neon/safekeepers.yaml
kubectl wait --namespace neon cluster/neki-neon --for=condition=Available --timeout=300s
kubectl wait --namespace neon pageserver/neki-pageserver-0 --for=condition=Available --timeout=300s
kubectl apply --namespace neon -f ./infra/neon/project.yaml
kubectl apply --namespace neon -f ./infra/neon/branch.yaml
```

The installer can apply the same resources:

```bash
APPLY_SECRETS=true APPLY_CLUSTER=true APPLY_STORAGE_NODES=true APPLY_PROJECT=true APPLY_BRANCH=true \
IMG_OPERATOR=registry.example.com/neki/neon-operator:8f516af \
./infra/neon/install.sh
```

Use `APPLY_SECRETS=true` only after replacing placeholders in
`secrets.example.yaml`.

## Configuration Knobs

- `NEON_OPERATOR_REPO`, default `https://github.com/lovablelabs/neon-operator.git`
- `NEON_OPERATOR_REF`, default `8f516af7b12c0631d9c0d49f8fe121782a3bd1c6`
- `NEON_OPERATOR_SRC`, default `/private/tmp/neon-operator`
- `NEON_OPERATOR_NAMESPACE`, default `neon`
- `IMG_OPERATOR`, default `neon-operator:dev`
- `IMAGE_PULL_POLICY`, default `IfNotPresent`
- `CONTAINER_TOOL`, default `docker`
- `BUILD_OPERATOR_IMAGE`, default `false`
- `PUSH_OPERATOR_IMAGE`, default `false`
- `APPLY_SECRETS`, default `false`
- `APPLY_CLUSTER`, default `false`
- `APPLY_STORAGE_NODES`, default `false`
- `APPLY_PROJECT`, default `false`
- `APPLY_BRANCH`, default `false`
- `TIMEOUT`, default `300s`

## Verify

```bash
kubectl get pods --namespace neon
kubectl get crds | grep neon.oltp.molnett.org
kubectl api-resources --api-group=neon.oltp.molnett.org
kubectl get clusters,projects,branches --namespace neon
```

## Uninstall

Delete Neon resources before removing the operator:

```bash
kubectl delete --namespace neon -f ./infra/neon/branch.yaml --ignore-not-found
kubectl delete --namespace neon -f ./infra/neon/project.yaml --ignore-not-found
kubectl delete --namespace neon -f ./infra/neon/cluster.yaml --ignore-not-found
```

Then remove the upstream operator deployment from the pinned source checkout:

```bash
kubectl kustomize /private/tmp/neon-operator/.neki-deploy | kubectl delete --ignore-not-found -f -
```

PVCs and Secrets may contain database state and credentials, so they are not
removed by this installer.
