"use client"

import {
  IconAlertTriangle,
  IconCheck,
  IconGitBranch,
} from "@tabler/icons-react"
import { useActionState } from "react"
import {
  createServiceNeonBranch,
  type NeonBranchMutationResult,
} from "@/app/actions"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const initialResult: NeonBranchMutationResult = {
  ok: false,
  title: "",
  message: "",
  branchName: "",
  projectName: "",
  neonNamespace: "",
  error: "",
}

export function BranchForm({
  bucketName,
  defaultPgVersion,
  namespace,
  neonNamespace,
  projectName,
  serviceName,
  vaultComponent,
  vaultPath,
}: {
  bucketName: string
  defaultPgVersion: string
  namespace: string
  neonNamespace: string
  projectName: string
  serviceName: string
  vaultComponent: string
  vaultPath: string
}) {
  const action = createServiceNeonBranch.bind(
    null,
    namespace,
    serviceName,
    projectName,
  )
  const [result, formAction, isPending] = useActionState(action, initialResult)
  const hasResult = Boolean(result.title || result.error)

  return (
    <section className="rounded-md border border-zinc-200 bg-white">
      <div className="border-zinc-200 border-b p-5">
        <div className="flex items-start gap-3">
          <span className="rounded-md border border-blue-100 bg-blue-50 p-2 text-blue-700">
            <IconGitBranch className="size-5" />
          </span>
          <div>
            <h2 className="font-semibold text-xl">Create branch</h2>
            <p className="mt-1 max-w-2xl text-sm text-zinc-600">
              Add a Neon Branch CR to this project. The operator will reconcile
              compute for the new branch.
            </p>
          </div>
        </div>
      </div>

      <form action={formAction} className="space-y-5 p-5">
        <input type="hidden" name="neonNamespace" value={neonNamespace} />
        <input type="hidden" name="bucketName" value={bucketName} />
        <input type="hidden" name="vaultComponent" value={vaultComponent} />
        <input type="hidden" name="vaultPath" value={vaultPath} />

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5">
            <span className="font-medium text-sm">Branch name</span>
            <input
              name="branchName"
              placeholder="feature-branch"
              pattern="[a-z0-9]([-a-z0-9]*[a-z0-9])?"
              maxLength={63}
              required
              className={inputClassName}
            />
            <span className="block text-zinc-500 text-xs">
              Kubernetes name for the Neon Branch resource.
            </span>
          </label>

          <label className="space-y-1.5">
            <span className="font-medium text-sm">Postgres version</span>
            <select
              name="pgVersion"
              defaultValue={defaultPgVersion || "17"}
              className={inputClassName}
            >
              <option value="17">PostgreSQL 17</option>
              <option value="16">PostgreSQL 16</option>
              <option value="15">PostgreSQL 15</option>
              <option value="14">PostgreSQL 14</option>
            </select>
            <span className="block text-zinc-500 text-xs">
              Version passed to the branch spec.
            </span>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-zinc-100 bg-zinc-50 px-4 py-3">
          <p className="truncate text-zinc-600 text-xs">
            Project <span className="font-mono">{projectName}</span> in{" "}
            <span className="font-mono">{neonNamespace}</span>
          </p>
          <Button type="submit" size="lg" disabled={isPending}>
            <IconGitBranch data-icon="inline-start" />
            {isPending ? "Creating..." : "Create branch"}
          </Button>
        </div>

        {hasResult ? (
          <div
            className={cn(
              "rounded-md border px-3 py-2",
              result.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                : "border-red-200 bg-red-50 text-red-950",
            )}
          >
            <div className="flex items-start gap-2">
              {result.ok ? (
                <IconCheck className="mt-0.5 size-4 shrink-0" />
              ) : (
                <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
              )}
              <div>
                <p className="font-medium text-sm">{result.title}</p>
                <p className="mt-1 text-xs">{result.error || result.message}</p>
              </div>
            </div>
          </div>
        ) : null}
      </form>
    </section>
  )
}

const inputClassName =
  "h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
