import {
  IconEye,
  IconKey,
  IconListDetails,
  IconShieldLock,
} from "@tabler/icons-react"
import type { ComponentType } from "react"
import { getServiceDetail } from "@/app/actions"
import { Badge } from "@/components/ui/badge"
import { ServicePageFrame } from "../_components"
import { SecretsForm } from "./secrets-form"

export const dynamic = "force-dynamic"

type ServiceSecretsPageProps = {
  params: Promise<{
    namespace: string
    name: string
  }>
}

export default async function ServiceSecretsPage({
  params,
}: ServiceSecretsPageProps) {
  const { namespace, name } = await params
  const detail = await getServiceDetail(namespace, name)
  const service = detail.service

  if (!service) {
    return (
      <ServicePageFrame
        activeTab="secrets"
        detail={detail}
        name={name}
        namespace={namespace}
      >
        <span />
      </ServicePageFrame>
    )
  }
  const vaultComponents = detail.relatedDaprResources
    .filter(
      (resource) =>
        resource.kind === "Component" &&
        resource.detail === "secretstores.hashicorp.vault",
    )
    .map((resource) => resource.name)
    .sort((left, right) => left.localeCompare(right))
  const defaultVaultComponent = vaultComponents[0] ?? "vault"
  const defaultSecretName =
    detail.annotations.find(
      (annotation) => annotation.key === "neki.dev/postgres-vault-secret",
    )?.value ?? service.name

  return (
    <ServicePageFrame
      activeTab="secrets"
      detail={detail}
      name={name}
      namespace={namespace}
    >
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          icon={IconShieldLock}
          label="Secret store"
          value={defaultVaultComponent}
        />
        <MetricTile
          icon={IconKey}
          label="Default secret"
          value={defaultSecretName}
        />
        <MetricTile
          icon={IconListDetails}
          label="Vault components"
          value={String(vaultComponents.length)}
        />
        <MetricTile icon={IconEye} label="Reveal mode" value="On demand" />
      </section>

      {vaultComponents.length === 0 ? (
        <section className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="warning">Vault component not detected</Badge>
            <p className="text-sm">
              The loader defaults to component{" "}
              <span className="font-mono">vault</span>. Loading will fail unless
              that Dapr Vault component exists in{" "}
              <span className="font-mono">{namespace}</span>.
            </p>
          </div>
        </section>
      ) : null}

      <SecretsForm
        defaultSecretName={defaultSecretName}
        defaultVaultComponent={defaultVaultComponent}
        namespace={namespace}
        serviceName={name}
        vaultComponents={vaultComponents}
      />
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
