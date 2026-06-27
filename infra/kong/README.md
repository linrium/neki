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

Configuration knobs:

- `GATEWAY_API_VERSION`, default `v1.5.1`
- `KONG_OPERATOR_CHART_VERSION`, default `1.3.0`
- `KONG_OPERATOR_IMAGE_TAG`, default `2.2.0`
- `TIMEOUT`, default `180s`
- `INSTALL_ECHO`, default `true`
- `ECHO_SERVICE_URL`, default `https://developer.konghq.com/manifests/kic/echo-service.yaml`
- `REQUIRE_GATEWAY_PROGRAMMED`, default `false`
