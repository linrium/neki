"use client"

import {
  IconBolt,
  IconBox,
  IconCloud,
  IconDatabase,
  IconGitBranch,
  IconRoute,
} from "@tabler/icons-react"
import {
  Background,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  MiniMap,
  type Node,
  type NodeProps,
  type NodeTypes,
  Position,
  ReactFlow,
} from "@xyflow/react"
import { useMemo } from "react"
import { cn } from "@/lib/utils"

type FlowService = {
  name: string
  namespace: string
  url: string
  ready: boolean
  reason: string
  revision: string
  daprEnabled: boolean
  daprAppId: string
  daprConfig: string
  traffic: string
}

type FlowRevision = {
  name: string
  ready: boolean
  status: string
  trafficPercent: string
  trafficPercentValue: number
  trafficLabel: string
  image: string
}

type FlowContainer = {
  name: string
  image: string
  ports: string[]
  env: string[]
}

type FlowDaprResource = {
  name: string
  kind: "Component" | "Configuration" | "Subscription"
  detail: string
  target: string
}

type FlowPostgresCluster = {
  name: string
  linkedToService: boolean
  ready: boolean
  phase: string
  instances: string
  readyInstances: string
  primary: string
  database: string
  owner: string
  storage: string
}

type FlowTrafficTarget = {
  label: string
  percent: string
  revision: string
  url: string
}

type ServiceComponentFlowProps = {
  service: FlowService
  revisions: FlowRevision[]
  containers: FlowContainer[]
  daprResources: FlowDaprResource[]
  postgresClusters: FlowPostgresCluster[]
  trafficTargets: FlowTrafficTarget[]
}

type ComponentNodeData = {
  eyebrow: string
  title: string
  description: string
  status?: string
  tone: "blue" | "emerald" | "amber" | "violet" | "zinc"
  icon: "route" | "service" | "revision" | "container" | "dapr" | "database"
  metrics: Array<{ label: string; value: string }>
}

type ComponentNode = Node<ComponentNodeData, "component">

const PRIMARY_ROW_Y = 150
const NODE_VERTICAL_GAP = 210

const nodeTypes = {
  component: ComponentNodeCard,
} satisfies NodeTypes

export function ServiceComponentFlow({
  service,
  revisions,
  containers,
  daprResources,
  postgresClusters,
  trafficTargets,
}: ServiceComponentFlowProps) {
  const { nodes, edges } = useMemo(
    () =>
      buildGraph({
        service,
        revisions,
        containers,
        daprResources,
        postgresClusters,
        trafficTargets,
      }),
    [
      service,
      revisions,
      containers,
      daprResources,
      postgresClusters,
      trafficTargets,
    ],
  )

  return (
    <section className="relative left-1/2 w-screen -translate-x-1/2 px-4 sm:px-6 lg:px-8">
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <div className="h-[560px] w-full bg-zinc-50">
          <ReactFlow
            colorMode="light"
            defaultViewport={{ x: 80, y: 70, zoom: 0.82 }}
            edges={edges}
            fitView
            fitViewOptions={{ padding: 0.24 }}
            maxZoom={1.4}
            minZoom={0.45}
            nodes={nodes}
            nodeTypes={nodeTypes}
            nodesConnectable={false}
            nodesDraggable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#d4d4d8" gap={24} size={1} />
            <MiniMap
              className="hidden overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm md:block"
              maskColor="rgba(244, 244, 245, 0.65)"
              nodeColor={(node) => getMiniMapColor(node as ComponentNode)}
              pannable
              zoomable
            />
            <Controls
              className="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm"
              showInteractive={false}
            />
          </ReactFlow>
        </div>
      </div>
    </section>
  )
}

function buildGraph({
  service,
  revisions,
  containers,
  daprResources,
  postgresClusters,
  trafficTargets,
}: ServiceComponentFlowProps): { nodes: ComponentNode[]; edges: Edge[] } {
  const routedRevisions = revisions.filter(hasRoutedTraffic)
  const visibleContainers = containers.slice(0, 4)
  const visibleDaprResources = daprResources.slice(0, 4)
  const servicePostgresClusters = postgresClusters.filter(
    (cluster) => cluster.linkedToService,
  )
  const visiblePostgresClusters = servicePostgresClusters.slice(0, 3)
  const revisionStartY =
    routedRevisions.length > 0
      ? Math.max(35, PRIMARY_ROW_Y - (routedRevisions.length - 1) * 85)
      : PRIMARY_ROW_Y
  const routedRevisionBottomY =
    routedRevisions.length > 0
      ? revisionStartY + (routedRevisions.length - 1) * 170 + 180
      : 350
  const postgresStartY = revisionStartY - NODE_VERTICAL_GAP
  const daprResourceStartY = Math.max(430, routedRevisionBottomY + 50)
  const nodes: ComponentNode[] = [
    createNode({
      id: "route",
      position: { x: 0, y: 170 },
      data: {
        eyebrow: "Ingress",
        title: service.url === "n/a" ? "No public URL" : "Public route",
        description:
          service.url === "n/a" ? "Route has not reported a URL." : service.url,
        status: service.ready ? "Ready" : service.reason,
        tone: service.ready ? "emerald" : "amber",
        icon: "route",
        metrics: [
          {
            label: "Targets",
            value: trafficTargets.length
              ? String(trafficTargets.length)
              : "default",
          },
        ],
      },
    }),
    createNode({
      id: "service",
      position: { x: 390, y: PRIMARY_ROW_Y },
      data: {
        eyebrow: service.namespace,
        title: service.name,
        description: "Knative Service routes traffic to routed revisions.",
        status: service.ready ? "Ready" : service.reason,
        tone: service.ready ? "blue" : "amber",
        icon: "service",
        metrics: [
          { label: "Latest", value: service.revision },
          { label: "Dapr app", value: service.daprAppId },
        ],
      },
    }),
  ]
  const edges: Edge[] = [
    createEdge("route", "service", "edge-route-service", {
      animated: service.ready,
      label: service.traffic,
    }),
  ]

  if (routedRevisions.length > 0) {
    routedRevisions.forEach((revision, index) => {
      const revisionId = `revision-${revision.name}`
      nodes.push(
        createNode({
          id: revisionId,
          position: { x: 790, y: revisionStartY + index * 170 },
          data: {
            eyebrow: "Revision",
            title: revision.name,
            description: revision.image,
            status: revision.ready ? "Ready" : revision.status,
            tone: revision.ready ? "emerald" : "amber",
            icon: "revision",
            metrics: [
              { label: "Traffic", value: revision.trafficPercent },
              { label: "Route", value: revision.trafficLabel },
            ],
          },
        }),
      )
      edges.push(
        createEdge("service", revisionId, `edge-service-${revision.name}`, {
          animated: revision.trafficPercentValue > 0,
          label:
            revision.trafficPercent !== "n/a" ? revision.trafficPercent : "",
        }),
      )
    })
  } else {
    nodes.push(
      createNode({
        id: "no-routed-revisions",
        position: { x: 790, y: PRIMARY_ROW_Y },
        data: {
          eyebrow: "Revisions",
          title: "No routed revisions",
          description: "No revisions are currently receiving traffic.",
          status: "Unavailable",
          tone: "zinc",
          icon: "revision",
          metrics: [],
        },
      }),
    )
    edges.push(
      createEdge("service", "no-routed-revisions", "edge-service-empty"),
    )
  }

  visibleContainers.forEach((container, index) => {
    const containerId = `container-${container.name}`
    nodes.push(
      createNode({
        id: containerId,
        position: { x: 1210, y: PRIMARY_ROW_Y + index * 150 },
        data: {
          eyebrow: "Container",
          title: container.name,
          description: container.image,
          tone: "zinc",
          icon: "container",
          metrics: [
            {
              label: "Ports",
              value: container.ports.length
                ? container.ports.join(", ")
                : "none",
            },
            { label: "Env", value: String(container.env.length) },
          ],
        },
      }),
    )
    const sourceRevision =
      routedRevisions[index]?.name ?? routedRevisions[0]?.name
    edges.push(
      createEdge(
        sourceRevision ? `revision-${sourceRevision}` : "service",
        containerId,
        `edge-container-${container.name}`,
      ),
    )
  })

  if (containers.length > visibleContainers.length) {
    nodes.push(
      createNode({
        id: "container-overflow",
        position: {
          x: 1210,
          y: PRIMARY_ROW_Y + visibleContainers.length * 140,
        },
        data: {
          eyebrow: "Container",
          title: `+${containers.length - visibleContainers.length} more`,
          description: "Additional containers are listed below.",
          tone: "zinc",
          icon: "container",
          metrics: [],
        },
      }),
    )
    edges.push(
      createEdge("service", "container-overflow", "edge-container-overflow"),
    )
  }

  if (service.daprEnabled || visibleDaprResources.length > 0) {
    nodes.push(
      createNode({
        id: "dapr-sidecar",
        position: { x: 390, y: 380 },
        data: {
          eyebrow: "Dapr sidecar",
          title: service.daprEnabled ? service.daprAppId : "Not enabled",
          description: service.daprEnabled
            ? "Sidecar is enabled through service annotations."
            : "Scoped Dapr resources exist, but the sidecar is disabled.",
          status: service.daprEnabled ? "Enabled" : "Disabled",
          tone: service.daprEnabled ? "violet" : "zinc",
          icon: "dapr",
          metrics: [
            { label: "Resources", value: String(daprResources.length) },
            { label: "Config", value: service.daprConfig },
          ],
        },
      }),
    )
    edges.push(
      createEdge("service", "dapr-sidecar", "edge-service-dapr", {
        animated: service.daprEnabled,
      }),
    )
  }

  visiblePostgresClusters.forEach((cluster, index) => {
    const clusterId = `postgres-${cluster.name}`
    nodes.push(
      createNode({
        id: clusterId,
        position: {
          x: 725,
          y: postgresStartY * 2,
        },
        data: {
          eyebrow: "Postgres",
          title: cluster.name,
          description:
            cluster.primary !== "n/a"
              ? `Primary ${cluster.primary}`
              : "CloudNativePG cluster",
          status: cluster.ready ? "Ready" : cluster.phase,
          tone: cluster.ready ? "emerald" : "amber",
          icon: "database",
          metrics: [
            { label: "Database", value: cluster.database },
            {
              label: "Instances",
              value: `${cluster.readyInstances}/${cluster.instances}`,
            },
            { label: "Storage", value: cluster.storage },
          ],
        },
      }),
    )
    edges.push(
      createEdge("service", clusterId, `edge-postgres-${cluster.name}`, {
        animated: cluster.ready,
      }),
    )
  })

  if (servicePostgresClusters.length > visiblePostgresClusters.length) {
    nodes.push(
      createNode({
        id: "postgres-overflow",
        position: {
          x: 790,
          y: postgresStartY - visiblePostgresClusters.length * 155,
        },
        data: {
          eyebrow: "Postgres",
          title: `+${servicePostgresClusters.length - visiblePostgresClusters.length} more`,
          description:
            "Additional linked Postgres clusters are listed on the Postgres tab.",
          tone: "zinc",
          icon: "database",
          metrics: [],
        },
      }),
    )
    edges.push(createEdge("service", "postgres-overflow", "edge-postgres-more"))
  }

  visibleDaprResources.forEach((resource, index) => {
    const resourceId = `dapr-${resource.kind}-${resource.name}`
    nodes.push(
      createNode({
        id: resourceId,
        position: {
          x: 790,
          y: daprResourceStartY + index * 155,
        },
        data: {
          eyebrow: resource.kind,
          title: resource.name,
          description: resource.detail,
          tone: resource.kind === "Component" ? "blue" : "violet",
          icon: "dapr",
          metrics: [{ label: "Target", value: resource.target }],
        },
      }),
    )
    edges.push(
      createReferenceEdge("dapr-sidecar", resourceId, `edge-${resourceId}`),
    )
  })

  if (daprResources.length > visibleDaprResources.length) {
    nodes.push(
      createNode({
        id: "dapr-overflow",
        position: {
          x: 790,
          y: daprResourceStartY + visibleDaprResources.length * 155,
        },
        data: {
          eyebrow: "Dapr resources",
          title: `+${daprResources.length - visibleDaprResources.length} more`,
          description: "Additional scoped resources are listed below.",
          tone: "violet",
          icon: "dapr",
          metrics: [],
        },
      }),
    )
    edges.push(
      createReferenceEdge(
        "dapr-sidecar",
        "dapr-overflow",
        "edge-dapr-overflow",
      ),
    )
  }

  return { nodes, edges }
}

function createNode({
  id,
  position,
  data,
}: Pick<ComponentNode, "id" | "position" | "data">): ComponentNode {
  return {
    id,
    type: "component",
    position,
    data,
  }
}

function hasRoutedTraffic(revision: FlowRevision) {
  return revision.trafficPercentValue > 0
}

function createEdge(
  source: string,
  target: string,
  id: string,
  options: Partial<Edge> = {},
): Edge {
  return {
    id,
    source,
    target,
    type: "smoothstep",
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "#71717a",
    },
    style: {
      stroke: "#71717a",
      strokeWidth: 1.8,
    },
    labelBgBorderRadius: 8,
    labelBgPadding: [8, 4],
    labelStyle: {
      fill: "#3f3f46",
      fontSize: 11,
      fontWeight: 600,
    },
    ...options,
  }
}

function createReferenceEdge(source: string, target: string, id: string): Edge {
  return {
    id,
    source,
    target,
    type: "simplebezier",
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "#8b5cf6",
    },
    style: {
      stroke: "#8b5cf6",
      strokeDasharray: "5 5",
      strokeWidth: 1.8,
    },
  }
}

function ComponentNodeCard({ data }: NodeProps<ComponentNode>) {
  const Icon = getNodeIcon(data.icon)

  return (
    <article className="w-72 rounded-xl border border-zinc-200 bg-white p-3 text-left shadow-sm">
      <Handle
        className="!size-2 !border-2 !border-white !bg-zinc-400"
        position={Position.Left}
        type="target"
      />
      <Handle
        className="!size-2 !border-2 !border-white !bg-zinc-400"
        position={Position.Right}
        type="source"
      />
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-lg border",
            getToneClassName(data.tone),
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-medium text-[0.68rem] text-zinc-500 uppercase tracking-wide">
              {data.eyebrow}
            </p>
            {data.status ? <NodeStatus value={data.status} /> : null}
          </div>
          <h3 className="mt-1 truncate font-semibold text-sm text-zinc-950">
            {data.title}
          </h3>
          <p className="mt-1 line-clamp-2 break-all text-[0.72rem] text-zinc-600">
            {data.description || "n/a"}
          </p>
        </div>
      </div>

      {data.metrics.length > 0 ? (
        <dl className="mt-3 grid gap-2">
          {data.metrics.map((metric) => (
            <div
              className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 rounded-md bg-zinc-50 px-2 py-1.5"
              key={`${metric.label}-${metric.value}`}
            >
              <dt className="font-medium text-[0.68rem] text-zinc-500">
                {metric.label}
              </dt>
              <dd className="truncate font-medium text-[0.68rem] text-zinc-700">
                {metric.value || "n/a"}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </article>
  )
}

function NodeStatus({ value }: { value: string }) {
  const healthy = value === "Ready" || value === "Enabled"

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 font-medium text-[0.62rem]",
        healthy
          ? "bg-emerald-50 text-emerald-700"
          : "bg-amber-50 text-amber-700",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          healthy ? "bg-emerald-500" : "bg-amber-500",
        )}
      />
      {value}
    </span>
  )
}

function getNodeIcon(icon: ComponentNodeData["icon"]) {
  if (icon === "route") {
    return IconRoute
  }
  if (icon === "revision") {
    return IconGitBranch
  }
  if (icon === "container") {
    return IconBox
  }
  if (icon === "dapr") {
    return IconBolt
  }
  if (icon === "database") {
    return IconDatabase
  }

  return IconCloud
}

function getToneClassName(tone: ComponentNodeData["tone"]) {
  if (tone === "emerald") {
    return "border-emerald-100 bg-emerald-50 text-emerald-700"
  }
  if (tone === "amber") {
    return "border-amber-100 bg-amber-50 text-amber-700"
  }
  if (tone === "violet") {
    return "border-violet-100 bg-violet-50 text-violet-700"
  }
  if (tone === "blue") {
    return "border-blue-100 bg-blue-50 text-blue-700"
  }

  return "border-zinc-200 bg-zinc-50 text-zinc-600"
}

function getMiniMapColor(node: ComponentNode) {
  if (node.data.tone === "emerald") {
    return "#10b981"
  }
  if (node.data.tone === "amber") {
    return "#f59e0b"
  }
  if (node.data.tone === "violet") {
    return "#8b5cf6"
  }
  if (node.data.tone === "blue") {
    return "#2563eb"
  }

  return "#71717a"
}
