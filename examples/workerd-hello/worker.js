addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);

  if (url.pathname === "/healthz") {
    return json({ ok: true });
  }

  if (url.pathname === "/api/echo") {
    return json({
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers),
    });
  }

  return json({
    service: "workerd-hello",
    runtime: "workerd",
    message: "Hello from Cloudflare workerd on Kubernetes",
    path: url.pathname,
  });
}

function json(value, init = {}) {
  return new Response(JSON.stringify(value, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
}
