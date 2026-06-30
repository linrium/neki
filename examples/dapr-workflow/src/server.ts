import { DaprWorkflowClient, WorkflowRuntime, WorkflowRuntimeStatus } from "@dapr/dapr";
import { instrumentRequest, logError, logInfo, shutdownTelemetry } from "./telemetry";
import {
  approvalEventName,
  notifyActivity,
  orderProcessingWorkflow,
  processPaymentActivity,
  reserveInventoryActivity,
  shipOrderActivity,
  workflowName,
  type Approval,
  type Order,
} from "./workflow";

const port = Number(process.env.PORT ?? 3000);
const daprHost = process.env.DAPR_HOST ?? "127.0.0.1";
const daprGrpcPort = process.env.DAPR_GRPC_PORT ?? "50001";

const workflowClient = new DaprWorkflowClient({
  daprHost,
  daprPort: daprGrpcPort,
});

const workflowRuntime = new WorkflowRuntime({
  daprHost,
  daprPort: daprGrpcPort,
});

workflowRuntime
  .registerWorkflowWithName(workflowName, orderProcessingWorkflow)
  .registerActivityWithName("notify", notifyActivity)
  .registerActivityWithName("reserve_inventory", reserveInventoryActivity)
  .registerActivityWithName("process_payment", processPaymentActivity)
  .registerActivityWithName("ship_order", shipOrderActivity);

function text(status: number, body: string, headers: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...headers,
    },
  });
}

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function routeFor(pathname: string) {
  if (pathname === "/" || pathname === "/healthz" || pathname === "/dapr/subscribe" || pathname === "/orders") {
    return pathname;
  }

  if (/^\/orders\/[^/]+$/.test(pathname)) {
    return "/orders/:id";
  }

  if (/^\/orders\/[^/]+\/approve$/.test(pathname)) {
    return "/orders/:id/approve";
  }

  if (pathname === "/notifications") {
    return "/notifications";
  }

  return "not_found";
}

function slug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

function newOrderId(customer: string) {
  const suffix = crypto.randomUUID().slice(0, 8);
  return `order-${slug(customer) || "guest"}-${suffix}`;
}

function parseJsonString(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function workflowStatusName(status: WorkflowRuntimeStatus) {
  return WorkflowRuntimeStatus[status] ?? String(status);
}

async function workflowStateResponse(orderId: string) {
  const state = await workflowClient.getWorkflowState(orderId, true);

  if (!state) {
    return text(404, `Order not found: ${orderId}\n`);
  }

  return Response.json({
    id: state.instanceId,
    name: state.name,
    status: workflowStatusName(state.runtimeStatus),
    createdAt: state.createdAt.toISOString(),
    lastUpdatedAt: state.lastUpdatedAt.toISOString(),
    details: parseJsonString(state.serializedInput),
    customStatus: parseJsonString(state.customStatus),
    result: parseJsonString(state.serializedOutput),
    failure: state.workflowFailureDetails
      ? {
          message: state.workflowFailureDetails.getErrorMessage(),
          errorType: state.workflowFailureDetails.getErrorType(),
          stackTrace: state.workflowFailureDetails.getStackTrace(),
        }
      : undefined,
  });
}

function orderFromBody(body: unknown): Order | string {
  if (!body || typeof body !== "object") {
    return "Expected JSON body";
  }

  const candidate = body as Partial<Order>;
  if (!candidate.customer || typeof candidate.customer !== "string") {
    return "Expected customer string";
  }

  if (!Array.isArray(candidate.items) || !candidate.items.every((item) => typeof item === "string")) {
    return "Expected items string array";
  }

  if (typeof candidate.total !== "number" || !Number.isFinite(candidate.total) || candidate.total < 0) {
    return "Expected non-negative total number";
  }

  return {
    id: typeof candidate.id === "string" && candidate.id.length > 0 ? candidate.id : newOrderId(candidate.customer),
    customer: candidate.customer,
    items: candidate.items,
    total: candidate.total,
  };
}

function approvalFromBody(body: unknown): Approval | string {
  if (!body || typeof body !== "object") {
    return "Expected JSON body";
  }

  const candidate = body as Partial<Approval>;
  if (!candidate.approver || typeof candidate.approver !== "string") {
    return "Expected approver string";
  }

  if (typeof candidate.approved !== "boolean") {
    return "Expected approved boolean";
  }

  return {
    approver: candidate.approver,
    approved: candidate.approved,
  };
}

const runtimeStarted = workflowRuntime.start().then(() => {
  logInfo("Workflow runtime started", {
    "workflow.name": workflowName,
  });
});

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    const route = routeFor(url.pathname);

    return instrumentRequest(request, route, async () => {
      if (request.method === "GET" && url.pathname === "/healthz") {
        return Response.json({ ok: true });
      }

      if (request.method === "GET" && url.pathname === "/") {
        return Response.json({
          app: "dapr-workflow",
          workflow: workflowName,
          routes: ["POST /orders", "GET /orders/:id", "POST /orders/:id/approve"],
        });
      }

      if (request.method === "GET" && url.pathname === "/dapr/subscribe") {
        return Response.json([
          {
            pubsubname: process.env.PUBSUB_NAME ?? "pubsub",
            topic: process.env.NOTIFICATIONS_TOPIC ?? "order-notifications",
            route: "notifications",
          },
        ]);
      }

      if (request.method === "POST" && url.pathname === "/notifications") {
        const body = await readJson(request);
        logInfo(`NOTIFICATION RECEIVED: ${JSON.stringify(body)}`, {
          "messaging.system": "dapr",
          "messaging.destination.name": process.env.NOTIFICATIONS_TOPIC ?? "order-notifications",
        });
        return text(200, "OK\n");
      }

      if (request.method === "POST" && url.pathname === "/orders") {
        await runtimeStarted;
        const order = orderFromBody(await readJson(request));

        if (typeof order === "string") {
          return text(400, `${order}\n`);
        }

        const instanceId = await workflowClient.scheduleNewWorkflow(workflowName, order, order.id);
        logInfo(`Started order workflow ${instanceId}`, {
          "workflow.instance_id": instanceId,
          "workflow.name": workflowName,
        });

        return Response.json(
          {
            id: instanceId,
            statusUrl: `/orders/${instanceId}`,
            approvalUrl: `/orders/${instanceId}/approve`,
          },
          {
            status: 202,
            headers: {
              location: `/orders/${instanceId}`,
            },
          },
        );
      }

      const orderMatch = url.pathname.match(/^\/orders\/([^/]+)$/);
      if (request.method === "GET" && orderMatch) {
        await runtimeStarted;
        return workflowStateResponse(orderMatch[1]);
      }

      const approvalMatch = url.pathname.match(/^\/orders\/([^/]+)\/approve$/);
      if (request.method === "POST" && approvalMatch) {
        await runtimeStarted;
        const approval = approvalFromBody(await readJson(request));

        if (typeof approval === "string") {
          return text(400, `${approval}\n`);
        }

        await workflowClient.raiseEvent(approvalMatch[1], approvalEventName, approval);
        logInfo(`Approval event sent for ${approvalMatch[1]}`, {
          "workflow.instance_id": approvalMatch[1],
          "workflow.event_name": approvalEventName,
        });

        return text(200, `Approval sent for order: ${approvalMatch[1]}\n`);
      }

      return text(404, "Not found\n");
    });
  },
});

logInfo(`Listening on ${port}`);
logInfo(`Workflow gRPC endpoint ${daprHost}:${daprGrpcPort}`);

async function shutdown() {
  await workflowRuntime.stop();
  await workflowClient.stop();
  await shutdownTelemetry();
}

process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
