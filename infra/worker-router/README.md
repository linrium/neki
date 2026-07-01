# neki-worker-router

Rust routing gateway that sits between Kong and worker-node pods.

The gateway:

1. Loads the global routing table (file-based in dev mode)
2. Matches incoming requests by host, method, and longest path prefix
3. Selects a healthy target pod
4. Forwards the request to the selected worker-node pod

## Install

```bash
./infra/worker-router/install.sh
```

## Configuration Knobs

- `NAMESPACE`, default `neki`
- `NAME`, default `neki-worker-router`
- `ROUTER_IMAGE`, default `neki/worker-router:latest`
- `REPLICAS`, default `2`
- `REFRESH_SECS`, default `5`

## Kong Route

Kong sends `/workers/*` to the gateway via the HTTPRoute in
`infra/kong/neki-worker-route.yaml`.
