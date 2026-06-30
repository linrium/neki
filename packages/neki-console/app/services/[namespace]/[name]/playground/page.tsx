import {
  IconApi,
  IconCheck,
  IconRoute,
  IconSend,
  IconTopologyStar,
} from "@tabler/icons-react"
import type { ComponentType } from "react"
import { getServiceDetail } from "@/app/actions"
import { PlaygroundForm } from "@/app/playground/playground-form"
import { getPlaygroundPresetsForService } from "@/app/playground/presets"
import { ServicePageFrame } from "../_components"

export const dynamic = "force-dynamic"

type ServicePlaygroundPageProps = {
  params: Promise<{
    namespace: string
    name: string
  }>
}

const kongBaseUrl = process.env.KONG_BASE_URL || "http://localhost:8080"

export default async function ServicePlaygroundPage({
  params,
}: ServicePlaygroundPageProps) {
  const { namespace, name } = await params
  const detail = await getServiceDetail(namespace, name)
  const presets = getPlaygroundPresetsForService(name)
  const primaryKind = presets[0]?.kind ?? "API"

  return (
    <ServicePageFrame
      activeTab="playground"
      detail={detail}
      name={name}
      namespace={namespace}
    >
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          icon={IconRoute}
          label="Route"
          value={`/api/functions/${name}`}
        />
        <MetricTile
          icon={IconSend}
          label="Presets"
          value={String(presets.length)}
        />
        <MetricTile icon={IconTopologyStar} label="Mode" value={primaryKind} />
        <MetricTile
          icon={IconApi}
          label="Gateway"
          value={formatGateway(kongBaseUrl)}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)]">
        <aside className="space-y-3">
          <SectionHeader
            title={`${primaryKind} presets`}
            description="Service-specific requests based on the example invoke documentation."
          />
          <div className="grid gap-3">
            {presets.map((preset) => (
              <PresetCard key={preset.id} preset={preset} />
            ))}
          </div>
        </aside>

        <div className="space-y-3">
          <SectionHeader
            title="Request builder"
            description={`Trigger ${namespace}/${name} through Kong and inspect the response inline.`}
          />
          <PlaygroundForm
            functionLocked
            kongBaseUrl={kongBaseUrl}
            presets={presets}
          />
        </div>
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
          <p className="mt-2 truncate font-semibold text-lg">{value}</p>
        </div>
        <span className="rounded-md border border-zinc-200 bg-zinc-50 p-2 text-zinc-600">
          <Icon className="size-4" />
        </span>
      </div>
    </div>
  )
}

function SectionHeader({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div>
      <h2 className="font-semibold text-lg">{title}</h2>
      <p className="text-sm text-zinc-600">{description}</p>
    </div>
  )
}

function PresetCard({
  preset,
}: {
  preset: ReturnType<typeof getPlaygroundPresetsForService>[number]
}) {
  return (
    <article className="rounded-md border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium text-sm">{preset.title}</h3>
            <span className="rounded-sm bg-blue-50 px-1.5 py-0.5 font-medium text-[0.68rem] text-blue-700">
              {preset.kind}
            </span>
          </div>
          <p className="mt-1 text-zinc-500 text-xs">{preset.description}</p>
        </div>
        <span className="rounded-sm bg-zinc-100 px-1.5 py-0.5 font-medium text-[0.68rem] text-zinc-600">
          {preset.method}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-sm bg-zinc-50 px-2 py-1.5">
          <dt className="text-zinc-500">Function</dt>
          <dd className="mt-0.5 truncate font-medium text-zinc-800">
            {preset.service}
          </dd>
        </div>
        <div className="rounded-sm bg-zinc-50 px-2 py-1.5">
          <dt className="text-zinc-500">Path</dt>
          <dd className="mt-0.5 truncate font-medium text-zinc-800">
            {preset.path}
          </dd>
        </div>
      </dl>
      <div className="mt-3 flex items-center gap-2 text-zinc-500 text-xs">
        <IconCheck className="size-3.5 text-emerald-600" />
        Ready for this service route
      </div>
    </article>
  )
}

function formatGateway(value: string) {
  return value.replace(/^https?:\/\//, "")
}
