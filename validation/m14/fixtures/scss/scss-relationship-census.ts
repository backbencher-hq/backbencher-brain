/**
 * SCSS RELATIONSHIP CENSUS — §2b of the lane brief, through the PRODUCTION entry.
 *
 * Every number this lane reports comes from `parseFile` (src/ast/pool-worker.ts), never
 * from `analyze()`. `analyze()` is the per-file unit and SKIPS the pipeline stages that
 * decide what a consumer sees: the pool, the analyzer timeout, truncation and the
 * enhancement passes. A count taken from `analyze()` is a count of the analyzer's
 * intent rather than of what the store receives, and the difference is exactly where
 * the lane's defects live.
 *
 * WHAT IT MEASURES, per the brief:
 *   - relationship types, with counts and the files each came from
 *   - `SymbolKind` values, and any empty or unknown kind
 *   - symbols with an empty name
 *   - relationship endpoints equal to the literal `unknown`
 *   - BOTH endpoints of every edge resolved against the file's own symbol set, per type
 *
 * The resolution rate is reported per type because a single pooled number hides the
 * only fact that matters: CSS `references` resolves at both ends on 66.8% of its edges,
 * and a type at 0% is a type whose edges cannot be joined to anything.
 *
* USAGE:  npx tsx validation/m14/fixtures/scss/scss-relationship-census.ts [sampleSize]
 * The sample is DETERMINISTIC: every admitted `.scss` path is sorted, then every Nth is
 * taken, so the same corpus yields the same FILES on every run.
 *
 * ## THE FILE SET IS DETERMINISTIC. THE EDGE COUNTS ARE NOT. — measured, 2026-10-04
 *
 * This header used to claim the number itself was reproducible. Four runs of this script
 * over the SAME 4,433 admitted files disagreed:
 *
 *   run          degraded   contains   imports   extends   symbols   exports
 *   committed        4        12,371    3,634     423/151   39,601     4,019
 *   re-run          10        12,371    3,611     423/151   39,650     4,019
 *   A                3        12,373    3,619     427/152   39,660     4,019
 *   B                7        12,374    3,619     427/152   39,599     4,019
 *   E                6        12,369    3,623     423/151   39,650     4,018
 *
 * `calls` 304, `uses` 91, `references` 6,594 and `overrides` 32 were IDENTICAL in all five.
 * The movement is confined to `contains`, `imports`, `extends` and — from run E — `exports`.
 *
 * Run E is the one that corrected this header. Four runs agreed on `exports` at 4,019, and
 * this header therefore listed `exports` among the invariant types; run E reads 4,018, so
 * the invariant set is four types, not five. A property asserted from four samples and then
 * broken by the fifth is a sample, not a property, which is the same error as reading a
 * per-type count without its population.
 *
 * ## THE CAUSE — and the first explanation of it was wrong
 *
 * The obvious story is "more degraded files, fewer edges", and it is FALSE here: the four
 * degraded counts are 4, 10, 3 and 7 while `imports` runs 3,634 / 3,611 / 3,619 / 3,619,
 * which is not monotone in them. Run B settles it directly — its per-file sidecar records
 * that all 7 degraded files contributed **0 edges**, so a degraded file is not a partial
 * producer, it is a total non-producer, and the degraded COUNT is not the variable.
 *
 * The variable is WHICH files degrade, and it is a different set every run:
 *
 *   run A  bulma/.../fontawesome-free-6.5.2-web/scss/solid.scss
 *          consul/.../icons/file-diff/keyframes.scss, consul/.../plus-square-fill/placeholders.scss
 *   run B  bulma/.../scss/fontawesome.scss, consul/.../lock/property-24.scss,
 *          consul/.../logo-alicloud-color/{index,keyframes}.scss,
 *          element-plus/packages/theme-chalk/src/select-v2.scss,
 *          r-pkgdown/inst/highlight-styles/solarized-{dark,light}.scss
 *   run E  bulma/.../scss/fontawesome.scss, consul/.../inline-alert/debug.scss,
 *          consul/.../file-diff/keyframes.scss,
 *          consul/.../plus-circle/property-{16,24}.scss,
 *          element-plus/packages/theme-chalk/src/select.scss
 *
 * Run E is the run that makes "a different set every run" a measurement rather than a
 * phrase: only 2 of its 6 files (fontawesome.scss, file-diff/keyframes.scss) appeared in an
 * earlier run's list, so 4 of 6 are new. The three runs' lists are drawn from three
 * different repos' worth of the same shape — consul icon property sheets and element-plus
 * theme-chalk partials — which is consistent with a shared cause rather than with N
 * independent bad files, and `scss-flaky-files.ts` measures 22 candidates for it.
 *
 * A file that succeeds contributes its edges and a file that fails contributes none, so the
 * run-to-run spread is the sum of the edge counts of the flaky files that happened to fail
 * — which is why `imports` moves by up to 23 while `overrides` does not move at all:
 * a 6 KB `keyframes.scss` carries no `@use`, and `select-v2.scss` carries many.
 * `scss-flaky-files.ts` measures that sum per file.
 *
 * So: report a per-type edge count with the degraded count beside it, or report the count
 * as a lower bound on a run with N degraded files. A bare count from this script is a
 * statement about one run's machine load, which is the thing §2 of the honesty contract
 * calls a count without its population.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SAMPLE = Number(process.argv[2] ?? 200)
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]

// ── the admitted population, exactly the gate's admission rule ────────────────
// The gate and this census MUST agree on the denominator. A census over a different
// file set than the arbiter's makes every number uncheckable by the instrument meant
// to check them; the css lane once read 1,171 where the gate read 1,180 purely because
// it called `detectLanguageFromPath` with one argument where the gate uses two.
const all: string[] = []
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
  for (const rel of tracked) all.push(path.join(dir, rel))
}
const admitted: string[] = []
for (const abs of all) {
  let text: string
  try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
  if (detectLanguageFromPath(abs, text) !== "scss") continue
  admitted.push(abs)
}
admitted.sort()

// every Nth, not the first N: the first N of a sorted path list is one repository's
// alphabetically-early directories, which is a statement about directory naming.
const step = Math.max(1, Math.floor(admitted.length / SAMPLE))
const sample = admitted.filter((_, i) => i % step === 0).slice(0, SAMPLE)

// ── the census ────────────────────────────────────────────────────────────────
type Row = { n: number; files: Set<string>; seen: Set<string>; bothEnds: number }
const byType = new Map<string, Row>()
const kinds = new Map<string, number>()
const unknownKinds = new Map<string, number>()
let emptyNames = 0
let symbols = 0
let unknownEndpoints = 0
let filesOk = 0
let filesFailed = 0
let importsArray = 0
let degradedFiles = 0
const degradedList: string[] = []
let filesWithErrors = 0
let filesErrorsAndZeroEdges = 0
const errorsAndZeroEdgesList: string[] = []
const unflagged = new Map<string, string>()
let confidenceLow = 0
const confByType = new Map<string, { low: number; n: number }>()

let idx = 0
const perFile = new Map<string, Record<string, number>>()
const flags = new Map<string, { fb: boolean; dg: boolean; err: number; rels: number }>()
async function worker(): Promise<void> {
  for (;;) {
    const i = idx++
    if (i >= sample.length) return
    const abs = sample[i]
    let r: any
    try { r = await parseFile(abs, path.dirname(abs)) } catch { filesFailed++; continue }
    const names = new Set<string>()
    for (const s of r.symbols ?? []) {
      symbols++
      const nm = String(s?.name ?? "")
      if (nm.length === 0) emptyNames++
      else names.add(nm)
      const k = String(s?.kind ?? "")
      kinds.set(k, (kinds.get(k) ?? 0) + 1)
      if (k.length === 0) unknownKinds.set("(empty)", (unknownKinds.get("(empty)") ?? 0) + 1)
    }
    const rel = path.relative(CR, abs)
    if (r.fallback === true || r.degraded === true) { degradedFiles++; degradedList.push(rel) }
    // THE THIRD FAILURE MODE, and the one the degraded list cannot see. `fallback` and
    // `degraded` are flags; this is the absence of a flag. `engine.ts` returns a result
    // whose `relationships` are empty and whose `errors` are populated when a parse yields
    // ERROR nodes, and `pool-worker.ts:1180` forwards exactly that — `fallback` stays
    // unset. So a file can be walked, throw nothing, be flagged as nothing, and contribute
    // zero edges, and a census that counts only the flags calls it clean.
    //
    // Measured to be a real population rather than a theoretical one: a differencing of two
    // sidecars over the same 4,433 files found 8 files whose per-type counts moved, and 3
    // of the 8 were flagged in NEITHER run (brands.scss and regular.scss +2 imports each,
    // solid.scss -2). These counters say whether such a file is the ERROR-node shape, and
    // the flag is recorded per file in the sidecar so the next run is differenced against
    // this one rather than re-derived.
    const errCount = Array.isArray(r.errors) ? r.errors.length : 0
    const relCount = Array.isArray(r.relationships) ? r.relationships.length : 0
    if (errCount > 0) filesWithErrors++
    if (errCount > 0 && relCount === 0) { filesErrorsAndZeroEdges++; errorsAndZeroEdgesList.push(rel) }
    if (Array.isArray(r.imports)) importsArray += r.imports.length
    const mine: Record<string, number> = Object.create(null)
    let produced = 0
    for (const e of r.relationships ?? []) {
      const t = String(e?.type ?? "")
      const row = byType.get(t) ?? { n: 0, files: new Set<string>(), seen: new Set<string>(), bothEnds: 0 }
      byType.set(t, row)
      row.n++
      mine[t] = (mine[t] ?? 0) + 1
      // `seen` counts DISTINCT files; `files` keeps a bounded sample for printing. They
      // are two different facts and the first version conflated them by capping the set
      // it counted from, so every type read "6 files" whatever its true spread.
      row.seen.add(rel)
      if (row.files.size < 4) row.files.add(rel)
      const src = String(e?.source ?? "")
      const dst = String(e?.target ?? "")
      if (src === "unknown" || dst === "unknown") unknownEndpoints++
      if (src.length > 0 && dst.length > 0 && names.has(src) && names.has(dst)) row.bothEnds++
      const conf = typeof e?.confidence === "number" ? e.confidence : 1
      if (conf < 0.7) confidenceLow++
      const cb = confByType.get(t) ?? { low: 0, n: 0 }
      cb.n++
      if (conf < 0.7) cb.low++
      confByType.set(t, cb)
      produced++
    }
    perFile.set(rel, mine)
    // Recorded per file so a later run can be differenced against this one: the flag is
    // what decides whether a mover was explained by the fallback path or not.
    flags.set(rel, { fb: r.fallback === true, dg: r.degraded === true, err: errCount, rels: relCount })
    if (produced > 0) filesOk++
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

console.log(`scss relationship census — production parseFile`)
console.log(`corpus root        ${CR}`)
console.log(`admitted .scss     ${admitted.length} tracked files`)
console.log(`sampled            ${sample.length} (every ${step}th of the sorted admitted list)`)
console.log(`repos represented  ${new Set(sample.map((f) => f.split("/").slice(-3, -2)[0] ?? "")).size}`)
console.log(`files with >=1 edge ${filesOk} / ${sample.length};  thrown ${filesFailed};  fallback/degraded ${degradedFiles}`)
console.log(
  `UNFLAGGED population: ${filesWithErrors} files carry >=1 parse error, of which ` +
    `${filesErrorsAndZeroEdges} carry errors AND zero relationships with neither fallback nor degraded set`,
)
if (errorsAndZeroEdgesList.length) {
  for (const f of errorsAndZeroEdgesList.slice(0, 6)) console.log(`    errors+0 edges, unflagged: ${f}`)
  if (errorsAndZeroEdgesList.length > 6) console.log(`    ... and ${errorsAndZeroEdgesList.length - 6} more`)
}
console.log(`symbols ${symbols.toLocaleString()}   empty names ${emptyNames}   ParseResult.imports entries ${importsArray.toLocaleString()}   endpoints == "unknown" ${unknownEndpoints}`)
console.log(`edges under confidence 0.7: ${confidenceLow}\n`)
console.log(`${"type".padEnd(12)}${"edges".padStart(9)}${"files".padStart(7)}${"both-ends resolved".padStart(21)}${"conf<0.7".padStart(10)}`)
console.log("-".repeat(60))
for (const t of ALL_TYPES) {
  const row = byType.get(t)
  const cb = confByType.get(t)
  if (!row) { console.log(`${t.padEnd(12)}${"0".padStart(9)}${"-".padStart(7)}${"n/a".padStart(21)}${"-".padStart(10)}`); continue }
  const pct = ((row.bothEnds / row.n) * 100).toFixed(1)
  console.log(`${t.padEnd(12)}${row.n.toLocaleString().padStart(9)}${String(row.seen.size).padStart(7)}${`${row.bothEnds.toLocaleString()} (${pct}%)`.padStart(21)}${String(cb?.low ?? 0).padStart(10)}`)
}
const offType = [...byType.keys()].filter((t) => !ALL_TYPES.includes(t))
if (offType.length) console.log(`\nlabels outside the 10-type ontology: ${offType.map((t) => `${t} x${byType.get(t)!.n}`).join(", ")}`)
console.log(`\nsymbol kinds:`)
for (const [k, v] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(16)} ${v.toLocaleString()}`)
if (unknownKinds.size) console.log(`\nEMPTY/UNKNOWN kind: ${[...unknownKinds].map(([k, v]) => `${k} x${v}`).join(", ")}`)
console.log(`\nfiles behind each type:`)
for (const t of ALL_TYPES) {
  const row = byType.get(t)
  if (row) console.log(`  ${t.padEnd(12)} ${[...row.files].slice(0, 3).join(", ")}`)
}
// WHICH files took the degraded extractor, not just how many. Two runs of this script over
// the same admitted set produced different per-type counts and the difference tracked this
// list, so naming the files turns that correlation into something a reviewer re-derives.
console.log(`\nDEGRADED_FILES (${degradedList.length}) — the non-deterministic part of this census:`)
for (const f of [...degradedList].sort()) console.log(`  ${f}`)

// PER-FILE sidecar, so the run-to-run delta is arithmetic a reviewer can check instead of
// a correlation they have to accept. Sum `counts[type]` over the DEGRADED_FILES list and
// that is the most the degraded set can account for; anything beyond it is variance this
// census does not yet explain, and both numbers belong in the write-up.
const sidecar = process.env.BB_CENSUS_SIDECAR
if (sidecar) {
  const degraded = new Set(degradedList)
  const byTypeForDegraded: Record<string, number> = Object.create(null)
  for (const f of degradedList) {
    const mine = perFile.get(f) ?? {}
    for (const [t, n] of Object.entries(mine)) byTypeForDegraded[t] = (byTypeForDegraded[t] ?? 0) + n
  }
  writeFileSync(
    sidecar,
    JSON.stringify(
      {
        admitted: admitted.length,
        sampled: sample.length,
        degradedFiles: degradedList,
        degradedFilesWithNoEdges: degradedList.filter((f) => Object.keys(perFile.get(f) ?? {}).length === 0),
        edgeContributionOfDegradedFiles: byTypeForDegraded,
        // The unflagged population, by name. Without it a mover that neither run flagged
        // is unattributable, and the diff reports it as movement with no cause.
        filesWithErrorsAndZeroEdges: errorsAndZeroEdgesList,
        filesWithErrors: filesWithErrors,
        perFile: Object.fromEntries(perFile),
        // Per-file flags, so a differencing can say for each mover whether it was explained
        // by the fallback path, by ERROR nodes, or by neither.
        flags: Object.fromEntries(flags),
      },
      null,
      1,
    ),
  )
  console.log(`\nsidecar written: ${sidecar}`)
  console.log(`  degraded files contributing 0 edges: ${degradedList.filter((f) => Object.keys(perFile.get(f) ?? {}).length === 0).length}/${degradedList.length}`)
  for (const t of ALL_TYPES) {
    const n = byTypeForDegraded[t] ?? 0
    if (n) console.log(`  ${t.padEnd(12)} ${n} of ${byType.get(t)?.n ?? 0} edges came from a DEGRADED file`)
  }
}
