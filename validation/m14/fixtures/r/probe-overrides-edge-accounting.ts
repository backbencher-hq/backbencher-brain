#!/usr/bin/env npx tsx
/**
 * PROBE — the `overrides` edges are counted THREE times, and the three counts differ.
 *
 * `census-overrides-instantiates.ts` walks the whole R corpus and finds 95 `overrides` edges in 8
 * files — but the analyzer's own `metadata.callAttribution.overridesEdgesEmitted`, summed over the
 * same walk, reads 118. Two counts of the same fact, 23 apart. This probe decomposes the gap
 * instead of guessing at it, because there are exactly two stages between them and they are
 * different kinds of loss:
 *
 *   1. `RealRAnalyzer.analyze()` increments `overridesEdges++` once per (class, base, member)
 *      triple, then dedupes its whole relationship list on `type|source|target`
 *      (`real-r-analyzer.ts:470-479`). Two bases declaring the same member name for one class
 *      emit the SAME edge twice. Predicted loss: DEDUP — benign, one semantic fact.
 *   2. `pool-worker.parseFile` then runs `filterNoiseRelationships` over what `analyze()` returned
 *      (`pool-worker.ts:1373`). Anything it removes is NOT in the graph. Predicted loss: PRODUCT —
 *      an edge the analyzer proved and the index never sees.
 *
 * Only the second is a defect. A single number cannot tell them apart, which is why the census's
 * 118-vs-95 was reported as a DISAGREEMENT rather than as a loss.
 *
 * `prod-filter-delta.ts` already measures stage 2 alone (`analyze()` vs `parseFile`). This probe
 * measures all three counts on the same files, so the 23 is split rather than attributed.
 *
 * Population: the three repositories the census found emitting `overrides` or `instantiates`
 * (R6 27 files, S7 61, r-testthat 266). Every other repository emits zero of both, so the account
 * closes on the whole corpus.
 *
 * ## WHAT IT FOUND, AND WHAT IT IS NOW
 *
 * BEFORE THE FIX, measured 2026-10-09: `1. self-report 118`, `2. analyze() 95`, `3. parseFile 95`
 * — stage 1 DEDUP 23, stage 2 FILTER 0. The 23 are 14 in `R6/tests/testthat/test-clone.R`,
 * 8 in `R6/tests/testthat/test-finalizer.R` and 1 in
 * `R6/tests/testthat/test-portable-inheritance.R` — files that redeclare one class name many
 * times, which is exactly where two bases of one class declare the same member name.
 *
 * The COUNTER was the defect, not the collapse: `real-r-analyzer.ts` published the EMISSION count
 * under the name `overridesEdgesEmitted`. It now publishes the post-collapse count and carries the
 * emission count and the collapse beside it (`overridesEmissionsBeforeDedup`,
 * `overridesEmissionsCollapsedByDedup`), so nothing is dropped and the name is true.
 *
 * AFTER THE FIX this probe is a GUARD: it asserts the three counts are equal and that
 * `before − collapsed === after`, and it EXITS NON-ZERO if either drifts. A counter that stops
 * agreeing with the census is exactly the defect this file exists to catch.
 *
 * Population: the three repositories the census found emitting `overrides` or `instantiates`
 * (R6 27 files, S7 61, r-testthat 266). Every other repository emits zero of both, so the account
 * closes on the whole corpus.
 *
 * Run: npx tsx validation/m14/fixtures/r/probe-overrides-edge-accounting.ts
 */

import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { RealRAnalyzer } from "../../../../src/ast/real-r-analyzer"
import { parseFile } from "../../../../src/ast/pool-worker"

const T0 = Date.now()
const loadAtStart = os.loadavg()
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
/** The repositories the whole-corpus census found emitting either type. */
const REPOS = (process.env.BB_R_REPOS ?? "R6,S7,r-testthat").split(",").map((s) => s.trim()).filter(Boolean)

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-r.wasm"))))

const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
for (const e of REPOS) {
  const dir = path.join(CR, e)
  let tracked: string[]
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "r") continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}

const countType = (rels: any[], type: string): number => rels.filter((r: any) => String(r?.type) === type).length

interface Row { label: string; self: number; ovA: number; ovP: number; inA: number; inP: number }
const rows: Row[] = []
let selfTotal = 0
let ovAnalyzeTotal = 0
let ovProdTotal = 0
let inAnalyzeTotal = 0
let inProdTotal = 0
let emissionsBeforeDedup = 0
let collapsedByDedup = 0
let degraded = 0
let skipped = 0

for (const f of files) {
  let t: any
  try { t = parser.parse(f.text) } catch { skipped++; continue }
  if (!t) { skipped++; continue }
  let a: any
  try { a = new RealRAnalyzer().analyze(t.rootNode, f.text, f.abs) } catch { t.delete?.(); skipped++; continue }
  t.delete?.()
  let p: any
  try { p = await parseFile(f.abs, f.dir) } catch { skipped++; continue }
  if (p?.fallback === true || p?.metadata?.fallback === true) degraded++
  const self = Number(a?.metadata?.callAttribution?.overridesEdgesEmitted ?? 0)
  const ovA = countType(a?.relationships ?? [], "overrides")
  const ovP = countType(p?.relationships ?? [], "overrides")
  const inA = countType(a?.relationships ?? [], "instantiates")
  const inP = countType(p?.relationships ?? [], "instantiates")
  selfTotal += self
  ovAnalyzeTotal += ovA
  ovProdTotal += ovP
  inAnalyzeTotal += inA
  inProdTotal += inP
  emissionsBeforeDedup += Number(a?.metadata?.callAttribution?.overridesEmissionsBeforeDedup ?? self)
  collapsedByDedup += Number(a?.metadata?.callAttribution?.overridesEmissionsCollapsedByDedup ?? 0)
  if (self || ovA || ovP || inA || inP) rows.push({ label: `${f.repo}/${f.rel}`, self, ovA, ovP, inA, inP })
}

console.log("=".repeat(78))
console.log("PROBE — `overrides`: analyzer self-count vs analyze() vs production parseFile")
console.log("=".repeat(78))
console.log(`load average at start: ${loadAtStart.map((n) => n.toFixed(2)).join(" ")}  cores: ${os.cpus().length}`)
console.log(`population: ${files.length} .R files over repositories ${REPOS.join(", ")} (whole repos, no stride)`)
console.log(`files accounted: ${files.length - skipped}   skipped (parse/analyze threw): ${skipped}`)
console.log(`degraded (regex fallback): ${degraded}`)
console.log("")
console.log("THE THREE COUNTS, over the same files — `overrides`")
console.log("-".repeat(78))
console.log(`1. analyzer self-report  callAttribution.overridesEdgesEmitted ${String(selfTotal).padStart(5)}`)
console.log(`2. analyze() edges       (after the analyzer's own dedup)       ${String(ovAnalyzeTotal).padStart(5)}`)
console.log(`3. parseFile edges       (after filterNoiseRelationships)      ${String(ovProdTotal).padStart(5)}`)
console.log("")
console.log(`stage 1 loss  self -> analyze()  DEDUP   ${selfTotal - ovAnalyzeTotal}   (one edge emitted once per base; same (type,source,target))`)
console.log(`stage 2 loss  analyze() -> parseFile  FILTER ${ovAnalyzeTotal - ovProdTotal}   (edges the index never receives)`)
console.log("")
console.log("`instantiates` — the second silent type, same two-stage account")
console.log("-".repeat(78))
console.log(`analyze() ${inAnalyzeTotal}   parseFile ${inProdTotal}   FILTER loss ${inAnalyzeTotal - inProdTotal}`)
console.log("")
console.log("PER FILE, every file where any count is non-zero")
console.log("-".repeat(78))
console.log("file                                       self  ov_a  ov_p  in_a  in_p")
for (const r of rows.sort((a, b) => (b.self + b.inA) - (a.self + a.inA))) {
  console.log(`${r.label.padEnd(42)} ${String(r.self).padStart(4)} ${String(r.ovA).padStart(5)} ${String(r.ovP).padStart(5)} ${String(r.inA).padStart(5)} ${String(r.inP).padStart(5)}`)
}
console.log("")
console.log(`wall time ${Date.now() - T0}ms`)
console.log("")
console.log("-".repeat(78))
console.log("THE COUNTER'S OWN ACCOUNT (post-fix fields, so nothing is dropped)")
console.log(`  overridesEmissionsBeforeDedup        ${emissionsBeforeDedup}`)
console.log(`  overridesEmissionsCollapsedByDedup   ${collapsedByDedup}`)
console.log(`  before - collapsed = after           ${emissionsBeforeDedup - collapsedByDedup}`)
console.log("")
console.log("GUARD — a counter that stops agreeing with the census is the defect this file catches")
const countsAgree = selfTotal === ovAnalyzeTotal && ovAnalyzeTotal === ovProdTotal
const collapseCloses = emissionsBeforeDedup - collapsedByDedup === selfTotal
const noFilterLoss = ovAnalyzeTotal === ovProdTotal && inAnalyzeTotal === inProdTotal
console.log(`  self === analyze() === parseFile              ${countsAgree ? "OK" : `DRIFT: ${selfTotal} / ${ovAnalyzeTotal} / ${ovProdTotal}`}`)
console.log(`  before - collapsed === after                  ${collapseCloses ? "OK" : `DRIFT: ${emissionsBeforeDedup} - ${collapsedByDedup} != ${selfTotal}`}`)
console.log(`  filter removes nothing (overrides+instantiates) ${noFilterLoss ? "OK" : "LOSS"}`)
if (countsAgree && collapseCloses && noFilterLoss) {
  console.log("")
  console.log("RESULT: the three counts agree. Before the fix this read 118 / 95 / 95 with the 23 in")
  console.log("        stage 1; the analyzer now publishes the post-collapse count and carries the")
  console.log("        collapse beside it. Nothing is lost between the analyzer and the index.")
  process.exit(0)
} else {
  console.log("")
  console.log("RESULT: DRIFT. One of the three counts moved against the others. This is the defect")
  console.log("        the probe was written to find; investigate before declaring anything.")
  process.exit(1)
}
