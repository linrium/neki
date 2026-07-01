import type { KubernetesObject } from "@kubernetes/client-node"

export type CustomObjectList = {
  items?: KubernetesCustomObject[]
}

export type KubernetesCustomObject = {
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

export type SecretObject = KubernetesObject & {
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

export type NeonDatabaseProvisionResult = {
  ok: boolean
  title: string
  message: string
  neonNamespace: string
  projectName: string
  branchName: string
  bucketName: string
  database: string
  username: string
  vaultComponent: string
  vaultSecretName: string
  vaultPath: string
  serviceReloadedAt: string
  steps: Array<{ label: string; detail: string }>
  error: string
}

export type NeonBranchMutationResult = {
  ok: boolean
  title: string
  message: string
  branchName: string
  projectName: string
  neonNamespace: string
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

export type ServiceNeonDatabase = {
  projectName: string
  branchName: string
  namespace: string
  linkedToService: boolean
  managedByConsole: boolean
  projectCluster: string
  bucketName: string
  pgVersion: string
  timelineId: string
  computeHost: string
  computePort: string
  databaseUrl: string
  vaultComponent: string
  vaultPath: string
  ready: boolean
  phase: string
  age: string
}

export type ServiceNeonProjectSummary = {
  projectName: string
  namespace: string
  linkedToService: boolean
  managedByConsole: boolean
  cluster: string
  bucketName: string
  branchCount: number
  readyBranchCount: number
  latestBranchName: string
  latestBranchPhase: string
  vaultComponent: string
  vaultPath: string
  age: string
}

export type ServiceNeonDatabases = {
  lastSyncedAt: string
  databases: ServiceNeonProjectSummary[]
  errors: string[]
}

export type ServiceNeonProjectBranches = {
  lastSyncedAt: string
  projectName: string
  namespace: string
  cluster: string
  bucketName: string
  linkedToService: boolean
  managedByConsole: boolean
  branches: ServiceNeonDatabase[]
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

export type DaprVaultConnection = {
  address: string
  enginePath: string
  prefix: string
  usePrefix: boolean
  token: string
}

export const EMPTY_VALUE = "n/a"
export const DEFAULT_LOG_LIMIT = 200
export const DEFAULT_LOG_WINDOW_MINUTES = 60
export const LOKI_NAMESPACE_TOKEN = "$" + "{namespace}"
export const LOKI_NAME_TOKEN = "$" + "{name}"
export const LOKI_REVISION_TOKEN = "$" + "{revision}"
export const LOKI_DAPR_APP_ID_TOKEN = "$" + "{daprAppId}"
