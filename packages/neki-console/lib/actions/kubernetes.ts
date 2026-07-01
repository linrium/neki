import {
  type Cluster,
  CustomObjectsApi,
  KubeConfig,
  KubernetesObjectApi,
  PatchStrategy,
} from "@kubernetes/client-node"
import {
  type CustomObjectList,
  EMPTY_VALUE,
  type KubernetesCustomObject,
  type SecretObject,
} from "./types"
import {
  getCondition,
  getErrorMessage,
  getErrorStatus,
  getNumber,
  getRecord,
  sleep,
} from "./utils"

export function getClusterClient() {
  const kubeConfig = new KubeConfig()
  kubeConfig.loadFromDefault()

  return {
    customObjectsApi: kubeConfig.makeApiClient(CustomObjectsApi),
    objectApi: KubernetesObjectApi.makeApiClient(kubeConfig),
    currentCluster: kubeConfig.getCurrentCluster(),
    currentContext: kubeConfig.getCurrentContext() || EMPTY_VALUE,
  }
}

export async function getNamespacedKnativeService(
  customObjectsApi: CustomObjectsApi,
  namespace: string,
  name: string,
) {
  return (await customObjectsApi.getNamespacedCustomObject({
    group: "serving.knative.dev",
    version: "v1",
    namespace,
    plural: "services",
    name,
  })) as KubernetesCustomObject
}

export async function listKnativeRevisions(
  customObjectsApi: CustomObjectsApi,
  namespace: string,
  serviceName: string,
): Promise<{ items: KubernetesCustomObject[]; errors: string[] }> {
  try {
    const response = (await customObjectsApi.listNamespacedCustomObject({
      group: "serving.knative.dev",
      version: "v1",
      namespace,
      plural: "revisions",
      labelSelector: `serving.knative.dev/service=${serviceName}`,
      timeoutSeconds: 8,
    })) as CustomObjectList

    return {
      items: response.items ?? [],
      errors: [],
    }
  } catch (error) {
    return {
      items: [],
      errors: [`Knative revisions: ${getErrorMessage(error)}`],
    }
  }
}

export async function listCustomObjects(
  customObjectsApi: CustomObjectsApi,
  resource: {
    group: string
    version: string
    plural: string
    label: string
  },
): Promise<{ items: KubernetesCustomObject[]; errors: string[] }> {
  try {
    const response = (await customObjectsApi.listCustomObjectForAllNamespaces({
      group: resource.group,
      version: resource.version,
      plural: resource.plural,
      timeoutSeconds: 8,
    })) as CustomObjectList

    return {
      items: response.items ?? [],
      errors: [],
    }
  } catch (error) {
    return {
      items: [],
      errors: [`${resource.label}: ${getErrorMessage(error)}`],
    }
  }
}

export async function createCustomObject(
  customObjectsApi: CustomObjectsApi,
  request: {
    group: string
    version: string
    namespace: string
    plural: string
    body: KubernetesCustomObject
  },
) {
  await customObjectsApi.createNamespacedCustomObject({
    ...request,
    fieldManager: "neki-console",
  })
}

export async function createOrPatchObject(
  objectApi: KubernetesObjectApi,
  object: SecretObject,
) {
  try {
    await objectApi.create(object, undefined, undefined, "neki-console")
  } catch (error) {
    if (getErrorStatus(error) !== 409) {
      throw error
    }

    await objectApi.patch(
      object,
      undefined,
      undefined,
      "neki-console",
      undefined,
      PatchStrategy.MergePatch,
    )
  }
}

export async function reloadKnativeService(
  objectApi: KubernetesObjectApi,
  namespace: string,
  serviceName: string,
  annotations: Record<string, string>,
) {
  await objectApi.patch(
    {
      apiVersion: "serving.knative.dev/v1",
      kind: "Service",
      metadata: {
        name: serviceName,
        namespace,
      },
      spec: {
        template: {
          metadata: {
            annotations,
          },
        },
      },
    },
    undefined,
    undefined,
    "neki-console",
    undefined,
    PatchStrategy.MergePatch,
  )
}

export async function waitForKnativeServiceReady(
  customObjectsApi: CustomObjectsApi,
  namespace: string,
  serviceName: string,
) {
  const timeoutAt = Date.now() + 90_000

  while (Date.now() < timeoutAt) {
    const service = await getNamespacedKnativeService(
      customObjectsApi,
      namespace,
      serviceName,
    )
    const generation = service.metadata?.generation
    const observedGeneration = getNumber(
      getRecord(service.status)?.observedGeneration,
    )
    const readyCondition = getCondition(
      getRecord(service.status)?.conditions,
      "Ready",
    )

    if (
      readyCondition?.status === "True" &&
      generation !== undefined &&
      observedGeneration !== undefined &&
      observedGeneration >= generation
    ) {
      return
    }

    await sleep(2000)
  }

  throw new Error(
    `Knative service ${namespace}/${serviceName} did not become ready after reload.`,
  )
}

export function decodeSecretValue(secret: SecretObject, key: string) {
  const encoded = secret.data?.[key]
  if (!encoded) {
    throw new Error(
      `Kubernetes secret ${secret.metadata?.name} is missing ${key}.`,
    )
  }

  return Buffer.from(encoded, "base64").toString("utf8")
}

export function decodeOptionalSecretValue(secret: SecretObject, key: string) {
  const encoded = secret.data?.[key]
  return encoded ? Buffer.from(encoded, "base64").toString("utf8") : ""
}

export function getClusterName(cluster: Cluster | null) {
  if (!cluster) {
    return EMPTY_VALUE
  }

  return cluster.name || cluster.server || EMPTY_VALUE
}
