export type PlaygroundPreset = {
  id: string
  title: string
  service: string
  method: string
  path: string
  description: string
  body: unknown
  kind: "API" | "Workflow" | "Pub/Sub"
}

const pubsubPresets: PlaygroundPreset[] = [
  {
    id: "pubsub-widget",
    title: "Publish widget",
    service: "dapr-knative-pubsub",
    method: "POST",
    path: "/publish",
    description: "Routes a widget message through the Dapr pub/sub example.",
    kind: "Pub/Sub",
    body: {
      type: "widget",
      source: "dapr-knative-pubsub",
      data: {
        description: "Hello, Widget!",
        price: 25,
        widgetField: "widgets only",
      },
    },
  },
  {
    id: "pubsub-gadget",
    title: "Publish gadget",
    service: "dapr-knative-pubsub",
    method: "POST",
    path: "/publish",
    description: "Exercises the gadget route from the pub/sub subscription.",
    kind: "Pub/Sub",
    body: {
      type: "gadget",
      source: "dapr-knative-pubsub",
      data: {
        description: "Hello, Gadget!",
        price: 75,
        gadgetField: "gadgets only",
      },
    },
  },
  {
    id: "pubsub-product",
    title: "Publish default product",
    service: "dapr-knative-pubsub",
    method: "POST",
    path: "/publish",
    description:
      "Publishes a product that uses the fallback subscription route.",
    kind: "Pub/Sub",
    body: {
      type: "thingamajig",
      source: "dapr-knative-pubsub",
      data: {
        description: "Hello, Thingamajig!",
        price: 5,
      },
    },
  },
]

const workflowPresets: PlaygroundPreset[] = [
  {
    id: "workflow-auto",
    title: "Start auto-approved order",
    service: "dapr-workflow",
    method: "POST",
    path: "/orders",
    description:
      "Starts a workflow order that should complete without approval.",
    kind: "Workflow",
    body: {
      customer: "Casey",
      items: ["milk", "bread"],
      total: 25,
    },
  },
  {
    id: "workflow-approval",
    title: "Start order needing approval",
    service: "dapr-workflow",
    method: "POST",
    path: "/orders",
    description: "Starts a workflow order that waits for an approval event.",
    kind: "Workflow",
    body: {
      customer: "Riley",
      items: ["milk", "bread", "laptop"],
      total: 1299,
    },
  },
  {
    id: "workflow-status",
    title: "Check order status",
    service: "dapr-workflow",
    method: "GET",
    path: "/orders/order-smoke-riley-75012453",
    description: "Fetches workflow status for an order ID returned by /orders.",
    kind: "Workflow",
    body: null,
  },
  {
    id: "workflow-approve",
    title: "Approve order",
    service: "dapr-workflow",
    method: "POST",
    path: "/orders/order-smoke-riley-75012453/approve",
    description: "Raises the approval event for a waiting workflow instance.",
    kind: "Workflow",
    body: {
      approver: "Chris",
      approved: true,
    },
  },
]

const helloPresets: PlaygroundPreset[] = [
  {
    id: "hello-get",
    title: "Call hello endpoint",
    service: "hello-bun-ts",
    method: "GET",
    path: "/",
    description: "Invokes the basic Knative hello service through Kong.",
    kind: "API",
    body: null,
  },
]

export const playgroundPresets = [
  ...pubsubPresets,
  ...workflowPresets,
  ...helloPresets,
]

export function getPlaygroundPresetsForService(serviceName: string) {
  const matches = playgroundPresets.filter(
    (preset) => preset.service === serviceName,
  )

  if (matches.length > 0) {
    return matches
  }

  return [
    {
      id: `${serviceName}-get`,
      title: "GET root",
      service: serviceName,
      method: "GET",
      path: "/",
      description: "Call the function root endpoint through Kong.",
      kind: "API",
      body: null,
    },
    {
      id: `${serviceName}-post`,
      title: "POST JSON",
      service: serviceName,
      method: "POST",
      path: "/",
      description: "Send a generic JSON payload to this function.",
      kind: "API",
      body: {
        message: "Hello from Neki Console",
      },
    },
  ] satisfies PlaygroundPreset[]
}
