# Kong Gateway

This installs Kong Operator and provisions an on-prem Kong Gateway with the Kubernetes Gateway API.

Based on Kong's official Gateway API quickstart docs:

- https://developer.konghq.com/operator/get-started/gateway-api/install/
- https://developer.konghq.com/operator/get-started/gateway-api/deploy-gateway/
- https://developer.konghq.com/operator/get-started/gateway-api/create-route/

```bash
./infra/kong/install.sh
```

The default install follows Kong's Gateway API quickstart:

- installs Gateway API CRDs `v1.5.1`
- installs Kong Operator `2.2.0` with Helm chart `1.3.0`
- creates the `kong` namespace, `GatewayConfiguration`, `GatewayClass`, and `Gateway`
- exposes Kong's ingress service as `NodePort` for local clusters
- optionally installs Kong's echo backend and an `/echo` `HTTPRoute`

The installer applies Gateway API CRDs directly with `kubectl` and disables the Kong chart's Gateway API CRD subcharts. This prevents server-side apply ownership conflicts on Gateway API admission policies while still allowing the chart to install Kong Operator's own CRDs.

By default, `infra/kong/gateway.yaml` uses `NodePort` for the generated Kong ingress service. This avoids `EXTERNAL-IP <pending>` on local clusters without a LoadBalancer implementation. For a cloud cluster with a working LoadBalancer controller, change `spec.dataPlaneOptions.network.services.ingress.type` to `LoadBalancer`.

Set `INSTALL_ECHO=false` to skip the sample backend and route.

```bash
INSTALL_ECHO=false ./infra/kong/install.sh
```

After install, get the proxy address and test the sample route:

```bash
PROXY_IP="$(kubectl get gateway kong -n kong -o jsonpath='{.status.addresses[0].value}')"
curl -i "${PROXY_IP}/echo" --no-progress-meter --fail-with-body
```

For local testing, port-forward the generated ingress service:

```bash
kubectl port-forward --namespace kong service/$(kubectl get service --namespace kong --selector gateway-operator.konghq.com/dataplane-service-type=ingress --output jsonpath='{.items[0].metadata.name}') 8080:80
curl -i http://localhost:8080/echo
```

## Knative path-style function routes

Knative Serving routes requests by hostname, for example
`hello-bun-ts.default.example.com`. Kong can expose a path-style API in front of
Knative with one generic `/functions/:function-name` route.

The route sends all `/functions/*` requests to a lightweight in-cluster router.
That router derives the Knative hostname from the first path segment, strips the
function prefix, and forwards the request to Kourier.

Install the generic route for functions in the `default` namespace:

```bash
FUNCTION_NAMESPACE=default \
KNATIVE_DOMAIN=example.com \
envsubst '${FUNCTION_NAMESPACE} ${KNATIVE_DOMAIN}' < infra/kong/knative-functions-route.yaml | kubectl apply -f -
```

Then port-forward Kong and invoke the service without a manual `Host` header:

```bash
kubectl port-forward --namespace kong service/$(kubectl get service --namespace kong --selector gateway-operator.konghq.com/dataplane-service-type=ingress --output jsonpath='{.items[0].metadata.name}') 8080:80
curl -i http://localhost:8080/functions/hello-bun-ts
```

Requests below the function prefix are forwarded with the prefix removed. For
example, `/functions/hello-bun-ts/healthz` reaches Knative as `/healthz`.

If the router was already installed, restart it after applying ConfigMap
changes:

```bash
kubectl rollout restart deployment/knative-function-router --namespace kong
kubectl rollout status deployment/knative-function-router --namespace kong --timeout=180s
```

This single route works for any Knative Service in the configured
`FUNCTION_NAMESPACE`. For example, `/functions/my-api` forwards with
`Host: my-api.default.example.com`. If you need to route functions from multiple
namespaces through one public API, use a namespace path segment such as
`/functions/:namespace/:function-name` or install one router per namespace with
a different path prefix.

Configuration knobs:

- `GATEWAY_API_VERSION`, default `v1.5.1`
- `KONG_OPERATOR_CHART_VERSION`, default `1.3.0`
- `KONG_OPERATOR_IMAGE_TAG`, default `2.2.0`
- `TIMEOUT`, default `180s`
- `INSTALL_ECHO`, default `true`
- `ECHO_SERVICE_URL`, default `https://developer.konghq.com/manifests/kic/echo-service.yaml`
- `REQUIRE_GATEWAY_PROGRAMMED`, default `false`
