// scss-overrides-sample-probe.ts — is `overrides` reading 0 in firing-check a DEFECT
// or a POPULATION fact?
//
// WHAT IT ANSWERS. `npx tsx script/m14/firing-check.ts --files 120 scss` reports 7/10:
// the eight types the arbiter measures as EMITTED, minus `overrides`. The arbiter, over
// 4,433 files, reports `overrides` at 32 edges in 12 files. Those two disagree, and only
// one of them can be the whole population: firing-check takes a DETERMINISTIC STRIDE
// sample (`stride = max(1, floor(all.length / limit))`, firing-check.ts:190), so the
// question is not "does overrides fire" — the arbiter already answered that — but
// "does the stride sample CONTAIN any of the 12 files that carry one".
//
// THE ARITHMETIC IS NOT LEFT AS AN EXPECTATION. Expected hits in a stride sample of size
// L drawn from N files, when M files carry the construct, is L*M/N. For this lane that is
// 120*12/4433 = 0.32, so zero is the single most likely outcome and a non-zero would be
// the surprise. This script replaces that arithmetic with a measurement: it reconstructs
// the exact 120-file stride set from the same admitted list and intersects it with the
// file set that actually produced an `overrides` edge.
//
// A third possibility is ruled out explicitly rather than assumed away: `overrides` could
// read 0 because the 12 files are produced by the FALLBACK path (a degraded parse
// substituting the regex extractor), in which case production `parseFile` would not be
// emitting them at all and the arbiter's 32 edges would be an artifact of that path. So
// the probe records, per override file, whether it parsed clean or degraded. If every one
// of the 12 is clean, the edges are real parse facts.
//
// USAGE.  npx tsx validation/m14/fixtures/scss/scss-overrides-sample-probe.ts
// Population: the whole admitted corpus, 4,433 tracked .scss files, 116 repositories —
// not a sample. The stride set is the sample, and it is reported as a set.
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

// The admitted population, EXACTLY the census's admission rule. Reproduced rather than
// imported so this probe stands alone, and it is why both instruments agree on 4,433.
function admittedScss(): string[] {
  const out: string[] = []
  for (const e of readdirSync(CR).sort()) {
    const dir = path.join(CR, e)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) out.push(path.join(dir, rel))
  }
  const admitted: string[] = []
  for (const abs of out) {
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "scss") continue
    admitted.push(abs)
  }
  admitted.sort()
  return admitted
}

const SAMPLE = 120

const all = admittedScss()
const stride = Math.max(1, Math.floor(all.length / SAMPLE))
// firing-check.ts:190-192 walks the sorted list forward by `stride`, not by `i % step`,
// so this reconstructs the same set rather than an equivalent-looking one.
const picked: string[] = []
for (let i = 0; i < all.length && picked.length < SAMPLE; i += stride) picked.push(all[i])

console.log(`admitted .scss           ${all.length}`)
console.log(`stride                   ${stride} (every ${stride}th of the sorted admitted list)`)
console.log(`firing-check sample set  ${picked.length}`)
console.log(`expected overrides hits  ${((SAMPLE * 12) / all.length).toFixed(3)}  (L*M/N, M=12 from the arbiter)`)

// Walk the WHOLE population, not the sample: the sample only tells us whether firing-check
// could have seen an `overrides` edge, and this lane reports on the population.
const overrideFiles = new Map<string, { edges: number; degraded: boolean }>()
for (const abs of all) {
  const r = await parseFile(abs, path.dirname(abs))
  const rel = path.relative(CR, abs)
  for (const e of r.relationships ?? []) {
    if (e.type === "overrides") {
      const cur = overrideFiles.get(rel) ?? { edges: 0, degraded: r.fallback === true || r.degraded === true }
      cur.edges += 1
      overrideFiles.set(rel, cur)
    }
  }
}

const pickedSet = new Set(picked)
const hits = [...overrideFiles.keys()].filter((f) => pickedSet.has(f))

console.log(`\npopulation files with >=1 overrides edge: ${overrideFiles.size}  (edges: ${[...overrideFiles.values()].reduce((a, b) => a + b.edges, 0)})`)
console.log(`of those, inside firing-check's 120-file sample: ${hits.length}`)
if (hits.length) for (const f of hits) console.log(`  HIT ${f}`)

const degradedOverrideFiles = [...overrideFiles.entries()].filter(([, v]) => v.degraded)
console.log(`\noverride files whose parse was DEGRADED (fallback, not a real parse fact): ${degradedOverrideFiles.length}`)
for (const [f, v] of degradedOverrideFiles) console.log(`  DEGRADED ${f} (${v.edges} edges)`)

const nonDegraded = overrideFiles.size - degradedOverrideFiles.length
console.log(`\nVERDICT: ${overrideFiles.size} of ${overrideFiles.size} override files parse clean; the sample contains ${hits.length} of them.`)
console.log(
  hits.length === 0
    ? `  firing-check's 7/10 is a SAMPLE-POPULATION fact: expected ${((SAMPLE * overrideFiles.size) / all.length).toFixed(2)} hits, observed 0.`
    : `  firing-check's 7/10 is NOT explained by the sample: ${hits.length} override file(s) ARE in the sample, so a 0 reading would be a real defect.`,
)
