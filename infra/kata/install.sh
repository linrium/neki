#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

KATA_VERSION="${KATA_VERSION:-latest}"
KATA_ARCH="${KATA_ARCH:-}"
KATA_RELEASE_BASE_URL="${KATA_RELEASE_BASE_URL:-https://github.com/kata-containers/kata-containers/releases/download}"
KATA_INSTALL_PREFIX="${KATA_INSTALL_PREFIX:-/opt/kata}"
CONTAINERD_CONFIG="${CONTAINERD_CONFIG:-/etc/containerd/config.toml}"
CONTAINERD_SERVICE="${CONTAINERD_SERVICE:-containerd}"
CONFIGURE_SYSTEM_CONTAINERD="${CONFIGURE_SYSTEM_CONTAINERD:-auto}"
K3S_CONFIG_FILE="${K3S_CONFIG_FILE:-/etc/rancher/k3s/config.yaml}"
K3S_CONFIG_TEMPLATE="${K3S_CONFIG_TEMPLATE:-/var/lib/rancher/k3s/agent/etc/containerd/config.toml.tmpl}"
USE_K3S_TEMPLATE="${USE_K3S_TEMPLATE:-auto}"
CONFIGURE_CONTAINERD="${CONFIGURE_CONTAINERD:-true}"
RESTART_CONTAINERD="${RESTART_CONTAINERD:-true}"
LABEL_NODE="${LABEL_NODE:-true}"
APPLY_RUNTIME_CLASS="${APPLY_RUNTIME_CLASS:-true}"
APPLY_SMOKE_TEST="${APPLY_SMOKE_TEST:-false}"
NODE_NAME="${NODE_NAME:-}"
TIMEOUT="${TIMEOUT:-120s}"

DEVMAPPER_DATA_FILE="${DEVMAPPER_DATA_FILE:-/var/lib/kata-fc/devmapper/data}"
DEVMAPPER_META_FILE="${DEVMAPPER_META_FILE:-/var/lib/kata-fc/devmapper/meta}"
DEVMAPPER_DATA_SIZE="${DEVMAPPER_DATA_SIZE:-100G}"
DEVMAPPER_META_SIZE="${DEVMAPPER_META_SIZE:-2G}"
DEVMAPPER_POOL_NAME="${DEVMAPPER_POOL_NAME:-containerd-pool}"
DEVMAPPER_ROOT_PATH="${DEVMAPPER_ROOT_PATH:-/var/lib/containerd/io.containerd.snapshotter.v1.devmapper}"
DEVMAPPER_BASE_IMAGE_SIZE="${DEVMAPPER_BASE_IMAGE_SIZE:-10GB}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

as_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "This installer must run as root on each Kubernetes node" >&2
    exit 1
  fi
}

detect_arch() {
  if [[ -n "${KATA_ARCH}" ]]; then
    echo "${KATA_ARCH}"
    return
  fi

  case "$(uname -m)" in
    x86_64 | amd64) echo "amd64" ;;
    aarch64 | arm64) echo "arm64" ;;
    *)
      echo "Unsupported architecture: $(uname -m). Set KATA_ARCH explicitly." >&2
      exit 1
      ;;
  esac
}

resolve_kata_version() {
  if [[ "${KATA_VERSION}" != "latest" ]]; then
    echo "${KATA_VERSION}"
    return
  fi

  curl -fsSLI -o /dev/null -w '%{url_effective}' \
    https://github.com/kata-containers/kata-containers/releases/latest |
    sed -E 's#^.*/tag/##'
}

is_k3s_node() {
  [[ -d /var/lib/rancher/k3s ]] || systemctl is-active --quiet k3s || systemctl is-active --quiet k3s-agent
}

should_configure_system_containerd() {
  case "${CONFIGURE_SYSTEM_CONTAINERD}" in
    true) return 0 ;;
    false) return 1 ;;
    auto)
      if is_k3s_node; then
        return 1
      fi
      return 0
      ;;
    *)
      echo "Unsupported CONFIGURE_SYSTEM_CONTAINERD=${CONFIGURE_SYSTEM_CONTAINERD}; use true, false, or auto" >&2
      exit 1
      ;;
  esac
}

download_and_install_kata() {
  local version="$1"
  local arch="$2"
  local archive="kata-static-${version}-${arch}.tar.xz"
  local url="${KATA_RELEASE_BASE_URL}/${version}/${archive}"
  local tmpdir

  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN

  echo "Downloading Kata Containers ${version} for ${arch}"
  curl -fL "${url}" -o "${tmpdir}/${archive}"

  echo "Installing Kata static bundle into /opt/kata"
  tar -C / -xJf "${tmpdir}/${archive}"

  install -d /usr/local/bin
  ln -sf "${KATA_INSTALL_PREFIX}/bin/containerd-shim-kata-v2" /usr/local/bin/containerd-shim-kata-v2
  ln -sf "${KATA_INSTALL_PREFIX}/bin/kata-runtime" /usr/local/bin/kata-runtime

  if [[ -x "${KATA_INSTALL_PREFIX}/bin/firecracker" ]]; then
    ln -sf "${KATA_INSTALL_PREFIX}/bin/firecracker" /usr/local/bin/firecracker
  fi

  if [[ ! -f "${KATA_INSTALL_PREFIX}/share/defaults/kata-containers/configuration-fc.toml" ]]; then
    echo "Missing ${KATA_INSTALL_PREFIX}/share/defaults/kata-containers/configuration-fc.toml after install." >&2
    echo "The selected Kata bundle does not include Firecracker defaults." >&2
    exit 1
  fi
}

install_firecracker_shim_wrapper() {
  install -d /usr/local/bin
  cat >/usr/local/bin/containerd-shim-kata-fc-v2 <<EOF
#!/usr/bin/env bash
export KATA_CONF_FILE="\${KATA_CONF_FILE:-${KATA_INSTALL_PREFIX}/share/defaults/kata-containers/configuration-fc.toml}"
exec "${KATA_INSTALL_PREFIX}/bin/containerd-shim-kata-v2" "\$@"
EOF
  chmod 0755 /usr/local/bin/containerd-shim-kata-fc-v2
}

write_devmapper_helper() {
  install -d /etc/kata-fc /usr/local/sbin "$(dirname "${DEVMAPPER_DATA_FILE}")" "${DEVMAPPER_ROOT_PATH}"

  cat >/etc/kata-fc/devmapper.env <<EOF
DEVMAPPER_DATA_FILE=${DEVMAPPER_DATA_FILE}
DEVMAPPER_META_FILE=${DEVMAPPER_META_FILE}
DEVMAPPER_DATA_SIZE=${DEVMAPPER_DATA_SIZE}
DEVMAPPER_META_SIZE=${DEVMAPPER_META_SIZE}
DEVMAPPER_POOL_NAME=${DEVMAPPER_POOL_NAME}
EOF

  cat >/usr/local/sbin/kata-fc-devmapper-setup <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

DEVMAPPER_DATA_FILE="${DEVMAPPER_DATA_FILE:-/var/lib/kata-fc/devmapper/data}"
DEVMAPPER_META_FILE="${DEVMAPPER_META_FILE:-/var/lib/kata-fc/devmapper/meta}"
DEVMAPPER_DATA_SIZE="${DEVMAPPER_DATA_SIZE:-100G}"
DEVMAPPER_META_SIZE="${DEVMAPPER_META_SIZE:-2G}"
DEVMAPPER_POOL_NAME="${DEVMAPPER_POOL_NAME:-containerd-pool}"

if dmsetup info "${DEVMAPPER_POOL_NAME}" >/dev/null 2>&1; then
  exit 0
fi

if command -v modprobe >/dev/null 2>&1; then
  modprobe dm_thin_pool || true
fi

mkdir -p "$(dirname "${DEVMAPPER_DATA_FILE}")"
truncate -s "${DEVMAPPER_DATA_SIZE}" "${DEVMAPPER_DATA_FILE}"
truncate -s "${DEVMAPPER_META_SIZE}" "${DEVMAPPER_META_FILE}"

DATA_LOOP="$(losetup --find --show "${DEVMAPPER_DATA_FILE}")"
META_LOOP="$(losetup --find --show "${DEVMAPPER_META_FILE}")"

DATA_SECTORS="$(blockdev --getsz "${DATA_LOOP}")"
LOW_WATER_MARK=32768
THIN_TABLE="0 ${DATA_SECTORS} thin-pool ${META_LOOP} ${DATA_LOOP} 128 ${LOW_WATER_MARK} 1 skip_block_zeroing"

dmsetup create "${DEVMAPPER_POOL_NAME}" --table "${THIN_TABLE}"
EOF
  chmod 0755 /usr/local/sbin/kata-fc-devmapper-setup

  install -m 0644 "${SCRIPT_DIR}/devmapper-setup.service" /etc/systemd/system/kata-fc-devmapper.service
  systemctl daemon-reload
  systemctl enable --now kata-fc-devmapper.service
}

write_containerd_fragment() {
  local target="/etc/containerd/conf.d/kata-fc.toml"

  install -d /etc/containerd/conf.d
  sed \
    -e "s#pool_name = \"containerd-pool\"#pool_name = \"${DEVMAPPER_POOL_NAME}\"#" \
    -e "s#root_path = \"/var/lib/containerd/io.containerd.snapshotter.v1.devmapper\"#root_path = \"${DEVMAPPER_ROOT_PATH}\"#" \
    -e "s#base_image_size = \"10GB\"#base_image_size = \"${DEVMAPPER_BASE_IMAGE_SIZE}\"#" \
    "${SCRIPT_DIR}/containerd-kata-fc.toml" >"${target}"
}

ensure_containerd_imports_fragment() {
  install -d "$(dirname "${CONTAINERD_CONFIG}")" /etc/containerd/conf.d

  if [[ ! -f "${CONTAINERD_CONFIG}" ]]; then
    containerd config default >"${CONTAINERD_CONFIG}"
  fi

  if ! grep -Eq '^[[:space:]]*imports[[:space:]]*=' "${CONTAINERD_CONFIG}"; then
    cp "${CONTAINERD_CONFIG}" "${CONTAINERD_CONFIG}.bak.$(date +%Y%m%d%H%M%S)"
    sed -i '1i imports = ["/etc/containerd/conf.d/*.toml"]' "${CONTAINERD_CONFIG}"
  elif ! grep -q '/etc/containerd/conf.d/\*.toml' "${CONTAINERD_CONFIG}"; then
    echo "Containerd config already has imports, but not /etc/containerd/conf.d/*.toml." >&2
    echo "Add /etc/containerd/conf.d/*.toml to ${CONTAINERD_CONFIG}, then rerun." >&2
    exit 1
  fi
}

write_k3s_template_if_needed() {
  if [[ "${USE_K3S_TEMPLATE}" == "false" ]]; then
    return
  fi

  if [[ "${USE_K3S_TEMPLATE}" == "auto" && ! -d /var/lib/rancher/k3s ]]; then
    return
  fi

  install -d "$(dirname "${K3S_CONFIG_FILE}")"
  if [[ ! -f "${K3S_CONFIG_FILE}" ]]; then
    printf 'snapshotter: devmapper\n' >"${K3S_CONFIG_FILE}"
  elif ! grep -Eq '^[[:space:]]*snapshotter[[:space:]]*:' "${K3S_CONFIG_FILE}"; then
    cp "${K3S_CONFIG_FILE}" "${K3S_CONFIG_FILE}.bak.$(date +%Y%m%d%H%M%S)"
    printf '\nsnapshotter: devmapper\n' >>"${K3S_CONFIG_FILE}"
  elif ! grep -Eq '^[[:space:]]*snapshotter[[:space:]]*:[[:space:]]*"?devmapper"?[[:space:]]*$' "${K3S_CONFIG_FILE}"; then
    echo "k3s config already sets a non-devmapper snapshotter in ${K3S_CONFIG_FILE}." >&2
    echo "Set snapshotter: devmapper there, then rerun." >&2
    exit 1
  fi

  install -d "$(dirname "${K3S_CONFIG_TEMPLATE}")"
  cat >"${K3S_CONFIG_TEMPLATE}" <<EOF
{{ template "base" . }}

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.kata-fc]
  runtime_type = "io.containerd.kata-fc.v2"
  privileged_without_host_devices = true

[plugins."io.containerd.snapshotter.v1.devmapper"]
  pool_name = "${DEVMAPPER_POOL_NAME}"
  root_path = "${DEVMAPPER_ROOT_PATH}"
  base_image_size = "${DEVMAPPER_BASE_IMAGE_SIZE}"
EOF
}

restart_runtime() {
  if [[ "${RESTART_CONTAINERD}" != "true" ]]; then
    return
  fi

  if systemctl is-active --quiet k3s; then
    systemctl restart k3s
  elif systemctl is-active --quiet k3s-agent; then
    systemctl restart k3s-agent
  else
    systemctl restart "${CONTAINERD_SERVICE}"
  fi
}

apply_kubernetes_assets() {
  if [[ "${APPLY_RUNTIME_CLASS}" == "true" ]]; then
    kubectl apply -f "${SCRIPT_DIR}/kata-fc-runtimeclass.yaml"
  fi

  if [[ "${LABEL_NODE}" == "true" ]]; then
    local node="${NODE_NAME}"
    if [[ -z "${node}" ]]; then
      node="$(hostname)"
    fi
    kubectl label node "${node}" katacontainers.io/kata-runtime=true --overwrite
  fi

  if [[ "${APPLY_SMOKE_TEST}" == "true" ]]; then
    kubectl apply -f "${SCRIPT_DIR}/kata-fc-smoke-test.yaml"
    kubectl wait --for=condition=Ready pod/kata-fc-smoke-test --timeout="${TIMEOUT}" || true
    kubectl logs pod/kata-fc-smoke-test || true
  fi
}

main() {
  as_root
  need curl
  need tar
  need xz
  need sed
  need grep
  need losetup
  need blockdev
  need dmsetup
  need systemctl

  if [[ "${CONFIGURE_CONTAINERD}" == "true" ]] && should_configure_system_containerd; then
    need containerd
  fi

  local arch version
  arch="$(detect_arch)"
  version="$(resolve_kata_version)"

  download_and_install_kata "${version}" "${arch}"
  install_firecracker_shim_wrapper
  write_devmapper_helper

  if [[ "${CONFIGURE_CONTAINERD}" == "true" ]]; then
    if should_configure_system_containerd; then
      write_containerd_fragment
      ensure_containerd_imports_fragment
    fi
    write_k3s_template_if_needed
    restart_runtime
  fi

  if [[ "${APPLY_RUNTIME_CLASS}" == "true" || "${LABEL_NODE}" == "true" || "${APPLY_SMOKE_TEST}" == "true" ]]; then
    need kubectl
    apply_kubernetes_assets
  fi

  echo "Kata Containers Firecracker runtime install complete"
  echo "Run a pod with: runtimeClassName: kata-fc"
}

main "$@"
