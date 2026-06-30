"use server"

import {
  type Cluster,
  CustomObjectsApi,
  KubeConfig,
  type KubernetesObject,
  KubernetesObjectApi,
  PatchStrategy,
} from "@kubernetes/client-node"
import { revalidatePath } from "next/cache"

type CustomObjectList = {
  items?: KubernetesCustomObject[]
}

type KubernetesCustomObject = {
  apiVersion?: string
  kind?: string
  metadata?: {
    annotations?: Record<string, string>
    creationTimestamp?: string
    generation?: number
    labels?: Record<string, string>
    name?: string
    namespace?: string
    resourceVersion?: string
    uid?: string
  }
  spec?: Record<string, unknown>
  status?: Record<string, unknown>
  scopes?: string[]
}

type SecretObject = KubernetesObject & {
  data?: Record<string, string>
  stringData?: Record<string, string>
  type?: string
}

export type KnativeService = {
  name: string
  namespace: string
  url: string
  ready: boolean
  reason: string
  revision: string
  minScale: string
  daprEnabled: boolean
  daprAppId: string
  daprConfig: string
  traffic: string
  age: string
}

export type ServiceCondition = {
  type: string
  status: string
  reason: string
  message: string
  lastTransitionTime: string
}

export type ServiceTrafficTarget = {
  label: string
  percent: string
  revision: string
  url: string
}

export type ServiceRevision = {
  name: string
  namespace: string
  ready: boolean
  status: string
  reason: string
  message: string
  trafficPercent: string
  trafficPercentValue: number
  trafficLabel: string
  url: string
  image: string
  imageDigest: string
  observedGeneration: string
  createdAt: string
}

export type ServiceContainer = {
  name: string
  image: string
  ports: string[]
  env: string[]
}

export type ServiceDetail = {
  clusterName: string
  currentContext: string
  lastSyncedAt: string
  service: KnativeService | null
  uid: string
  resourceVersion: string
  generation: string
  observedGeneration: string
  labels: Array<{ key: string; value: string }>
  annotations: Array<{ key: string; value: string }>
  conditions: ServiceCondition[]
  trafficTargets: ServiceTrafficTarget[]
  revisions: ServiceRevision[]
  containers: ServiceContainer[]
  relatedDaprResources: DaprResource[]
  rawJson: string
  errors: string[]
}

export type ServiceLogEntry = {
  timestamp: string
  time: string
  line: string
  stream: Record<string, string>
}

export type ServiceLogs = {
  lastSyncedAt: string
  query: string
  limit: number
  windowMinutes: number
  entries: ServiceLogEntry[]
  errors: string[]
}

export type DaprResource = {
  name: string
  namespace: string
  kind: "Component" | "Configuration" | "Subscription"
  detail: string
  target: string
  scopes: string[]
  age: string
}

export type ClusterOverview = {
  clusterName: string
  currentContext: string
  lastSyncedAt: string
  services: KnativeService[]
  daprResources: DaprResource[]
  errors: string[]
}

export type PlaygroundResult = {
  ok: boolean
  status: number
  statusText: string
  url: string
  method: string
  durationMs: number
  responseBody: string
  responseHeaders: Array<{ key: string; value: string }>
  error: string
}

export type PostgresProvisionResult = {
  ok: boolean
  title: string
  message: string
  clusterName: string
  database: string
  username: string
  vaultComponent: string
  vaultSecretName: string
  vaultPath: string
  cnpgSecretName: string
  serviceReloadedAt: string
  steps: Array<{ label: string; detail: string }>
  error: string
}

export type ServicePostgresCluster = {
  name: string
  namespace: string
  linkedToService: boolean
  managedByConsole: boolean
  phase: string
  ready: boolean
  instances: string
  readyInstances: string
  primary: string
  database: string
  owner: string
  storage: string
  image: string
  bootstrapSecret: string
  vaultComponent: string
  vaultPath: string
  age: string
}

export type ServicePostgresClusters = {
  lastSyncedAt: string
  clusters: ServicePostgresCluster[]
  errors: string[]
}

export type SecretReadResult = {
  ok: boolean
  title: string
  message: string
  namespace: string
  serviceName: string
  vaultComponent: string
  secretName: string
  vaultPath: string
  loadedAt: string
  entries: Array<{ key: string; value: string; size: number }>
  error: string
}

const EMPTY_VALUE = "n/a"
const DEFAULT_LOG_LIMIT = 200
const DEFAULT_LOG_WINDOW_MINUTES = 60
const LOKI_NAMESPACE_TOKEN = "$" + "{namespace}"
const LOKI_NAME_TOKEN = "$" + "{name}"
const LOKI_REVISION_TOKEN = "$" + "{revision}"
const LOKI_DAPR_APP_ID_TOKEN = "$" + "{daprAppId}"

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

function getClusterClient() {
  const kubeConfig = new KubeConfig()
  kubeConfig.loadFromDefault()

  return {
    customObjectsApi: kubeConfig.makeApiClient(CustomObjectsApi),
    objectApi: KubernetesObjectApi.makeApiClient(kubeConfig),
    currentCluster: kubeConfig.getCurrentCluster(),
    currentContext: kubeConfig.getCurrentContext() || EMPTY_VALUE,
  }
}

async function getNamespacedKnativeService(
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

async function listKnativeRevisions(
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

async function listDaprResources(
  customObjectsApi: CustomObjectsApi,
): Promise<{ resources: DaprResource[]; errors: string[] }> {
  const [componentsResult, configurationsResult, subscriptionsResult] =
    await Promise.all([
      listCustomObjects(customObjectsApi, {
        group: "dapr.io",
        version: "v1alpha1",
        plural: "components",
        label: "Dapr components",
      }),
      listCustomObjects(customObjectsApi, {
        group: "dapr.io",
        version: "v1alpha1",
        plural: "configurations",
        label: "Dapr configurations",
      }),
      listCustomObjects(customObjectsApi, {
        group: "dapr.io",
        version: "v2alpha1",
        plural: "subscriptions",
        label: "Dapr subscriptions",
      }),
    ])

  return {
    resources: [
      ...componentsResult.items.map((item) =>
        toDaprResource(item, "Component"),
      ),
      ...configurationsResult.items.map((item) =>
        toDaprResource(item, "Configuration"),
      ),
      ...subscriptionsResult.items.map((item) =>
        toDaprResource(item, "Subscription"),
      ),
    ],
    errors: [
      ...componentsResult.errors,
      ...configurationsResult.errors,
      ...subscriptionsResult.errors,
    ],
  }
}

async function listCustomObjects(
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

function toKnativeService(item: KubernetesCustomObject): KnativeService {
  const template = getRecord(item.spec?.template)
  const templateMetadata = getRecord(template?.metadata)
  const templateAnnotations = getStringRecord(templateMetadata?.annotations)
  const status = getRecord(item.status)
  const readyCondition = getCondition(status?.conditions, "Ready")

  return {
    name: item.metadata?.name ?? EMPTY_VALUE,
    namespace: item.metadata?.namespace ?? EMPTY_VALUE,
    url: getString(status?.url) || EMPTY_VALUE,
    ready: readyCondition?.status === "True",
    reason: readyCondition?.reason || readyCondition?.message || "Ready",
    revision: getString(status?.latestReadyRevisionName) || EMPTY_VALUE,
    minScale: templateAnnotations["autoscaling.knative.dev/min-scale"] ?? "0",
    daprEnabled: templateAnnotations["dapr.io/enabled"] === "true",
    daprAppId: templateAnnotations["dapr.io/app-id"] ?? EMPTY_VALUE,
    daprConfig: templateAnnotations["dapr.io/config"] ?? EMPTY_VALUE,
    traffic: formatTraffic(status?.traffic),
    age: item.metadata?.creationTimestamp ?? "",
  }
}

function toServiceConditions(conditions: unknown): ServiceCondition[] {
  if (!Array.isArray(conditions)) {
    return []
  }

  return conditions.map((condition) => {
    const record = getRecord(condition)

    return {
      type: getString(record?.type) || EMPTY_VALUE,
      status: getString(record?.status) || EMPTY_VALUE,
      reason: getString(record?.reason) || EMPTY_VALUE,
      message: getString(record?.message) || EMPTY_VALUE,
      lastTransitionTime: getString(record?.lastTransitionTime) || "",
    }
  })
}

function toTrafficTargets(traffic: unknown): ServiceTrafficTarget[] {
  if (!Array.isArray(traffic)) {
    return []
  }

  return traffic.map((target) => {
    const record = getRecord(target)
    const tag = getString(record?.tag)
    const latest = record?.latestRevision === true

    return {
      label: tag || (latest ? "latest" : "pinned"),
      percent: formatValue(record?.percent),
      revision:
        getString(record?.revisionName) ||
        (latest ? "Latest revision" : EMPTY_VALUE),
      url: getString(record?.url) || EMPTY_VALUE,
    }
  })
}

function toServiceRevisions(
  revisions: KubernetesCustomObject[],
  traffic: unknown,
  latestReadyRevisionName: string,
): ServiceRevision[] {
  const trafficByRevision = toRevisionTraffic(traffic, latestReadyRevisionName)

  return revisions
    .map((revision) => {
      const status = getRecord(revision.status)
      const spec = getRecord(revision.spec)
      const readyCondition = getCondition(status?.conditions, "Ready")
      const container = getRecord(getArrayItem(spec?.containers, 0))
      const containerStatus = getRecord(
        getArrayItem(status?.containerStatuses, 0),
      )
      const trafficTarget = trafficByRevision.get(revision.metadata?.name ?? "")

      return {
        name: revision.metadata?.name ?? EMPTY_VALUE,
        namespace: revision.metadata?.namespace ?? EMPTY_VALUE,
        ready: readyCondition?.status === "True",
        status: readyCondition?.status || EMPTY_VALUE,
        reason: readyCondition?.reason || EMPTY_VALUE,
        message: readyCondition?.message || EMPTY_VALUE,
        trafficPercent: trafficTarget?.percent ?? EMPTY_VALUE,
        trafficPercentValue: trafficTarget?.percentValue ?? 0,
        trafficLabel: trafficTarget?.label ?? "No routed traffic",
        url: trafficTarget?.url ?? EMPTY_VALUE,
        image: getString(container?.image) || EMPTY_VALUE,
        imageDigest: getString(containerStatus?.imageDigest) || EMPTY_VALUE,
        observedGeneration: formatValue(status?.observedGeneration),
        createdAt: revision.metadata?.creationTimestamp ?? "",
      }
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

function toRevisionTraffic(
  traffic: unknown,
  latestReadyRevisionName: string,
): Map<
  string,
  {
    percent: string
    percentValue: number
    label: string
    url: string
  }
> {
  const trafficByRevision = new Map<
    string,
    {
      percentLabels: string[]
      percentValue: number
      labels: string[]
      urls: string[]
      latest: boolean
    }
  >()

  if (!Array.isArray(traffic)) {
    return new Map()
  }

  for (const target of traffic) {
    const record = getRecord(target)
    const latest = record?.latestRevision === true
    const revisionName =
      getString(record?.revisionName) || (latest ? latestReadyRevisionName : "")

    if (!revisionName || revisionName === EMPTY_VALUE) {
      continue
    }

    const percent = getNumber(record?.percent)
    const tag = getString(record?.tag)
    const url = getString(record?.url)
    const existing = trafficByRevision.get(revisionName) ?? {
      percentLabels: [],
      percentValue: 0,
      labels: [],
      urls: [],
      latest: false,
    }

    if (percent !== undefined) {
      existing.percentLabels.push(`${percent}%`)
      existing.percentValue += percent
    }
    if (tag) {
      existing.labels.push(tag)
    }
    if (url) {
      existing.urls.push(url)
    }
    existing.latest = existing.latest || latest
    trafficByRevision.set(revisionName, existing)
  }

  return new Map(
    [...trafficByRevision.entries()].map(([revision, value]) => [
      revision,
      {
        percent:
          value.percentLabels.length > 0
            ? value.percentLabels.join(" + ")
            : EMPTY_VALUE,
        percentValue: Math.min(value.percentValue, 100),
        label:
          value.labels.length > 0
            ? value.labels.join(", ")
            : value.latest
              ? "latest route"
              : "default route",
        url: value.urls[0] ?? EMPTY_VALUE,
      },
    ]),
  )
}

function toServiceContainers(containers: unknown): ServiceContainer[] {
  if (!Array.isArray(containers)) {
    return []
  }

  return containers.map((container) => {
    const record = getRecord(container)

    return {
      name: getString(record?.name) || EMPTY_VALUE,
      image: getString(record?.image) || EMPTY_VALUE,
      ports: toContainerPorts(record?.ports),
      env: toContainerEnv(record?.env),
    }
  })
}

function toServicePostgresCluster(
  item: KubernetesCustomObject,
  serviceName: string,
): ServicePostgresCluster {
  const metadata = item.metadata ?? {}
  const labels = metadata.labels ?? {}
  const annotations = metadata.annotations ?? {}
  const spec = getRecord(item.spec)
  const status = getRecord(item.status)
  const bootstrap = getRecord(spec?.bootstrap)
  const initdb = getRecord(bootstrap?.initdb)
  const secret = getRecord(initdb?.secret)
  const readyCondition = getCondition(status?.conditions, "Ready")
  const linkedToService = labels["app.kubernetes.io/part-of"] === serviceName

  return {
    name: metadata.name ?? EMPTY_VALUE,
    namespace: metadata.namespace ?? EMPTY_VALUE,
    linkedToService,
    managedByConsole: labels["app.kubernetes.io/managed-by"] === "neki-console",
    phase:
      getString(status?.phase) ||
      readyCondition?.reason ||
      readyCondition?.message ||
      EMPTY_VALUE,
    ready: readyCondition?.status === "True",
    instances: formatValue(spec?.instances),
    readyInstances: formatValue(status?.readyInstances),
    primary: getString(status?.currentPrimary) || EMPTY_VALUE,
    database: getString(initdb?.database) || EMPTY_VALUE,
    owner: getString(initdb?.owner) || EMPTY_VALUE,
    storage: getString(getRecord(spec?.storage)?.size) || EMPTY_VALUE,
    image: getString(spec?.imageName) || EMPTY_VALUE,
    bootstrapSecret: getString(secret?.name) || EMPTY_VALUE,
    vaultComponent: annotations["neki.dev/dapr-vault-component"] || EMPTY_VALUE,
    vaultPath: annotations["neki.dev/dapr-vault-path"] || EMPTY_VALUE,
    age: metadata.creationTimestamp ?? "",
  }
}

function sortServicePostgresClusters(
  left: ServicePostgresCluster,
  right: ServicePostgresCluster,
) {
  if (left.linkedToService !== right.linkedToService) {
    return left.linkedToService ? -1 : 1
  }

  return right.age.localeCompare(left.age)
}

function toContainerPorts(ports: unknown): string[] {
  if (!Array.isArray(ports)) {
    return []
  }

  return ports
    .map((port) => {
      const record = getRecord(port)
      const containerPort = formatValue(record?.containerPort)
      const protocol = getString(record?.protocol)

      return [containerPort, protocol].filter(Boolean).join("/")
    })
    .filter(Boolean)
}

function toContainerEnv(env: unknown): string[] {
  if (!Array.isArray(env)) {
    return []
  }

  return env
    .map((entry) => {
      const record = getRecord(entry)
      return getString(record?.name)
    })
    .filter((name): name is string => Boolean(name))
}

function toDaprResource(
  item: KubernetesCustomObject,
  kind: DaprResource["kind"],
): DaprResource {
  const spec = getRecord(item.spec)

  return {
    name: item.metadata?.name ?? EMPTY_VALUE,
    namespace: item.metadata?.namespace ?? EMPTY_VALUE,
    kind,
    detail: getDaprDetail(kind, spec),
    target: getDaprTarget(kind, spec),
    scopes: item.scopes ?? getStringArray(spec?.scopes),
    age: item.metadata?.creationTimestamp ?? "",
  }
}

function getDaprDetail(
  kind: DaprResource["kind"],
  spec: Record<string, unknown> | undefined,
) {
  if (kind === "Component") {
    return getString(spec?.type) || EMPTY_VALUE
  }

  if (kind === "Subscription") {
    return getString(spec?.topic) || EMPTY_VALUE
  }

  const tracing = getRecord(spec?.tracing)
  const metric = getRecord(spec?.metric)
  const protocol = getString(getRecord(tracing?.otel)?.protocol)
  const metricState = metric?.enabled === true ? "metrics on" : "metrics off"

  return [protocol, metricState].filter(Boolean).join(" / ") || EMPTY_VALUE
}

function getDaprTarget(
  kind: DaprResource["kind"],
  spec: Record<string, unknown> | undefined,
) {
  if (kind === "Component") {
    return getString(spec?.version) || EMPTY_VALUE
  }

  if (kind === "Subscription") {
    return getString(spec?.pubsubname) || EMPTY_VALUE
  }

  return (
    getString(getRecord(getRecord(spec?.tracing)?.otel)?.endpointAddress) ||
    EMPTY_VALUE
  )
}

function getRelatedDaprResources(
  resources: DaprResource[],
  service: KnativeService,
) {
  const scopeKeys = new Set(
    [service.name, service.daprAppId].filter(
      (value) => value && value !== EMPTY_VALUE,
    ),
  )

  return resources.filter((resource) => {
    if (resource.namespace !== service.namespace) {
      return false
    }

    if (resource.kind === "Configuration") {
      return (
        service.daprConfig !== EMPTY_VALUE &&
        resource.name === service.daprConfig
      )
    }

    return (
      resource.scopes.length === 0 ||
      resource.scopes.some((scope) => scopeKeys.has(scope))
    )
  })
}

type DaprVaultConnection = {
  address: string
  enginePath: string
  prefix: string
  usePrefix: boolean
  token: string
}

async function ensurePostgresClusterIsNew(
  customObjectsApi: CustomObjectsApi,
  namespace: string,
  clusterName: string,
) {
  try {
    await customObjectsApi.getNamespacedCustomObject({
      group: "postgresql.cnpg.io",
      version: "v1",
      namespace,
      plural: "clusters",
      name: clusterName,
    })
  } catch (error) {
    if (getErrorStatus(error) === 404) {
      return
    }
    throw error
  }

  throw new Error(
    `Postgres cluster ${namespace}/${clusterName} already exists.`,
  )
}

async function resolveDaprVault({
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

async function writeVaultKvSecret(
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

async function readVaultSecret(
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

function buildVaultKvPath(vault: DaprVaultConnection, secretName: string) {
  return `${vault.enginePath}/data/${getVaultDataPath(vault, secretName)}`
}

function getVaultDataPath(vault: DaprVaultConnection, secretName: string) {
  return [vault.usePrefix ? vault.prefix : "", secretName]
    .filter(Boolean)
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .join("/")
}

function buildPostgresSecret({
  namespace,
  name,
  username,
  password,
  clusterName,
  serviceName,
}: {
  namespace: string
  name: string
  username: string
  password: string
  clusterName: string
  serviceName: string
}): SecretObject {
  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name,
      namespace,
      labels: {
        "app.kubernetes.io/managed-by": "neki-console",
        "app.kubernetes.io/part-of": serviceName,
        "cnpg.io/cluster": clusterName,
      },
    },
    type: "kubernetes.io/basic-auth",
    stringData: {
      username,
      password,
    },
  }
}

function buildPostgresCluster({
  namespace,
  clusterName,
  database,
  username,
  secretName,
  instances,
  storageSize,
  postgresVersion,
  serviceName,
  vaultComponent,
  vaultPath,
}: {
  namespace: string
  clusterName: string
  database: string
  username: string
  secretName: string
  instances: number
  storageSize: string
  postgresVersion: string
  serviceName: string
  vaultComponent: string
  vaultPath: string
}): KubernetesCustomObject {
  return {
    apiVersion: "postgresql.cnpg.io/v1",
    kind: "Cluster",
    metadata: {
      name: clusterName,
      namespace,
      annotations: {
        "neki.dev/dapr-vault-component": vaultComponent,
        "neki.dev/dapr-vault-path": vaultPath,
      },
      labels: {
        "app.kubernetes.io/managed-by": "neki-console",
        "app.kubernetes.io/part-of": serviceName,
      },
    },
    spec: {
      instances,
      imageName: `ghcr.io/cloudnative-pg/postgresql:${postgresVersion}`,
      storage: {
        size: storageSize,
      },
      monitoring: {
        enablePodMonitor: true,
      },
      bootstrap: {
        initdb: {
          database,
          owner: username,
          secret: {
            name: secretName,
          },
        },
      },
      postgresql: {
        parameters: {
          max_connections: "200",
          shared_buffers: "256MB",
        },
      },
      resources: {
        requests: {
          cpu: "250m",
          memory: "512Mi",
        },
        limits: {
          cpu: "1",
          memory: "1Gi",
        },
      },
    },
  }
}

async function createCustomObject(
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

async function createOrPatchObject(
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

async function reloadKnativeService(
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

async function waitForKnativeServiceReady(
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

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function decodeSecretValue(secret: SecretObject, key: string) {
  const encoded = secret.data?.[key]
  if (!encoded) {
    throw new Error(
      `Kubernetes secret ${secret.metadata?.name} is missing ${key}.`,
    )
  }

  return Buffer.from(encoded, "base64").toString("utf8")
}

function generatePassword() {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789_-+=."
  const bytes = crypto.getRandomValues(new Uint8Array(32))

  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")
}

function validateKubernetesName(value: string, label: string) {
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value) || value.length > 63) {
    throw new Error(
      `${label} must be a DNS label: lowercase letters, numbers, hyphens, and at most 63 characters.`,
    )
  }
}

function validateVaultSecretName(value: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,126}[a-zA-Z0-9]$/.test(value)) {
    throw new Error(
      "Vault secret name must use letters, numbers, dots, underscores, hyphens, or slashes.",
    )
  }
}

function validateIdentifier(value: string, label: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(value)) {
    throw new Error(
      `${label} must start with a letter or underscore and only contain letters, numbers, or underscores.`,
    )
  }
}

function validateStorageSize(value: string) {
  if (!/^[1-9][0-9]*(Mi|Gi|Ti)$/.test(value)) {
    throw new Error("Storage size must look like 512Mi, 8Gi, or 1Ti.")
  }
}

async function fetchLokiQueryRange({
  baseUrl,
  query,
  limit,
  windowMinutes,
}: {
  baseUrl: string
  query: string
  limit: number
  windowMinutes: number
}): Promise<{ entries: ServiceLogEntry[]; errors: string[] }> {
  const now = Date.now()
  const url = new URL("/loki/api/v1/query_range", normalizeBaseUrl(baseUrl))
  url.searchParams.set("query", query)
  url.searchParams.set("direction", "BACKWARD")
  url.searchParams.set("limit", String(limit))
  url.searchParams.set("start", toLokiTimestamp(now - windowMinutes * 60_000))
  url.searchParams.set("end", toLokiTimestamp(now))

  const headers: HeadersInit = {}
  if (process.env.LOKI_TENANT_ID) {
    headers["X-Scope-OrgID"] = process.env.LOKI_TENANT_ID
  }

  const response = await fetch(url, {
    headers,
    cache: "no-store",
  })

  if (!response.ok) {
    return {
      entries: [],
      errors: [`Loki returned ${response.status}: ${response.statusText}`],
    }
  }

  const payload = (await response.json()) as LokiQueryRangeResponse
  if (payload.status !== "success") {
    return {
      entries: [],
      errors: [payload.error || "Loki query did not complete successfully."],
    }
  }

  return {
    entries: toLogEntries(payload).slice(0, limit),
    errors: [],
  }
}

type LokiQueryRangeResponse = {
  status?: string
  error?: string
  data?: {
    result?: Array<{
      stream?: Record<string, string>
      values?: Array<[string, string]>
    }>
  }
}

function toLogEntries(payload: LokiQueryRangeResponse): ServiceLogEntry[] {
  return (payload.data?.result ?? [])
    .flatMap((streamResult) =>
      (streamResult.values ?? []).map(([timestamp, line]) => ({
        timestamp,
        time: formatLogTimestamp(timestamp),
        line,
        stream: streamResult.stream ?? {},
      })),
    )
    .sort((left, right) => Number(right.timestamp) - Number(left.timestamp))
}

function buildLokiQuery({
  namespace,
  name,
  revision = "",
  daprAppId = "",
}: {
  namespace: string
  name: string
  revision?: string
  daprAppId?: string
}) {
  const template = process.env.LOKI_QUERY_TEMPLATE

  if (template) {
    return template
      .replaceAll(LOKI_NAMESPACE_TOKEN, escapeLogQLString(namespace))
      .replaceAll(LOKI_NAME_TOKEN, escapeLogQLString(name))
      .replaceAll(LOKI_REVISION_TOKEN, escapeLogQLString(revision))
      .replaceAll(LOKI_DAPR_APP_ID_TOKEN, escapeLogQLString(daprAppId))
  }

  return `{namespace="${escapeLogQLString(namespace)}", pod=~"${escapeLogQLRegexp(name)}.*"}`
}

function normalizeBaseUrl(value: string) {
  return value.endsWith("/") ? value : `${value}/`
}

function buildKongFunctionUrl(
  baseUrl: string,
  functionName: string,
  path: string,
) {
  const url = new URL(
    `/api/functions/${encodeURIComponent(functionName)}`,
    normalizeBaseUrl(baseUrl),
  )
  const normalizedPath = path.trim()

  if (normalizedPath) {
    url.pathname += normalizedPath.startsWith("/")
      ? normalizedPath
      : `/${normalizedPath}`
  }

  return url.toString()
}

function toLokiTimestamp(value: number) {
  return String(value * 1_000_000)
}

function formatLogTimestamp(timestamp: string) {
  const milliseconds = Math.floor(Number(timestamp) / 1_000_000)

  if (!Number.isFinite(milliseconds)) {
    return EMPTY_VALUE
  }

  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(milliseconds))
}

function escapeLogQLString(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')
}

function escapeLogQLRegexp(value: string) {
  return escapeLogQLString(value).replace(/[|\\{}()[\]^$+*?.]/g, "\\$&")
}

function formatTraffic(traffic: unknown) {
  if (!Array.isArray(traffic) || traffic.length === 0) {
    return EMPTY_VALUE
  }

  return traffic
    .map((target) => {
      const trafficTarget = getRecord(target)
      const percent = getNumber(trafficTarget?.percent)
      const revision = getString(trafficTarget?.revisionName)
      const latest = trafficTarget?.latestRevision === true ? "latest" : ""

      return [
        percent === undefined ? undefined : `${percent}%`,
        revision || latest,
      ]
        .filter(Boolean)
        .join(" ")
    })
    .filter(Boolean)
    .join(", ")
}

function getClusterName(cluster: Cluster | null) {
  if (!cluster) {
    return EMPTY_VALUE
  }

  return cluster.name || cluster.server || EMPTY_VALUE
}

function getCondition(conditions: unknown, type: string) {
  if (!Array.isArray(conditions)) {
    return undefined
  }

  return conditions
    .map(getRecord)
    .find((condition) => getString(condition?.type) === type) as
    | { status?: string; reason?: string; message?: string }
    | undefined
}

function getString(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function getNumber(value: unknown) {
  return typeof value === "number" ? value : undefined
}

function getStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function getArrayItem(value: unknown, index: number) {
  return Array.isArray(value) ? value[index] : undefined
}

function toKeyValues(value: unknown) {
  const record = getStringRecord(value)

  return Object.entries(record)
    .map(([key, recordValue]) => ({ key, value: recordValue }))
    .sort((left, right) => left.key.localeCompare(right.key))
}

function formatValue(value: unknown) {
  if (typeof value === "string") {
    return value || EMPTY_VALUE
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }

  return EMPTY_VALUE
}

function getPositiveInteger(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback
  }

  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === "string" ? value.trim() : ""
}

function formatResponseBody(value: string) {
  if (!value) {
    return ""
  }

  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function getStringRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }

  return value as Record<string, string>
}

function getRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }

  return value as Record<string, unknown>
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function getErrorStatus(error: unknown) {
  const record = getRecord(error)
  const response = getRecord(record?.response)
  const status =
    record?.statusCode ??
    record?.status ??
    record?.code ??
    response?.statusCode ??
    response?.status

  if (typeof status === "number") {
    return status
  }

  const message = getErrorMessage(error)
  const httpCodeMatch = /HTTP-Code:\s*(\d{3})/.exec(message)
  if (httpCodeMatch?.[1]) {
    return Number(httpCodeMatch[1])
  }

  const bodyCodeMatch = /"code"\s*:\s*(\d{3})/.exec(message)
  if (bodyCodeMatch?.[1]) {
    return Number(bodyCodeMatch[1])
  }

  return undefined
}
