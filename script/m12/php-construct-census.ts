// M12.PHP-CONSTRUCT-CENSUS — which grammar constructs does NO corpus exercise?
//
// Motivation, from a real defect. `use C\{D, E as F};` (grouped use) emitted
// nothing at all — and the full-corpus differential over 4,139 files reported
// 100% coverage while missing it, because the construct occurs ZERO times in
// phpunit and ZERO times in phpmyadmin. A differential measures agreement on
// what it SEES; it cannot see a construct its corpora never contain.
//
// A hand-picked checklist finds the constructs you thought of. This walks the
// grammar's own node types against both corpora instead, so the list is
// complete by construction rather than by memory.
//
// The output that matters is CLAIMED-BUT-NEVER-EXERCISED: a node type the
// completeness spec classifies as handled/verified, on which no corpus file
// provides evidence. Those are assertions nobody has ever tested.
//
// Run:  bun script/m12/php-construct-census.ts
// Writes: validation/m12/results/php-construct-census.json
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { execSync } from "node:child_process"
import * as path from "node:path"

const ROOT = process.cwd()
const CORPORA = [
  { name: "phpunit", dir: "$HOME/fixtures/repositories/phpunit" },
  { name: "phpmyadmin", dir: "$HOME/fixtures/repositories/phpmyadmin" },
].filter((c) => existsSync(c.dir))

const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const grammar = await (wts as any).Language.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-php.wasm")))

const spec = JSON.parse(readFileSync(path.join(ROOT, "script/m14/spec/php-completeness.json"), "utf8"))
// A type is only UNADJUDICATED if nothing in the spec reasons about it. A
// `handled_verified` claim that a design decision also names has been looked at
// and written down, which is evidence of a different kind from corpus coverage
// — so the census reports the two separately rather than calling a probed type
// unexamined.
const classified = new Map<string, string>()
const adjudicated = new Map<string, string>()
for (const d of spec.design_decision?.decisions ?? []) {
  if (!d.node_type) continue
  for (const t of String(d.node_type).split(",")) { const k = t.trim(); if (k) adjudicated.set(k, d.id ?? "decision") }
}
for (const t of spec.handled_verified?.types ?? []) classified.set(t, "handled_verified")
for (const t of spec.internal_silent?.types ?? []) if (!classified.has(t)) classified.set(t, "internal_silent")
for (const [k, v] of adjudicated) if (!classified.has(k)) classified.set(k, `decision:${v}`)
for (const g of spec.gap?.gaps ?? []) for (const t of String(g.node_type).split(",")) { const k = t.trim(); if (k && !classified.has(k)) classified.set(k, "gap") }

const counts = new Map<string, number>()
const perCorpus: Record<string, number> = {}
let files = 0

for (const c of CORPORA) {
  const all = execSync(`git ls-files -z -- '*.php'`, { cwd: c.dir, maxBuffer: 1 << 28 }).toString().split("\0").filter(Boolean).sort()
  const seen = new Map<string, number>()
  for (const f of all) {
    let root: any, p: any
    try {
      p = new P(); p.setLanguage(grammar)
      const src = readFileSync(path.join(c.dir, f), "utf8")
      root = p.parse(src).rootNode
    } catch { continue }
    files++
    const stack = [root]
    while (stack.length) {
      const n = stack.pop()!
      if (n.isNamed && n.type) { counts.set(n.type, (counts.get(n.type) ?? 0) + 1); seen.set(n.type, (seen.get(n.type) ?? 0) + 1) }
      for (let i = 0; i < n.namedChildCount; i++) { const ch = n.namedChild(i); if (ch) stack.push(ch) }
    }
  }
  perCorpus[c.name] = seen.size
  console.log(`  walked ${c.name}: ${all.length} files, ${seen.size} distinct named types`)
}

const neverSeen: string[] = []
const claimedButUntested: string[] = []
const probedButUntested: Array<{ type: string; decision: string }> = []
const thin: Array<{ type: string; count: number }> = []
for (const [t, bucket] of classified) {
  if (t === "ERROR" || t === "MISSING") continue
  const n = counts.get(t) ?? 0
  if (n === 0) {
    neverSeen.push(t)
    if (bucket === "handled_verified" && !adjudicated.has(t)) claimedButUntested.push(t)
    else if (bucket === "handled_verified" && adjudicated.has(t)) probedButUntested.push({ type: t, decision: adjudicated.get(t) })
  }
  else if (n <= 2) thin.push({ type: t, count: n })
}
thin.sort((a, b) => a.count - b.count)

const art = {
  schemaVersion: 1, milestone: "M12", language: "php",
  purpose: "which grammar constructs does NO corpus exercise? complete by construction, not by memory",
  corpora: CORPORA.map((c) => c.name), filesWalked: files,
  grammarNamedTypesSeen: counts.size,
  specClassifiedTypes: classified.size,
  neverSeenInAnyCorpus: neverSeen.sort(),
  claimedButNeverExercised: claimedButUntested.sort(),
  claimedButNeverExercisedCount: claimedButUntested.length,
  thinlyExercised: thin,
  perCorpusDistinctTypes: perCorpus,
  note: "CLAIMED-BUT-NEVER-EXERCISED means: classified handled/verified, no corpus file exercises it, AND no design decision reasons about it — i.e. an assertion nobody has ever looked at. A type that is handled and corpus-unexercised but IS named by a decision has hand-probe evidence recorded in that decision, and is reported separately rather than conflated with the unexamined set. CLAIMED-BUT-NEVER-EXERCISED is the actionable set: a type the spec asserts is handled, on which no corpus file provides evidence. Grouped use was invisible to every agreement-based gate for exactly this reason, and it is a `handled` claim by any reasonable reading.",
  generatedAt: new Date().toISOString(),
}
writeFileSync(path.join(ROOT, "validation/m12/results/php-construct-census.json"), JSON.stringify(art, null, 2) + "\n")
console.log(`\nfiles walked: ${files} | named types seen: ${counts.size} | spec-classified: ${classified.size}`)
console.log(`never seen in ANY corpus: ${neverSeen.length}`)
console.log(`CLAIMED-BUT-NEVER-EXERCISED (spec says handled, no evidence): ${claimedButUntested.length}`)
if (claimedButUntested.length) console.log(`  ${claimedButUntested.join(", ")}`)
if (probedButUntested.length) console.log(`handled but no corpus evidence, YET adjudicated with hand-probe evidence: ${probedButUntested.length} -> ${probedButUntested.map((p) => `${p.type} (${p.decision})`).join(", ")}`)
console.log(`thinly exercised (<=2 occurrences): ${thin.length} -> ${thin.slice(0, 12).map((t) => `${t.type}(${t.count})`).join(", ")}`)
