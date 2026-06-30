"use client"

import {
  IconAlertTriangle,
  IconCheck,
  IconDatabase,
  IconKey,
  IconRefresh,
  IconServerBolt,
  IconShieldLock,
} from "@tabler/icons-react"
import type { ComponentType, ReactNode } from "react"
import { useActionState } from "react"
import {
  createServicePostgres,
  type PostgresProvisionResult,
} from "@/app/actions"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const initialResult: PostgresProvisionResult = {
  ok: false,
  title: "",
  message: "",
  clusterName: "",
  database: "",
  username: "",
  vaultComponent: "",
  vaultSecretName: "",
  vaultPath: "",
  cnpgSecretName: "",
  serviceReloadedAt: "",
  steps: [],
  error: "",
}

export function PostgresForm({
  defaultVaultComponent,
  namespace,
  serviceName,
}: {
  defaultVaultComponent: string
  namespace: string
  serviceName: string
}) {
  const action = createServicePostgres.bind(null, namespace, serviceName)
  const [result, formAction, isPending] = useActionState(action, initialResult)
  const defaultClusterName = `${serviceName}-postgres`

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="rounded-md border border-zinc-200 bg-white">
        <div className="border-zinc-200 border-b p-5">
          <div className="flex items-start gap-3">
            <span className="rounded-md border border-blue-100 bg-blue-50 p-2 text-blue-700">
              <IconDatabase className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold text-xl">Create managed Postgres</h2>
              <p className="mt-1 max-w-2xl text-sm text-zinc-600">
                Provision a CloudNativePG cluster for this Knative service,
                generate a strong database password, store it in the linked Dapr
                Vault secret store, and roll a fresh service pod.
              </p>
            </div>
          </div>
        </div>

        <form action={formAction} className="space-y-6 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              description="Kubernetes name for the CloudNativePG Cluster."
              label="Postgres cluster"
            >
              <input
                name="clusterName"
                defaultValue={defaultClusterName}
                pattern="[a-z0-9]([-a-z0-9]*[a-z0-9])?"
                maxLength={63}
                required
                className={inputClassName}
              />
            </Field>
            <Field
              description="Initial database created by CloudNativePG."
              label="Database"
            >
              <input
                name="database"
                defaultValue="app"
                pattern="[A-Za-z_][A-Za-z0-9_]*"
                maxLength={63}
                required
                className={inputClassName}
              />
            </Field>
            <Field
              description="Owner role. The password is generated on submit."
              label="Username"
            >
              <input
                name="username"
                defaultValue="app"
                pattern="[A-Za-z_][A-Za-z0-9_]*"
                maxLength={63}
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
            <Field
              description="Single-node is best for local examples."
              label="Instances"
            >
              <select
                name="instances"
                defaultValue="1"
                className={inputClassName}
              >
                <option value="1">1 instance</option>
                <option value="2">2 instances</option>
                <option value="3">3 instances</option>
              </select>
            </Field>
            <Field
              description="PersistentVolumeClaim size for the cluster."
              label="Storage"
            >
              <input
                name="storageSize"
                defaultValue="1Gi"
                pattern="[1-9][0-9]*(Mi|Gi|Ti)"
                required
                className={inputClassName}
              />
            </Field>
            <Field
              description="CloudNativePG image tag."
              label="Postgres version"
            >
              <select
                name="postgresVersion"
                defaultValue="16"
                className={inputClassName}
              >
                <option value="16">PostgreSQL 16</option>
                <option value="15">PostgreSQL 15</option>
              </select>
            </Field>
          </div>

          <div className="rounded-md border border-blue-100 bg-blue-50 p-4">
            <div className="flex gap-3">
              <IconShieldLock className="mt-0.5 size-4 shrink-0 text-blue-700" />
              <div>
                <h3 className="font-medium text-blue-950 text-sm">
                  Password handling
                </h3>
                <p className="mt-1 text-blue-900 text-xs">
                  The server action generates a random password, writes it to
                  Vault using the Dapr component token, creates the CNPG
                  bootstrap secret, and does not return the password to the
                  browser.
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
              {isPending ? "Provisioning..." : "Create Postgres"}
            </Button>
          </div>
        </form>
      </section>

      <aside className="space-y-4">
        <InfoCard
          icon={IconServerBolt}
          title="What gets created"
          items={[
            "CloudNativePG Cluster",
            "CNPG bootstrap Secret",
            "Vault KV v2 credentials",
            "Knative template reload",
          ]}
        />
        <InfoCard
          icon={IconKey}
          title="Vault payload keys"
          items={[
            "postgresHost",
            "postgresPort",
            "postgresDatabase",
            "postgresUsername",
            "postgresPassword",
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
  result: PostgresProvisionResult
}) {
  const hasResult = Boolean(result.title || result.error)

  return (
    <section className="rounded-md border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm">Provisioning result</h3>
          <p className="mt-1 text-sm text-zinc-600">
            The generated password is intentionally not displayed.
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
          <IconDatabase className="mx-auto size-6 animate-pulse text-zinc-400" />
          <p className="mt-3 font-medium text-sm">
            Creating Postgres and writing Vault...
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
              <Fact label="Cluster" value={result.clusterName} />
              <Fact label="Vault path" value={result.vaultPath} />
              <Fact label="Bootstrap secret" value={result.cnpgSecretName} />
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
          <IconKey className="mx-auto size-6 text-zinc-400" />
          <p className="mt-3 font-medium text-sm">
            Ready to generate credentials
          </p>
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
