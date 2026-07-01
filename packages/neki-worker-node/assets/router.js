/**
 * Stable router Worker for neki-worker-node.
 *
 * Reads the manifest from a text binding (NEKI_MANIFEST) that is embedded
 * at config-render time, matches incoming requests by host + method +
 * longest path prefix, and dispatches through a service binding.
 */

function matchRoute(manifest, request) {
  const url = new URL(request.url);
  const host = url.hostname;
  const method = request.method;
  const path = url.pathname;

  const routes = (manifest.routes || []).slice();

  // Sort by path prefix length descending (longest prefix first)
  routes.sort((a, b) => b.pathPrefix.length - a.pathPrefix.length);

  for (const route of routes) {
    if (route.host && route.host !== "*" && route.host !== host) {
      continue;
    }
    if (route.methods && route.methods.length > 0 && !route.methods.includes(method)) {
      continue;
    }
    if (route.pathPrefix && route.pathPrefix !== "/" && route.pathPrefix !== "/*") {
      if (!path.startsWith(route.pathPrefix.replace(/\/$/, ""))) {
        continue;
      }
    }
    return route;
  }

  return null;
}

addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request, globalThis));
});

async function handleRequest(request, env) {
    let manifest = env.NEKI_MANIFEST || { routes: [] };
    if (typeof manifest === "string") {
      try {
        manifest = JSON.parse(manifest);
      } catch (err) {
        return new Response(
          JSON.stringify({ error: "manifest parse error", detail: String(err) }),
          { status: 500, headers: { "content-type": "application/json" } }
        );
      }
    }

    const route = matchRoute(manifest, request);
    if (!route) {
      return new Response(
        JSON.stringify({
          error: "no route matched",
          generation: manifest.generation,
          node: manifest.node_id,
          pool: manifest.pool_id,
        }),
        { status: 404, headers: { "content-type": "application/json" } }
      );
    }

    const binding = env[route.binding];
    if (!binding) {
      return new Response(
        JSON.stringify({
          error: "binding unavailable",
          binding: route.binding,
          workerId: route.workerId,
          workerVersion: route.workerVersion,
        }),
        { status: 503, headers: { "content-type": "application/json" } }
      );
    }

    try {
      const resp = await binding.fetch(request.url, request);
      // Add debugging headers
      const headers = new Headers(resp.headers);
      if (manifest.generation) headers.set("x-neki-generation", manifest.generation);
      if (manifest.node_id) headers.set("x-neki-node", manifest.node_id);
      headers.set("x-neki-worker", route.workerId);
      headers.set("x-neki-worker-version", route.workerVersion);
      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: "dispatch failed",
          binding: route.binding,
          workerId: route.workerId,
          detail: String(err),
        }),
        { status: 502, headers: { "content-type": "application/json" } }
      );
    }
}
