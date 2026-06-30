import {
  IconAlertTriangle,
  IconCheck,
  IconDatabase,
  IconServerBolt,
  IconShieldLock,
} from "@tabler/icons-react"
import type { ComponentType } from "react"
import {
  getServiceDetail,
  getServicePostgresClusters,
  type ServicePostgresCluster,
} from "@/app/actions"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { formatAge, ServicePageFrame, StatusBadge } from "../_components"
import { PostgresForm } from "./postgres-form"

export const dynamic = "force-dynamic"

type ServicePostgresPageProps = {
  params: Promise<{
    namespace: string
    name: string
  }>
}

export default async function ServicePostgresPage({
  params,
}: ServicePostgresPageProps) {
  const { namespace, name } = await params
  const [detail, postgres] = await Promise.all([
    getServiceDetail(namespace, name),
    getServicePostgresClusters(namespace, name),
  ])
  const vaultResource = detail.relatedDaprResources.find(
    (resource) =>
      resource.kind === "Component" &&
      resource.detail === "secretstores.hashicorp.vault",
  )
  const defaultVaultComponent = vaultResource?.name ?? "vault"

  return (
    <ServicePageFrame
      activeTab="postgres"
      detail={detail}
      name={name}
      namespace={namespace}
    >
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          icon={IconDatabase}
          label="Provider"
          value="CloudNativePG"
        />
        <MetricTile
          icon={IconServerBolt}
          label="Clusters"
          value={String(postgres.clusters.length)}
        />
        <MetricTile
          icon={IconShieldLock}
          label="Secret store"
          value={defaultVaultComponent}
        />
        <MetricTile
          icon={IconCheck}
          label="Linked"
          value={String(
            postgres.clusters.filter((cluster) => cluster.linkedToService)
              .length,
          )}
        />
      </section>

      {postgres.errors.length > 0 ? (
        <section className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
          <div className="flex gap-3">
            <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              <h2 className="font-medium text-sm">
                Postgres clusters are unavailable
              </h2>
              <ul className="space-y-1 text-amber-900 text-xs">
                {postgres.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      {!vaultResource ? (
        <section className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="warning">Vault component not detected</Badge>
            <p className="text-sm">
              The form defaults to component{" "}
              <span className="font-mono">vault</span>. Provisioning will fail
              unless that Dapr Vault component exists in{" "}
              <span className="font-mono">{namespace}</span>.
            </p>
          </div>
        </section>
      ) : null}

      <section className="rounded-md border border-zinc-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-semibold text-lg">Postgres clusters</h2>
            <p className="mt-1 text-sm text-zinc-600">
              CloudNativePG clusters found in{" "}
              <span className="font-mono">{namespace}</span>. Clusters created
              by this console are linked to the current service with labels.
            </p>
          </div>
          <Badge variant="outline">
            Synced {new Date(postgres.lastSyncedAt).toLocaleTimeString()}
          </Badge>
        </div>
        <PostgresClusterList clusters={postgres.clusters} />
      </section>

      <PostgresForm
        defaultVaultComponent={defaultVaultComponent}
        namespace={namespace}
        serviceName={name}
      />
    </ServicePageFrame>
  )
}

function PostgresClusterList({
  clusters,
}: {
  clusters: ServicePostgresCluster[]
}) {
  if (clusters.length === 0) {
    return (
      <div className="mt-4 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-10 text-center">
        <IconDatabase className="mx-auto size-6 text-zinc-400" />
        <h3 className="mt-3 font-medium text-sm">No Postgres clusters found</h3>
        <p className="mt-1 text-zinc-500 text-xs">
          Create a managed Postgres instance below, then refresh this page to
          see the CloudNativePG cluster status.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-4 grid gap-3 xl:grid-cols-2">
      {clusters.map((cluster) => (
        <article
          key={`${cluster.namespace}/${cluster.name}`}
          className={cn(
            "rounded-md border p-4",
            cluster.linkedToService
              ? "border-blue-200 bg-blue-50/40"
              : "border-zinc-200 bg-white",
          )}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate font-semibold text-base">
                  {cluster.name}
                </h3>
                <StatusBadge
                  active={cluster.ready}
                  label={cluster.ready ? "Ready" : cluster.phase}
                />
                {cluster.linkedToService ? (
                  <Badge variant="default">Linked</Badge>
                ) : null}
                {cluster.managedByConsole ? (
                  <Badge variant="secondary">neki-console</Badge>
                ) : null}
              </div>
              <p className="mt-1 truncate text-sm text-zinc-600">
                {cluster.primary !== "n/a"
                  ? `Primary ${cluster.primary}`
                  : "Primary not reported yet"}
              </p>
            </div>
            <Badge variant="outline">Age {formatAge(cluster.age)}</Badge>
          </div>

          <dl className="mt-4 grid gap-2 sm:grid-cols-2">
            <Fact label="Ready instances" value={cluster.readyInstances} />
            <Fact label="Desired instances" value={cluster.instances} />
            <Fact label="Database" value={cluster.database} />
            <Fact label="Owner" value={cluster.owner} />
            <Fact label="Storage" value={cluster.storage} />
            <Fact label="Bootstrap secret" value={cluster.bootstrapSecret} />
            <Fact label="Vault component" value={cluster.vaultComponent} />
            <Fact label="Vault path" value={cluster.vaultPath} />
          </dl>

          {cluster.image !== "n/a" ? (
            <div className="mt-3 rounded-md bg-white/70 px-2 py-1.5">
              <p className="text-zinc-500 text-xs">Image</p>
              <p className="mt-0.5 truncate font-mono text-xs text-zinc-700">
                {cluster.image}
              </p>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-white/80 px-2 py-1.5">
      <dt className="text-zinc-500 text-xs">{label}</dt>
      <dd className="mt-0.5 truncate font-medium text-sm">{value}</dd>
    </div>
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
          <p className="mt-2 truncate font-semibold text-lg">{value}</p>
        </div>
        <span className="rounded-md border border-zinc-200 bg-zinc-50 p-2 text-zinc-600">
          <Icon className="size-4" />
        </span>
      </div>
    </div>
  )
}
