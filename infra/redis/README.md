# Redis Operator

This installs the Opstree Redis Operator with Helm so examples can create Redis
instances with `Redis` custom resources instead of raw Deployments.

Based on the official Redis Operator docs:

- https://redis-operator.opstree.dev/docs/installation/installation/
- https://redis-operator.opstree.dev/docs/getting-started/standalone/

```bash
./infra/redis-operator/install.sh
```

The installer follows the official Helm path:

- adds the `ot-helm` repository `https://ot-container-kit.github.io/helm-charts/`
- installs chart `ot-helm/redis-operator`
- uses release `redis-operator`
- creates and uses namespace `ot-operators`
- sets `featureGates.GenerateConfigInInitContainer=true`

## Configuration Knobs

- `REDIS_OPERATOR_NAMESPACE`, default `ot-operators`
- `REDIS_OPERATOR_RELEASE`, default `redis-operator`
- `TIMEOUT`, default `180s`

## Verify

```bash
kubectl get pods --namespace ot-operators
kubectl get crds | grep redis.opstreelabs.in
```

## Uninstall

```bash
./infra/redis-operator/uninstall.sh
```
