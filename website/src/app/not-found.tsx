import type { Metadata } from "next"
import Link from "next/link"
import { AtlasPage, PageHead } from "@/components/atlas/AtlasPage"

// A branded 404 on the atlas. The route contract excludes it from the sitemap,
// and `robots` keeps it out of the index while still letting crawlers follow
// the links. The chrome is the shared AtlasPage, so the dead end still offers
// the six surfaces (the legacy fixed nav is suppressed by the body:has(.atlas)
// rule and by ATLAS_ROUTES on the real routes).

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
}

const SURFACES: { href: string; label: string; note: string }[] = [
  { href: "/install", label: "Install", note: "The one command to get bb on your machine." },
  { href: "/docs", label: "Docs", note: "First index, how it works, the full CLI reference." },
  { href: "/tools", label: "Tools", note: "The 16 agent contracts and what each refuses." },
  { href: "/languages", label: "Languages & analyzers", note: "What indexing each language buys you." },
  { href: "/editors", label: "Editors & IDEs", note: "bb_lsp in VS Code, Zed, Helix and JetBrains." },
  { href: "/support", label: "Support", note: "Answers to the questions people actually ask." },
]

export default function NotFound() {
  return (
    <AtlasPage>
      <div className="container">
        <PageHead
          title="This address doesn't exist."
          lead="The page may have moved, or the link may be a typo. Nothing is lost — pick a surface below, or start from the homepage."
          meta="404 · page not found"
        />
        <div className="page-actions" style={{ borderTop: 0, marginTop: 26, paddingTop: 0 }}>
          <Link className="btn" href="/">Back to the homepage</Link>
          <Link className="btn-ghost" href="/install">Install bb</Link>
        </div>
        <div className="reading">
          <h2>Where you can go instead</h2>
          <ul>
            {SURFACES.map((surface) => (
              <li key={surface.href}>
                <Link href={surface.href}>{surface.label}</Link> — {surface.note}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AtlasPage>
  )
}
