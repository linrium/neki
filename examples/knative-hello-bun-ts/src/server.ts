import { instrumentRequest, logInfo } from "./telemetry";

const port = Number(process.env.PORT ?? 3000);

function routeFor(pathname: string) {
  if (pathname === "/" || pathname === "/healthz") {
    return pathname;
  }

  return "not_found";
}

Bun.serve({
  port,
  fetch(request) {
    const url = new URL(request.url);
    const route = routeFor(url.pathname);

    return instrumentRequest(request, route, () => {
      if (url.pathname === "/healthz") {
        return Response.json({ ok: true });
      }

      if (url.pathname === "/") {
        logInfo(`Received request: ${request.method} ${url.pathname}`, {
          "http.request.method": request.method,
          "url.path": url.pathname,
        });

        return Response.json({
          message: "Hello from Bun TypeScript on Knative",
          path: url.pathname,
          method: request.method,
          timestamp: new Date().toISOString(),
        });
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    });
  },
});

logInfo(`Listening on ${port}`);
