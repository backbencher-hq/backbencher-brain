"use client"

import { useState } from "react"

export function CopyCommand({ command, className = "command-copy" }: { command: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={className}
      aria-label={`Copy command: ${command}`}
      onClick={() => {
        void navigator.clipboard?.writeText(command).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1600)
        })
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  )
}
