import { normalizeBaseUrl } from "./utils"

export function buildKongFunctionUrl(
  baseUrl: string,
  functionName: string,
  path: string,
) {
  const url = new URL(
    `/api/functions/${encodeURIComponent(functionName)}`,
    normalizeBaseUrl(baseUrl),
  )
  const normalizedPath = path.trim()

  if (normalizedPath) {
    url.pathname += normalizedPath.startsWith("/")
      ? normalizedPath
      : `/${normalizedPath}`
  }

  return url.toString()
}
