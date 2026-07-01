import {
  type DaprResource,
  EMPTY_VALUE,
  type KnativeService,
  type KubernetesCustomObject,
  type ServiceCondition,
  type ServiceContainer,
  type ServiceNeonDatabase,
  type ServiceNeonProjectSummary,
  type ServicePostgresCluster,
  type ServiceRevision,
  type ServiceTrafficTarget,
} from "./types"
import {
  formatValue,
  getArrayItem,
  getCondition,
  getNumber,
  getRecord,
  getString,
  getStringArray,
  getStringRecord,
} from "./utils"

export function toKnativeService(item: KubernetesCustomObject): KnativeService {
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

export function toServiceConditions(conditions: unknown): ServiceCondition[] {
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

export function toTrafficTargets(traffic: unknown): ServiceTrafficTarget[] {
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

export function toServiceRevisions(
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

export function toServiceContainers(containers: unknown): ServiceContainer[] {
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

export function toServicePostgresCluster(
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

export function sortServicePostgresClusters(
  left: ServicePostgresCluster,
  right: ServicePostgresCluster,
) {
  if (left.linkedToService !== right.linkedToService) {
    return left.linkedToService ? -1 : 1
  }

  return right.age.localeCompare(left.age)
}

export function toServiceNeonDatabase(
  branch: KubernetesCustomObject,
  project: KubernetesCustomObject | undefined,
  serviceName: string,
): ServiceNeonDatabase {
  const metadata = branch.metadata ?? {}
  const labels = metadata.labels ?? {}
  const annotations = metadata.annotations ?? {}
  const spec = getRecord(branch.spec)
  const status = getRecord(branch.status)
  const projectSpec = getRecord(project?.spec)
  const timelineCondition = getCondition(status?.conditions, "TimelineCreated")
  const computeCondition = getCondition(status?.conditions, "ComputeReady")
  const availableCondition = getCondition(status?.conditions, "Available")
  const projectName = getString(spec?.projectID) || EMPTY_VALUE
  const branchName = metadata.name ?? EMPTY_VALUE
  const namespace = metadata.namespace ?? EMPTY_VALUE
  const computeHost =
    branchName !== EMPTY_VALUE && namespace !== EMPTY_VALUE
      ? `${branchName}-postgres.${namespace}.svc.cluster.local`
      : EMPTY_VALUE
  const computePort = "55433"
  const linkedToService = labels["app.kubernetes.io/part-of"] === serviceName
  const ready =
    availableCondition?.status === "True" || computeCondition?.status === "True"

  return {
    projectName,
    branchName,
    namespace,
    linkedToService,
    managedByConsole: labels["app.kubernetes.io/managed-by"] === "neki-console",
    projectCluster: getString(projectSpec?.cluster) || EMPTY_VALUE,
    bucketName: annotations["neki.dev/rustfs-bucket"] || EMPTY_VALUE,
    pgVersion: formatValue(spec?.pgVersion),
    timelineId: getString(status?.timelineID) || EMPTY_VALUE,
    computeHost,
    computePort,
    databaseUrl:
      computeHost !== EMPTY_VALUE
        ? `postgres://cloud_admin@${computeHost}:${computePort}/postgres?sslmode=disable`
        : EMPTY_VALUE,
    vaultComponent: annotations["neki.dev/dapr-vault-component"] || EMPTY_VALUE,
    vaultPath: annotations["neki.dev/dapr-vault-path"] || EMPTY_VALUE,
    ready,
    phase:
      availableCondition?.reason ||
      computeCondition?.reason ||
      timelineCondition?.reason ||
      availableCondition?.message ||
      computeCondition?.message ||
      timelineCondition?.message ||
      EMPTY_VALUE,
    age: metadata.creationTimestamp ?? "",
  }
}

export function toServiceNeonProjectSummary(
  project: KubernetesCustomObject,
  branches: ServiceNeonDatabase[],
  serviceName: string,
  bucketNameOverride = "",
): ServiceNeonProjectSummary {
  const metadata = project.metadata ?? {}
  const labels = metadata.labels ?? {}
  const annotations = metadata.annotations ?? {}
  const spec = getRecord(project.spec)
  const projectName = metadata.name ?? EMPTY_VALUE
  const projectBranches = branches
    .filter((branch) => branch.projectName === projectName)
    .sort(sortServiceNeonDatabases)
  const latestBranch = projectBranches[0]

  return {
    projectName,
    namespace: metadata.namespace ?? EMPTY_VALUE,
    linkedToService: labels["app.kubernetes.io/part-of"] === serviceName,
    managedByConsole: labels["app.kubernetes.io/managed-by"] === "neki-console",
    cluster: getString(spec?.cluster) || EMPTY_VALUE,
    bucketName:
      bucketNameOverride ||
      annotations["neki.dev/rustfs-bucket"] ||
      EMPTY_VALUE,
    branchCount: projectBranches.length,
    readyBranchCount: projectBranches.filter((branch) => branch.ready).length,
    latestBranchName: latestBranch?.branchName ?? EMPTY_VALUE,
    latestBranchPhase: latestBranch?.phase ?? EMPTY_VALUE,
    vaultComponent:
      latestBranch?.vaultComponent ||
      annotations["neki.dev/dapr-vault-component"] ||
      EMPTY_VALUE,
    vaultPath:
      latestBranch?.vaultPath ||
      annotations["neki.dev/dapr-vault-path"] ||
      EMPTY_VALUE,
    age: metadata.creationTimestamp ?? "",
  }
}

export function sortServiceNeonDatabases(
  left: ServiceNeonDatabase,
  right: ServiceNeonDatabase,
) {
  if (left.linkedToService !== right.linkedToService) {
    return left.linkedToService ? -1 : 1
  }

  return right.age.localeCompare(left.age)
}

export function sortServiceNeonProjectSummaries(
  left: ServiceNeonProjectSummary,
  right: ServiceNeonProjectSummary,
) {
  if (left.linkedToService !== right.linkedToService) {
    return left.linkedToService ? -1 : 1
  }

  return right.age.localeCompare(left.age)
}

export function toDaprResource(
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

export function getRelatedDaprResources(
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

export function formatTraffic(traffic: unknown) {
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
