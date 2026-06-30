#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "Missing required command: bun" >&2
  exit 1
fi

cd "${SCRIPT_DIR}"
exec bun scripts/test-workflow.ts
