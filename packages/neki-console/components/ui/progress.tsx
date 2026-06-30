import type * as React from "react"

import { cn } from "@/lib/utils"

function Progress({
  className,
  value = 0,
  ...props
}: React.ComponentProps<"div"> & { value?: number }) {
  const normalizedValue = Math.max(0, Math.min(value, 100))

  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={normalizedValue}
      className={cn("h-2 overflow-hidden rounded-full bg-zinc-100", className)}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className="h-full rounded-full bg-blue-600 transition-all"
        style={{ width: `${normalizedValue}%` }}
      />
    </div>
  )
}

export { Progress }
