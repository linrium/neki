import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCloud,
  IconExternalLink,
  IconGitBranch,
  IconPlayerPlay,
  IconRefresh,
  IconServer,
  IconTag,
  IconTerminal2,
} from "@tabler/icons-react"
import Link from "next/link"
import type { ComponentType, ReactNode } from "react"
import { refreshService, type ServiceDetail } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type ServiceTab = "overview" | "logs" | "playground"

export function ServicePageFrame({
  activeTab,
  children,
  detail,
  name,
  namespace,
}: {
  activeTab: ServiceTab
  children: ReactNode
  detail: ServiceDetail
  name: string
  namespace: string
}) {
  const service = detail.service
  const refreshServiceAction = refreshService.bind(null, namespace, name)

  if (!service) {
    return (
      <main className="min-h-screen bg-zinc-50 text-zinc-950">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
          <BackLink />
          <section className="rounded-md border border-amber-200 bg-amber-50 p-6 text-amber-950">
            <IconAlertTriangle className="size-6" />
            <h1 className="mt-4 font-semibold text-2xl">
              Service details unavailable
            </h1>
            <p className="mt-2 text-amber-900 text-sm">
              {detail.errors[0] ??
                "The requested Knative service could not be read."}
            </p>
          </section>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="space-y-5 border-zinc-200 border-b pb-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <BackLink />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-semibold text-3xl tracking-normal">
                    {service.name}
                  </h1>
                  <StatusBadge
                    active={service.ready}
                    label={service.ready ? "Ready" : service.reason}
                  />
                </div>
                <p className="mt-2 max-w-3xl text-sm text-zinc-600">
                  Knative service detail for{" "}
                  <span className="font-medium text-zinc-800">
                    {service.namespace}
                  </span>{" "}
                  with overview and logs for day-two operations.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-zinc-500 text-xs lg:text-right">
                Last synced{" "}
                <span className="font-medium text-zinc-700">
                  {formatTimestamp(detail.lastSyncedAt)}
                </span>
              </p>
              {service.url !== "n/a" ? (
                <a
                  href={service.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2.5 font-medium text-xs hover:bg-zinc-50"
                >
                  <IconExternalLink className="size-4" />
                  Open URL
                </a>
              ) : null}
              <form action={refreshServiceAction}>
                <Button type="submit" variant="outline" size="lg">
                  <IconRefresh data-icon="inline-start" />
                  Refresh
                </Button>
              </form>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-zinc-500 text-xs">
            <HeaderPill icon={IconCloud} value={detail.currentContext} />
            <HeaderPill icon={IconServer} value={detail.clusterName} />
            <HeaderPill icon={IconTag} value={service.namespace} />
            <HeaderPill icon={IconGitBranch} value={service.revision} />
          </div>

          <ServiceTabs
            activeTab={activeTab}
            name={service.name}
            namespace={service.namespace}
          />
        </header>

        {detail.errors.length > 0 ? (
          <section className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
            <div className="flex gap-3">
              <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div className="space-y-1">
                <h2 className="font-medium text-sm">Service read is partial</h2>
                <ul className="space-y-1 text-amber-900 text-xs">
                  {detail.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        ) : null}

        {children}
      </div>
    </main>
  )
}

function BackLink() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-2 font-medium text-sm text-zinc-600 hover:text-zinc-950"
    >
      <IconArrowLeft className="size-4" />
      Back to dashboard
    </Link>
  )
}

function ServiceTabs({
  activeTab,
  name,
  namespace,
}: {
  activeTab: ServiceTab
  name: string
  namespace: string
}) {
  const baseHref = `/services/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`
  const tabs: Array<{
    value: ServiceTab
    label: string
    href: string
    icon: ComponentType<{ className?: string }>
  }> = [
    { value: "overview", label: "Overview", href: baseHref, icon: IconCloud },
    {
      value: "logs",
      label: "Logs",
      href: `${baseHref}/logs`,
      icon: IconTerminal2,
    },
    {
      value: "playground",
      label: "Playground",
      href: `${baseHref}/playground`,
      icon: IconPlayerPlay,
    },
  ]

  return (
    <nav
      aria-label="Service sections"
      className="inline-flex w-fit rounded-md border border-zinc-200 bg-white p-1"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.value}
          href={tab.href}
          aria-current={activeTab === tab.value ? "page" : undefined}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 font-medium text-xs transition-colors",
            activeTab === tab.value
              ? "bg-zinc-950 text-white"
              : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950",
          )}
        >
          <tab.icon className="size-3.5" />
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}

function HeaderPill({
  icon: Icon,
  value,
}: {
  icon: ComponentType<{ className?: string }>
  value: string
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 py-1 font-medium">
      <Icon className="size-3.5 text-blue-600" />
      {value}
    </span>
  )
}

export function StatusBadge({
  active,
  label,
}: {
  active: boolean
  label: string
}) {
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

export function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value))
}

export function formatAge(value: string) {
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
