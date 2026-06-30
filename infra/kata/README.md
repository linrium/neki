# Kata Containers with Firecracker

This directory installs Kata Containers with the Firecracker microVM runtime for
Kubernetes nodes. It follows the same shape as the CloudKernels tutorial:

- install the Kata static bundle under `/opt/kata`
- expose a `containerd-shim-kata-fc-v2` wrapper that selects
  `/opt/kata/share/defaults/kata-containers/configuration-fc.toml`
- configure containerd with a `kata-fc` runtime handler
- use the containerd devmapper snapshotter required by the Firecracker flow
- create a Kubernetes `RuntimeClass` named `kata-fc`

Run this on every Linux worker node that should host Kata Firecracker pods:

```bash
sudo ./infra/kata/install.sh
```

Then schedule a pod with:

```yaml
spec:
  runtimeClassName: kata-fc
```

## Files

- `install.sh` installs host binaries, configures devmapper/containerd, restarts
  the node runtime, labels the node, and applies the RuntimeClass.
- `containerd-kata-fc.toml` is the containerd config fragment for normal
  containerd installs.
- `devmapper-setup.service` recreates the devmapper thin pool before containerd
  or k3s starts.
- `kata-fc-runtimeclass.yaml` defines the Kubernetes runtime class.
- `kata-fc-smoke-test.yaml` is an optional BusyBox pod using `runtimeClassName:
  kata-fc`.

## Common Knobs

```bash
KATA_VERSION=3.2.0 sudo ./infra/kata/install.sh
KATA_ARCH=amd64 sudo ./infra/kata/install.sh
APPLY_SMOKE_TEST=true sudo ./infra/kata/install.sh
NODE_NAME=my-worker-1 sudo ./infra/kata/install.sh
RESTART_CONTAINERD=false sudo ./infra/kata/install.sh
CONFIGURE_CONTAINERD=false sudo ./infra/kata/install.sh
CONFIGURE_SYSTEM_CONTAINERD=true sudo ./infra/kata/install.sh
USE_K3S_TEMPLATE=false sudo ./infra/kata/install.sh
```

Defaults:

- `KATA_VERSION=latest`
- `CONTAINERD_CONFIG=/etc/containerd/config.toml`
- `CONTAINERD_SERVICE=containerd`
- `CONFIGURE_SYSTEM_CONTAINERD=auto`
- `K3S_CONFIG_FILE=/etc/rancher/k3s/config.yaml`
- `USE_K3S_TEMPLATE=auto`
- `APPLY_RUNTIME_CLASS=true`
- `LABEL_NODE=true`
- `APPLY_SMOKE_TEST=false`
- `DEVMAPPER_DATA_SIZE=100G`
- `DEVMAPPER_META_SIZE=2G`
- `DEVMAPPER_POOL_NAME=containerd-pool`
- `DEVMAPPER_BASE_IMAGE_SIZE=10GB`

## k3s Notes

When `/var/lib/rancher/k3s` exists, the installer sets `snapshotter:
devmapper` in:

```text
/etc/rancher/k3s/config.yaml
```

It also writes the Kata runtime and devmapper plugin settings to:

```text
/var/lib/rancher/k3s/agent/etc/containerd/config.toml.tmpl
```

and restarts `k3s` or `k3s-agent` if either service is active. Set
`USE_K3S_TEMPLATE=false` if your k3s containerd config is managed another way.

## Verify

```bash
kubectl get runtimeclass kata-fc
kubectl get nodes -l katacontainers.io/kata-runtime=true
kubectl apply -f ./infra/kata/kata-fc-smoke-test.yaml
kubectl wait --for=condition=Ready pod/kata-fc-smoke-test --timeout=120s
kubectl logs kata-fc-smoke-test
```

On the node:

```bash
systemctl status kata-fc-devmapper.service
ctr plugins ls | grep devmapper
ls -l /usr/local/bin/containerd-shim-kata-fc-v2
```

## Operational Notes

This is a node-level install and changes host container runtime state. Review it
before using it on production nodes. The script backs up `/etc/containerd/config.toml`
before adding the import line, but it intentionally does not try to merge custom
containerd `imports` arrays.

The devmapper helper uses sparse loopback files under `/var/lib/kata-fc/devmapper`.
For production clusters, prefer real block devices for the data and metadata
devices and adjust the helper accordingly.
