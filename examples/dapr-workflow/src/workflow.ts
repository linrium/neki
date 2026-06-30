import type { Task, TWorkflow, WorkflowActivityContext, WorkflowContext } from "@dapr/dapr";
import { logError, logInfo } from "./telemetry";

export const workflowName = "order_processing_workflow";
export const approvalEventName = "manager_approval";

const daprHttpPort = Number(process.env.DAPR_HTTP_PORT ?? 3500);
const pubsubName = process.env.PUBSUB_NAME ?? "pubsub";
const topicName = process.env.NOTIFICATIONS_TOPIC ?? "order-notifications";
const publishUrl = `http://127.0.0.1:${daprHttpPort}/v1.0/publish/${pubsubName}/${topicName}`;

export type Order = {
  id: string;
  customer: string;
  items: string[];
  total: number;
};

export type Approval = {
  approver: string;
  approved: boolean;
};

export type OrderResult = {
  id: string;
  message: string;
  success: boolean;
};

type Notification = {
  orderId: string;
  message: string;
  workflowInstanceId?: string;
};

async function publishNotification(notification: Notification) {
  const response = await fetch(publishUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...notification,
      timestamp: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Dapr notification publish failed: ${response.status} ${body}`);
  }

  logInfo(`NOTIFY ${notification.orderId}: ${notification.message}`, {
    "messaging.system": "dapr",
    "messaging.destination.name": topicName,
    "workflow.instance_id": notification.workflowInstanceId ?? notification.orderId,
  });
}

export async function notifyActivity(context: WorkflowActivityContext, notification: Notification) {
  await publishNotification({
    ...notification,
    workflowInstanceId: context.getWorkflowInstanceId(),
  });
}

export async function reserveInventoryActivity(context: WorkflowActivityContext, order: Order) {
  await publishNotification({
    orderId: order.id,
    workflowInstanceId: context.getWorkflowInstanceId(),
    message: `Reserved inventory for ${order.items.join(", ")}`,
  });

  return {
    reserved: true,
    itemCount: order.items.length,
  };
}

export async function processPaymentActivity(context: WorkflowActivityContext, order: Order) {
  await publishNotification({
    orderId: order.id,
    workflowInstanceId: context.getWorkflowInstanceId(),
    message: `Processed payment for $${order.total.toFixed(2)}`,
  });

  return {
    paid: true,
    amount: order.total,
  };
}

export async function shipOrderActivity(context: WorkflowActivityContext, order: Order) {
  if (process.env.SHIPPING_DISABLED === "true") {
    logError(`Shipping disabled for ${order.id}`, {
      "workflow.instance_id": context.getWorkflowInstanceId(),
    });
    throw new Error("shipping is temporarily disabled");
  }

  await publishNotification({
    orderId: order.id,
    workflowInstanceId: context.getWorkflowInstanceId(),
    message: "Submitted order for shipping",
  });

  return {
    carrier: "demo-express",
    trackingNumber: `trk-${order.id}`,
  };
}

export const orderProcessingWorkflow: TWorkflow = function* orderProcessingWorkflow(
  context: WorkflowContext,
  order: Order,
): Generator<Task<any>, OrderResult, any> {
  context.setCustomStatus(JSON.stringify({ step: "received", orderId: order.id }));

  yield context.callActivity("notify", {
    orderId: order.id,
    message: `Received order for ${order.customer}. Total = $${order.total.toFixed(2)}`,
  });

  context.setCustomStatus(JSON.stringify({ step: "inventory", orderId: order.id }));
  yield context.callActivity("reserve_inventory", order);

  if (order.total >= 1000) {
    const deadline = new Date(context.getCurrentUtcDateTime().getTime() + 24 * 60 * 60 * 1000);

    context.setCustomStatus(JSON.stringify({ step: "waiting_for_approval", orderId: order.id, deadline }));
    yield context.callActivity("notify", {
      orderId: order.id,
      message: `Waiting for approval because total is $${order.total.toFixed(2)}. Deadline = ${deadline.toISOString()}`,
    });

    const approvalTask = context.waitForExternalEvent(approvalEventName);
    const timeoutTask = context.createTimer(deadline);
    const completedTask = yield context.whenAny([approvalTask, timeoutTask]);

    if (completedTask === timeoutTask) {
      yield context.callActivity("notify", {
        orderId: order.id,
        message: "Order cancelled because approval timed out",
      });
      return {
        id: order.id,
        message: "Order cancelled because approval timed out",
        success: false,
      } satisfies OrderResult;
    }

    const approval = (approvalTask as Task<Approval>).getResult();
    if (!approval.approved) {
      yield context.callActivity("notify", {
        orderId: order.id,
        message: `Order rejected by ${approval.approver}`,
      });
      return {
        id: order.id,
        message: `Order rejected by ${approval.approver}`,
        success: false,
      } satisfies OrderResult;
    }

    yield context.callActivity("notify", {
      orderId: order.id,
      message: `Order approved by ${approval.approver}`,
    });
  }

  context.setCustomStatus(JSON.stringify({ step: "payment", orderId: order.id }));
  yield context.callActivity("process_payment", order);

  context.setCustomStatus(JSON.stringify({ step: "shipping", orderId: order.id }));
  yield context.callActivity("ship_order", order);

  context.setCustomStatus(JSON.stringify({ step: "completed", orderId: order.id }));
  return {
    id: order.id,
    message: "Order processed successfully",
    success: true,
  } satisfies OrderResult;
};
