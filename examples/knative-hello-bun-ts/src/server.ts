import { instrumentRequest, logInfo } from "./telemetry";

const port = Number(process.env.PORT ?? 3000);
const daprHttpPort = process.env.DAPR_HTTP_PORT ?? "3500";
const daprSecretStore = process.env.DAPR_SECRET_STORE ?? "vault";
const daprSecretName = process.env.DAPR_SECRET_NAME ?? "hello-bun-ts";

type DaprSecret = Record<string, string>;

function routeFor(pathname: string) {
  if (pathname === "/" || pathname === "/healthz") {
    return pathname;
  }

  return "not_found";
}

async function loadVaultSecret() {
  const response = await fetch(`http://127.0.0.1:${daprHttpPort}/v1.0/secrets/${daprSecretStore}/${daprSecretName}`);

  if (!response.ok) {
    throw new Error(`Dapr secret lookup failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as DaprSecret;
}

Bun.serve({
  port,
  fetch(request) {
    const url = new URL(request.url);
    const route = routeFor(url.pathname);

    return instrumentRequest(request, route, async () => {
      if (url.pathname === "/healthz") {
        return Response.json({ ok: true });
      }

      if (url.pathname === "/") {
        const vaultSecret = await loadVaultSecret();

        logInfo(`Received request: ${request.method} ${url.pathname}`, {
          "http.request.method": request.method,
          "url.path": url.pathname,
        });
        logInfo(`Loaded Vault secret from Dapr: ${JSON.stringify(vaultSecret)}`, {
          "dapr.secret_store": daprSecretStore,
          "dapr.secret_name": daprSecretName,
        });

        return Response.json({
          message: "Hello from Bun TypeScript on Knative",
          path: url.pathname,
          method: request.method,
          vaultSecret,
          timestamp: new Date().toISOString(),
        });
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    });
  },
});

logInfo(`Listening on ${port}`);
