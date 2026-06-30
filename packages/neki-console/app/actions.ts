"use server"

import {
  type Cluster,
  CustomObjectsApi,
  KubeConfig,
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

export async function refreshService(namespace: string, name: string) {
  revalidatePath(
    `/services/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
  )
  revalidatePath(
    `/services/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/logs`,
  )
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
    const [serviceItem, daprResult] = await Promise.all([
      getNamespacedKnativeService(customObjectsApi, namespace, name),
      listDaprResources(customObjectsApi),
    ])
    const service = toKnativeService(serviceItem)

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
      trafficTargets: toTrafficTargets(getRecord(serviceItem.status)?.traffic),
      containers: toServiceContainers(
        getRecord(getRecord(serviceItem.spec?.template)?.spec)?.containers,
      ),
      relatedDaprResources: getRelatedDaprResources(
        daprResult.resources,
        service,
      ),
      rawJson: JSON.stringify(serviceItem, null, 2),
      errors: daprResult.errors,
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

    return (
      resource.scopes.length === 0 ||
      resource.scopes.some((scope) => scopeKeys.has(scope))
    )
  })
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
