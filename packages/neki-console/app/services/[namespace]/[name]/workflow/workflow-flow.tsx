"use client"

import {
  IconBolt,
  IconCheck,
  IconClock,
  IconCloud,
  IconGitBranch,
  IconRoute,
  IconServer,
} from "@tabler/icons-react"
import {
  Background,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  type NodeTypes,
  Position,
  ReactFlow,
} from "@xyflow/react"
import { useMemo } from "react"
import { cn } from "@/lib/utils"

export type WorkflowTone = "blue" | "emerald" | "amber" | "violet" | "zinc"

export type WorkflowNodeKind =
  | "activity"
  | "decision"
  | "event"
  | "pubsub"
  | "request"
  | "route"
  | "server"
  | "terminal"
  | "workflow"

export type WorkflowNodeData = {
  eyebrow: string
  title: string
  description: string
  kind: WorkflowNodeKind
  tone: WorkflowTone
  status?: string
  metrics: Array<{ label: string; value: string }>
}

export type WorkflowDefinition = {
  serviceName: string
  title: string
  description: string
  kind: string
  entrypoint: string
  sourceFiles: string[]
  nodes: Array<{
    id: string
    position: { x: number; y: number }
    data: WorkflowNodeData
  }>
  edges: Array<{
    id: string
    source: string
    target: string
    label?: string
    animated?: boolean
    sourceHandle?: WorkflowHandleId
    targetHandle?: WorkflowHandleId
    tone?: WorkflowTone
  }>
}

type WorkflowNode = Node<WorkflowNodeData, "workflow">
type WorkflowHandleId =
  | "bottom"
  | "left"
  | "left-bottom"
  | "left-top"
  | "right"
  | "right-bottom"
  | "right-top"
  | "top"
  | "top-left"
  | "top-right"

const nodeTypes = {
  workflow: WorkflowNodeCard,
} satisfies NodeTypes

const NODE_X_SPACING_SCALE = 1.3

export function WorkflowFlow({ workflow }: { workflow: WorkflowDefinition }) {
  const { nodes, edges } = useMemo(() => buildFlow(workflow), [workflow])

  return (
    <section className="relative left-1/2 w-screen -translate-x-1/2 px-4 sm:px-6 lg:px-8">
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <div className="h-[720px] w-full bg-zinc-50">
          <ReactFlow
            colorMode="light"
            edges={edges}
            fitView
            fitViewOptions={{ padding: 0.18 }}
            maxZoom={1.25}
            minZoom={0.32}
            nodes={nodes}
            nodeTypes={nodeTypes}
            nodesConnectable={false}
            nodesDraggable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#d4d4d8" gap={24} size={1} />
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

function buildFlow(workflow: WorkflowDefinition): {
  nodes: WorkflowNode[]
  edges: Edge[]
} {
  return {
    nodes: workflow.nodes.map((node) => ({
      ...node,
      position: {
        x: node.position.x * NODE_X_SPACING_SCALE,
        y: node.position.y,
      },
      type: "workflow",
    })),
    edges: workflow.edges.map((edge) => createEdge(edge)),
  }
}

function createEdge(edge: WorkflowDefinition["edges"][number]): Edge {
  const color = getEdgeColor(edge.tone)

  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? "right",
    targetHandle: edge.targetHandle ?? "left",
    type: "smoothstep",
    animated: edge.animated,
    label: edge.label,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color,
    },
    style: {
      stroke: color,
      strokeWidth: 1.9,
    },
    labelBgBorderRadius: 8,
    labelBgPadding: [8, 4],
    labelStyle: {
      fill: "#3f3f46",
      fontSize: 11,
      fontWeight: 600,
    },
  }
}

function WorkflowNodeCard({ data }: NodeProps<WorkflowNode>) {
  const Icon = getNodeIcon(data.kind)

  return (
    <article className="w-72 rounded-xl border border-zinc-200 bg-white p-3 text-left shadow-sm">
      <NodeHandles />
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
          <p className="mt-1 line-clamp-2 text-[0.72rem] text-zinc-600">
            {data.description}
          </p>
        </div>
      </div>

      {data.metrics.length > 0 ? (
        <dl className="mt-3 grid gap-2">
          {data.metrics.map((metric) => (
            <div
              className="grid grid-cols-[76px_minmax(0,1fr)] gap-2 rounded-md bg-zinc-50 px-2 py-1.5"
              key={`${metric.label}-${metric.value}`}
            >
              <dt className="font-medium text-[0.68rem] text-zinc-500">
                {metric.label}
              </dt>
              <dd className="truncate font-medium text-[0.68rem] text-zinc-700">
                {metric.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </article>
  )
}

function NodeHandles() {
  const handleClassName =
    "!size-2 !border-2 !border-white !bg-zinc-400 !opacity-0"

  return (
    <>
      <Handle
        className={handleClassName}
        id="left"
        position={Position.Left}
        type="target"
      />
      <Handle
        className={handleClassName}
        id="left-top"
        position={Position.Left}
        style={{ top: 44 }}
        type="target"
      />
      <Handle
        className={handleClassName}
        id="left-bottom"
        position={Position.Left}
        style={{ top: "calc(100% - 44px)" }}
        type="target"
      />
      <Handle
        className={handleClassName}
        id="right"
        position={Position.Right}
        type="source"
      />
      <Handle
        className={handleClassName}
        id="right-top"
        position={Position.Right}
        style={{ top: 44 }}
        type="source"
      />
      <Handle
        className={handleClassName}
        id="right-bottom"
        position={Position.Right}
        style={{ top: "calc(100% - 44px)" }}
        type="source"
      />
      <Handle
        className={handleClassName}
        id="top"
        position={Position.Top}
        type="target"
      />
      <Handle
        className={handleClassName}
        id="top-left"
        position={Position.Top}
        style={{ left: "32%" }}
        type="target"
      />
      <Handle
        className={handleClassName}
        id="top-right"
        position={Position.Top}
        style={{ left: "68%" }}
        type="target"
      />
      <Handle
        className={handleClassName}
        id="bottom"
        position={Position.Bottom}
        type="source"
      />
    </>
  )
}

function NodeStatus({ value }: { value: string }) {
  const healthy =
    value === "200" || value === "202 Accepted" || value === "success=true"

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

function getNodeIcon(kind: WorkflowNodeKind) {
  if (kind === "activity") {
    return IconBolt
  }
  if (kind === "decision") {
    return IconGitBranch
  }
  if (kind === "event") {
    return IconClock
  }
  if (kind === "pubsub") {
    return IconCloud
  }
  if (kind === "route" || kind === "request") {
    return IconRoute
  }
  if (kind === "terminal") {
    return IconCheck
  }

  return IconServer
}

function getToneClassName(tone: WorkflowTone) {
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

function getEdgeColor(tone: WorkflowTone = "zinc") {
  if (tone === "amber") {
    return "#f59e0b"
  }
  if (tone === "violet") {
    return "#8b5cf6"
  }
  if (tone === "blue") {
    return "#2563eb"
  }
  if (tone === "emerald") {
    return "#10b981"
  }

  return "#71717a"
}
