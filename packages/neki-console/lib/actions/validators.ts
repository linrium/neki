export function validateKubernetesName(value: string, label: string) {
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value) || value.length > 63) {
    throw new Error(
      `${label} must be a DNS label: lowercase letters, numbers, hyphens, and at most 63 characters.`,
    )
  }
}

export function validateVaultSecretName(value: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,126}[a-zA-Z0-9]$/.test(value)) {
    throw new Error(
      "Vault secret name must use letters, numbers, dots, underscores, hyphens, or slashes.",
    )
  }
}

export function validateIdentifier(value: string, label: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(value)) {
    throw new Error(
      `${label} must start with a letter or underscore and only contain letters, numbers, or underscores.`,
    )
  }
}

export function validateStorageSize(value: string) {
  if (!/^[1-9][0-9]*(Mi|Gi|Ti)$/.test(value)) {
    throw new Error("Storage size must look like 512Mi, 8Gi, or 1Ti.")
  }
}

export function validatePostgresVersion(value: string) {
  if (!/^(14|15|16|17)$/.test(value)) {
    throw new Error("Postgres version must be 14, 15, 16, or 17.")
  }
}

export function validateBucketName(value: string) {
  if (
    value.length < 3 ||
    value.length > 63 ||
    !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(value) ||
    value.includes("..") ||
    value.includes(".-") ||
    value.includes("-.")
  ) {
    throw new Error(
      "RustFS bucket must be a lowercase S3 bucket name between 3 and 63 characters.",
    )
  }
}
