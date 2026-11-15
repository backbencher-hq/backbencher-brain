/**
 * CSS-D15 TARGET-SPELLING COMPATIBILITY — the two shared rules a file-scoped target must obey,
 * checked against the SHARED implementations, with controls that fail.
 *
 * WHY THIS EXISTS. `real-css-analyzer.ts` respells an edge's target to `<file-scope>::<name>`
 * when the edge's own file publishes exactly one declaration of that name (CSS-D15). That
 * spelling is not free: two shared rules downstream read targets, and a spelling change is
 * exactly how a lane silently loses edges or breaks a differential — the fsharp `tearDown`
 * defect in `pool-worker.ts` was found "by measuring a spelling change rather than by reading
 * this function", and this lane found its own version of it the same way. So both rules are
 * asserted here, on LIVE analyzer output, against the shared code rather than a copy of it:
 *
 *   1. `script/m14/differential.ts` matches a truth row to an analyzer edge on
 *      `label + normTarget(target)`, and `normTarget` takes the last `.`/`::`-delimited
 *      segment. The css differential is green today (0 MISSING / 0 unexplained on both pinned
 *      repos), so a qualified target must normalise to the SAME leaf the bare one does.
 *   2. `src/ast/pool-worker.ts` `filterNoiseRelationships` runs on the analyzer's output on the
 *      way to the index and DELETES a target longer than 200 characters. The analyzer's own
 *      guard refuses to qualify a target that would cross that budget; this file asserts the
 *      budget is still 200 by handing the shared filter a 201-character target and requiring
 *      the drop.
 *
 * THE CONTROLS are the point. A compatibility check that has only ever said "compatible" is
 * not evidence, so two deliberately-wrong spellings must be REJECTED: a qualified target that
 * keeps the file extension (its last `.`-segment is no longer the bare name) and a target one
 * character over the worker's budget.
 *
 * Usage: npx tsx validation/m14/fixtures/css/qualified-target-compat.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { normTarget } from "../../../../script/m14/differential"
import { filterNoiseRelationships } from "../../../../src/ast/pool-worker"
import { getParser } from "../../../../src/ast/engine"
import { RealCssAnalyzer } from "../../../../src/ast/real-css-analyzer"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, "../../../..")

function cssFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name.startsWith(".")) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...cssFiles(p))
    else if (e.name.endsWith(".css")) out.push(p)
  }
  return out
}

const parser = await getParser("css")
const analyzer = new RealCssAnalyzer()
let qualified = 0, compatFail = 0, filterFail = 0, budgetFail = 0
const failures: string[] = []

for (const f of cssFiles(HERE)) {
  const content = readFileSync(f, "utf8")
  const result: any = analyzer.analyze(parser.parse(content).rootNode, content, path.relative(REPO, f))
  const declaredNames = new Set<string>((result.symbols ?? []).map((s: any) => String(s?.name ?? "")))
  for (const rel of result.relationships ?? []) {
    const target = String(rel.target ?? "")
    const cut = target.indexOf("::")
    if (cut < 0) continue
    qualified++
    const bare = target.slice(cut + 2)
    const scopePart = target.slice(0, cut)
    const where = `${path.relative(REPO, f)} -> ${target}`
    // 1. the differential's leaf identity
    if (normTarget(target) !== normTarget(bare)) { compatFail++; failures.push(`differential: ${where}`) }
    // 2. the worker's garbage rule keeps it
    const kept = filterNoiseRelationships([{ ...rel, target }], "css", declaredNames)
    if (kept.length !== 1) { filterFail++; failures.push(`worker filter dropped: ${where}`) }
    // 3. the analyzer's own budget guard
    if (target.length > 200) { budgetFail++; failures.push(`over budget (${target.length}): ${where}`) }
    // 4. the scope itself must be dotless, or `normTarget` would split inside it
    if (scopePart.includes(".")) { compatFail++; failures.push(`scope carries a dot: ${where}`) }
  }
}

// ── THE CONTROLS: spellings that MUST be rejected, or the checks above prove nothing.
//
// The DOTLESS target is the discriminating one. `normTarget` splits on `.` and `::`, so for a
// DOTTED name (`.btn`) almost any prefix still leaves `.btn` as the last dot-segment — the
// first version of this control used `.btn` and reported "rejected: NO", i.e. it was blind to
// the very failure it exists to detect. A DOTLESS name (`--brand`, `nav`, `fade`) puts the
// whole prefix into the last segment unless the separator is `::` and the prefix is dotless.
const bareDotless = normTarget("--brand")
const extensionKept = normTarget("fixtures/css/x.css#--brand")
const singleColon = normTarget("fixtures/css/x:--brand")
const correctSpelling = normTarget("fixtures/css/x::--brand")
// The single-colon spelling is the discriminating rejection: `normTarget` splits on `::` and
// on `.`, so a scope carrying dots is harmless (the `::` isolates the name) and the first
// version of this control asserted the opposite. A ONE-colon separator is what actually fails,
// because the whole prefix stays in the last segment — which is why the shipped separator is
// `::` and not `:`.
const controlA = extensionKept !== bareDotless && singleColon !== bareDotless && correctSpelling === bareDotless
// The worker's budget, which MOVED on 2026-10-10 — and this control is why that was noticed.
// `filterNoiseRelationships` used to refuse a target over 200 characters TOTAL, which a
// file-scoped spelling can cross (46 edges per 60 files, this lane's measurement, recorded in
// `pool-worker.ts` as the reason). The budget now applies to the target's LEAF. So the
// discriminating control is the case that USED to fail and must now be KEPT — a very long SCOPE
// with a short leaf — plus the other direction, which must still be refused or the check has no
// teeth: a long LEAF (a code snippet) is dropped whatever its scope.
const longScopeShortLeaf = "s".repeat(400) + "::.btn"
const longLeaf = "s".repeat(81)
const keptLongScope = filterNoiseRelationships([{ type: "contains", source: "a", target: longScopeShortLeaf }], "css", new Set()).length === 1
const droppedLongLeaf = filterNoiseRelationships([{ type: "contains", source: "a", target: longLeaf }], "css", new Set()).length === 0
const controlB = keptLongScope && droppedLongLeaf

console.log("css qualified-target compatibility — live analyzer output vs the shared rules")
console.log(`files ${cssFiles(HERE).length}   qualified targets seen ${qualified}`)
console.log(`  differential leaf identity (normTarget)   failures ${compatFail}`)
console.log(`  worker garbage rule keeps the target      failures ${filterFail}`)
console.log(`  no analyzer budget guard: the worker keeps it  failures ${budgetFail}`)
console.log(`controls: wrong spellings rejected — extension-kept ${extensionKept !== bareDotless ? "YES" : "NO"}, single-colon ${singleColon !== bareDotless ? "YES" : "NO"}, the shipped spelling still matches ${correctSpelling === bareDotless ? "YES" : "NO"} · worker leaf budget: long scope KEPT / long leaf DROPPED ${controlB ? "YES" : "NO"}`)
for (const x of failures.slice(0, 10)) console.log(`  FAIL ${x}`)
const verdict = compatFail === 0 && filterFail === 0 && budgetFail === 0 && controlA && controlB && qualified > 0
console.log(`\nVERDICT: ${verdict ? "COMPATIBLE — and the controls fired" : "FAILS — see above"}`)
process.exitCode = verdict ? 0 : 1
