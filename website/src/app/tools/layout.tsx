import type { Metadata } from "next"
import { TRUTH } from "@/data/truth.generated"

// /tools is a client page ('use client' interactive tool browser); Next.js
// metadata must live in a server component — this layout is it.
export const metadata: Metadata = {
  title: `Agent Tools — all ${TRUTH.tools.length} MCP tools`,
  description:
    `The ${TRUTH.tools.length} tool contracts rendered whole: what each call returns, the bounds it declares, and the limits its reference page records.`,
  alternates: { canonical: "/tools" },
}

export default function ToolsLayout({ children }: { children: React.ReactNode }) {
  return children
}
