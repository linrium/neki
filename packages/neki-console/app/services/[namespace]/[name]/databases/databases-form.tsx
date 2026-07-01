"use client"

import {
  IconAlertTriangle,
  IconBucket,
  IconCheck,
  IconDatabase,
  IconGitBranch,
  IconKey,
  IconRefresh,
  IconServerBolt,
  IconShieldLock,
} from "@tabler/icons-react"
import type { ComponentType, ReactNode } from "react"
import { useActionState } from "react"
import {
  createServiceNeonDatabase,
  type NeonDatabaseProvisionResult,
} from "@/app/actions"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const initialResult: NeonDatabaseProvisionResult = {
  ok: false,
  title: "",
  message: "",
  neonNamespace: "",
  projectName: "",
  branchName: "",
  bucketName: "",
  database: "",
  username: "",
  vaultComponent: "",
  vaultSecretName: "",
  vaultPath: "",
  serviceReloadedAt: "",
  steps: [],
  error: "",
}

export function DatabasesForm({
  defaultVaultComponent,
  namespace,
  serviceName,
}: {
  defaultVaultComponent: string
  namespace: string
  serviceName: string
}) {
  const action = createServiceNeonDatabase.bind(null, namespace, serviceName)
  const [result, formAction, isPending] = useActionState(action, initialResult)
  const defaultProjectName = `${serviceName}-project`
  const defaultBranchName = `${serviceName}-main`
  const defaultBucketName = `neon-${serviceName}-project`

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="rounded-md border border-zinc-200 bg-white">
        <div className="border-zinc-200 border-b p-5">
          <div className="flex items-start gap-3">
            <span className="rounded-md border border-blue-100 bg-blue-50 p-2 text-blue-700">
              <IconDatabase className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold text-xl">Create Neon database</h2>
              <p className="mt-1 max-w-2xl text-sm text-zinc-600">
                Create a RustFS bucket, Neon Project, and Neon Branch for this
                Knative service, then write connection fields to the Dapr Vault
                secret read by the function.
              </p>
            </div>
          </div>
        </div>

        <form action={formAction} className="space-y-6 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              description="Namespace where the Neon operator CRs live."
              label="Neon namespace"
            >
              <input
                name="neonNamespace"
                defaultValue="neon"
                pattern="[a-z0-9]([-a-z0-9]*[a-z0-9])?"
                maxLength={63}
                required
                className={inputClassName}
              />
            </Field>
            <Field
              description="Existing Neon Cluster resource."
              label="Neon cluster"
            >
              <input
                name="neonCluster"
                defaultValue="neki-neon"
                pattern="[a-z0-9]([-a-z0-9]*[a-z0-9])?"
                maxLength={63}
                required
                className={inputClassName}
              />
            </Field>
            <Field
              description="New Neon Project resource name."
              label="Project"
            >
              <input
                name="projectName"
                defaultValue={defaultProjectName}
                pattern="[a-z0-9]([-a-z0-9]*[a-z0-9])?"
                maxLength={63}
                required
                className={inputClassName}
              />
            </Field>
            <Field description="New Neon Branch resource name." label="Branch">
              <input
                name="branchName"
                defaultValue={defaultBranchName}
                pattern="[a-z0-9]([-a-z0-9]*[a-z0-9])?"
                maxLength={63}
                required
                className={inputClassName}
              />
            </Field>
            <Field
              description="Initial database name saved to Vault."
              label="Database"
            >
              <input
                name="database"
                defaultValue="postgres"
                pattern="[A-Za-z_][A-Za-z0-9_]*"
                maxLength={63}
                required
                className={inputClassName}
              />
            </Field>
            <Field
              description="Neon compute role saved to Vault."
              label="Username"
            >
              <input
                name="username"
                defaultValue="cloud_admin"
                pattern="[A-Za-z_][A-Za-z0-9_]*"
                maxLength={63}
                required
                className={inputClassName}
              />
            </Field>
            <Field
              description="Branch Postgres major version."
              label="Postgres version"
            >
              <select
                name="pgVersion"
                defaultValue="17"
                className={inputClassName}
              >
                <option value="17">PostgreSQL 17</option>
                <option value="16">PostgreSQL 16</option>
                <option value="15">PostgreSQL 15</option>
                <option value="14">PostgreSQL 14</option>
              </select>
            </Field>
            <Field
              description="S3 bucket created in RustFS."
              label="RustFS bucket"
            >
              <input
                name="bucketName"
                defaultValue={defaultBucketName}
                pattern="[a-z0-9][a-z0-9.-]*[a-z0-9]"
                minLength={3}
                maxLength={63}
                required
                className={inputClassName}
              />
            </Field>
            <Field
              description="Namespace containing RustFS."
              label="RustFS namespace"
            >
              <input
                name="rustfsNamespace"
                defaultValue="rustfs"
                pattern="[a-z0-9]([-a-z0-9]*[a-z0-9])?"
                maxLength={63}
                required
                className={inputClassName}
              />
            </Field>
            <Field
              description="Secret with RUSTFS_ACCESS_KEY and RUSTFS_SECRET_KEY."
              label="RustFS secret"
            >
              <input
                name="rustfsSecretName"
                defaultValue="rustfs-secret"
                pattern="[a-z0-9]([-a-z0-9]*[a-z0-9])?"
                maxLength={63}
                required
                className={inputClassName}
              />
            </Field>
            <Field
              description="Internal S3-compatible RustFS endpoint."
              label="RustFS endpoint"
            >
              <input
                name="rustfsEndpoint"
                defaultValue="http://rustfs-svc.rustfs.svc.cluster.local:9000"
                required
                className={inputClassName}
              />
            </Field>
            <Field
              description="Dapr HashiCorp Vault component in this namespace."
              label="Dapr Vault component"
            >
              <input
                name="vaultComponent"
                defaultValue={defaultVaultComponent}
                pattern="[a-z0-9]([-a-z0-9]*[a-z0-9])?"
                maxLength={63}
                required
                className={inputClassName}
              />
            </Field>
            <Field
              description="Dapr secret name the service reads from Vault."
              label="Vault secret name"
            >
              <input
                name="vaultSecretName"
                defaultValue={serviceName}
                required
                className={inputClassName}
              />
            </Field>
          </div>

          <div className="rounded-md border border-blue-100 bg-blue-50 p-4">
            <div className="flex gap-3">
              <IconShieldLock className="mt-0.5 size-4 shrink-0 text-blue-700" />
              <div>
                <h3 className="font-medium text-blue-950 text-sm">
                  Vault payload
                </h3>
                <p className="mt-1 text-blue-900 text-xs">
                  The server action writes the Neon host, port, database,
                  username, empty local password, database URL, project, branch,
                  and RustFS bucket into the existing Dapr Vault secret.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-zinc-100 bg-zinc-50 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2 text-zinc-600 text-xs">
              <IconRefresh className="size-4 shrink-0" />
              <span className="truncate">
                Rolls {namespace}/{serviceName} after the Vault write.
              </span>
            </div>
            <Button type="submit" size="lg" disabled={isPending}>
              <IconDatabase data-icon="inline-start" />
              {isPending ? "Provisioning..." : "Create database"}
            </Button>
          </div>
        </form>
      </section>

      <aside className="space-y-4">
        <InfoCard
          icon={IconServerBolt}
          title="What gets created"
          items={[
            "RustFS bucket job",
            "Neon Project",
            "Neon Branch",
            "Vault KV v2 connection",
            "Knative template reload",
          ]}
        />
        <InfoCard
          icon={IconKey}
          title="Vault payload keys"
          items={[
            "DATABASE_URL",
            "postgresHost",
            "postgresPort",
            "postgresDatabase",
            "postgresUsername",
            "postgresPassword",
            "neonProject",
            "neonBranch",
            "rustfsBucket",
          ]}
        />
        <ResultPanel result={result} isPending={isPending} />
      </aside>
    </div>
  )
}

const inputClassName =
  "h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"

function Field({
  children,
  description,
  label,
}: {
  children: ReactNode
  description: string
  label: string
}) {
  return (
    <div className="space-y-1.5">
      <span className="font-medium text-sm">{label}</span>
      {children}
      <span className="block text-zinc-500 text-xs">{description}</span>
    </div>
  )
}

function InfoCard({
  icon: Icon,
  items,
  title,
}: {
  icon: ComponentType<{ className?: string }>
  items: string[]
  title: string
}) {
  return (
    <section className="rounded-md border border-zinc-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <span className="rounded-md border border-zinc-200 bg-zinc-50 p-2 text-zinc-600">
          <Icon className="size-4" />
        </span>
        <h3 className="font-semibold text-sm">{title}</h3>
      </div>
      <div className="mt-3 grid gap-2">
        {items.map((item) => (
          <div
            key={item}
            className="flex items-center gap-2 text-zinc-600 text-xs"
          >
            <IconCheck className="size-3.5 text-emerald-600" />
            {item}
          </div>
        ))}
      </div>
    </section>
  )
}

function ResultPanel({
  isPending,
  result,
}: {
  isPending: boolean
  result: NeonDatabaseProvisionResult
}) {
  const hasResult = Boolean(result.title || result.error)

  return (
    <section className="rounded-md border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm">Provisioning result</h3>
          <p className="mt-1 text-sm text-zinc-600">
            Connection secrets stay in Vault and are not displayed.
          </p>
        </div>
        {hasResult ? (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 font-medium text-xs",
              result.ok
                ? "bg-emerald-50 text-emerald-700"
                : "bg-red-50 text-red-700",
            )}
          >
            {result.ok ? (
              <IconCheck className="size-3.5" />
            ) : (
              <IconAlertTriangle className="size-3.5" />
            )}
            {result.ok ? "Created" : "Failed"}
          </span>
        ) : null}
      </div>

      {isPending ? (
        <div className="mt-4 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-center">
          <IconBucket className="mx-auto size-6 animate-pulse text-zinc-400" />
          <p className="mt-3 font-medium text-sm">
            Creating RustFS bucket and Neon branch...
          </p>
        </div>
      ) : hasResult ? (
        <div className="mt-4 space-y-3">
          <div
            className={cn(
              "rounded-md border px-3 py-2",
              result.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                : "border-red-200 bg-red-50 text-red-950",
            )}
          >
            <p className="font-medium text-sm">{result.title}</p>
            <p className="mt-1 text-xs">{result.error || result.message}</p>
          </div>

          {result.ok ? (
            <div className="space-y-2">
              <Fact label="Project" value={result.projectName} />
              <Fact label="Branch" value={result.branchName} />
              <Fact label="RustFS bucket" value={result.bucketName} />
              <Fact label="Vault path" value={result.vaultPath} />
              {result.steps.map((step) => (
                <div
                  key={step.label}
                  className="rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs"
                >
                  <p className="font-medium text-zinc-800">{step.label}</p>
                  <p className="mt-0.5 text-zinc-600">{step.detail}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-center">
          <IconGitBranch className="mx-auto size-6 text-zinc-400" />
          <p className="mt-3 font-medium text-sm">Ready to create a branch</p>
        </div>
      )}
    </section>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2">
      <dt className="text-zinc-500 text-xs">{label}</dt>
      <dd className="mt-1 break-all font-medium text-sm text-zinc-800">
        {value}
      </dd>
    </div>
  )
}
