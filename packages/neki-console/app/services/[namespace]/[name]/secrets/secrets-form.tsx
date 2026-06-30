"use client"

import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconKey,
  IconRefresh,
  IconShieldLock,
} from "@tabler/icons-react"
import type { ReactNode } from "react"
import { useActionState, useState } from "react"
import { loadServiceSecrets, type SecretReadResult } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const initialResult: SecretReadResult = {
  ok: false,
  title: "",
  message: "",
  namespace: "",
  serviceName: "",
  vaultComponent: "",
  secretName: "",
  vaultPath: "",
  loadedAt: "",
  entries: [],
  error: "",
}

export function SecretsForm({
  defaultSecretName,
  defaultVaultComponent,
  namespace,
  serviceName,
  vaultComponents,
}: {
  defaultSecretName: string
  defaultVaultComponent: string
  namespace: string
  serviceName: string
  vaultComponents: string[]
}) {
  const action = loadServiceSecrets.bind(null, namespace, serviceName)
  const [result, formAction, isPending] = useActionState(action, initialResult)
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())
  const [showAll, setShowAll] = useState(false)
  const [copiedKey, setCopiedKey] = useState("")

  function toggleKey(key: string) {
    setRevealedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  async function copyValue(key: string, value: string) {
    await navigator.clipboard.writeText(value)
    setCopiedKey(key)
    window.setTimeout(() => setCopiedKey(""), 1600)
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)]">
      <section className="rounded-md border border-zinc-200 bg-white">
        <div className="border-zinc-200 border-b p-5">
          <div className="flex items-start gap-3">
            <span className="rounded-md border border-blue-100 bg-blue-50 p-2 text-blue-700">
              <IconShieldLock className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold text-xl">Load Vault secret</h2>
              <p className="mt-1 max-w-2xl text-sm text-zinc-600">
                Read a KV v2 secret through the Dapr HashiCorp Vault component
                configured in this namespace. Values stay masked until you
                reveal or copy them.
              </p>
            </div>
          </div>
        </div>

        <form action={formAction} className="space-y-6 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              description="Dapr component that contains vaultAddr and vaultToken metadata."
              label="Dapr Vault component"
            >
              <input
                name="vaultComponent"
                defaultValue={defaultVaultComponent}
                list="vault-components"
                pattern="[a-z0-9]([-a-z0-9]*[a-z0-9])?"
                maxLength={63}
                required
                className={inputClassName}
              />
              <datalist id="vault-components">
                {vaultComponents.map((component) => (
                  <option key={component} value={component} />
                ))}
              </datalist>
            </Field>
            <Field
              description="Vault KV path after the component prefix is applied."
              label="Secret name"
            >
              <input
                name="secretName"
                defaultValue={defaultSecretName}
                pattern="[A-Za-z0-9][A-Za-z0-9._/-]{0,126}[A-Za-z0-9]"
                required
                className={inputClassName}
              />
            </Field>
          </div>

          <div className="rounded-md border border-amber-100 bg-amber-50 p-4">
            <div className="flex gap-3">
              <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" />
              <div>
                <h3 className="font-medium text-amber-950 text-sm">
                  Sensitive data
                </h3>
                <p className="mt-1 text-amber-900 text-xs">
                  Only load secrets when you need to debug this service. Avoid
                  pasting revealed values into issue trackers, logs, or chat.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-zinc-100 bg-zinc-50 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2 text-zinc-600 text-xs">
              <IconKey className="size-4 shrink-0" />
              <span className="truncate">
                Reads secrets for {namespace}/{serviceName}.
              </span>
            </div>
            <Button type="submit" size="lg" disabled={isPending}>
              <IconRefresh data-icon="inline-start" />
              {isPending ? "Loading..." : "Load secret"}
            </Button>
          </div>
        </form>
      </section>

      <section className="rounded-md border border-zinc-200 bg-white">
        <div className="flex flex-col gap-3 border-zinc-200 border-b p-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-semibold text-xl">Secret values</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Masked by default with per-value reveal and copy controls.
            </p>
          </div>
          {result.entries.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll ? (
                <IconEyeOff data-icon="inline-start" />
              ) : (
                <IconEye data-icon="inline-start" />
              )}
              {showAll ? "Hide all" : "Reveal all"}
            </Button>
          ) : null}
        </div>

        <div className="space-y-4 p-5">
          <ResultStatus result={result} isPending={isPending} />
          <dl className="grid gap-3">
            {result.entries.map((entry) => {
              const revealed = showAll || revealedKeys.has(entry.key)
              return (
                <div
                  key={entry.key}
                  className="rounded-md border border-zinc-200 bg-zinc-50 p-3"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <dt className="font-medium text-sm">{entry.key}</dt>
                      <dd className="mt-1 text-zinc-500 text-xs">
                        {entry.size} bytes
                      </dd>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => toggleKey(entry.key)}
                      >
                        {revealed ? (
                          <IconEyeOff data-icon="inline-start" />
                        ) : (
                          <IconEye data-icon="inline-start" />
                        )}
                        {revealed ? "Hide" : "Reveal"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => copyValue(entry.key, entry.value)}
                      >
                        {copiedKey === entry.key ? (
                          <IconCheck data-icon="inline-start" />
                        ) : (
                          <IconCopy data-icon="inline-start" />
                        )}
                        {copiedKey === entry.key ? "Copied" : "Copy"}
                      </Button>
                    </div>
                  </div>
                  <pre
                    className={cn(
                      "mt-3 overflow-x-auto rounded-sm border px-3 py-2 font-mono text-xs",
                      revealed
                        ? "border-zinc-200 bg-white text-zinc-800"
                        : "border-zinc-200 bg-zinc-100 text-zinc-400 select-none",
                    )}
                  >
                    {revealed ? entry.value : maskValue(entry.value)}
                  </pre>
                </div>
              )
            })}
          </dl>
        </div>
      </section>
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

function ResultStatus({
  isPending,
  result,
}: {
  isPending: boolean
  result: SecretReadResult
}) {
  const hasResult = Boolean(result.title || result.error)

  if (isPending) {
    return (
      <StatusBox
        tone="blue"
        title="Loading secret..."
        message="Contacting Kubernetes and Vault."
      />
    )
  }

  if (!hasResult) {
    return (
      <StatusBox
        tone="zinc"
        title="No secret loaded"
        message="Choose a Dapr Vault component and secret name, then load values."
      />
    )
  }

  if (!result.ok) {
    return <StatusBox tone="red" title={result.title} message={result.error} />
  }

  return (
    <StatusBox
      tone={result.entries.length > 0 ? "emerald" : "amber"}
      title={result.title}
      message={`${result.message} ${result.vaultPath ? `Path: ${result.vaultPath}` : ""}`}
    />
  )
}

function StatusBox({
  message,
  title,
  tone,
}: {
  message: string
  title: string
  tone: "amber" | "blue" | "emerald" | "red" | "zinc"
}) {
  return (
    <div
      className={cn(
        "rounded-md border px-4 py-3",
        tone === "amber" && "border-amber-200 bg-amber-50 text-amber-950",
        tone === "blue" && "border-blue-200 bg-blue-50 text-blue-950",
        tone === "emerald" &&
          "border-emerald-200 bg-emerald-50 text-emerald-950",
        tone === "red" && "border-red-200 bg-red-50 text-red-950",
        tone === "zinc" && "border-zinc-200 bg-zinc-50 text-zinc-950",
      )}
    >
      <h3 className="font-medium text-sm">{title}</h3>
      <p className="mt-1 text-xs opacity-80">{message}</p>
    </div>
  )
}

function maskValue(value: string) {
  return "*".repeat(Math.min(Math.max(value.length, 12), 48))
}
