import { SQL } from "bun";
import { instrumentRequest, logInfo } from "./telemetry";

const port = Number(process.env.PORT ?? 3000);
const daprHttpPort = process.env.DAPR_HTTP_PORT ?? "3500";
const daprSecretStore = process.env.DAPR_SECRET_STORE ?? "vault";
const daprSecretName = process.env.DAPR_SECRET_NAME ?? "hello-bun-ts";

type DaprSecret = Record<string, string>;
type PostgresSecret = {
  database: string;
  hostname: string;
  password: string;
  port: number;
  username: string;
};

type PostgresCheck = {
  connected: boolean;
  database: string;
  error: string;
  host: string;
  requiredSecretKeys: string[];
  user: string;
};

const postgresSecretKeys = [
  "postgresDatabase",
  "postgresHost",
  "postgresPassword",
  "postgresPort",
  "postgresUsername",
];

function routeFor(pathname: string) {
  if (pathname === "/" || pathname === "/healthz") {
    return pathname;
  }

  return "not_found";
}

async function loadVaultSecret() {
  const response = await fetch(
    `http://127.0.0.1:${daprHttpPort}/v1.0/secrets/${daprSecretStore}/${daprSecretName}`,
  );

  if (!response.ok) {
    throw new Error(
      `Dapr secret lookup failed: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as DaprSecret;
}

async function checkPostgresFromVault(
  vaultSecret: DaprSecret,
): Promise<PostgresCheck> {
  const postgresSecret = getPostgresSecret(vaultSecret);

  if (!postgresSecret) {
    return {
      connected: false,
      database: "",
      error:
        "Dapr Vault secret must include postgresDatabase, postgresHost, postgresPassword, postgresPort, and postgresUsername.",
      host: "",
      requiredSecretKeys: postgresSecretKeys,
      user: "",
    };
  }

  const sql = new SQL(postgresSecret);

  try {
    const [row] = await sql`
      SELECT
        current_database() AS database,
        current_user AS username,
        inet_server_addr()::text AS host
    `;
    const result = row as
      | { database?: string; host?: string; username?: string }
      | undefined;

    return {
      connected: true,
      database: result?.database ?? postgresSecret.database,
      error: "",
      host: result?.host ?? postgresSecret.hostname,
      requiredSecretKeys: postgresSecretKeys,
      user: result?.username ?? postgresSecret.username,
    };
  } catch (error) {
    return {
      connected: false,
      database: postgresSecret.database,
      error: error instanceof Error ? error.message : String(error),
      host: postgresSecret.hostname,
      requiredSecretKeys: postgresSecretKeys,
      user: postgresSecret.username,
    };
  } finally {
    await sql.close({ timeout: 1 });
  }
}

function getPostgresSecret(secret: DaprSecret): PostgresSecret | undefined {
  const database = secret.postgresDatabase;
  const hostname = secret.postgresHost;
  const password = secret.postgresPassword;
  const port = Number(secret.postgresPort);
  const username = secret.postgresUsername;

  if (!database || !hostname || !password || !username) {
    return undefined;
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return undefined;
  }

  return {
    database,
    hostname,
    password,
    port,
    username,
  };
}

function summarizeVaultSecret(secret: DaprSecret) {
  return Object.fromEntries(
    Object.entries(secret).map(([key, value]) => [
      key,
      {
        length: value.length,
        requiredForPostgres: postgresSecretKeys.includes(key),
      },
    ]),
  );
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
        const postgres = await checkPostgresFromVault(vaultSecret);

        logInfo(`Received request: ${request.method} ${url.pathname}`, {
          "http.request.method": request.method,
          "url.path": url.pathname,
        });
        logInfo(
          `Loaded Vault secret from Dapr with keys: ${Object.keys(vaultSecret).join(", ")}`,
          {
            "dapr.secret_store": daprSecretStore,
            "dapr.secret_name": daprSecretName,
            "postgres.connected": postgres.connected,
          },
        );

        return Response.json({
          message: "Hello from Bun TypeScript on Knative",
          path: url.pathname,
          method: request.method,
          daprSecret: {
            name: daprSecretName,
            store: daprSecretStore,
            keys: Object.keys(vaultSecret),
            summary: summarizeVaultSecret(vaultSecret),
          },
          postgres,
          timestamp: new Date().toISOString(),
        });
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    });
  },
});

logInfo(`Listening on ${port}`);
