import {
  IconAlertTriangle,
  IconClock,
  IconCode,
  IconDatabase,
  IconFileText,
  IconInfoCircle,
  IconTerminal2,
} from "@tabler/icons-react"
import type { ComponentType, ReactNode } from "react"
import {
  getServiceDetail,
  getServiceLogs,
  type ServiceLogEntry,
} from "@/app/actions"
import { cn } from "@/lib/utils"
import { formatTimestamp, ServicePageFrame } from "../_components"

export const dynamic = "force-dynamic"

type ServiceLogsPageProps = {
  params: Promise<{
    namespace: string
    name: string
  }>
}

export default async function ServiceLogsPage({
  params,
}: ServiceLogsPageProps) {
  const { namespace, name } = await params
  const [detail, logs] = await Promise.all([
    getServiceDetail(namespace, name),
    getServiceLogs(namespace, name),
  ])
  const streamCount = new Set(
    logs.entries.map((entry) => JSON.stringify(entry.stream)),
  ).size

  return (
    <ServicePageFrame
      activeTab="logs"
      detail={detail}
      name={name}
      namespace={namespace}
    >
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          icon={IconTerminal2}
          label="Log lines"
          value={String(logs.entries.length)}
        />
        <MetricTile
          icon={IconClock}
          label="Window"
          value={`${logs.windowMinutes}m`}
        />
        <MetricTile
          icon={IconDatabase}
          label="Streams"
          value={String(streamCount)}
        />
        <MetricTile
          icon={IconFileText}
          label="Limit"
          value={String(logs.limit)}
        />
      </section>

      {logs.errors.length > 0 ? (
        <section className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
          <div className="flex gap-3">
            <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              <h2 className="font-medium text-sm">Logs are unavailable</h2>
              <ul className="space-y-1 text-amber-900 text-xs">
                {logs.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel
          icon={IconTerminal2}
          title="Service logs"
          description="Recent Loki log lines for pods that match this Knative service."
        >
          <LogList entries={logs.entries} />
        </Panel>

        <aside className="space-y-6">
          <Panel
            icon={IconCode}
            title="Loki query"
            description="The LogQL selector used for this service."
          >
            <pre className="overflow-auto rounded-md border border-zinc-200 bg-zinc-950 p-3 text-[0.72rem] text-zinc-100">
              <code>{logs.query}</code>
            </pre>
            <div className="grid gap-3">
              <Fact
                label="Last synced"
                value={formatTimestamp(logs.lastSyncedAt)}
              />
              <Fact
                label="Default selector"
                value='{namespace="...", pod=~"service.*"}'
              />
            </div>
          </Panel>

          <Panel
            icon={IconInfoCircle}
            title="Configuration"
            description="Set these environment variables on the console server to tune Loki."
          >
            <ConfigList />
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
        <span className="mt-0.5 rounded-md border border-zinc-200 bg-zinc-50 p-2 text-zinc-600">
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

function LogList({ entries }: { entries: ServiceLogEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-10 text-center">
        <IconTerminal2 className="mx-auto size-6 text-zinc-400" />
        <h3 className="mt-3 font-medium text-sm">No logs found</h3>
        <p className="mt-1 text-zinc-500 text-xs">
          Try increasing LOKI_LOG_WINDOW_MINUTES or adjusting
          LOKI_QUERY_TEMPLATE.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between border-zinc-800 border-b px-4 py-2">
        <div className="flex items-center gap-2 text-zinc-300 text-xs">
          <span className="size-2 rounded-full bg-red-400" />
          <span className="size-2 rounded-full bg-amber-400" />
          <span className="size-2 rounded-full bg-emerald-400" />
          <span className="ml-2 font-medium">loki query_range</span>
        </div>
        <span className="text-[0.68rem] text-zinc-500">newest first</span>
      </div>
      <ol className="max-h-[720px] divide-y divide-zinc-900 overflow-auto font-mono text-[0.72rem]">
        {entries.map((entry) => (
          <li
            key={`${entry.timestamp}/${entry.line}`}
            className="grid gap-2 px-4 py-2 text-zinc-100 lg:grid-cols-[88px_minmax(140px,220px)_minmax(0,1fr)]"
          >
            <time className="text-zinc-500">{entry.time}</time>
            <StreamSummary stream={entry.stream} />
            <span className="break-words leading-relaxed">{entry.line}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function StreamSummary({ stream }: { stream: Record<string, string> }) {
  const labels = [
    stream.pod,
    stream.pod_name,
    stream.container,
    stream.container_name,
  ].filter((value): value is string => Boolean(value))

  if (labels.length === 0) {
    return <span className="text-zinc-600">stream</span>
  }

  return (
    <span className="flex min-w-0 flex-wrap gap-1">
      {labels.slice(0, 2).map((label) => (
        <span
          key={label}
          className="max-w-48 truncate rounded-sm bg-zinc-900 px-1.5 py-0.5 text-zinc-400"
        >
          {label}
        </span>
      ))}
    </span>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2">
      <dt className="text-zinc-500 text-xs">{label}</dt>
      <dd className="mt-1 truncate font-medium text-sm text-zinc-800">
        {value}
      </dd>
    </div>
  )
}

function ConfigList() {
  const items = [
    ["LOKI_BASE_URL", "Base URL for Loki, for example http://loki:3100"],
    [
      "LOKI_QUERY_TEMPLATE",
      `Optional LogQL selector with "$${"{namespace}"}" and "$${"{name}"}"`,
    ],
    ["LOKI_LOG_WINDOW_MINUTES", "Lookback window, defaults to 60"],
    ["LOKI_LOG_LIMIT", "Maximum log lines, defaults to 200"],
    ["LOKI_TENANT_ID", "Optional X-Scope-OrgID header"],
  ]

  return (
    <div className="space-y-2">
      {items.map(([key, description]) => (
        <div
          key={key}
          className={cn(
            "rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2",
          )}
        >
          <p className="font-mono font-medium text-xs">{key}</p>
          <p className="mt-1 text-zinc-500 text-xs">{description}</p>
        </div>
      ))}
    </div>
  )
}
