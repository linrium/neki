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

export async function refreshDashboard() {
  revalidatePath("/")
}

export async function getClusterOverview(): Promise<ClusterOverview> {
  const lastSyncedAt = new Date().toISOString()

  try {
    const kubeConfig = new KubeConfig()
    kubeConfig.loadFromDefault()

    const customObjectsApi = kubeConfig.makeApiClient(CustomObjectsApi)
    const currentCluster = kubeConfig.getCurrentCluster()
    const currentContext = kubeConfig.getCurrentContext() || EMPTY_VALUE

    const [
      knativeResult,
      componentsResult,
      configurationsResult,
      subscriptionsResult,
    ] = await Promise.all([
      listCustomObjects(customObjectsApi, {
        group: "serving.knative.dev",
        version: "v1",
        plural: "services",
        label: "Knative services",
      }),
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
      clusterName: getClusterName(currentCluster),
      currentContext,
      lastSyncedAt,
      services: knativeResult.items.map(toKnativeService),
      daprResources: [
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
        ...knativeResult.errors,
        ...componentsResult.errors,
        ...configurationsResult.errors,
        ...subscriptionsResult.errors,
      ],
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
