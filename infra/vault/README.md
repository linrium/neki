# Vault

This installs a local development HashiCorp Vault server and the HashiCorp
Vault Secrets Operator on Kubernetes with Helm.

Based on HashiCorp's official installation docs:

- https://developer.hashicorp.com/vault/docs/deploy/kubernetes/vso/installation

```bash
./infra/vault/install.sh
```

The default install:

- adds the official HashiCorp Helm repository `https://helm.releases.hashicorp.com`
- installs chart `hashicorp/vault` as release `vault`
- creates and uses namespace `vault`
- runs Vault server in dev mode, initialized and unsealed with root token `root`
- installs chart `hashicorp/vault-secrets-operator`
- pins the chart version to `1.4.0`
- uses release `vault-secrets-operator`
- creates and uses namespace `vault-secrets-operator`
- waits for the Helm release and operator rollout
- leaves default `VaultConnection` and `VaultAuth` disabled so application namespaces can define their own resources

Dev mode is for local testing only. Data is not durable and the root token is
intentionally simple.

Forward Vault locally:

```bash
./scripts/vault-port-forward.sh
export VAULT_ADDR=http://127.0.0.1:8200
export VAULT_TOKEN=root
vault status
```

## Sample static secret sync

`infra/vault/vault-static-secret.yaml` defines a starter application namespace setup:

- `ServiceAccount` named `neki-vso`
- `VaultConnection` named `neki-vault`
- `VaultAuth` named `neki-vault-auth` using Vault Kubernetes auth
- `VaultStaticSecret` named `neki-example` that syncs Vault KV v2 path `secret/data/neki/example` to Kubernetes Secret `neki-example`

Apply it during installation:

```bash
APPLY_EXAMPLE=true ./infra/vault/install.sh
```

Or choose another application namespace:

```bash
APP_NAMESPACE=neki APPLY_EXAMPLE=true ./infra/vault/install.sh
```

Update `vault-static-secret.yaml` before applying if your Vault service address, auth mount, role, KV mount, or secret path differs.

## Vault-side setup

The sample manifest expects Vault Kubernetes auth at mount `kubernetes`, role `neki-app`, KV v2 mounted at `secret`, and an in-cluster Vault address of `http://vault.vault.svc.cluster.local:8200`.

Example Vault policy and role:

```bash
vault policy write neki-vso - <<'EOF'
path "secret/data/neki/*" {
  capabilities = ["read"]
}
EOF

vault write auth/kubernetes/role/neki-app \
  bound_service_account_names=neki-vso \
  bound_service_account_namespaces=default \
  policies=neki-vso \
  ttl=24h
```

Create a test secret:

```bash
vault kv put secret/neki/example username=neki password=change-me
```

If you apply the sample to a namespace other than `default`, update `bound_service_account_namespaces` to match.

## Configuration knobs

- `VSO_NAMESPACE`, default `vault-secrets-operator`
- `VSO_RELEASE`, default `vault-secrets-operator`
- `VSO_CHART_VERSION`, default `1.4.0`
- `INSTALL_VAULT_SERVER`, default `true`
- `VAULT_NAMESPACE`, default `vault`
- `VAULT_RELEASE`, default `vault`
- `VAULT_CHART_VERSION`, default `0.33.0`
- `VAULT_DEV_ROOT_TOKEN`, default `root`
- `TIMEOUT`, default `300s`
- `APPLY_EXAMPLE`, default `false`
- `APP_NAMESPACE`, default `default`

## Verify

```bash
kubectl get pods --namespace vault
helm status vault --namespace vault
kubectl get pods --namespace vault-secrets-operator
helm status vault-secrets-operator --namespace vault-secrets-operator
kubectl get crds | grep secrets.hashicorp.com
kubectl get vaultconnection,vaultauth,vaultstaticsecret --namespace default
kubectl get secret neki-example --namespace default
```

## Uninstall

Delete sample resources before uninstalling the operator:

```bash
kubectl delete --namespace default -f ./infra/vault/vault-static-secret.yaml
```

Then uninstall the operator and dev Vault server:

```bash
helm uninstall vault-secrets-operator --namespace vault-secrets-operator
helm uninstall vault --namespace vault
```
