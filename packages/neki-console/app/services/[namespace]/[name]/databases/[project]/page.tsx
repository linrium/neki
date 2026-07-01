import {
  IconAlertTriangle,
  IconArrowLeft,
  IconDatabase,
  IconTrash,
} from "@tabler/icons-react"
import Link from "next/link"
import {
  deleteServiceNeonBranch,
  getServiceDetail,
  getServiceNeonProjectBranches,
  type ServiceNeonDatabase,
} from "@/app/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatAge, ServicePageFrame, StatusBadge } from "../../_components"
import { BranchForm } from "./branch-form"
import { CopyDatabaseUrlButton } from "./copy-database-url-button"

export const dynamic = "force-dynamic"

type NeonProjectPageProps = {
  params: Promise<{
    namespace: string
    name: string
    project: string
  }>
}

export default async function NeonProjectPage({
  params,
}: NeonProjectPageProps) {
  const { namespace, name, project } = await params
  const projectName = decodeURIComponent(project)
  const databasesHref = `/services/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/databases`
  const [detail, neonProject] = await Promise.all([
    getServiceDetail(namespace, name),
    getServiceNeonProjectBranches(namespace, name, projectName),
  ])
  const defaultBranch = neonProject.branches[0]
  const defaultVaultComponent = defaultBranch?.vaultComponent || "vault"
  const defaultVaultPath = defaultBranch?.vaultPath || ""
  const defaultPgVersion = defaultBranch?.pgVersion || "17"

  return (
    <ServicePageFrame
      activeTab="databases"
      detail={detail}
      name={name}
      namespace={namespace}
    >
      <div>
        <Link
          href={databasesHref}
          className="inline-flex items-center gap-2 font-medium text-sm text-zinc-600 hover:text-zinc-950"
        >
          <IconArrowLeft className="size-4" />
          Back to databases
        </Link>
      </div>

      {neonProject.errors.length > 0 ? (
        <section className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
          <div className="flex gap-3">
            <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              <h2 className="font-medium text-sm">
                Neon project is unavailable
              </h2>
              <ul className="space-y-1 text-amber-900 text-xs">
                {neonProject.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-md border border-zinc-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-lg">{projectName}</h2>
              {neonProject.linkedToService ? (
                <Badge variant="default">Linked</Badge>
              ) : null}
              {neonProject.managedByConsole ? (
                <Badge variant="secondary">neki-console</Badge>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-zinc-600">
              Neon Project in{" "}
              <span className="font-mono">{neonProject.namespace}</span>.
            </p>
          </div>
          <Badge variant="outline">
            Synced {new Date(neonProject.lastSyncedAt).toLocaleTimeString()}
          </Badge>
        </div>

        <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Cluster" value={neonProject.cluster} />
          <Fact label="RustFS bucket" value={neonProject.bucketName} />
          <Fact label="Branches" value={String(neonProject.branches.length)} />
          <Fact label="Namespace" value={neonProject.namespace} />
        </dl>
      </section>

      <section className="rounded-md border border-zinc-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-semibold text-lg">Branches</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Branch CRs whose <span className="font-mono">spec.projectID</span>{" "}
              points at this project.
            </p>
          </div>
          <Badge variant="outline">
            {neonProject.branches.length} branch
            {neonProject.branches.length === 1 ? "" : "es"}
          </Badge>
        </div>

        <BranchList
          branches={neonProject.branches}
          namespace={namespace}
          neonNamespace={neonProject.namespace}
          projectName={projectName}
          serviceName={name}
        />
      </section>

      <BranchForm
        bucketName={neonProject.bucketName}
        defaultPgVersion={defaultPgVersion}
        namespace={namespace}
        neonNamespace={neonProject.namespace}
        projectName={projectName}
        serviceName={name}
        vaultComponent={defaultVaultComponent}
        vaultPath={defaultVaultPath}
      />
    </ServicePageFrame>
  )
}

function BranchList({
  branches,
  namespace,
  neonNamespace,
  projectName,
  serviceName,
}: {
  branches: ServiceNeonDatabase[]
  namespace: string
  neonNamespace: string
  projectName: string
  serviceName: string
}) {
  if (branches.length === 0) {
    return (
      <div className="mt-4 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-10 text-center">
        <IconDatabase className="mx-auto size-6 text-zinc-400" />
        <h3 className="mt-3 font-medium text-sm">No branches found</h3>
        <p className="mt-1 text-zinc-500 text-xs">
          Create a branch below, then refresh this page to see operator status.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-4 grid gap-3 xl:grid-cols-2">
      {branches.map((branch) => {
        const deleteAction = deleteServiceNeonBranch.bind(
          null,
          namespace,
          serviceName,
          projectName,
          neonNamespace,
          branch.branchName,
        )

        return (
          <article
            key={`${branch.namespace}/${branch.branchName}`}
            className={cn(
              "rounded-md border p-4",
              branch.linkedToService
                ? "border-blue-200 bg-blue-50/40"
                : "border-zinc-200 bg-white",
            )}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate font-semibold text-base">
                    {branch.branchName}
                  </h3>
                  <StatusBadge
                    active={branch.ready}
                    label={branch.ready ? "Ready" : branch.phase}
                  />
                  {branch.managedByConsole ? (
                    <Badge variant="secondary">neki-console</Badge>
                  ) : null}
                </div>
                <p className="mt-1 truncate text-sm text-zinc-600">
                  {branch.computeHost}
                </p>
              </div>
              <Badge variant="outline">Age {formatAge(branch.age)}</Badge>
            </div>

            <dl className="mt-4 grid gap-2 sm:grid-cols-2">
              <Fact label="Postgres" value={`PG ${branch.pgVersion}`} />
              <Fact label="Timeline" value={branch.timelineId} />
              <Fact label="Port" value={branch.computePort} />
              <Fact label="Vault path" value={branch.vaultPath} />
            </dl>

            <div className="mt-3 rounded-md bg-white/70 px-2 py-1.5">
              <p className="text-zinc-500 text-xs">Database URL</p>
              <p className="mt-0.5 break-all font-mono text-xs text-zinc-700">
                {branch.databaseUrl}
              </p>
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <CopyDatabaseUrlButton databaseUrl={branch.databaseUrl} />
              <form action={deleteAction}>
                <Button type="submit" variant="destructive" size="lg">
                  <IconTrash data-icon="inline-start" />
                  Delete branch
                </Button>
              </form>
            </div>
          </article>
        )
      })}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-white/80 px-2 py-1.5">
      <dt className="text-zinc-500 text-xs">{label}</dt>
      <dd className="mt-0.5 truncate font-medium text-sm">{value || "n/a"}</dd>
    </div>
  )
}
