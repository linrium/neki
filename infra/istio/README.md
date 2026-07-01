# Istio

This installs Istio with `istioctl` using an `IstioOperator` manifest.

```bash
./infra/istio/install.sh
```

The default installer:

- uses `istioctl install`
- applies `istio-operator.yaml`
- creates and uses namespace `istio-system`
- installs the default Istio profile
- enables `istiod`
- enables the default ingress gateway service

## Prerequisites

- A Kubernetes cluster reachable through the current `kubectl` context
- `kubectl`
- `istioctl`, or network access so `install.sh` can download a local copy

Install `istioctl` from the Istio release that you want to run. The manifest in
this directory is intentionally version-neutral; the installed Istio version is
controlled by the `istioctl` binary you run.

If `istioctl` is missing, `install.sh` installs a local copy at
`./infra/istio/bin/istioctl` using the official Istio download script. It does
not write to `/usr/local/bin` or change your shell profile.

Check the client and cluster before installing:

```bash
kubectl config current-context
istioctl version --remote=false
```

## Install

```bash
./infra/istio/install.sh
```

Install only `istioctl`:

```bash
./infra/istio/install-istioctl.sh
```

Pin the downloaded Istio version:

```bash
ISTIO_VERSION=1.27.0 ./infra/istio/install-istioctl.sh
```

Disable automatic `istioctl` installation:

```bash
ISTIOCTL_AUTO_INSTALL=false ./infra/istio/install.sh
```

Use a different operator manifest:

```bash
ISTIO_OPERATOR_FILE=./infra/istio/istio-operator.yaml ./infra/istio/install.sh
```

Install and enable automatic sidecar injection in an application namespace:

```bash
APPLY_INJECTION=true APP_NAMESPACE=default ./infra/istio/install.sh
```

## Configuration Knobs

- `ISTIO_NAMESPACE`, default `istio-system`
- `ISTIO_OPERATOR_FILE`, default `./infra/istio/istio-operator.yaml`
- `ISTIOCTL_BIN`, default discovered from `PATH` or `./infra/istio/bin/istioctl`
- `ISTIOCTL_AUTO_INSTALL`, default `true`
- `ISTIO_VERSION`, default latest available from the official Istio installer
- `TIMEOUT`, default `300s`
- `VERIFY`, default `true`; runs `istioctl verify-install` only when supported
- `APPLY_INJECTION`, default `false`
- `APP_NAMESPACE`, default `default`

## Files

- `istio-operator.yaml`: primary `IstioOperator` install manifest
- `namespace-injection.yaml`: example namespace label for sidecar injection
- `gateway.yaml`: example Istio `Gateway` resource for HTTP ingress
- `install-istioctl.sh`: downloads a local `istioctl` binary
- `install.sh`: installs Istio through `istioctl`
- `uninstall.sh`: removes Istio through `istioctl`

## Verify

```bash
kubectl get pods --namespace istio-system
kubectl get svc --namespace istio-system
istioctl proxy-status
```

Some `istioctl` versions include an additional install verifier:

```bash
istioctl verify-install -f ./infra/istio/istio-operator.yaml
```

After deploying workloads into an injected namespace, restart existing
deployments so they receive sidecars:

```bash
kubectl rollout restart deployment --namespace default
```

## Uninstall

Remove the installation described by `istio-operator.yaml`:

```bash
./infra/istio/uninstall.sh
```

To remove all Istio control plane resources from the cluster, including shared
resources managed by `istioctl`, use purge mode:

```bash
PURGE=true ./infra/istio/uninstall.sh
```

`istioctl uninstall` does not remove application namespace labels. Remove
sidecar injection labels explicitly when needed:

```bash
kubectl label namespace default istio-injection-
```
