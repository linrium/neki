import { EMPTY_VALUE } from "./types"

export function getString(value: unknown) {
  return typeof value === "string" ? value : undefined
}

export function getNumber(value: unknown) {
  return typeof value === "number" ? value : undefined
}

export function getStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

export function getArrayItem(value: unknown, index: number) {
  return Array.isArray(value) ? value[index] : undefined
}

export function toKeyValues(value: unknown) {
  const record = getStringRecord(value)

  return Object.entries(record)
    .map(([key, recordValue]) => ({ key, value: recordValue }))
    .sort((left, right) => left.key.localeCompare(right.key))
}

export function formatValue(value: unknown) {
  if (typeof value === "string") {
    return value || EMPTY_VALUE
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }

  return EMPTY_VALUE
}

export function getPositiveInteger(
  value: string | undefined,
  fallback: number,
) {
  if (!value) {
    return fallback
  }

  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function getFormString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === "string" ? value.trim() : ""
}

export function formatResponseBody(value: string) {
  if (!value) {
    return ""
  }

  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

export function getStringRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }

  return value as Record<string, string>
}

export function getRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }

  return value as Record<string, unknown>
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

export function getErrorStatus(error: unknown) {
  const record = getRecord(error)
  const response = getRecord(record?.response)
  const status =
    record?.statusCode ??
    record?.status ??
    record?.code ??
    response?.statusCode ??
    response?.status

  if (typeof status === "number") {
    return status
  }

  const message = getErrorMessage(error)
  const httpCodeMatch = /HTTP-Code:\s*(\d{3})/.exec(message)
  if (httpCodeMatch?.[1]) {
    return Number(httpCodeMatch[1])
  }

  const bodyCodeMatch = /"code"\s*:\s*(\d{3})/.exec(message)
  if (bodyCodeMatch?.[1]) {
    return Number(bodyCodeMatch[1])
  }

  return undefined
}

export function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function normalizeBaseUrl(value: string) {
  return value.endsWith("/") ? value : `${value}/`
}

export function getCondition(conditions: unknown, type: string) {
  if (!Array.isArray(conditions)) {
    return undefined
  }

  return conditions
    .map(getRecord)
    .find((condition) => getString(condition?.type) === type) as
    | { status?: string; reason?: string; message?: string }
    | undefined
}

export function generatePassword() {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789_-+=."
  const bytes = crypto.getRandomValues(new Uint8Array(32))

  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")
}
