"use server"

import { revalidatePath } from "next/cache"
import { listDaprResources } from "./dapr"
import { buildKongFunctionUrl } from "./kong"
import {
  createCustomObject,
  createOrPatchObject,
  getClusterClient,
  getClusterName,
  getNamespacedKnativeService,
  listCustomObjects,
  listKnativeRevisions,
  reloadKnativeService,
  waitForKnativeServiceReady,
} from "./kubernetes"
import { buildLokiQuery, fetchLokiQueryRange } from "./loki"
import {
  getRelatedDaprResources,
  sortServiceNeonDatabases,
  sortServiceNeonProjectSummaries,
  sortServicePostgresClusters,
  toKnativeService,
  toServiceConditions,
  toServiceContainers,
  toServiceNeonDatabase,
  toServiceNeonProjectSummary,
  toServicePostgresCluster,
  toServiceRevisions,
  toTrafficTargets,
} from "./mappers"
import {
  buildNeonBranch,
  buildNeonProject,
  ensureNeonBranchIsNew,
  ensureNeonProjectIsNew,
  getNeonProject,
  resolveNeonBucketConfig,
  resolveProjectBuckets,
} from "./neon"
import {
  buildPostgresCluster,
  buildPostgresSecret,
  ensurePostgresClusterIsNew,
} from "./postgres"
import {
  buildRustfsBucketJobName,
  createRustfsBucketJob,
  waitForJobComplete,
} from "./rustfs"
import {
  type ClusterOverview,
  type CustomObjectList,
  DEFAULT_LOG_LIMIT,
  DEFAULT_LOG_WINDOW_MINUTES,
  EMPTY_VALUE,
  type NeonBranchMutationResult,
  type NeonDatabaseProvisionResult,
  type PlaygroundResult,
  type PostgresProvisionResult,
  type SecretReadResult,
  type ServiceDetail,
  type ServiceLogs,
  type ServiceNeonDatabases,
  type ServiceNeonProjectBranches,
  type ServicePostgresClusters,
} from "./types"
import {
  formatResponseBody,
  formatValue,
  generatePassword,
  getErrorMessage,
  getErrorStatus,
  getFormString,
  getPositiveInteger,
  getRecord,
  getString,
  toKeyValues,
} from "./utils"
import {
  validateBucketName,
  validateIdentifier,
  validateKubernetesName,
  validatePostgresVersion,
  validateStorageSize,
  validateVaultSecretName,
} from "./validators"
import {
  buildVaultKvPath,
  readVaultSecret,
  resolveDaprVault,
  writeVaultKvSecret,
} from "./vault"

export async function refreshDashboard() {
  revalidatePath("/")
}

export async function triggerKongFunction(
  _previousState: PlaygroundResult,
  formData: FormData,
): Promise<PlaygroundResult> {
  const startedAt = Date.now()
  const method = getFormString(formData, "method") || "POST"
  const functionName = getFormString(formData, "functionName")
  const path = getFormString(formData, "path")
  const body = getFormString(formData, "body")
  const kongBaseUrl =
    getFormString(formData, "kongBaseUrl") ||
    process.env.KONG_BASE_URL ||
    "http://localhost:8080"

  try {
    if (!functionName) {
      throw new Error("Function name is required.")
    }

    const url = buildKongFunctionUrl(kongBaseUrl, functionName, path)
    const response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body:
        method === "GET" || method === "HEAD" ? undefined : body || undefined,
      cache: "no-store",
    })
    const responseBody = await response.text()

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url,
      method,
      durationMs: Date.now() - startedAt,
      responseBody: formatResponseBody(responseBody),
      responseHeaders: Array.from(response.headers.entries()).map(
        ([key, value]) => ({ key, value }),
      ),
      error: "",
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: "Request failed",
      url: "",
      method,
      durationMs: Date.now() - startedAt,
      responseBody: "",
      responseHeaders: [],
      error: getErrorMessage(error),
    }
  }
}

export async function refreshService(namespace: string, name: string) {
  revalidatePath(
    `/services/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
  )
  revalidatePath(
    `/services/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/logs`,
  )
  revalidatePath(
    `/services/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/playground`,
  )
  revalidatePath(
    `/services/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/postgres`,
  )
  revalidatePath(
    `/services/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/databases`,
  )
  revalidatePath(
    `/services/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/secrets`,
  )
}

export async function createServicePostgres(
  namespace: string,
  serviceName: string,
  _previousState: PostgresProvisionResult,
  formData: FormData,
): Promise<PostgresProvisionResult> {
  const startedAt = new Date().toISOString()
  const input = {
    clusterName:
      getFormString(formData, "clusterName") || `${serviceName}-postgres`,
    database: getFormString(formData, "database") || "app",
    username: getFormString(formData, "username") || "app",
    instances: getPositiveInteger(getFormString(formData, "instances"), 1),
    storageSize: getFormString(formData, "storageSize") || "8Gi",
    postgresVersion: getFormString(formData, "postgresVersion") || "16",
    vaultComponent: getFormString(formData, "vaultComponent") || "vault",
    vaultSecretName: getFormString(formData, "vaultSecretName") || serviceName,
  }
  const password = generatePassword()
  const cnpgSecretName = `${input.clusterName}-app`
  const resultBase = {
    clusterName: input.clusterName,
    database: input.database,
    username: input.username,
    vaultComponent: input.vaultComponent,
    vaultSecretName: input.vaultSecretName,
    vaultPath: "",
    cnpgSecretName,
    serviceReloadedAt: startedAt,
    steps: [],
  }

  try {
    validateKubernetesName(namespace, "Namespace")
    validateKubernetesName(serviceName, "Service name")
    validateKubernetesName(input.clusterName, "Postgres cluster name")
    validateKubernetesName(input.vaultComponent, "Dapr Vault component")
    validateVaultSecretName(input.vaultSecretName)
    validateIdentifier(input.database, "Database")
    validateIdentifier(input.username, "Username")
    validateStorageSize(input.storageSize)

    const { customObjectsApi, objectApi } = getClusterClient()
    await ensurePostgresClusterIsNew(
      customObjectsApi,
      namespace,
      input.clusterName,
    )

    const vault = await resolveDaprVault({
      customObjectsApi,
      objectApi,
      namespace,
      componentName: input.vaultComponent,
    })
    const vaultPath = buildVaultKvPath(vault, input.vaultSecretName)
    const host = `${input.clusterName}-rw.${namespace}.svc.cluster.local`
    const vaultData = {
      postgresDatabase: input.database,
      postgresHost: host,
      postgresPassword: password,
      postgresPort: "5432",
      postgresUsername: input.username,
    }

    await writeVaultKvSecret(vault, input.vaultSecretName, vaultData)
    await createOrPatchObject(
      objectApi,
      buildPostgresSecret({
        namespace,
        name: cnpgSecretName,
        username: input.username,
        password,
        clusterName: input.clusterName,
        serviceName,
      }),
    )
    await createCustomObject(customObjectsApi, {
      group: "postgresql.cnpg.io",
      version: "v1",
      namespace,
      plural: "clusters",
      body: buildPostgresCluster({
        namespace,
        clusterName: input.clusterName,
        database: input.database,
        username: input.username,
        secretName: cnpgSecretName,
        instances: input.instances,
        storageSize: input.storageSize,
        postgresVersion: input.postgresVersion,
        serviceName,
        vaultComponent: input.vaultComponent,
        vaultPath,
      }),
    })
    await reloadKnativeService(objectApi, namespace, serviceName, {
      "neki.dev/postgres-cluster": input.clusterName,
      "neki.dev/postgres-vault-component": input.vaultComponent,
      "neki.dev/postgres-vault-secret": input.vaultSecretName,
      "neki.dev/postgres-reloaded-at": startedAt,
    })
    await waitForKnativeServiceReady(customObjectsApi, namespace, serviceName)

    const servicePath = `/services/${encodeURIComponent(namespace)}/${encodeURIComponent(serviceName)}`
    revalidatePath(servicePath)
    revalidatePath(`${servicePath}/postgres`)

    return {
      ok: true,
      title: "Postgres instance created",
      message:
        "CloudNativePG is provisioning the cluster, credentials were saved to Vault, and the Knative service template was reloaded.",
      ...resultBase,
      vaultPath,
      steps: [
        {
          label: "Vault",
          detail: `Wrote credentials to ${vaultPath} through ${input.vaultComponent}.`,
        },
        {
          label: "CloudNativePG",
          detail: `Created ${namespace}/${input.clusterName} with bootstrap secret ${cnpgSecretName}.`,
        },
        {
          label: "Knative",
          detail: `Reloaded ${namespace}/${serviceName} and waited for the new template to become ready.`,
        },
      ],
      error: "",
    }
  } catch (error) {
    return {
      ok: false,
      title: "Postgres provisioning failed",
      message: "No Postgres instance was completed.",
      ...resultBase,
      error: getErrorMessage(error),
    }
  }
}

export async function loadServiceSecrets(
  namespace: string,
  serviceName: string,
  _previousState: SecretReadResult,
  formData: FormData,
): Promise<SecretReadResult> {
  const loadedAt = new Date().toISOString()
  const input = {
    vaultComponent: getFormString(formData, "vaultComponent") || "vault",
    secretName: getFormString(formData, "secretName") || serviceName,
  }
  const resultBase = {
    namespace,
    serviceName,
    vaultComponent: input.vaultComponent,
    secretName: input.secretName,
    vaultPath: "",
    loadedAt,
    entries: [],
  }

  try {
    validateKubernetesName(namespace, "Namespace")
    validateKubernetesName(serviceName, "Service name")
    validateKubernetesName(input.vaultComponent, "Dapr Vault component")
    validateVaultSecretName(input.secretName)

    const { customObjectsApi, objectApi } = getClusterClient()
    await getNamespacedKnativeService(customObjectsApi, namespace, serviceName)
    const vault = await resolveDaprVault({
      customObjectsApi,
      objectApi,
      namespace,
      componentName: input.vaultComponent,
    })
    const secret = await readVaultSecret(vault, input.secretName)
    const entries = Object.entries(secret.values)
      .map(([key, value]) => ({
        key,
        value,
        size: new TextEncoder().encode(value).length,
      }))
      .sort((left, right) => left.key.localeCompare(right.key))

    return {
      ok: true,
      title: secret.exists ? "Secret loaded" : "Secret not found",
      message: secret.exists
        ? `Loaded ${entries.length} value${entries.length === 1 ? "" : "s"} from Vault KV.`
        : "Vault returned 404 for this secret path.",
      ...resultBase,
      vaultPath: buildVaultKvPath(vault, input.secretName),
      entries,
      error: "",
    }
  } catch (error) {
    return {
      ok: false,
      title: "Secret load failed",
      message: "The secret values could not be loaded.",
      ...resultBase,
      error: getErrorMessage(error),
    }
  }
}

export async function createServiceNeonDatabase(
  namespace: string,
  serviceName: string,
  _previousState: NeonDatabaseProvisionResult,
  formData: FormData,
): Promise<NeonDatabaseProvisionResult> {
  const startedAt = new Date().toISOString()
  const input = {
    neonNamespace: getFormString(formData, "neonNamespace") || "neon",
    neonCluster: getFormString(formData, "neonCluster") || "neki-neon",
    projectName:
      getFormString(formData, "projectName") || `${serviceName}-project`,
    branchName: getFormString(formData, "branchName") || `${serviceName}-main`,
    pgVersion: getFormString(formData, "pgVersion") || "17",
    database: getFormString(formData, "database") || "postgres",
    username: getFormString(formData, "username") || "cloud_admin",
    rustfsNamespace: getFormString(formData, "rustfsNamespace") || "rustfs",
    rustfsEndpoint:
      getFormString(formData, "rustfsEndpoint") ||
      "http://rustfs-svc.rustfs.svc.cluster.local:9000",
    rustfsSecretName:
      getFormString(formData, "rustfsSecretName") || "rustfs-secret",
    bucketName:
      getFormString(formData, "bucketName") || `neon-${serviceName}-project`,
    vaultComponent: getFormString(formData, "vaultComponent") || "vault",
    vaultSecretName: getFormString(formData, "vaultSecretName") || serviceName,
  }
  const resultBase = {
    neonNamespace: input.neonNamespace,
    projectName: input.projectName,
    branchName: input.branchName,
    bucketName: input.bucketName,
    database: input.database,
    username: input.username,
    vaultComponent: input.vaultComponent,
    vaultSecretName: input.vaultSecretName,
    vaultPath: "",
    serviceReloadedAt: startedAt,
    steps: [],
  }

  try {
    validateKubernetesName(namespace, "Namespace")
    validateKubernetesName(serviceName, "Service name")
    validateKubernetesName(input.neonNamespace, "Neon namespace")
    validateKubernetesName(input.neonCluster, "Neon cluster")
    validateKubernetesName(input.projectName, "Neon project")
    validateKubernetesName(input.branchName, "Neon branch")
    validateKubernetesName(input.rustfsNamespace, "RustFS namespace")
    validateKubernetesName(input.rustfsSecretName, "RustFS secret")
    validateKubernetesName(input.vaultComponent, "Dapr Vault component")
    validateVaultSecretName(input.vaultSecretName)
    validateIdentifier(input.database, "Database")
    validateIdentifier(input.username, "Username")
    validatePostgresVersion(input.pgVersion)

    const { customObjectsApi, objectApi } = getClusterClient()
    await getNamespacedKnativeService(customObjectsApi, namespace, serviceName)
    const neonBucket = await resolveNeonBucketConfig({
      customObjectsApi,
      objectApi,
      namespace: input.neonNamespace,
      clusterName: input.neonCluster,
    })
    await ensureNeonProjectIsNew(
      customObjectsApi,
      input.neonNamespace,
      input.projectName,
    )
    await ensureNeonBranchIsNew(
      customObjectsApi,
      input.neonNamespace,
      input.branchName,
    )

    const vault = await resolveDaprVault({
      customObjectsApi,
      objectApi,
      namespace,
      componentName: input.vaultComponent,
    })
    const vaultPath = buildVaultKvPath(vault, input.vaultSecretName)
    const host = `${input.branchName}-postgres.${input.neonNamespace}.svc.cluster.local`
    const port = "55433"
    const databaseUrl = `postgres://${input.username}@${host}:${port}/${input.database}?sslmode=disable`

    const bucketJobName = buildRustfsBucketJobName(neonBucket.bucketName)
    await createRustfsBucketJob(objectApi, {
      bucketName: neonBucket.bucketName,
      endpoint: neonBucket.endpoint || input.rustfsEndpoint,
      jobName: bucketJobName,
      namespace: input.rustfsNamespace,
      secretName: input.rustfsSecretName,
    })
    await waitForJobComplete(objectApi, input.rustfsNamespace, bucketJobName)

    await createCustomObject(customObjectsApi, {
      group: "neon.oltp.molnett.org",
      version: "v1alpha1",
      namespace: input.neonNamespace,
      plural: "projects",
      body: buildNeonProject({
        namespace: input.neonNamespace,
        projectName: input.projectName,
        neonCluster: input.neonCluster,
        serviceNamespace: namespace,
        serviceName,
        bucketName: neonBucket.bucketName,
        vaultComponent: input.vaultComponent,
        vaultPath,
      }),
    })
    await createCustomObject(customObjectsApi, {
      group: "neon.oltp.molnett.org",
      version: "v1alpha1",
      namespace: input.neonNamespace,
      plural: "branches",
      body: buildNeonBranch({
        namespace: input.neonNamespace,
        branchName: input.branchName,
        projectName: input.projectName,
        pgVersion: Number(input.pgVersion),
        serviceNamespace: namespace,
        serviceName,
        bucketName: neonBucket.bucketName,
        vaultComponent: input.vaultComponent,
        vaultPath,
      }),
    })
    await writeVaultKvSecret(vault, input.vaultSecretName, {
      DATABASE_URL: databaseUrl,
      neonBranch: input.branchName,
      neonComputeService: `${input.branchName}-postgres`,
      neonNamespace: input.neonNamespace,
      neonProject: input.projectName,
      postgresDatabase: input.database,
      postgresHost: host,
      postgresPassword: "",
      postgresPort: port,
      postgresUsername: input.username,
      rustfsBucket: neonBucket.bucketName,
      rustfsEndpoint: neonBucket.endpoint || input.rustfsEndpoint,
    })
    await reloadKnativeService(objectApi, namespace, serviceName, {
      "neki.dev/neon-branch": input.branchName,
      "neki.dev/neon-project": input.projectName,
      "neki.dev/neon-vault-component": input.vaultComponent,
      "neki.dev/neon-vault-secret": input.vaultSecretName,
      "neki.dev/neon-reloaded-at": startedAt,
    })
    await waitForKnativeServiceReady(customObjectsApi, namespace, serviceName)

    const servicePath = `/services/${encodeURIComponent(namespace)}/${encodeURIComponent(serviceName)}`
    revalidatePath(servicePath)
    revalidatePath(`${servicePath}/databases`)
    revalidatePath(`${servicePath}/secrets`)

    return {
      ok: true,
      title: "Neon database requested",
      message:
        "Created the RustFS bucket, Neon Project, Neon Branch, saved connection fields to Vault, and reloaded the Knative service.",
      ...resultBase,
      bucketName: neonBucket.bucketName,
      vaultPath,
      steps: [
        {
          label: "RustFS",
          detail: `Ensured Neon bucket ${neonBucket.bucketName} with job ${input.rustfsNamespace}/${bucketJobName}.`,
        },
        {
          label: "Neon",
          detail: `Created Project ${input.projectName} and Branch ${input.branchName} in ${input.neonNamespace}.`,
        },
        {
          label: "Vault",
          detail: `Wrote Neon connection fields to ${vaultPath} through ${input.vaultComponent}.`,
        },
        {
          label: "Knative",
          detail: `Reloaded ${namespace}/${serviceName} and waited for the new template to become ready.`,
        },
      ],
      error: "",
    }
  } catch (error) {
    return {
      ok: false,
      title: "Neon provisioning failed",
      message: "No Neon database was completed.",
      ...resultBase,
      error: getErrorMessage(error),
    }
  }
}

export async function createServiceNeonBranch(
  namespace: string,
  serviceName: string,
  projectName: string,
  _previousState: NeonBranchMutationResult,
  formData: FormData,
): Promise<NeonBranchMutationResult> {
  const input = {
    neonNamespace: getFormString(formData, "neonNamespace") || "neon",
    branchName: getFormString(formData, "branchName"),
    pgVersion: getFormString(formData, "pgVersion") || "17",
    vaultComponent: getFormString(formData, "vaultComponent") || "vault",
    vaultPath: getFormString(formData, "vaultPath"),
    bucketName: getFormString(formData, "bucketName"),
  }
  const resultBase = {
    branchName: input.branchName,
    projectName,
    neonNamespace: input.neonNamespace,
  }

  try {
    validateKubernetesName(namespace, "Namespace")
    validateKubernetesName(serviceName, "Service name")
    validateKubernetesName(input.neonNamespace, "Neon namespace")
    validateKubernetesName(projectName, "Neon project")
    validateKubernetesName(input.branchName, "Neon branch")
    validateKubernetesName(input.vaultComponent, "Dapr Vault component")
    validatePostgresVersion(input.pgVersion)
    if (input.bucketName) {
      validateBucketName(input.bucketName)
    }

    const { customObjectsApi } = getClusterClient()
    await getNamespacedKnativeService(customObjectsApi, namespace, serviceName)
    await getNeonProject(customObjectsApi, input.neonNamespace, projectName)
    await ensureNeonBranchIsNew(
      customObjectsApi,
      input.neonNamespace,
      input.branchName,
    )
    await createCustomObject(customObjectsApi, {
      group: "neon.oltp.molnett.org",
      version: "v1alpha1",
      namespace: input.neonNamespace,
      plural: "branches",
      body: buildNeonBranch({
        namespace: input.neonNamespace,
        branchName: input.branchName,
        projectName,
        pgVersion: Number(input.pgVersion),
        serviceNamespace: namespace,
        serviceName,
        bucketName: input.bucketName,
        vaultComponent: input.vaultComponent,
        vaultPath: input.vaultPath,
      }),
    })

    const servicePath = `/services/${encodeURIComponent(namespace)}/${encodeURIComponent(serviceName)}`
    revalidatePath(`${servicePath}/databases`)
    revalidatePath(
      `${servicePath}/databases/${encodeURIComponent(projectName)}`,
    )

    return {
      ok: true,
      title: "Branch created",
      message: `Created Neon Branch ${input.neonNamespace}/${input.branchName}.`,
      ...resultBase,
      error: "",
    }
  } catch (error) {
    return {
      ok: false,
      title: "Branch create failed",
      message: "The Neon branch was not created.",
      ...resultBase,
      error: getErrorMessage(error),
    }
  }
}

export async function deleteServiceNeonBranch(
  namespace: string,
  serviceName: string,
  projectName: string,
  neonNamespace: string,
  branchName: string,
) {
  try {
    validateKubernetesName(namespace, "Namespace")
    validateKubernetesName(serviceName, "Service name")
    validateKubernetesName(projectName, "Neon project")
    validateKubernetesName(neonNamespace, "Neon namespace")
    validateKubernetesName(branchName, "Neon branch")

    const { customObjectsApi } = getClusterClient()
    await getNamespacedKnativeService(customObjectsApi, namespace, serviceName)
    await customObjectsApi.deleteNamespacedCustomObject({
      group: "neon.oltp.molnett.org",
      version: "v1alpha1",
      namespace: neonNamespace,
      plural: "branches",
      name: branchName,
    })
  } catch (error) {
    if (getErrorStatus(error) !== 404) {
      throw error
    }
  }

  const servicePath = `/services/${encodeURIComponent(namespace)}/${encodeURIComponent(serviceName)}`
  revalidatePath(`${servicePath}/databases`)
  revalidatePath(`${servicePath}/databases/${encodeURIComponent(projectName)}`)
}

export async function getServicePostgresClusters(
  namespace: string,
  serviceName: string,
): Promise<ServicePostgresClusters> {
  const lastSyncedAt = new Date().toISOString()

  try {
    validateKubernetesName(namespace, "Namespace")
    validateKubernetesName(serviceName, "Service name")

    const { customObjectsApi } = getClusterClient()
    const response = (await customObjectsApi.listNamespacedCustomObject({
      group: "postgresql.cnpg.io",
      version: "v1",
      namespace,
      plural: "clusters",
      timeoutSeconds: 8,
    })) as CustomObjectList

    return {
      lastSyncedAt,
      clusters: (response.items ?? [])
        .map((item) => toServicePostgresCluster(item, serviceName))
        .sort(sortServicePostgresClusters),
      errors: [],
    }
  } catch (error) {
    return {
      lastSyncedAt,
      clusters: [],
      errors: [`CloudNativePG clusters: ${getErrorMessage(error)}`],
    }
  }
}

export async function getServiceNeonDatabases(
  _namespace: string,
  serviceName: string,
): Promise<ServiceNeonDatabases> {
  const lastSyncedAt = new Date().toISOString()
  const neonNamespace = process.env.NEON_NAMESPACE || "neon"

  try {
    validateKubernetesName(serviceName, "Service name")
    validateKubernetesName(neonNamespace, "Neon namespace")

    const { customObjectsApi, objectApi } = getClusterClient()
    const [projectsResponse, branchesResponse] = await Promise.all([
      customObjectsApi.listNamespacedCustomObject({
        group: "neon.oltp.molnett.org",
        version: "v1alpha1",
        namespace: neonNamespace,
        plural: "projects",
        timeoutSeconds: 8,
      }) as Promise<CustomObjectList>,
      customObjectsApi.listNamespacedCustomObject({
        group: "neon.oltp.molnett.org",
        version: "v1alpha1",
        namespace: neonNamespace,
        plural: "branches",
        timeoutSeconds: 8,
      }) as Promise<CustomObjectList>,
    ])
    const projectsByName = new Map(
      (projectsResponse.items ?? []).map((project) => [
        project.metadata?.name ?? "",
        project,
      ]),
    )
    const projectBuckets = await resolveProjectBuckets({
      customObjectsApi,
      objectApi,
      namespace: neonNamespace,
      projects: projectsResponse.items ?? [],
    })
    const branches = (branchesResponse.items ?? []).map((branch) =>
      toServiceNeonDatabase(
        branch,
        projectsByName.get(getString(getRecord(branch.spec)?.projectID) ?? ""),
        serviceName,
      ),
    )

    return {
      lastSyncedAt,
      databases: (projectsResponse.items ?? [])
        .map((project) =>
          toServiceNeonProjectSummary(
            project,
            branches,
            serviceName,
            projectBuckets.get(project.metadata?.name ?? ""),
          ),
        )
        .sort(sortServiceNeonProjectSummaries),
      errors: [],
    }
  } catch (error) {
    return {
      lastSyncedAt,
      databases: [],
      errors: [`Neon databases: ${getErrorMessage(error)}`],
    }
  }
}

export async function getServiceNeonProjectBranches(
  _namespace: string,
  serviceName: string,
  projectName: string,
): Promise<ServiceNeonProjectBranches> {
  const lastSyncedAt = new Date().toISOString()
  const neonNamespace = process.env.NEON_NAMESPACE || "neon"

  try {
    validateKubernetesName(serviceName, "Service name")
    validateKubernetesName(projectName, "Neon project")
    validateKubernetesName(neonNamespace, "Neon namespace")

    const { customObjectsApi, objectApi } = getClusterClient()
    const [project, branchesResponse] = await Promise.all([
      getNeonProject(customObjectsApi, neonNamespace, projectName),
      customObjectsApi.listNamespacedCustomObject({
        group: "neon.oltp.molnett.org",
        version: "v1alpha1",
        namespace: neonNamespace,
        plural: "branches",
        timeoutSeconds: 8,
      }) as Promise<CustomObjectList>,
    ])
    const labels = project.metadata?.labels ?? {}
    const annotations = project.metadata?.annotations ?? {}
    const spec = getRecord(project.spec)
    const bucketConfig = await resolveNeonBucketConfig({
      customObjectsApi,
      objectApi,
      namespace: neonNamespace,
      clusterName: getString(spec?.cluster) || "",
    })
    const branches = (branchesResponse.items ?? [])
      .filter(
        (branch) =>
          getString(getRecord(branch.spec)?.projectID) === projectName,
      )
      .map((branch) => toServiceNeonDatabase(branch, project, serviceName))
      .sort(sortServiceNeonDatabases)

    return {
      lastSyncedAt,
      projectName,
      namespace: project.metadata?.namespace ?? neonNamespace,
      cluster: getString(spec?.cluster) || EMPTY_VALUE,
      bucketName:
        bucketConfig.bucketName ||
        annotations["neki.dev/rustfs-bucket"] ||
        EMPTY_VALUE,
      linkedToService: labels["app.kubernetes.io/part-of"] === serviceName,
      managedByConsole:
        labels["app.kubernetes.io/managed-by"] === "neki-console",
      branches,
      errors: [],
    }
  } catch (error) {
    return {
      lastSyncedAt,
      projectName,
      namespace: neonNamespace,
      cluster: EMPTY_VALUE,
      bucketName: EMPTY_VALUE,
      linkedToService: false,
      managedByConsole: false,
      branches: [],
      errors: [`Neon project: ${getErrorMessage(error)}`],
    }
  }
}

export async function getClusterOverview(): Promise<ClusterOverview> {
  const lastSyncedAt = new Date().toISOString()

  try {
    const { customObjectsApi, currentCluster, currentContext } =
      getClusterClient()

    const [knativeResult, daprResult] = await Promise.all([
      listCustomObjects(customObjectsApi, {
        group: "serving.knative.dev",
        version: "v1",
        plural: "services",
        label: "Knative services",
      }),
      listDaprResources(customObjectsApi),
    ])

    return {
      clusterName: getClusterName(currentCluster),
      currentContext,
      lastSyncedAt,
      services: knativeResult.items.map(toKnativeService),
      daprResources: daprResult.resources,
      errors: [...knativeResult.errors, ...daprResult.errors],
    }
  } catch (error) {
    return {
      clusterName: EMPTY_VALUE,
      currentContext: EMPTY_VALUE,
      lastSyncedAt,
      services: [],
      daprResources: [],
      errors: [`Kubernetes connection failed: ${getErrorMessage(error)}`],
    }
  }
}

export async function getServiceDetail(
  namespace: string,
  name: string,
): Promise<ServiceDetail> {
  const lastSyncedAt = new Date().toISOString()

  try {
    const { customObjectsApi, currentCluster, currentContext } =
      getClusterClient()
    const [serviceItem, daprResult, revisionsResult] = await Promise.all([
      getNamespacedKnativeService(customObjectsApi, namespace, name),
      listDaprResources(customObjectsApi),
      listKnativeRevisions(customObjectsApi, namespace, name),
    ])
    const service = toKnativeService(serviceItem)
    const traffic = getRecord(serviceItem.status)?.traffic

    return {
      clusterName: getClusterName(currentCluster),
      currentContext,
      lastSyncedAt,
      service,
      uid: serviceItem.metadata?.uid ?? EMPTY_VALUE,
      resourceVersion: serviceItem.metadata?.resourceVersion ?? EMPTY_VALUE,
      generation: formatValue(serviceItem.metadata?.generation),
      observedGeneration: formatValue(
        getRecord(serviceItem.status)?.observedGeneration,
      ),
      labels: toKeyValues(serviceItem.metadata?.labels),
      annotations: toKeyValues(serviceItem.metadata?.annotations),
      conditions: toServiceConditions(
        getRecord(serviceItem.status)?.conditions,
      ),
      trafficTargets: toTrafficTargets(traffic),
      revisions: toServiceRevisions(
        revisionsResult.items,
        traffic,
        service.revision,
      ),
      containers: toServiceContainers(
        getRecord(getRecord(serviceItem.spec?.template)?.spec)?.containers,
      ),
      relatedDaprResources: getRelatedDaprResources(
        daprResult.resources,
        service,
      ),
      rawJson: JSON.stringify(serviceItem, null, 2),
      errors: [...daprResult.errors, ...revisionsResult.errors],
    }
  } catch (error) {
    return {
      clusterName: EMPTY_VALUE,
      currentContext: EMPTY_VALUE,
      lastSyncedAt,
      service: null,
      uid: EMPTY_VALUE,
      resourceVersion: EMPTY_VALUE,
      generation: EMPTY_VALUE,
      observedGeneration: EMPTY_VALUE,
      labels: [],
      annotations: [],
      conditions: [],
      trafficTargets: [],
      revisions: [],
      containers: [],
      relatedDaprResources: [],
      rawJson: "",
      errors: [`Knative service read failed: ${getErrorMessage(error)}`],
    }
  }
}

export async function getServiceLogs(
  namespace: string,
  name: string,
): Promise<ServiceLogs> {
  const lastSyncedAt = new Date().toISOString()
  const limit = getPositiveInteger(
    process.env.LOKI_LOG_LIMIT,
    DEFAULT_LOG_LIMIT,
  )
  const windowMinutes = getPositiveInteger(
    process.env.LOKI_LOG_WINDOW_MINUTES,
    DEFAULT_LOG_WINDOW_MINUTES,
  )
  const lokiBaseUrl = process.env.LOKI_BASE_URL || process.env.LOKI_URL

  if (!lokiBaseUrl) {
    return {
      lastSyncedAt,
      query: buildLokiQuery({ namespace, name }),
      limit,
      windowMinutes,
      entries: [],
      errors: [
        "Loki is not configured. Set LOKI_BASE_URL or LOKI_URL for the console server.",
      ],
    }
  }

  try {
    const query = buildLokiQuery({ namespace, name })
    const response = await fetchLokiQueryRange({
      baseUrl: lokiBaseUrl,
      query,
      limit,
      windowMinutes,
    })

    return {
      lastSyncedAt,
      query,
      limit,
      windowMinutes,
      entries: response.entries,
      errors: response.errors,
    }
  } catch (error) {
    return {
      lastSyncedAt,
      query: buildLokiQuery({ namespace, name }),
      limit,
      windowMinutes,
      entries: [],
      errors: [`Loki log read failed: ${getErrorMessage(error)}`],
    }
  }
}
