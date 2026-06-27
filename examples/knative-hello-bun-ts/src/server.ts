const port = Number(process.env.PORT ?? 3000);

Bun.serve({
  port,
  fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return Response.json({ ok: true });
    }

    console.log(`Received request: ${request.method} ${url.pathname}`);

    return Response.json({
      message: "Hello from Bun TypeScript on Knative",
      path: url.pathname,
      method: request.method,
      timestamp: new Date().toISOString(),
    });
  },
});

console.log(`Listening on ${port}`);
