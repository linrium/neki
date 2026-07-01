import type {
  CustomObjectsApi,
  KubernetesObjectApi,
} from "@kubernetes/client-node"
import { decodeOptionalSecretValue, decodeSecretValue } from "./kubernetes"
import type { KubernetesCustomObject, SecretObject } from "./types"
import { getErrorStatus, getRecord, getString } from "./utils"
import { validateBucketName } from "./validators"

export async function ensureNeonProjectIsNew(
  customObjectsApi: CustomObjectsApi,
  namespace: string,
  projectName: string,
) {
  try {
    await customObjectsApi.getNamespacedCustomObject({
      group: "neon.oltp.molnett.org",
      version: "v1alpha1",
      namespace,
      plural: "projects",
      name: projectName,
    })
  } catch (error) {
    if (getErrorStatus(error) === 404) {
      return
    }
    throw error
  }

  throw new Error(`Neon project ${namespace}/${projectName} already exists.`)
}

export async function getNeonProject(
  customObjectsApi: CustomObjectsApi,
  namespace: string,
  projectName: string,
) {
  return (await customObjectsApi.getNamespacedCustomObject({
    group: "neon.oltp.molnett.org",
    version: "v1alpha1",
    namespace,
    plural: "projects",
    name: projectName,
  })) as KubernetesCustomObject
}

export async function ensureNeonBranchIsNew(
  customObjectsApi: CustomObjectsApi,
  namespace: string,
  branchName: string,
) {
  try {
    await customObjectsApi.getNamespacedCustomObject({
      group: "neon.oltp.molnett.org",
      version: "v1alpha1",
      namespace,
      plural: "branches",
      name: branchName,
    })
  } catch (error) {
    if (getErrorStatus(error) === 404) {
      return
    }
    throw error
  }

  throw new Error(`Neon branch ${namespace}/${branchName} already exists.`)
}

export async function resolveNeonBucketConfig({
  customObjectsApi,
  objectApi,
  namespace,
  clusterName,
}: {
  customObjectsApi: CustomObjectsApi
  objectApi: KubernetesObjectApi
  namespace: string
  clusterName: string
}) {
  const cluster = (await customObjectsApi.getNamespacedCustomObject({
    group: "neon.oltp.molnett.org",
    version: "v1alpha1",
    namespace,
    plural: "clusters",
    name: clusterName,
  })) as KubernetesCustomObject
  const spec = getRecord(cluster.spec)
  const secretRef = getRecord(spec?.bucketCredentialsSecret)
  const secretName = getString(secretRef?.name)
  const secretNamespace = getString(secretRef?.namespace) || namespace

  if (!secretName) {
    throw new Error(
      `Neon cluster ${namespace}/${clusterName} does not reference bucketCredentialsSecret.name.`,
    )
  }

  const secret = await objectApi.read<SecretObject>({
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: secretName,
      namespace: secretNamespace,
    },
  })
  const bucketName = decodeSecretValue(secret, "BUCKET_NAME")
  const endpoint = decodeOptionalSecretValue(secret, "AWS_ENDPOINT_URL")

  validateBucketName(bucketName)

  return {
    bucketName,
    endpoint,
    secretNamespace,
  }
}

export async function resolveProjectBuckets({
  customObjectsApi,
  objectApi,
  namespace,
  projects,
}: {
  customObjectsApi: CustomObjectsApi
  objectApi: KubernetesObjectApi
  namespace: string
  projects: KubernetesCustomObject[]
}) {
  const bucketByProject = new Map<string, string>()

  for (const project of projects) {
    const projectName = project.metadata?.name
    const clusterName = getString(getRecord(project.spec)?.cluster)

    if (!projectName || !clusterName) {
      continue
    }

    try {
      const bucket = await resolveNeonBucketConfig({
        customObjectsApi,
        objectApi,
        namespace,
        clusterName,
      })
      bucketByProject.set(projectName, bucket.bucketName)
    } catch {
      // Keep the page usable if bucket credentials are temporarily unavailable.
    }
  }

  return bucketByProject
}

export function buildNeonProject({
  namespace,
  projectName,
  neonCluster,
  serviceNamespace,
  serviceName,
  bucketName,
  vaultComponent,
  vaultPath,
}: {
  namespace: string
  projectName: string
  neonCluster: string
  serviceNamespace: string
  serviceName: string
  bucketName: string
  vaultComponent: string
  vaultPath: string
}): KubernetesCustomObject {
  return {
    apiVersion: "neon.oltp.molnett.org/v1alpha1",
    kind: "Project",
    metadata: {
      name: projectName,
      namespace,
      annotations: {
        "neki.dev/service-namespace": serviceNamespace,
        "neki.dev/rustfs-bucket": bucketName,
        "neki.dev/dapr-vault-component": vaultComponent,
        "neki.dev/dapr-vault-path": vaultPath,
      },
      labels: {
        "app.kubernetes.io/name": "neon",
        "app.kubernetes.io/managed-by": "neki-console",
        "app.kubernetes.io/part-of": serviceName,
      },
    },
    spec: {
      cluster: neonCluster,
    },
  }
}

export function buildNeonBranch({
  namespace,
  branchName,
  projectName,
  pgVersion,
  serviceNamespace,
  serviceName,
  bucketName,
  vaultComponent,
  vaultPath,
}: {
  namespace: string
  branchName: string
  projectName: string
  pgVersion: number
  serviceNamespace: string
  serviceName: string
  bucketName: string
  vaultComponent: string
  vaultPath: string
}): KubernetesCustomObject {
  return {
    apiVersion: "neon.oltp.molnett.org/v1alpha1",
    kind: "Branch",
    metadata: {
      name: branchName,
      namespace,
      annotations: {
        "neki.dev/service-namespace": serviceNamespace,
        "neki.dev/rustfs-bucket": bucketName,
        "neki.dev/dapr-vault-component": vaultComponent,
        "neki.dev/dapr-vault-path": vaultPath,
      },
      labels: {
        "app.kubernetes.io/name": "neon",
        "app.kubernetes.io/managed-by": "neki-console",
        "app.kubernetes.io/part-of": serviceName,
      },
    },
    spec: {
      projectID: projectName,
      pgVersion,
    },
  }
}
