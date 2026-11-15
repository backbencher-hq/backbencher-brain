import type { ReactNode } from "react"
import { AtlasNav } from "./AtlasNav"
import { AtlasFooter } from "./AtlasFooter"

/** The shared chrome for every re-skinned surface: paper canvas, atlas nav,
 *  the page's own content, the atlas footer. The homepage composes its plates
 *  itself; every other page starts here so the transition can happen one page
 *  at a time without two chromes ever rendering on the same route. */
export function AtlasPage({ children }: { children: ReactNode }) {
  return (
    <div className="atlas atlas-page">
      <AtlasNav />
      <main>{children}</main>
      <AtlasFooter />
    </div>
  )
}

/** The title block every atlas page opens with: a serif statement, a lead that
 *  carries the facts, and an optional mono meta line. No eyebrow kicker above
 *  the heading — the heading carries its own weight (DESIGN.md v0.3). */
export function PageHead({ title, lead, meta }: { title: ReactNode; lead?: ReactNode; meta?: ReactNode }) {
  return (
    <header className="page-head">
      <h1>{title}</h1>
      {lead ? <p className="lead">{lead}</p> : null}
      {meta ? <p className="meta">{meta}</p> : null}
    </header>
  )
}
