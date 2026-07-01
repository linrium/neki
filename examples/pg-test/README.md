# pg-test

Simple Bun TypeScript script that connects to Neon Postgres with Bun's built-in
`Bun.SQL` Postgres client. It runs a connection check, creates a temporary
table, inserts one row, and prints the result.

## Install

```bash
bun install
```

## Run Against Local Neon

Port-forward the Neon branch Postgres service:

```bash
kubectl port-forward --namespace neon svc/main-postgres 55433:55433
```

Then run:

```bash
bun run start
```

Default connection string:

```text
postgres://cloud_admin@127.0.0.1:55433/postgres?sslmode=disable
```

## Override Connection

Use `DATABASE_URL`:

```bash
DATABASE_URL='postgres://cloud_admin@127.0.0.1:55433/postgres?sslmode=disable' \
  bun run start
```

Or use `PG*` variables:

```bash
PGHOST=127.0.0.1 \
PGPORT=55433 \
PGDATABASE=postgres \
PGUSER=cloud_admin \
bun run start
```

## Typecheck

```bash
bun run typecheck
```
