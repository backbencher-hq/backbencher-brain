/**
 * WHY: `script/m14/differential.ts --lang markdown` reports 770 MISSING on the
 * kubernetes corpus, every sample an edge of the shape
 * `references document -> <heading text>`, all from files carrying a
 * `<!-- BEGIN MUNGE: GENERATED_TOC -->` block — a machine-generated table of contents
 * that links every heading in its own document.
 *
 * markdown's compared allowlist is ["contains","uses"] (differential.ts:23392), so
 * `references` is outside the compared set and these rows print as "undefined truth"
 * rather than as a scored verdict. That makes them unadjudicated, not dismissed.
 *
 * This probe answers the one question the number leaves open: does production `parseFile`
 * emit anything for those TOC destinations, and if not, what does it emit instead?
 */
import { parseFile } from "../../../../src/ast/pool-worker"

const F = "/home/ishaq2321/bb_tests/repositories/kubernetes/CHANGELOG/CHANGELOG-1.11.md"
const r: any = await parseFile(F, "/home/ishaq2321/bb_tests/repositories/kubernetes")
const rels: any[] = r.relationships ?? []

const byType: Record<string, number> = {}
for (const x of rels) {
  const t = String(x.type ?? "")
  byType[t] = (byType[t] ?? 0) + 1
}
console.log("file:", F)
console.log("total relationships:", rels.length)
console.log("byType:", JSON.stringify(byType))

// The exact targets the oracle named as MISSING.
const MISSING_TARGETS = ["v1.11.10", "Downloads for v1.11.10", "Client Binaries", "Changelog since v1.11.9"]
const hits = rels.filter(x => MISSING_TARGETS.includes(String(x.target ?? "")))
console.log("\nedges targeting a TOC heading TEXT:", hits.length)
console.log(JSON.stringify(hits.slice(0, 6), null, 1))

// What the analyzer emits instead: references edges whose destination is a SLUG.
const refs = rels.filter(x => String(x.type) === "references")
console.log(`\nreferences edges: ${refs.length}`)
console.log("first 6:", JSON.stringify(refs.slice(0, 6).map((x: any) => ({
  type: x.type, source: x.source, target: x.target, confidence: x.confidence,
})), null, 1))

const byTargetShape: Record<string, number> = {}
for (const x of refs) {
  const t = String(x.target ?? "")
  const k = t.startsWith("#") ? "startsWith#" : t.includes("/") ? "hasSlash" : t.includes(".") ? "hasDot" : "bare"
  byTargetShape[k] = (byTargetShape[k] ?? 0) + 1
}
console.log("references target shapes:", JSON.stringify(byTargetShape))
