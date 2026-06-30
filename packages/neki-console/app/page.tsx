import {
  IconActivity,
  IconAlertTriangle,
  IconBolt,
  IconCloud,
  IconComponents,
  IconCube,
  IconRefresh,
  IconRoute,
} from "@tabler/icons-react"
import Link from "next/link"
import type { ComponentType, ReactNode } from "react"
import { getClusterOverview, refreshDashboard } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"

const exampleServices = ["hello-bun-ts", "dapr-knative-pubsub", "dapr-workflow"]

export default async function Home() {
  const overview = await getClusterOverview()
  const daprEnabledServices = overview.services.filter(
    (service) => service.daprEnabled,
  )
  const readyServices = overview.services.filter((service) => service.ready)
  const components = overview.daprResources.filter(
    (resource) => resource.kind === "Component",
  )
  const subscriptions = overview.daprResources.filter(
    (resource) => resource.kind === "Subscription",
  )

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-zinc-200 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-zinc-500 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 py-1 font-medium">
                <IconCube className="size-3.5 text-blue-600" />
                {overview.currentContext}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 py-1 font-medium">
                <IconCloud className="size-3.5 text-emerald-600" />
                {overview.clusterName}
              </span>
            </div>
            <div>
              <h1 className="font-semibold text-3xl tracking-normal">
                Neki Service Console
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-zinc-600">
                Operational view for Knative services and Dapr resources running
                in the current Kubernetes context.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-right text-zinc-500 text-xs">
              Last synced{" "}
              <span className="font-medium text-zinc-700">
                {formatTimestamp(overview.lastSyncedAt)}
              </span>
            </p>
            <form action={refreshDashboard}>
              <Button type="submit" variant="outline" size="lg">
                <IconRefresh data-icon="inline-start" />
                Refresh
              </Button>
            </form>
          </div>
        </header>

        {overview.errors.length > 0 ? (
          <section className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
            <div className="flex gap-3">
              <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div className="space-y-1">
                <h2 className="font-medium text-sm">Cluster read is partial</h2>
                <ul className="space-y-1 text-amber-900 text-xs">
                  {overview.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        ) : null}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricTile
            icon={IconCloud}
            label="Knative services"
            value={overview.services.length}
            detail={`${readyServices.length} ready`}
          />
          <MetricTile
            icon={IconBolt}
            label="Dapr sidecars"
            value={daprEnabledServices.length}
            detail="enabled on Knative revisions"
          />
          <MetricTile
            icon={IconComponents}
            label="Dapr components"
            value={components.length}
            detail="state, pub/sub, bindings"
          />
          <MetricTile
            icon={IconRoute}
            label="Subscriptions"
            value={subscriptions.length}
            detail="topic routes"
          />
        </section>

        <section className="grid gap-6">
          <div className="space-y-3">
            <SectionHeader
              title="Knative Services"
              description="Serving resources, traffic targets, revision readiness, and Dapr annotations."
            />
            <div className="overflow-hidden rounded-md border border-zinc-200 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="border-zinc-200 border-b bg-zinc-100/70 text-zinc-500 text-xs">
                    <tr>
                      <TableHead>Service</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>URL</TableHead>
                      <TableHead>Dapr</TableHead>
                      <TableHead>Traffic</TableHead>
                      <TableHead>Age</TableHead>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {overview.services.length > 0 ? (
                      overview.services.map((service) => (
                        <tr key={`${service.namespace}/${service.name}`}>
                          <TableCell>
                            <div className="space-y-1">
                              <p className="font-medium text-zinc-950">
                                <Link
                                  href={`/services/${encodeURIComponent(service.namespace)}/${encodeURIComponent(service.name)}`}
                                  className="text-blue-700 underline-offset-4 hover:underline"
                                >
                                  {service.name}
                                </Link>
                              </p>
                              <p className="text-zinc-500 text-xs">
                                {service.namespace} / {service.revision}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <StatusBadge
                              active={service.ready}
                              label={service.ready ? "Ready" : service.reason}
                            />
                          </TableCell>
                          <TableCell>
                            <span className="block max-w-[280px] truncate text-zinc-600 text-xs">
                              {service.url}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <StatusBadge
                                active={service.daprEnabled}
                                label={service.daprEnabled ? "Enabled" : "Off"}
                              />
                              <p className="text-zinc-500 text-xs">
                                {service.daprAppId}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="text-zinc-600 text-xs">
                            {service.traffic}
                          </TableCell>
                          <TableCell className="text-zinc-500 text-xs">
                            {formatAge(service.age)}
                          </TableCell>
                        </tr>
                      ))
                    ) : (
                      <EmptyTableRow
                        columns={6}
                        title="No Knative services found"
                        detail={`Deploy one of the examples: ${exampleServices.join(", ")}.`}
                      />
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <SectionHeader
              title="Dapr Inventory"
              description="Components, configurations, and subscriptions discovered from dapr.io CRDs."
            />
            <div className="space-y-2">
              {overview.daprResources.length > 0 ? (
                overview.daprResources.map((resource) => (
                  <div
                    key={`${resource.kind}/${resource.namespace}/${resource.name}`}
                    className="rounded-md border border-zinc-200 bg-white p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <ResourceKind kind={resource.kind} />
                          <h3 className="truncate font-medium text-sm">
                            {resource.name}
                          </h3>
                        </div>
                        <p className="text-zinc-500 text-xs">
                          {resource.namespace} / {formatAge(resource.age)}
                        </p>
                      </div>
                      <IconActivity className="size-4 shrink-0 text-zinc-400" />
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <ResourceFact label="Detail" value={resource.detail} />
                      <ResourceFact label="Target" value={resource.target} />
                    </dl>
                    <div className="mt-3 flex flex-wrap gap-1">
                      {resource.scopes.length > 0 ? (
                        resource.scopes.map((scope) => (
                          <span
                            key={scope}
                            className="rounded-sm bg-zinc-100 px-1.5 py-0.5 font-medium text-[0.68rem] text-zinc-600"
                          >
                            {scope}
                          </span>
                        ))
                      ) : (
                        <span className="text-zinc-500 text-xs">
                          No explicit scopes
                        </span>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-md border border-dashed border-zinc-300 bg-white p-6 text-center">
                  <IconComponents className="mx-auto size-6 text-zinc-400" />
                  <h3 className="mt-3 font-medium text-sm">
                    No Dapr resources found
                  </h3>
                  <p className="mt-1 text-zinc-500 text-xs">
                    Components, configurations, and subscriptions will appear
                    after the example manifests are applied.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function MetricTile({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  value: number
  detail: string
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-zinc-500 text-xs">{label}</p>
          <p className="mt-2 font-semibold text-3xl">{value}</p>
        </div>
        <span className="rounded-md border border-zinc-200 bg-zinc-50 p-2 text-zinc-600">
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-3 text-zinc-500 text-xs">{detail}</p>
    </div>
  )
}

function SectionHeader({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div>
      <h2 className="font-semibold text-lg">{title}</h2>
      <p className="text-sm text-zinc-600">{description}</p>
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
  return <td className={cn("px-4 py-3 align-top", className)}>{children}</td>
}

function EmptyTableRow({
  columns,
  title,
  detail,
}: {
  columns: number
  title: string
  detail: string
}) {
  return (
    <tr>
      <td colSpan={columns} className="px-4 py-12 text-center">
        <IconCloud className="mx-auto size-6 text-zinc-400" />
        <p className="mt-3 font-medium text-sm">{title}</p>
        <p className="mt-1 text-zinc-500 text-xs">{detail}</p>
      </td>
    </tr>
  )
}

function StatusBadge({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 font-medium text-xs",
        active ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          active ? "bg-emerald-500" : "bg-zinc-400",
        )}
      />
      {label}
    </span>
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

function ResourceFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm bg-zinc-50 px-2 py-1.5">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="mt-0.5 truncate font-medium text-zinc-800">{value}</dd>
    </div>
  )
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value))
}

function formatAge(value: string) {
  if (!value) {
    return "n/a"
  }

  const createdAt = new Date(value).getTime()
  const diffMs = Date.now() - createdAt
  const minutes = Math.max(1, Math.floor(diffMs / 60000))

  if (minutes < 60) {
    return `${minutes}m`
  }

  const hours = Math.floor(minutes / 60)
  if (hours < 48) {
    return `${hours}h`
  }

  return `${Math.floor(hours / 24)}d`
}
