import { TRUTH } from "@/data/truth.generated"
import { PARSERS } from "@/data/brain-languages"

// Structured data for search engines. All registry-owned fields derive from
// TRUTH — never hand-typed. Rendered as a <script type="application/ld+json">
// in the homepage DOM.
export function JsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Backbencher",
    alternateName: ["bb", "bb cli", "bb mcp", "backbencher-brain"],
    applicationCategory: "DeveloperApplication",
    operatingSystem: "macOS, Linux, Windows",
    softwareVersion: TRUTH.version,
    description: `bb (Backbencher): local-first code intelligence — AST indexing into ${TRUTH.tables} SQLite tables across ${PARSERS.length} languages (${TRUTH.languages.classified} registry ids), code search, symbol extraction, call-graph analysis, and ${TRUTH.tools.length} MCP agent tools.`,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    author: { "@type": "Person", name: "Muhammad Ishaq Khan", alternateName: "ishaq2321", url: "https://ishaq2321.github.io", sameAs: ["https://ishaq2321.github.io", "https://www.linkedin.com/in/2321ishaq", "https://github.com/ishaq2321"] },
    // One short line per tool: the registry name + the first sentence of the
    // registry description. The full description (≈29k words across 16 tools)
    // used to be embedded here, which bloated the homepage HTML and pushed
    // internal declared-bounds prose into structured data. Derived, not typed.
    featureList: TRUTH.tools.map((t) => {
      const firstSentence = t.description.split(/(?<=[.!?])\s/)[0] ?? t.description
      const clipped = firstSentence.length > 140 ? `${firstSentence.slice(0, 137).trimEnd()}…` : firstSentence
      return `${t.name}: ${clipped}`
    }),
  }
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}
