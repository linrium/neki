# RustFS

This installs RustFS with Helm and updates Neon to use RustFS as its
S3-compatible object storage.

The installer uses the published Helm repository:

```text
https://charts.rustfs.com
```

Default local-dev shape:

- namespace `rustfs`
- release `rustfs`
- chart `rustfs/rustfs`
- chart version `0.8.0`
- standalone mode, one pod, one data PVC
- service endpoint `http://rustfs-svc.rustfs.svc.cluster.local:9000`
- bucket `neon`
- Neon secret `neon/bucket-credentials`

## Install And Integrate With Neon

```bash
./infra/rustfs/install.sh
```

This will:

1. install RustFS with Helm
2. create the `neon` bucket using a short `minio/mc` Job
3. create or update Neon’s `bucket-credentials` Secret

The generated Neon Secret contains:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `AWS_ENDPOINT_URL`
- `BUCKET_NAME`

Those are the keys the current Neon operator reads for pageserver remote
storage.

## Credentials

The installer defaults are for local development:

```bash
RUSTFS_ACCESS_KEY=neki-rustfs
RUSTFS_SECRET_KEY=neki-rustfs-secret
```

Override them when installing:

```bash
RUSTFS_ACCESS_KEY=your-access-key \
RUSTFS_SECRET_KEY=your-secret-key \
./infra/rustfs/install.sh
```

If Neon is already running and pageservers already exist, restart or recreate
those pageservers after changing `neon/bucket-credentials` so they pick up the
new S3 settings.

## Configuration Knobs

- `RUSTFS_NAMESPACE`, default `rustfs`
- `RUSTFS_RELEASE`, default `rustfs`
- `RUSTFS_CHART_REPO_URL`, default `https://charts.rustfs.com`
- `RUSTFS_CHART`, default `rustfs/rustfs`
- `RUSTFS_CHART_VERSION`, default `0.8.0`
- `RUSTFS_ACCESS_KEY`, default `neki-rustfs`
- `RUSTFS_SECRET_KEY`, default `neki-rustfs-secret`
- `RUSTFS_REGION`, default `us-east-1`
- `RUSTFS_BUCKET`, default `neon`
- `RUSTFS_ENDPOINT`, default `http://rustfs-svc.rustfs.svc.cluster.local:9000`
- `NEON_NAMESPACE`, default `neon`
- `NEON_BUCKET_SECRET`, default `bucket-credentials`
- `CREATE_BUCKET`, default `true`
- `SYNC_NEON_SECRET`, default `true`
- `TIMEOUT`, default `300s`

## Verify

```bash
kubectl get pods,svc,pvc --namespace rustfs
kubectl get secret bucket-credentials --namespace neon
kubectl logs --namespace rustfs job/rustfs-create-neon
```

Forward the S3 API and console:

```bash
kubectl port-forward --namespace rustfs svc/rustfs-svc 9000:9000 9001:9001
```

Then open the console at `http://localhost:9001`.

## Uninstall

```bash
helm uninstall rustfs --namespace rustfs
```

PVCs are kept by the chart through Helm resource policy. Delete them only when
you intentionally want to remove object storage data:

```bash
kubectl delete pvc --namespace rustfs --selector app.kubernetes.io/instance=rustfs
```
