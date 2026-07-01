import { EMPTY_VALUE, type ServiceLogEntry } from "./types"
import { normalizeBaseUrl } from "./utils"

const LOKI_NAMESPACE_TOKEN = "$" + "{namespace}"
const LOKI_NAME_TOKEN = "$" + "{name}"
const LOKI_REVISION_TOKEN = "$" + "{revision}"
const LOKI_DAPR_APP_ID_TOKEN = "$" + "{daprAppId}"

type LokiQueryRangeResponse = {
  status?: string
  error?: string
  data?: {
    result?: Array<{
      stream?: Record<string, string>
      values?: Array<[string, string]>
    }>
  }
}

export async function fetchLokiQueryRange({
  baseUrl,
  query,
  limit,
  windowMinutes,
}: {
  baseUrl: string
  query: string
  limit: number
  windowMinutes: number
}): Promise<{ entries: ServiceLogEntry[]; errors: string[] }> {
  const now = Date.now()
  const url = new URL("/loki/api/v1/query_range", normalizeBaseUrl(baseUrl))
  url.searchParams.set("query", query)
  url.searchParams.set("direction", "BACKWARD")
  url.searchParams.set("limit", String(limit))
  url.searchParams.set("start", toLokiTimestamp(now - windowMinutes * 60_000))
  url.searchParams.set("end", toLokiTimestamp(now))

  const headers: HeadersInit = {}
  if (process.env.LOKI_TENANT_ID) {
    headers["X-Scope-OrgID"] = process.env.LOKI_TENANT_ID
  }

  const response = await fetch(url, {
    headers,
    cache: "no-store",
  })

  if (!response.ok) {
    return {
      entries: [],
      errors: [`Loki returned ${response.status}: ${response.statusText}`],
    }
  }

  const payload = (await response.json()) as LokiQueryRangeResponse
  if (payload.status !== "success") {
    return {
      entries: [],
      errors: [payload.error || "Loki query did not complete successfully."],
    }
  }

  return {
    entries: toLogEntries(payload).slice(0, limit),
    errors: [],
  }
}

function toLogEntries(payload: LokiQueryRangeResponse): ServiceLogEntry[] {
  return (payload.data?.result ?? [])
    .flatMap((streamResult) =>
      (streamResult.values ?? []).map(([timestamp, line]) => ({
        timestamp,
        time: formatLogTimestamp(timestamp),
        line,
        stream: streamResult.stream ?? {},
      })),
    )
    .sort((left, right) => Number(right.timestamp) - Number(left.timestamp))
}

export function buildLokiQuery({
  namespace,
  name,
  revision = "",
  daprAppId = "",
}: {
  namespace: string
  name: string
  revision?: string
  daprAppId?: string
}) {
  const template = process.env.LOKI_QUERY_TEMPLATE

  if (template) {
    return template
      .replaceAll(LOKI_NAMESPACE_TOKEN, escapeLogQLString(namespace))
      .replaceAll(LOKI_NAME_TOKEN, escapeLogQLString(name))
      .replaceAll(LOKI_REVISION_TOKEN, escapeLogQLString(revision))
      .replaceAll(LOKI_DAPR_APP_ID_TOKEN, escapeLogQLString(daprAppId))
  }

  return `{namespace="${escapeLogQLString(namespace)}", pod=~"${escapeLogQLRegexp(name)}.*"}`
}

function toLokiTimestamp(value: number) {
  return String(value * 1_000_000)
}

function formatLogTimestamp(timestamp: string) {
  const milliseconds = Math.floor(Number(timestamp) / 1_000_000)

  if (!Number.isFinite(milliseconds)) {
    return EMPTY_VALUE
  }

  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(milliseconds))
}

function escapeLogQLString(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')
}

function escapeLogQLRegexp(value: string) {
  return escapeLogQLString(value).replace(/[|\\{}()[\]^$+*?.]/g, "\\$&")
}
