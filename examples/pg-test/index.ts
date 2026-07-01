const DEFAULT_DATABASE_URL =
  "postgres://cloud_admin@127.0.0.1:55433/postgres?sslmode=disable";

function databaseUrl(): string {
  if (Bun.env.DATABASE_URL) {
    return Bun.env.DATABASE_URL;
  }

  const host = Bun.env.PGHOST ?? "127.0.0.1";
  const port = Bun.env.PGPORT ?? "55433";
  const database = Bun.env.PGDATABASE ?? "postgres";
  const username = Bun.env.PGUSER ?? "cloud_admin";
  const password = Bun.env.PGPASSWORD;
  const auth = password
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}`
    : encodeURIComponent(username);

  if (
    host === "127.0.0.1" &&
    port === "55433" &&
    database === "postgres" &&
    username === "cloud_admin" &&
    !password
  ) {
    return DEFAULT_DATABASE_URL;
  }

  return `postgres://${auth}@${host}:${port}/${database}?sslmode=disable`;
}

function redactConnectionString(value: string): string {
  const url = new URL(value);

  if (url.password) {
    url.password = "****";
  }

  return url.toString();
}

const connectionString = databaseUrl();
const sql = new Bun.SQL(connectionString);

try {
  console.log(`Connecting to ${redactConnectionString(connectionString)}`);

  const [connection] = await sql`
    select
      current_database() as database,
      current_user as username,
      version() as version,
      now() as connected_at
  `;

  await sql`
    create temporary table bun_pg_test (
      id integer generated always as identity primary key,
      note text not null,
      created_at timestamptz not null default now()
    )
  `;

  const [inserted] = await sql`
    insert into bun_pg_test (note)
    values (${"hello from Bun SQL"})
    returning id, note, created_at
  `;

  const [{ row_count }] = await sql`
    select count(*)::int as row_count
    from bun_pg_test
  `;

  console.log("Connection OK");
  console.table({
    database: connection.database,
    username: connection.username,
    version: String(connection.version).split("\n")[0],
    connectedAt: String(connection.connected_at),
    insertedId: inserted.id,
    insertedNote: inserted.note,
    rowCount: row_count,
  });
} finally {
  await sql.close();
}
