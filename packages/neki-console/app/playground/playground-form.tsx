"use client"

import Editor from "@monaco-editor/react"
import {
  IconAlertTriangle,
  IconCheck,
  IconClock,
  IconCode,
  IconListDetails,
  IconPlayerPlay,
  IconRoute,
} from "@tabler/icons-react"
import type { editor } from "monaco-editor"
import { useActionState, useEffect, useMemo, useState } from "react"
import { type PlaygroundResult, triggerKongFunction } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { PlaygroundPreset } from "./presets"

const initialResult: PlaygroundResult = {
  ok: false,
  status: 0,
  statusText: "",
  url: "",
  method: "POST",
  durationMs: 0,
  responseBody: "",
  responseHeaders: [],
  error: "",
}

export function PlaygroundForm({
  functionLocked = false,
  kongBaseUrl,
  presets,
}: {
  functionLocked?: boolean
  kongBaseUrl: string
  presets: PlaygroundPreset[]
}) {
  const [selectedPresetId, setSelectedPresetId] = useState(presets[0]?.id ?? "")
  const selectedPreset = useMemo(
    () =>
      presets.find((preset) => preset.id === selectedPresetId) ?? presets[0],
    [presets, selectedPresetId],
  )
  const [body, setBody] = useState(getPresetBody(selectedPreset))
  const [result, formAction, isPending] = useActionState(
    triggerKongFunction,
    initialResult,
  )

  useEffect(() => {
    setBody(getPresetBody(selectedPreset))
  }, [selectedPreset])

  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4">
      <form action={formAction} className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1.5">
            <span className="font-medium text-sm">Preset</span>
            <select
              value={selectedPresetId}
              onChange={(event) => setSelectedPresetId(event.target.value)}
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            >
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.title}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="font-medium text-sm">Kong base URL</span>
            <input
              name="kongBaseUrl"
              defaultValue={kongBaseUrl}
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 font-mono text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-[140px_minmax(0,1fr)_minmax(0,1fr)]">
          <label className="space-y-1.5">
            <span className="font-medium text-sm">Method</span>
            <select
              name="method"
              key={`${selectedPreset.id}-method`}
              defaultValue={selectedPreset.method}
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="font-medium text-sm">Function</span>
            <input
              name="functionName"
              key={`${selectedPreset.id}-function`}
              defaultValue={selectedPreset.service}
              readOnly={functionLocked}
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 font-mono text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </label>
          <label className="space-y-1.5">
            <span className="font-medium text-sm">Path</span>
            <input
              name="path"
              key={`${selectedPreset.id}-path`}
              defaultValue={selectedPreset.path}
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 font-mono text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </label>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium text-sm">JSON body</span>
            <span className="text-zinc-500 text-xs">
              Monaco editor · submitted as request body
            </span>
          </div>
          <input type="hidden" name="body" value={body} />
          <div className="overflow-hidden rounded-md border border-zinc-200">
            <Editor
              height="300px"
              language="json"
              theme="vs-dark"
              value={body}
              onChange={(value) => setBody(value ?? "")}
              options={editorOptions}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2 text-zinc-600 text-xs">
            <IconRoute className="size-4 shrink-0" />
            <span className="truncate font-mono">
              {kongBaseUrl}/api/functions/{selectedPreset.service}
              {selectedPreset.path}
            </span>
          </div>
          <Button type="submit" size="lg" disabled={isPending}>
            <IconPlayerPlay data-icon="inline-start" />
            {isPending ? "Triggering..." : "Trigger function"}
          </Button>
        </div>
      </form>

      <ResponsePanel result={result} isPending={isPending} />
    </div>
  )
}

function ResponsePanel({
  result,
  isPending,
}: {
  result: PlaygroundResult
  isPending: boolean
}) {
  const hasResult = Boolean(result.url || result.error)

  return (
    <section className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-lg">Response</h3>
          <p className="text-sm text-zinc-600">
            Status, timing, headers, and body returned by Kong.
          </p>
        </div>
        {hasResult ? (
          <StatusPill
            ok={result.ok}
            label={result.error || result.statusText}
          />
        ) : null}
      </div>

      {isPending ? (
        <div className="mt-4 rounded-md border border-dashed border-zinc-300 bg-white px-4 py-10 text-center">
          <IconClock className="mx-auto size-6 animate-pulse text-zinc-400" />
          <p className="mt-3 font-medium text-sm">
            Waiting for Kong response...
          </p>
        </div>
      ) : hasResult ? (
        <div className="mt-4 space-y-4">
          {result.error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-red-950">
              <div className="flex gap-3">
                <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
                <p className="text-sm">{result.error}</p>
              </div>
            </div>
          ) : (
            <dl className="grid gap-3 sm:grid-cols-3">
              <Fact
                label="Status"
                value={`${result.status} ${result.statusText}`}
              />
              <Fact label="Duration" value={`${result.durationMs}ms`} />
              <Fact label="Method" value={result.method} />
            </dl>
          )}

          {result.url ? (
            <div className="rounded-md border border-zinc-200 bg-white px-3 py-2">
              <p className="text-zinc-500 text-xs">Request URL</p>
              <p className="mt-1 truncate font-mono text-sm">{result.url}</p>
            </div>
          ) : null}

          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-zinc-600 text-xs">
                <IconListDetails className="size-4" />
                Headers
              </div>
              <HeaderList headers={result.responseHeaders} />
            </div>

            <div>
              <div className="mb-2 flex items-center gap-2 text-zinc-600 text-xs">
                <IconCode className="size-4" />
                Body
              </div>
              <ResponseBodyView body={result.responseBody} />
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-md border border-dashed border-zinc-300 bg-white px-4 py-10 text-center">
          <IconPlayerPlay className="mx-auto size-6 text-zinc-400" />
          <p className="mt-3 font-medium text-sm">
            Trigger a function to inspect the response
          </p>
        </div>
      )}
    </section>
  )
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 font-medium text-xs",
        ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700",
      )}
    >
      {ok ? (
        <IconCheck className="size-3.5" />
      ) : (
        <IconAlertTriangle className="size-3.5" />
      )}
      {label}
    </span>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-zinc-200 bg-white px-3 py-2">
      <dt className="text-zinc-500 text-xs">{label}</dt>
      <dd className="mt-1 truncate font-medium text-sm text-zinc-800">
        {value}
      </dd>
    </div>
  )
}

function HeaderList({
  headers,
}: {
  headers: Array<{ key: string; value: string }>
}) {
  if (headers.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 bg-white px-3 py-6 text-center text-zinc-500 text-xs">
        No response headers
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded-md border border-zinc-200 bg-white">
      <div className="grid grid-cols-[minmax(160px,0.35fr)_minmax(0,1fr)] border-zinc-200 border-b bg-zinc-100/70 px-3 py-2 font-medium text-zinc-500 text-xs">
        <span>Name</span>
        <span>Value</span>
      </div>
      <div className="max-h-64 divide-y divide-zinc-100 overflow-auto">
        {headers.map((header) => (
          <div
            key={header.key}
            className="grid grid-cols-[minmax(160px,0.35fr)_minmax(0,1fr)] gap-3 px-3 py-2 text-xs"
          >
            <span className="break-words font-mono font-medium text-zinc-700">
              {header.key}
            </span>
            <span className="break-words font-mono text-zinc-500">
              {header.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ResponseBodyView({ body }: { body: string }) {
  if (!body) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 bg-white px-3 py-8 text-center text-zinc-500 text-xs">
        No response body
      </p>
    )
  }

  const parsed = parseJson(body)

  if (parsed.ok) {
    return (
      <div className="max-h-[560px] overflow-auto rounded-md border border-zinc-200 bg-white p-3">
        <JsonValue value={parsed.value} />
      </div>
    )
  }

  return (
    <pre className="max-h-[560px] overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-[0.76rem] text-zinc-100">
      <code>{body}</code>
    </pre>
  )
}

function JsonValue({ value }: { value: unknown }) {
  if (value === null) {
    return <span className="font-mono text-zinc-500 text-xs">null</span>
  }

  if (Array.isArray(value)) {
    return (
      <div className="space-y-1 font-mono text-xs">
        <span className="text-zinc-500">[</span>
        <div className="space-y-1 border-zinc-100 border-l pl-4">
          {value.map((item, index) => (
            <div key={`${index}-${JSON.stringify(item).slice(0, 32)}`}>
              <span className="mr-2 text-zinc-400">{index}</span>
              <JsonValue value={item} />
            </div>
          ))}
        </div>
        <span className="text-zinc-500">]</span>
      </div>
    )
  }

  if (typeof value === "object") {
    return (
      <div className="space-y-1 font-mono text-xs">
        <span className="text-zinc-500">{"{"}</span>
        <div className="space-y-1 border-zinc-100 border-l pl-4">
          {Object.entries(value as Record<string, unknown>).map(
            ([key, item]) => (
              <div
                key={key}
                className="grid gap-2 sm:grid-cols-[minmax(120px,0.35fr)_minmax(0,1fr)]"
              >
                <span className="break-words text-blue-700">{key}</span>
                <span className="min-w-0 break-words">
                  <JsonValue value={item} />
                </span>
              </div>
            ),
          )}
        </div>
        <span className="text-zinc-500">{"}"}</span>
      </div>
    )
  }

  if (typeof value === "string") {
    return <span className="font-mono text-emerald-700 text-xs">"{value}"</span>
  }

  if (typeof value === "number") {
    return <span className="font-mono text-violet-700 text-xs">{value}</span>
  }

  return (
    <span className="font-mono text-amber-700 text-xs">{String(value)}</span>
  )
}

function parseJson(
  value: string,
): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) }
  } catch {
    return { ok: false }
  }
}

function getPresetBody(preset: PlaygroundPreset | undefined) {
  if (!preset || preset.body === null) {
    return ""
  }

  return JSON.stringify(preset.body, null, 2)
}

const editorOptions: editor.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 12,
  lineNumbers: "on",
  tabSize: 2,
  wordWrap: "on",
}
