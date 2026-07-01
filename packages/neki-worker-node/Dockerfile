FROM rust:1.91-bookworm AS builder

WORKDIR /build

COPY Cargo.toml Cargo.lock ./
COPY src/ src/

RUN cargo build --release

FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g workerd@latest || true

COPY --from=builder /build/target/release/neki-worker-node /usr/local/bin/neki-worker-node
COPY assets/router.js /opt/neki/router.js

RUN chmod 644 /opt/neki/router.js && \
    mkdir -p /var/lib/neki/workerd && \
    chown 1000:1000 /var/lib/neki/workerd

USER 1000:1000

ENTRYPOINT ["neki-worker-node"]
