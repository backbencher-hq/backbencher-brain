import type { ReactNode } from "react"

// Plate — the shared raised surface (M56.D2): the `.plate` hairline surface
// token, optionally padded, optionally rendered as another element (a
// `<details>` disclosure, an `<article>` card). `pad` exists because the two
// page-level idioms in this site are "bare surface, caller sets padding" and
// "padded card" — naming both here keeps the padding scale in one place instead
// of repeated `p-5`/`p-6` values across pages.
export function Plate({
  as: Tag = "div",
  pad = false,
  hover = false,
  children,
  className = "",
}: {
  as?: "div" | "article" | "details" | "section" | "li"
  pad?: boolean
  hover?: boolean
  children: ReactNode
  className?: string
}) {
  const cls = ["plate", pad ? "p-5" : "", hover ? "plate-hover" : "", className].filter(Boolean).join(" ")
  return <Tag className={cls}>{children}</Tag>
}
