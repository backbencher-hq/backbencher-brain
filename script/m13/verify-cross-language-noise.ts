// script/m13/verify-cross-language-noise.ts
//
// Reported on 0.1.8: "Cross-language is still noisy. 110/122 edges are Go test uses
// edges into minified openlayers/ol.js identifiers (N, to, r) at confidence 0.5,
// bindingBasis=name-only, tier=inferred. bb_cross_language N alone reports 85 such
// facts. Exclude minified assets or require real bridge evidence."
//
// Two kinds of row are not facts:
//   · a row whose end is build output / vendored code / a minified bundle — the
//     identifiers there are minifier-minted one- or two-character names, so a name
//     match is a coincidence of the alphabet;
//   · a row whose only basis is a name collision (`name-only` / `name-resolution`).
// Both are now excluded from the fact list AND counted, so the exclusion is visible.

import { readFileSync } from "node:fs"
import * as path from "node:path"
import { factsFromRows, isMinifiedOrVendorAsset, type CrossLanguageEdgeRow } from "../../src/lsp/cross_language_hover"

let failures = 0
let checks = 0
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

const row = (over: Partial<CrossLanguageEdgeRow> = {}): CrossLanguageEdgeRow => ({
  relationship_type: "uses",
  confidence: 0.5,
  bridge_mechanism: "import",
  other_language: "javascript",
  direction: "caller",
  evidence_class: null,
  binding_basis: "import",
  ...over,
})

console.log("M13 cross-language noise\n")

// ── path classification ─────────────────────────────────────────────────────
for (const p of [
  "src/vendor/openlayers/ol.js",
  "static/build/openlayers/ol.js",
  "node_modules/foo/index.js",
  "dist/app.js",
  "web/lib/ol.min.js",
  "assets/app.bundle.js",
  "gen/api.pb.go",
]) {
  check(`classifies as build/vendor output: ${p}`, isMinifiedOrVendorAsset(p), String(isMinifiedOrVendorAsset(p)))
}
for (const p of [
  "src/analyzer.ts",
  "internal/pkg/load.go",
  "app/components/Button.tsx",
  "docs/readme.md",
]) {
  check(`keeps real source: ${p}`, !isMinifiedOrVendorAsset(p), String(isMinifiedOrVendorAsset(p)))
}
check("a null path is not an asset", !isMinifiedOrVendorAsset(null))

// ── the hover projection keeps its own contract ─────────────────────────────
//
// `factsFromRows` is the HOVER projection and carries no file paths, so it cannot
// classify an asset. It keeps marking name-only rows as `candidate` (the hover shows
// them WITH that label). The tool's fact list is the AGENT projection, and that is
// where the two exclusions live — asserted from source below.
{
  const facts = factsFromRows([row({ binding_basis: "name-only", bridge_mechanism: "name-resolution" })], "go")
  check("the hover projection still reports a name-only row, but MARKED as a candidate", facts.length === 1 && facts[0]?.candidate === true, `facts=${facts.length} candidate=${facts[0]?.candidate}`)
  const clean = factsFromRows([row({ binding_basis: "import", bridge_mechanism: "import" })], "go")
  check("a real bridge is not marked a candidate", clean[0]?.candidate === false, String(clean[0]?.candidate))
}

// ── the AGENT projection (bb_cross_language) applies both exclusions ───────
{
  const src = readFileSync(path.resolve(import.meta.dirname, "../../src/lsp/cross_language_hover.ts"), "utf8")
  const builder = src.slice(src.indexOf("function factFromRow("), src.indexOf("function factFromRow(") + 4000)
  check("THE REPORTED DEFECT: the agent fact builder refuses asset rows", /isMinifiedOrVendorAsset\(row\.(other_file|self_file|owner_file)\)/.test(builder))
  check("and refuses name-only / name-resolution candidates", /name-only/.test(builder) && /name-resolution/.test(builder))
  check("both refusals are COUNTED, not silent", /excludedAssetRows\+\+/.test(builder) && /nameOnlyCandidates\+\+/.test(builder))
  check("the counts are surfaced on the result", /excludedAssetRowCount:/.test(src) && /nameOnlyCandidateCount:/.test(src))
}

console.log(`\n${checks - failures}/${checks} passed`)
console.log(failures === 0 ? "CROSS-LANGUAGE NOISE: PASS" : `CROSS-LANGUAGE NOISE: FAIL (${failures})`)
process.exit(failures === 0 ? 0 : 1)
