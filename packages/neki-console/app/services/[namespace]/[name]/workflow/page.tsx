import { IconAlertTriangle } from "@tabler/icons-react"
import { getServiceDetail } from "@/app/actions"
import { ServicePageFrame } from "../_components"
import pubsubWorkflow from "./data/dapr-knative-pubsub.json"
import daprWorkflow from "./data/dapr-workflow.json"
import { type WorkflowDefinition, WorkflowFlow } from "./workflow-flow"

export const dynamic = "force-dynamic"

type ServiceWorkflowPageProps = {
  params: Promise<{
    namespace: string
    name: string
  }>
}

const workflows = [daprWorkflow, pubsubWorkflow] as WorkflowDefinition[]

export default async function ServiceWorkflowPage({
  params,
}: ServiceWorkflowPageProps) {
  const { namespace, name } = await params
  const detail = await getServiceDetail(namespace, name)
  const workflow = workflows.find((candidate) => candidate.serviceName === name)

  return (
    <ServicePageFrame
      activeTab="workflow"
      detail={detail}
      name={name}
      namespace={namespace}
    >
      {workflow ? (
        <WorkflowFlow workflow={workflow} />
      ) : (
        <section className="rounded-md border border-dashed border-zinc-300 bg-white px-4 py-12 text-center">
          <IconAlertTriangle className="mx-auto size-6 text-zinc-400" />
          <h2 className="mt-3 font-semibold text-lg">No static workflow yet</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm text-zinc-600">
            Static workflow graphs are currently available for dapr-workflow and
            dapr-knative-pubsub.
          </p>
        </section>
      )}
    </ServicePageFrame>
  )
}
