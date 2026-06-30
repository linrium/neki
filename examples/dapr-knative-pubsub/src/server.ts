import { instrumentRequest, logError, logInfo } from "./telemetry";

const port = Number(process.env.PORT ?? 3000);
const daprHttpPort = Number(process.env.DAPR_HTTP_PORT ?? 3500);
const pubsubName = process.env.PUBSUB_NAME ?? "pubsub";
const topicName = process.env.TOPIC_NAME ?? "inventory";
const publishUrl = `http://127.0.0.1:${daprHttpPort}/v1.0/publish/${pubsubName}/${topicName}`;

type InventoryMessage = {
  id?: string;
  type?: string;
  item?: string;
  quantity?: number;
};

function text(status: number, body: string) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
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
  if (
    pathname === "/" ||
    pathname === "/healthz" ||
    pathname === "/dapr/subscribe" ||
    pathname === "/publish" ||
    pathname === "/widgets" ||
    pathname === "/gadgets" ||
    pathname === "/products"
  ) {
    return pathname;
  }

  return "not_found";
}

function logRoutedMessage(route: string, payload: unknown) {
  logInfo(`${route}: ${JSON.stringify(payload)}`, {
    "messaging.system": "dapr",
    "messaging.destination.name": topicName,
  });
}

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
          app: "dapr-knative-pubsub",
          publish: "POST /publish",
          routes: ["/widgets", "/gadgets", "/products"],
        });
      }

      if (request.method === "GET" && url.pathname === "/dapr/subscribe") {
        return Response.json([]);
      }

      if (request.method === "POST" && url.pathname === "/publish") {
        const body = (await readJson(request)) as InventoryMessage | null;

        if (!body) {
          return text(400, "Expected JSON body\n");
        }

        const response = await fetch(publishUrl, {
          method: "POST",
          headers: { "content-type": "application/cloudevents+json" },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const error = await response.text();
          logError(`Publish failed: ${response.status} ${error}`, {
            "messaging.system": "dapr",
            "messaging.destination.name": topicName,
          });
          return text(502, "Dapr publish failed\n");
        }

        logInfo(`PUBLISHED: ${JSON.stringify(body)}`, {
          "messaging.system": "dapr",
          "messaging.destination.name": topicName,
        });
        return text(200, "OK\n");
      }

      if (request.method === "POST" && url.pathname === "/widgets") {
        logRoutedMessage("WIDGET", await readJson(request));
        return text(200, "OK\n");
      }

      if (request.method === "POST" && url.pathname === "/gadgets") {
        logRoutedMessage("GADGET", await readJson(request));
        return text(200, "OK\n");
      }

      if (request.method === "POST" && url.pathname === "/products") {
        logRoutedMessage("PRODUCT default", await readJson(request));
        return text(200, "OK\n");
      }

      return text(404, "Not found\n");
    });
  },
});

logInfo(`Listening on ${port}`);
logInfo(`Publishing to ${publishUrl}`);
