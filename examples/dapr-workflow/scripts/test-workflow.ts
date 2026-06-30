const functionUrl = (process.env.FUNCTION_URL ?? "http://localhost:8080/api/functions/dapr-workflow").replace(/\/$/, "");
const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS ?? 1500);
const timeoutMs = Number(process.env.TIMEOUT_MS ?? 90000);

type WorkflowStatus = {
  id: string;
  status: string;
  customStatus?: {
    step?: string;
    orderId?: string;
    deadline?: string;
  };
  result?: {
    id?: string;
    message?: string;
    success?: boolean;
  };
  failure?: {
    message?: string;
    errorType?: string;
  };
};

type StartedOrder = {
  id: string;
  statusUrl: string;
  approvalUrl: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function heading(message: string) {
  console.log(`\n== ${message} ==`);
}

function step(message: string) {
  console.log(`\n> ${message}`);
}

function detail(message: string) {
  console.log(`  ${message}`);
}

function pretty(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith("http") ? path : `${functionUrl}${path}`;
  const response = await fetch(url, init);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${url} failed with ${response.status}: ${text}`);
  }

  if (!text) {
    return undefined as T;
  }

  return JSON.parse(text) as T;
}

async function postOrder(order: unknown) {
  return requestJson<StartedOrder>("/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(order),
  });
}

async function getStatus(orderId: string) {
  return requestJson<WorkflowStatus>(`/orders/${orderId}`);
}

async function approveOrder(orderId: string, approval: unknown) {
  const response = await fetch(`${functionUrl}/orders/${orderId}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(approval),
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`POST approval failed with ${response.status}: ${text}`);
  }

  return text.trim();
}

async function waitFor(orderId: string, label: string, predicate: (status: WorkflowStatus) => boolean) {
  const startedAt = Date.now();
  let lastStep = "";
  let lastStatus = "";

  while (Date.now() - startedAt < timeoutMs) {
    const status = await getStatus(orderId);
    const currentStep = status.customStatus?.step ?? "no custom step yet";
    const currentStatus = status.status;

    if (currentStep !== lastStep || currentStatus !== lastStatus) {
      detail(`${label}: status=${currentStatus}, step=${currentStep}`);
      lastStep = currentStep;
      lastStatus = currentStatus;
    }

    if (predicate(status)) {
      return status;
    }

    if (status.status === "FAILED" || status.status === "TERMINATED") {
      throw new Error(`${label} ended early with status ${status.status}: ${JSON.stringify(status.failure ?? status.result)}`);
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(`${label} did not reach the expected state within ${timeoutMs}ms`);
}

async function main() {
  heading("Dapr Workflow Smoke Test");
  detail(`Function URL: ${functionUrl}`);
  detail(`Timeout: ${timeoutMs}ms`);

  step("Check that the Knative function is reachable.");
  const root = await requestJson("/");
  pretty(root);

  step("Start a small order. It should reserve inventory, process payment, ship, and complete without approval.");
  const autoOrder = await postOrder({
    customer: "Smoke Casey",
    items: ["milk", "bread"],
    total: 25,
  });
  pretty(autoOrder);

  const completedAutoOrder = await waitFor(
    autoOrder.id,
    "auto-approved order",
    (status) => status.status === "COMPLETED",
  );
  detail(`Completed message: ${completedAutoOrder.result?.message ?? "no result message"}`);

  step("Start a high-value order. The workflow should pause at waiting_for_approval.");
  const approvalOrder = await postOrder({
    customer: "Smoke Riley",
    items: ["milk", "bread", "laptop"],
    total: 1299,
  });
  pretty(approvalOrder);

  const waitingOrder = await waitFor(
    approvalOrder.id,
    "approval order",
    (status) => status.customStatus?.step === "waiting_for_approval",
  );
  detail(`Approval deadline: ${waitingOrder.customStatus?.deadline ?? "not reported"}`);

  step("Send the manager_approval external event to resume the workflow.");
  const approvalResponse = await approveOrder(approvalOrder.id, {
    approver: "Smoke Chris",
    approved: true,
  });
  detail(approvalResponse);

  step("Wait for the approved order to process payment, ship, and complete.");
  const completedApprovalOrder = await waitFor(
    approvalOrder.id,
    "approved order",
    (status) => status.status === "COMPLETED",
  );
  detail(`Completed message: ${completedApprovalOrder.result?.message ?? "no result message"}`);

  heading("Smoke Test Passed");
  detail("The order API, workflow runtime, approval event, activities, and notification path all responded successfully.");
}

main().catch((error) => {
  console.error("\nSmoke test failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
