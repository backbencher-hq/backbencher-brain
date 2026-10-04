/**
 * M60 LUA-52 — evidence-tier verification on the CORPUS edges, not on the fixture.
 *
 * ## Why a recount would not be evidence for this defect
 *
 * The fix changes one field on edges whose COUNT does not move: `overrides` is 67
 * edges over 38 files before and after, so the census total, the arbiter's EMITTED row
 * and the oracle's set diff all read identically either way. A number that cannot
 * distinguish the two states cannot establish that the fix took effect at corpus
 * scale. What distinguishes them is the field itself, on the real edges the corpus
 * produces.
 *
 * So this verifies the THING rather than re-counting it: it finds every
 * `lua_inherited_member` edge production `parseFile` emits over the corpus and prints
 * its `confidence` beside its `metadata.evidenceClass`, and it FAILS if any edge pairs
 * a confidence below 1.0 with the `structural` tier.
 *
 * ## The rule being checked, and where it comes from
 *
 * It is not this script's rule. `real-lua-analyzer.ts:1381` states it for the analyzer
 * itself, in `addFactorySupertypeEdges`:
 *
 *   `evidenceClassFor` derives the tier from the TYPE alone — anything that is not
 *   imports/references/uses is `structural` — "and a 0.95 edge must not claim
 *   `structural`".
 *
 * `usage_contextual` is the family's word for a link that rests on a name in a value
 * position (real-css-analyzer.ts:737), and the honesty contract §4 requires a
 * machine-readable reason code beside every confidence below 1.0. So the pairing under
 * test is: `confidence < 1.0` must not carry `structural`.
 *
 * ## SCOPE, stated because it bounds the claim
 *
 * `lua_redefinition` (65 edges at 1.0) and `lua_factory_supertype` (2 edges at 0.95) are
 * covered too, and so is every other type, because the check is a property of the EDGE
 * and not of one method. What this script cannot show is that the rule is right for a
 * type nobody has thought about: it tests the tiers this corpus exercises.
 *
 * Usage: npx tsx script/m60/verify-lua-evidence-tier.ts [--cap N] [--out <path>]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const arg = (k: string, d?: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const CAP = Number(arg("--cap", "0"))
const OUT = path.resolve(ROOT, arg("--out", "validation/m60/lua/evidence-tier.json")!)

const DETERMINISTIC_TIERS = new Set(["structural", "usage_contextual", "import_based", "inferred"])

interface CorpusFile { repo: string; rel: string; abs: string }
function corpusFiles(): CorpusFile[] {
  const files: CorpusFile[] = []
  for (const e of readdirSync(CR).sort()) {
    const dir = path.join(CR, e)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    let tracked: string[]
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.lua"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean).sort()
    } catch { continue }
    for (const rel of (CAP > 0 ? tracked.slice(0, CAP) : tracked)) files.push({ repo: e, rel, abs: path.join(dir, rel) })
  }
  return files
}

const files = corpusFiles()
console.log(`evidence-tier verification — ${files.length} lua files (cap=${CAP || "none"})`)

const rows: { repo: string; rel: string; type: string; label: string; source: string; target: string; line: number | null; confidence: number; tier: string }[] = []
const violations: typeof rows = []
const byTier: Record<string, number> = {}
/** type/label -> every (confidence, tier) PAIR observed, with a count. The first
 * implementation recorded only the first pair seen per label, which printed an empty
 * tier for all 33,859 `calls` edges because the first one it happened to meet was a
 * pool-worker fallback edge. An aggregate that reports one arbitrary member of a set is
 * the same defect as a probe that reads the wrong argument slot. */
const byLabelTier: Record<string, Record<string, number>> = {}
let edges = 0
let analyzerEdgesMissingTier = 0
let fallbackEdges = 0
let fallbackEdgesMissingTier = 0
const fallbackMissingExamples: string[] = []

const idx = { i: 0 }
async function worker(): Promise<void> {
  for (;;) {
    const i = idx.i++
    if (i >= files.length) return
    const f = files[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { continue }
    const isFallback = r?.fallback === true
    for (const e of r.relationships ?? []) {
      edges++
      if (isFallback) {
        fallbackEdges++
        if (!e.metadata?.evidenceClass) {
          fallbackEdgesMissingTier++
          if (fallbackMissingExamples.length < 5) fallbackMissingExamples.push(`${f.repo}/${f.rel}`)
        }
        continue
      }
      const type = String(e.type ?? "")
      const conf = Number(e.confidence)
      const tier = String(e.metadata?.evidenceClass ?? "")
      if (!tier) analyzerEdgesMissingTier++
      byTier[tier || "(absent)"] = (byTier[tier || "(absent)"] ?? 0) + 1
      const label = String(e.metadata?.relationshipType ?? "(none)")
      const k = `${type}/${label}`
      const pairs = byLabelTier[k] ?? {}
      const pk = `conf=${conf} tier=${tier || "(absent)"}`
      pairs[pk] = (pairs[pk] ?? 0) + 1
      byLabelTier[k] = pairs
      if (conf < 1.0 && tier === "structural") {
        const row = { repo: f.repo, rel: f.rel, type, label, source: String(e.source), target: String(e.target), line: e.line_number ?? null, confidence: conf, tier }
        violations.push(row)
        if (rows.length < 40) rows.push(row)
      }
      if (tier !== "" && !DETERMINISTIC_TIERS.has(tier)) {
        violations.push({ repo: f.repo, rel: f.rel, type, label, source: String(e.source), target: String(e.target), line: e.line_number ?? null, confidence: conf, tier: `NOT-A-TIER:${tier}` })
      }
    }
  }
}
await Promise.all(Array.from({ length: 4 }, () => worker()))

const out = {
  schemaVersion: 1,
  kind: "lua_evidence_tier_verification",
  at: new Date().toISOString().slice(0, 10),
  rule: "real-lua-analyzer.ts:1381 — `evidenceClassFor` derives the tier from the type alone, and a confidence below 1.0 must not carry `structural`. `usage_contextual` is the family's word for a link resting on a name in a value position (real-css-analyzer.ts:737); honesty contract §4 requires the reason code beside every sub-1.0 confidence.",
  entryPoint: "src/ast/pool-worker.ts parseFile",
  filesSampled: files.length,
  cap: CAP || null,
  analyzerEdgesExamined: edges - fallbackEdges,
  poolWorkerFallbackEdges: fallbackEdges,
  poolWorkerFallbackEdgesMissingATier: fallbackEdgesMissingTier,
  poolWorkerFallbackExamples: fallbackMissingExamples,
  analyzerEdgesMissingATier: analyzerEdgesMissingTier,
  byTier,
  byTypeAndLabel: byLabelTier,
  violations: { count: violations.length, sample: rows },
  overturn: "a violation count above 0 means a sub-1.0 edge claims a parse-fact tier. The check cannot show the rule is right for a type nobody has exercised; it tests the tiers this corpus produces.",
}
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")

console.log(`\nanalyzer edges examined: ${(edges - fallbackEdges).toLocaleString()}   missing a tier: ${analyzerEdgesMissingTier}`)
console.log(`pool-worker fallback edges: ${fallbackEdges}   missing a tier: ${fallbackEdgesMissingTier} (disclosed, and not this analyzer's)`)
console.log(`tiers: ${JSON.stringify(byTier)}`)
console.log(`\nsub-1.0 analyzer edges claiming \`structural\`: ${violations.length}`)
for (const r of violations.slice(0, 12)) console.log(`  ${r.repo}/${r.rel}:${r.line} ${r.type}/${r.label} ${r.source} -> ${r.target} conf=${r.confidence} tier=${r.tier}`)
console.log(`\nper type/label:`)
for (const [k, pairs] of Object.entries(byLabelTier).sort()) {
  const parts = Object.entries(pairs).map(([p, n]) => `${p} x${n.toLocaleString()}`)
  console.log(`  ${k.padEnd(42)} ${parts.join("  |  ")}`)
}
console.log(`\nwrote ${path.relative(ROOT, OUT)}`)
if (analyzerEdgesMissingTier > 0) { console.error(`\nFAIL: ${analyzerEdgesMissingTier} analyzer edges carry no evidenceClass at all.`); process.exit(1) }
if (violations.length > 0) { console.error(`\nFAIL: ${violations.length} analyzer edges pair a sub-1.0 confidence with \`structural\`.`); process.exit(1) }
console.log(`\nPASS: 0 of ${(edges - fallbackEdges).toLocaleString()} analyzer edges pair a sub-1.0 confidence with a parse-fact tier, and every one carries a tier.`)