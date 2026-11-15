/**
 * WHY DO DART'S `overrides` EDGES NOT RESOLVE? — dart lane.
 *
 * The whole-corpus incoming gate reports `overrides 154,835 edges: 42,360 resolved, 5,568
 * ambiguous, 106,907 UNRESOLVED` — the largest unresolved class in the lane, and 16.3% of
 * every dart edge. The gate's rule is exact and worth restating, because the bucketing below
 * has to use the same one or the counts would not add up to its number:
 *
 *     tgt = rel.target ?? rel.to ?? rel.toSymbol
 *     decls = |{ symbols whose name OR qualifiedName === tgt }|
 *     decls === 0 -> unresolved · > 1 -> ambiguous · === 1 -> resolved
 *
 * So an override target like `StatefulWidget.build` resolves only if some file in the corpus
 * publishes a symbol whose qualifiedName is exactly that. Nothing about "why not" is in the
 * gate's output — it names 25 sampled targets and stops — and the answer decides what the
 * fix IS, because the three causes have three different correct treatments:
 *
 *   OWNER-NOT-PUBLISHED      the owner type is nowhere in the corpus. `StatefulWidget` is
 *                            declared by the Flutter framework, which this corpus does not
 *                            contain (0 files of packages/flutter/lib/**). The edge is
 *                            naming something OUTSIDE the declared population: a declared
 *                            exception, not a defect — and it must be marked as one.
 *   OWNER-PUBLISHED-MISSING  the owner IS in the corpus and the member is not. This is the
 *                            real defect class: either the member is inherited from a
 *                            grandparent the analyzer never walked, or publication missed
 *                            it. Fixable, and the fix is in the analyzer.
 *   BARE-TARGET              no owner qualifier at all, so there is no path to the
 *                            declaration. A different, also fixable, defect.
 *
 * Run: npx tsx validation/m14/fixtures/dart/override-unresolved-causes.ts [files] [concurrency]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SAMPLE = Number(process.argv[2] ?? 600)
const CONC = Number(process.argv[3] ?? 8)

function corpusDartFiles(): string[] {
  const out: string[] = []
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) if (rel.endsWith(".dart")) out.push(path.join(dir, rel))
  }
  return out
}

const all = corpusDartFiles()
// A stride sample, so the population is spread over every repo rather than being the first N
// files of an alphabetically ordered repo list.
const stride = Math.max(1, Math.floor(all.length / SAMPLE))
const files = all.filter((_, i) => i % stride === 0).slice(0, SAMPLE)
console.log(`override-cause census: ${files.length} of ${all.length} corpus .dart files (stride ${stride})`)

const declCount = new Map<string, number>()
let parsed = 0
let degraded = 0
/** edges whose target is exactly this string, for the unresolved buckets */
const overrideTargets: string[] = []
let overridesTotal = 0

let cursor = 0
await Promise.all(
  Array.from({ length: CONC }, async () => {
    while (true) {
      const i = cursor++
      if (i >= files.length) return
      let r: any
      try { r = await parseFile(files[i], path.dirname(files[i])) } catch { continue }
      if (!r) continue
      parsed++
      if (r.fallback === true || r.metadata?.analysisVersion === "2.0-basic-fallback") { degraded++; continue }
      for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
        const n = String(s?.name ?? "")
        if (n) declCount.set(n, (declCount.get(n) ?? 0) + 1)
        const q = String(s?.qualifiedName ?? "")
        if (q && q !== n) declCount.set(q, (declCount.get(q) ?? 0) + 1)
      }
      for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
        const label = String(rel?.type ?? rel?.relationshipType ?? "").toLowerCase()
        if (label !== "overrides") continue
        overridesTotal++
        overrideTargets.push(String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? ""))
      }
    }
  }),
)

const buckets = new Map<string, number>()
const ownerMissingMember = new Map<string, number>()
const ownerAbsent = new Map<string, number>()
const bareMissing = new Map<string, number>()
let resolved = 0
let ambiguous = 0

for (const tgt of overrideTargets) {
  if (tgt.length === 0) { buckets.set("EMPTY TARGET", (buckets.get("EMPTY TARGET") ?? 0) + 1); continue }
  const decls = declCount.get(tgt) ?? 0
  if (decls === 1) { resolved++; continue }
  if (decls > 1) { ambiguous++; continue }
  const dot = tgt.lastIndexOf(".")
  if (dot <= 0) {
    buckets.set("BARE-TARGET (no owner qualifier)", (buckets.get("BARE-TARGET (no owner qualifier)") ?? 0) + 1)
    bareMissing.set(tgt, (bareMissing.get(tgt) ?? 0) + 1)
    continue
  }
  const owner = tgt.slice(0, dot)
  const leaf = tgt.slice(dot + 1)
  const ownerPublished = (declCount.get(owner) ?? 0) > 0
  if (ownerPublished) {
    buckets.set("OWNER-PUBLISHED-MISSING (fixable in the analyzer)", (buckets.get("OWNER-PUBLISHED-MISSING (fixable in the analyzer)") ?? 0) + 1)
    ownerMissingMember.set(tgt, (ownerMissingMember.get(tgt) ?? 0) + 1)
  } else {
    buckets.set("OWNER-NOT-PUBLISHED (target is outside the declared population)", (buckets.get("OWNER-NOT-PUBLISHED (target is outside the declared population)") ?? 0) + 1)
    // The LEAF's owner, not `.`-split beyond it: for `a.b.c` the owner chain matters.
    const root = owner.split(".")[0]
    ownerAbsent.set(root, (ownerAbsent.get(root) ?? 0) + 1)
  }
  void leaf
}

const unresolved = overrideTargets.length - resolved - ambiguous
console.log(`\nparsed ${parsed} files, degraded ${degraded}`)
console.log(`overrides edges ${overridesTotal}: resolved ${resolved}, ambiguous ${ambiguous}, unresolved ${unresolved}\n`)
console.log(`${"cause".padEnd(58)}${"edges".padStart(9)}${"share of unresolved".padStart(20)}`)
for (const [k, v] of [...buckets.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${k.padEnd(58)}${String(v).padStart(9)}${((v / Math.max(1, unresolved)) * 100).toFixed(1).padStart(19)}%`)
}

const top = (m: Map<string, number>, n = 15) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
console.log(`\nTOP OWNERS ABSENT FROM THE CORPUS (these are the declared-exception candidates):`)
for (const [k, v] of top(ownerAbsent)) console.log(`  ${String(v).padStart(6)}  ${k}`)
console.log(`\nTOP OWNER-PUBLISHED TARGETS THAT STILL DO NOT RESOLVE (these are the analyzer's own gaps):`)
for (const [k, v] of top(ownerMissingMember)) console.log(`  ${String(v).padStart(6)}  ${k}`)
console.log(`\nTOP BARE TARGETS THAT DO NOT RESOLVE:`)
for (const [k, v] of top(bareMissing, 12)) console.log(`  ${String(v).padStart(6)}  ${k}`)
