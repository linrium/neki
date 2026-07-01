import type {
  CustomObjectsApi,
  KubernetesObjectApi,
} from "@kubernetes/client-node"
import { decodeSecretValue } from "./kubernetes"
import type {
  DaprVaultConnection,
  KubernetesCustomObject,
  SecretObject,
} from "./types"
import {
  getErrorMessage,
  getRecord,
  getString,
  getStringRecord,
  normalizeBaseUrl,
} from "./utils"

export async function resolveDaprVault({
  customObjectsApi,
  objectApi,
  namespace,
  componentName,
}: {
  customObjectsApi: CustomObjectsApi
  objectApi: KubernetesObjectApi
  namespace: string
  componentName: string
}): Promise<DaprVaultConnection> {
  const component = (await customObjectsApi.getNamespacedCustomObject({
    group: "dapr.io",
    version: "v1alpha1",
    namespace,
    plural: "components",
    name: componentName,
  })) as KubernetesCustomObject
  const spec = getRecord(component.spec)
  const type = getString(spec?.type)

  if (type !== "secretstores.hashicorp.vault") {
    throw new Error(
      `Dapr component ${namespace}/${componentName} is ${type || "unknown"}, not secretstores.hashicorp.vault.`,
    )
  }

  const metadata = getDaprMetadata(spec?.metadata)

  const tokenRef = metadata.get("vaultToken")?.secretKeyRef
  if (!tokenRef?.name || !tokenRef.key) {
    throw new Error(
      `Dapr Vault component ${namespace}/${componentName} does not reference a vaultToken Kubernetes secret.`,
    )
  }

  const tokenSecret = await objectApi.read<SecretObject>({
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: tokenRef.name,
      namespace,
    },
  })
  const token = decodeSecretValue(tokenSecret, tokenRef.key)
  const address = metadata.get("vaultAddr")?.value

  if (!address) {
    throw new Error(
      `Dapr Vault component ${namespace}/${componentName} is missing vaultAddr.`,
    )
  }

  return {
    address,
    enginePath: metadata.get("enginePath")?.value || "secret",
    prefix: metadata.get("vaultKVPrefix")?.value || "",
    usePrefix: metadata.get("vaultKVUsePrefix")?.value !== "false",
    token,
  }
}

function getDaprMetadata(value: unknown) {
  const entries = new Map<
    string,
    { value?: string; secretKeyRef?: { name?: string; key?: string } }
  >()

  if (!Array.isArray(value)) {
    return entries
  }

  for (const item of value) {
    const record = getRecord(item)
    const name = getString(record?.name)
    if (!name) {
      continue
    }

    entries.set(name, {
      value: getString(record?.value),
      secretKeyRef: getRecord(record?.secretKeyRef) as
        | { name?: string; key?: string }
        | undefined,
    })
  }

  return entries
}

export async function writeVaultKvSecret(
  vault: DaprVaultConnection,
  secretName: string,
  values: Record<string, string>,
) {
  const url = new URL(
    `/v1/${vault.enginePath}/data/${getVaultDataPath(vault, secretName)}`,
    normalizeBaseUrl(vault.address),
  )
  const existing = await readVaultKvSecret(url, vault.token)
  const response = await fetchVault(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Vault-Token": vault.token,
    },
    body: JSON.stringify({
      data: {
        ...existing,
        ...values,
      },
    }),
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error(
      `Vault write failed for ${url.pathname}: ${response.status} ${response.statusText}`,
    )
  }
}

async function readVaultKvSecret(url: URL, token: string) {
  const response = await fetchVault(url, {
    headers: {
      "X-Vault-Token": token,
    },
    cache: "no-store",
  })

  if (response.status === 404) {
    return {}
  }

  if (!response.ok) {
    throw new Error(
      `Vault read failed for ${url.pathname}: ${response.status} ${response.statusText}`,
    )
  }

  const payload = getRecord(await response.json())
  return getStringRecord(getRecord(payload?.data)?.data)
}

export async function readVaultSecret(
  vault: DaprVaultConnection,
  secretName: string,
): Promise<{ exists: boolean; values: Record<string, string> }> {
  const url = new URL(
    `/v1/${buildVaultKvPath(vault, secretName)}`,
    normalizeBaseUrl(vault.address),
  )
  const response = await fetchVault(url, {
    headers: {
      "X-Vault-Token": vault.token,
    },
    cache: "no-store",
  })

  if (response.status === 404) {
    return { exists: false, values: {} }
  }

  if (!response.ok) {
    throw new Error(
      `Vault read failed for ${url.pathname}: ${response.status} ${response.statusText}`,
    )
  }

  const payload = getRecord(await response.json())
  return {
    exists: true,
    values: getStringRecord(getRecord(payload?.data)?.data),
  }
}

async function fetchVault(url: URL, init: RequestInit) {
  try {
    return await fetch(url, init)
  } catch (error) {
    const localUrl = toLocalVaultUrl(url)
    if (!localUrl) {
      throw new Error(
        `Vault is not reachable at ${url.origin}. If you are running neki-console locally, port-forward Vault and set VAULT_ADDR=http://127.0.0.1:8200. ${getErrorMessage(error)}`,
      )
    }

    try {
      return await fetch(localUrl, init)
    } catch (localError) {
      throw new Error(
        `Vault is not reachable at ${url.origin} or ${localUrl.origin}. Start the Vault port-forward with ./scripts/vault-port-forward.sh, then retry. ${getErrorMessage(localError)}`,
      )
    }
  }
}

function toLocalVaultUrl(url: URL) {
  const isClusterService =
    url.hostname.endsWith(".svc") ||
    url.hostname.includes(".svc.") ||
    url.hostname.endsWith(".svc.cluster.local")

  if (!isClusterService) {
    return undefined
  }

  const localUrl = new URL(url.toString())
  localUrl.hostname = "127.0.0.1"
  return localUrl
}

export function buildVaultKvPath(
  vault: DaprVaultConnection,
  secretName: string,
) {
  return `${vault.enginePath}/data/${getVaultDataPath(vault, secretName)}`
}

function getVaultDataPath(vault: DaprVaultConnection, secretName: string) {
  return [vault.usePrefix ? vault.prefix : "", secretName]
    .filter(Boolean)
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .join("/")
}
