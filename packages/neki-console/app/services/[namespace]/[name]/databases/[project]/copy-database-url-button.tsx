"use client"

import { IconCheck, IconCopy } from "@tabler/icons-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"

export function CopyDatabaseUrlButton({
  databaseUrl,
}: {
  databaseUrl: string
}) {
  const [copied, setCopied] = useState(false)

  async function copyDatabaseUrl() {
    await navigator.clipboard.writeText(databaseUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      disabled={!databaseUrl || databaseUrl === "n/a"}
      onClick={copyDatabaseUrl}
    >
      {copied ? (
        <IconCheck data-icon="inline-start" />
      ) : (
        <IconCopy data-icon="inline-start" />
      )}
      {copied ? "Copied" : "Copy DB URL"}
    </Button>
  )
}
