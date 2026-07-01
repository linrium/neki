import { IconAlertTriangle, IconDatabase } from "@tabler/icons-react"
import Link from "next/link"
import {
  getServiceDetail,
  getServiceNeonDatabases,
  type ServiceNeonProjectSummary,
} from "@/app/actions"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { formatAge, ServicePageFrame, StatusBadge } from "../_components"
import { DatabasesForm } from "./databases-form"

export const dynamic = "force-dynamic"

type ServiceDatabasesPageProps = {
  params: Promise<{
    namespace: string
    name: string
  }>
}

export default async function ServiceDatabasesPage({
  params,
}: ServiceDatabasesPageProps) {
  const { namespace, name } = await params
  const [detail, neon] = await Promise.all([
    getServiceDetail(namespace, name),
    getServiceNeonDatabases(namespace, name),
  ])
  const vaultResource = detail.relatedDaprResources.find(
    (resource) =>
      resource.kind === "Component" &&
      resource.detail === "secretstores.hashicorp.vault",
  )
  const defaultVaultComponent = vaultResource?.name ?? "vault"

  return (
    <ServicePageFrame
      activeTab="databases"
      detail={detail}
      name={name}
      namespace={namespace}
    >
      {neon.errors.length > 0 ? (
        <section className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
          <div className="flex gap-3">
            <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              <h2 className="font-medium text-sm">
                Neon databases are unavailable
              </h2>
              <ul className="space-y-1 text-amber-900 text-xs">
                {neon.errors.map((error) => (
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
            <h2 className="font-semibold text-lg">Neon databases</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Neon projects found in the <span className="font-mono">neon</span>{" "}
              namespace. Open a project to create or delete branches.
            </p>
          </div>
          <Badge variant="outline">
            Synced {new Date(neon.lastSyncedAt).toLocaleTimeString()}
          </Badge>
        </div>
        <NeonDatabaseList databases={neon.databases} />
      </section>

      <DatabasesForm
        defaultVaultComponent={defaultVaultComponent}
        namespace={namespace}
        serviceName={name}
      />
    </ServicePageFrame>
  )
}

function NeonDatabaseList({
  databases,
}: {
  databases: ServiceNeonProjectSummary[]
}) {
  if (databases.length === 0) {
    return (
      <div className="mt-4 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-10 text-center">
        <IconDatabase className="mx-auto size-6 text-zinc-400" />
        <h3 className="mt-3 font-medium text-sm">No Neon projects found</h3>
        <p className="mt-1 text-zinc-500 text-xs">
          Create a Neon project below, then refresh this page to see operator
          status.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-4 grid gap-3 xl:grid-cols-2">
      {databases.map((database) => (
        <article
          key={`${database.namespace}/${database.projectName}`}
          className={cn(
            "rounded-md border p-4",
            database.linkedToService
              ? "border-blue-200 bg-blue-50/40"
              : "border-zinc-200 bg-white",
          )}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`databases/${encodeURIComponent(database.projectName)}`}
                  className="truncate font-semibold text-base hover:text-blue-700"
                >
                  {database.projectName}
                </Link>
                <StatusBadge
                  active={
                    database.branchCount > 0 &&
                    database.readyBranchCount === database.branchCount
                  }
                  label={`${database.readyBranchCount}/${database.branchCount} ready`}
                />
                {database.linkedToService ? (
                  <Badge variant="default">Linked</Badge>
                ) : null}
                {database.managedByConsole ? (
                  <Badge variant="secondary">neki-console</Badge>
                ) : null}
              </div>
              <p className="mt-1 truncate text-sm text-zinc-600">
                {database.branchCount} branch
                {database.branchCount === 1 ? "" : "es"}
              </p>
            </div>
            <Badge variant="outline">Age {formatAge(database.age)}</Badge>
          </div>

          <dl className="mt-4 grid gap-2 sm:grid-cols-2">
            <Fact label="Namespace" value={database.namespace} />
            <Fact label="Cluster" value={database.cluster} />
            <Fact label="RustFS bucket" value={database.bucketName} />
            <Fact label="Latest branch" value={database.latestBranchName} />
            <Fact label="Latest status" value={database.latestBranchPhase} />
            <Fact label="Vault component" value={database.vaultComponent} />
            <Fact label="Vault path" value={database.vaultPath} />
          </dl>

          <div className="mt-3">
            <Link
              href={`databases/${encodeURIComponent(database.projectName)}`}
              className="inline-flex h-8 items-center rounded-md border border-zinc-200 bg-white px-2.5 font-medium text-xs hover:bg-zinc-50"
            >
              Manage branches
            </Link>
          </div>
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
