import type { ReactNode } from "react"

// Section — the shared editorial section shell (M56.D2).
//
// Moved here from the editors page, which had the only copy: a Fraunces title,
// an optional sand lead and the section body, with the hairline top rule and
// the scroll-margin that anchor links need. The design gate requires the
// content pages to import this instead of re-declaring their own, so the two
// surfaces cannot drift apart again.
//
// The former ember-rule eyebrow was REMOVED on 2026-11-07: DESIGN.md v0.3 bans
// kickers above headings — the heading carries its own weight. Call sites no
// longer pass one.
export function Section({
  id,
  title,
  lead,
  children,
}: {
  id: string
  title: string
  lead?: ReactNode
  children: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-[rgba(241,233,221,0.09)] py-12 md:py-16">
      <h2 className="font-display text-[1.7rem] leading-[1.15] font-medium tracking-[-0.01em] text-[#F1E9DD] sm:text-[2rem]">{title}</h2>
      {lead ? <p className="mt-4 max-w-3xl text-[15px] leading-[1.75] text-[#C2B5A2]">{lead}</p> : null}
      <div className="mt-7">{children}</div>
    </section>
  )
}
