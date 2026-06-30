import {
  IconBolt,
  IconBox,
  IconClock,
  IconCode,
  IconGitBranch,
  IconInfoCircle,
  IconTag,
} from "@tabler/icons-react"
import type { ComponentType, ReactNode } from "react"
import {
  type DaprResource,
  getServiceDetail,
  type ServiceCondition,
  type ServiceContainer,
  type ServiceRevision,
} from "@/app/actions"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { formatAge, ServicePageFrame, StatusBadge } from "./_components"

export const dynamic = "force-dynamic"

type ServicePageProps = {
  params: Promise<{
    namespace: string
    name: string
  }>
}

export default async function ServicePage({ params }: ServicePageProps) {
  const { namespace, name } = await params
  const detail = await getServiceDetail(namespace, name)
  const service = detail.service

  if (!service) {
    return (
      <ServicePageFrame
        activeTab="overview"
        detail={detail}
        name={name}
        namespace={namespace}
      >
        <span />
      </ServicePageFrame>
    )
  }

  return (
    <ServicePageFrame
      activeTab="overview"
      detail={detail}
      name={name}
      namespace={namespace}
    >
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          icon={IconGitBranch}
          label="Revisions"
          value={String(detail.revisions.length)}
        />
        <MetricTile
          icon={IconBolt}
          label="Dapr app"
          value={service.daprEnabled ? service.daprAppId : "Disabled"}
        />
        <MetricTile
          icon={IconGitBranch}
          label="Min scale"
          value={service.minScale}
        />
        <MetricTile
          icon={IconClock}
          label="Age"
          value={formatAge(service.age)}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(380px,0.9fr)]">
        <div className="space-y-6">
          <Panel
            icon={IconInfoCircle}
            title="Serving status"
            description="Knative condition state and observed generation."
          >
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="URL" value={service.url} wide />
              <Fact label="Generation" value={detail.generation} />
              <Fact
                label="Observed generation"
                value={detail.observedGeneration}
              />
              <Fact label="Resource version" value={detail.resourceVersion} />
            </dl>
            <ConditionList conditions={detail.conditions} />
          </Panel>

          <Panel
            icon={IconGitBranch}
            title="Revisions"
            description="Knative revisions with readiness, traffic split, and deployed image details."
          >
            <RevisionList
              latestReadyRevision={service.revision}
              revisions={detail.revisions}
            />
          </Panel>

          <Panel
            icon={IconBox}
            title="Revision template"
            description="Container images, exposed ports, and configured environment keys."
          >
            <ContainerList containers={detail.containers} />
          </Panel>
        </div>

        <aside className="space-y-6">
          <Panel
            icon={IconBolt}
            title="Dapr integration"
            description="Sidecar annotations and Dapr resources scoped to this service."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Fact
                label="Sidecar"
                value={service.daprEnabled ? "Enabled" : "Disabled"}
              />
              <Fact label="App ID" value={service.daprAppId} />
            </div>
            <DaprResourceList resources={detail.relatedDaprResources} />
          </Panel>

          <Panel
            icon={IconTag}
            title="Metadata"
            description="Labels, annotations, and Kubernetes object identifiers."
          >
            <dl className="grid gap-3">
              <Fact label="UID" value={detail.uid} />
            </dl>
            <KeyValueList title="Labels" items={detail.labels} />
            <KeyValueList title="Annotations" items={detail.annotations} />
          </Panel>
        </aside>
      </section>
    </ServicePageFrame>
  )
}

function MetricTile({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-zinc-500 text-xs">{label}</p>
          <p className="mt-2 truncate font-semibold text-xl">{value}</p>
        </div>
        <span className="rounded-md border border-zinc-200 bg-zinc-50 p-2 text-zinc-600">
          <Icon className="size-4" />
        </span>
      </div>
    </div>
  )
}

function Panel({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="rounded-md border border-zinc-200 bg-white p-4">
      <div className="flex gap-3">
        <span className="mt-0.5 shrink-0 self-start rounded-md border border-zinc-200 bg-zinc-50 p-2 text-zinc-600">
          <Icon className="size-4" />
        </span>
        <div>
          <h2 className="font-semibold text-lg">{title}</h2>
          <p className="text-sm text-zinc-600">{description}</p>
        </div>
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

function Fact({
  label,
  value,
  wide = false,
}: {
  label: string
  value: string
  wide?: boolean
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2",
        wide && "sm:col-span-2 lg:col-span-4",
      )}
    >
      <dt className="text-zinc-500 text-xs">{label}</dt>
      <dd className="mt-1 truncate font-medium text-sm text-zinc-800">
        {value}
      </dd>
    </div>
  )
}

function ConditionList({ conditions }: { conditions: ServiceCondition[] }) {
  if (conditions.length === 0) {
    return <EmptyState title="No conditions reported" />
  }

  return (
    <div className="overflow-hidden rounded-md border border-zinc-200">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-zinc-200 border-b bg-zinc-100/70 text-zinc-500 text-xs">
          <tr>
            <TableHead>Condition</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Message</TableHead>
            <TableHead>Updated</TableHead>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {conditions.map((condition) => (
            <tr key={condition.type}>
              <TableCell className="font-medium">{condition.type}</TableCell>
              <TableCell>
                <StatusBadge
                  active={condition.status === "True"}
                  label={condition.status}
                />
              </TableCell>
              <TableCell>{condition.reason}</TableCell>
              <TableCell className="max-w-[280px] truncate text-zinc-600">
                {condition.message}
              </TableCell>
              <TableCell className="text-zinc-500">
                {formatAge(condition.lastTransitionTime)}
              </TableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RevisionList({
  latestReadyRevision,
  revisions,
}: {
  latestReadyRevision: string
  revisions: ServiceRevision[]
}) {
  if (revisions.length === 0) {
    return <EmptyState title="No revisions found for this service" />
  }

  return (
    <div className="space-y-3">
      {revisions.map((revision) => (
        <div
          key={`${revision.namespace}/${revision.name}`}
          className="rounded-md border border-zinc-200 bg-zinc-50 p-4"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="break-all font-semibold text-sm">
                  {revision.name}
                </h3>
                <Badge variant={revision.ready ? "success" : "warning"}>
                  {revision.ready ? "Ready" : revision.status}
                </Badge>
                {revision.name === latestReadyRevision ? (
                  <Badge variant="outline">Latest ready</Badge>
                ) : null}
              </div>

              <dl className="grid gap-2 text-xs sm:grid-cols-2">
                <RevisionFact label="Image" value={revision.image} wide />
                <RevisionFact
                  label="Image digest"
                  value={revision.imageDigest}
                  wide
                />
                <RevisionFact
                  label="Reason"
                  value={revision.reason || revision.message}
                />
                <RevisionFact
                  label="Observed generation"
                  value={revision.observedGeneration}
                />
                <RevisionFact label="Route" value={revision.trafficLabel} />
                <RevisionFact label="URL" value={revision.url} />
              </dl>
            </div>
            <div className="w-full rounded-md border border-zinc-200 bg-white p-3 lg:w-44">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-zinc-500 text-xs">
                  Traffic
                </span>
                <span className="font-semibold text-blue-700 text-sm">
                  {revision.trafficPercent}
                </span>
              </div>
              <Progress className="mt-3" value={revision.trafficPercentValue} />
              <p className="mt-3 text-zinc-500 text-xs">
                Created {formatAge(revision.createdAt)}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function RevisionFact({
  label,
  value,
  wide = false,
}: {
  label: string
  value: string
  wide?: boolean
}) {
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-2")}>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="mt-1 break-all font-medium text-zinc-700">
        {value || "n/a"}
      </dd>
    </div>
  )
}

function ContainerList({ containers }: { containers: ServiceContainer[] }) {
  if (containers.length === 0) {
    return <EmptyState title="No containers found in the revision template" />
  }

  return (
    <div className="space-y-3">
      {containers.map((container) => (
        <div
          key={container.name}
          className="rounded-md border border-zinc-200 bg-zinc-50 p-3"
        >
          <div className="flex items-start gap-3">
            <IconCode className="mt-0.5 size-4 shrink-0 text-zinc-500" />
            <div className="min-w-0 flex-1">
              <h3 className="font-medium text-sm">{container.name}</h3>
              <p className="mt-1 truncate text-zinc-600 text-xs">
                {container.image}
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <PillGroup label="Ports" values={container.ports} />
                <PillGroup label="Environment" values={container.env} />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function DaprResourceList({ resources }: { resources: DaprResource[] }) {
  if (resources.length === 0) {
    return <EmptyState title="No scoped Dapr resources found" />
  }

  return (
    <div className="space-y-2">
      {resources.map((resource) => (
        <div
          key={`${resource.kind}/${resource.namespace}/${resource.name}`}
          className="rounded-md border border-zinc-200 bg-zinc-50 p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <ResourceKind kind={resource.kind} />
            <h3 className="font-medium text-sm">{resource.name}</h3>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <Fact label="Detail" value={resource.detail} />
            <Fact label="Target" value={resource.target} />
          </dl>
        </div>
      ))}
    </div>
  )
}

function KeyValueList({
  title,
  items,
}: {
  title: string
  items: Array<{ key: string; value: string }>
}) {
  return (
    <div>
      <h3 className="font-medium text-sm">{title}</h3>
      {items.length > 0 ? (
        <div className="mt-2 max-h-56 space-y-1 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-2">
          {items.map((item) => (
            <div
              key={item.key}
              className="grid gap-2 rounded-sm bg-white px-2 py-1.5 text-xs sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"
            >
              <span className="truncate font-medium text-zinc-700">
                {item.key}
              </span>
              <span className="truncate text-zinc-600">{item.value}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-500 text-xs">
          No {title.toLowerCase()} set
        </p>
      )}
    </div>
  )
}

function PillGroup({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <p className="text-zinc-500 text-xs">{label}</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {values.length > 0 ? (
          values.map((value) => (
            <span
              key={value}
              className="rounded-sm bg-white px-1.5 py-0.5 font-medium text-[0.68rem] text-zinc-600"
            >
              {value}
            </span>
          ))
        ) : (
          <span className="text-zinc-500 text-xs">n/a</span>
        )}
      </div>
    </div>
  )
}

function TableHead({ children }: { children: ReactNode }) {
  return (
    <th className="px-4 py-3 font-medium tracking-normal whitespace-nowrap">
      {children}
    </th>
  )
}

function TableCell({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <td className={cn("px-4 py-3 align-top text-xs", className)}>{children}</td>
  )
}

function ResourceKind({ kind }: { kind: string }) {
  const className =
    kind === "Component"
      ? "bg-blue-50 text-blue-700"
      : kind === "Subscription"
        ? "bg-emerald-50 text-emerald-700"
        : "bg-violet-50 text-violet-700"

  return (
    <span
      className={cn("rounded-sm px-1.5 py-0.5 font-medium text-xs", className)}
    >
      {kind}
    </span>
  )
}

function EmptyState({ title }: { title: string }) {
  return (
    <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-6 text-center">
      <IconInfoCircle className="mx-auto size-5 text-zinc-400" />
      <p className="mt-2 font-medium text-sm">{title}</p>
    </div>
  )
}
