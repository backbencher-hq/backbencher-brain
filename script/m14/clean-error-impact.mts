/**
 * clean-error-impact — do the invented names from `clean-error-census.mts` reach the graph?
 *
 *   npx tsx script/m14/clean-error-impact.mts [--concurrency 4] [--timeout 200]
 *          [--in <error-census.ndjson>] [--out <json>] [--ndjson <ndjson>]
 *
 * WHY THIS EXISTS. `clean-error-census.mts` walks the GRAMMAR and reports 823
 * invented-name nodes over the WIDE population, each with file, line and source text:
 *
 *   A 758  operator_definition whose name contains `,` or `_` — neither is a Clean
 *          operator character, so a parenthesised PATTERN carries neither
 *   B  16  operator_definition named `->`, the function-type arrow
 *   C  49  type_definition whose text is `::` + a uniqueness marker and nothing else
 *
 * Those are parse-tree facts, and a parse-tree fact is not a graph fact. The analyzer's
 * stated policy for a damaged region is "damage is not loss": `src/ast/real-clean-analyzer.ts:614`
 * computes `inErrorRegion` and keeps the symbols, flagging them so `emitExports` withholds
 * them from the module interface. Kept-and-flagged means the row is still IN the symbol
 * set, so the question this instrument answers is not "does the grammar produce damage"
 * but
 *
 *   does the damage become a PUBLISHED SYMBOL, and do RELATIONSHIPS POINT AT IT.
 *
 * A name that is published but attracts no edge is internal noise. A name that is the
 * target of an edge is a fabricated ENDPOINT: `bb_graph`, `bb_impact` and `bb_migrate`
 * cannot tell it from a real declaration, so it is a wrong answer, not a missing one.
 * Those two are very different severities and only this instrument separates them.
 *
 * HOW. One child process per file (`validation/m14/fixtures/clean/error-invented-names.mts`),
 * for the same reason `clean-excluded-probe.mts` does it: `src/ast/engine.ts:1441` arms a
 * 120 s WALL-CLOCK `setTimeout` and calls `process.exit(1)`. Ten lanes share this machine,
 * so the parent's contention is not the file's property. Each child reports its own
 * outcome — PARSED / HUNG / ERRORED — and a file that did not walk is never counted as a
 * file whose names published nothing.
 *
 * THE CONTROL. `--selftest` re-reads the census NDJSON and checks that every row it is
 * about to measure names a file that exists on disk, and prints `rows`, `files` and
 * `rowsWithMissingFile`. The guard this lane has already been bitten by twice: a census
 * that resolves its POPULATION from `process.cwd()` and a shard driver whose `--shard`
 * slot was never written, both of which printed clean numbers over zero files.
 */
import { execFile } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { promisify } from "node:util"

const execFileP = promisify(execFile)

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..")
const CHILD = path.join(ROOT, "validation", "m14", "fixtures", "clean", "error-invented-names.mts")
const argv = process.argv.slice(2)
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : "" }
const CONCURRENCY = Math.max(1, Number(arg("--concurrency") ?? 4) || 4)
const TIMEOUT_S = Number(arg("--timeout") ?? 200) || 200
const IN = arg("--in") || path.join(ROOT, "validation", "m14", "measurements", "clean", "error-census.ndjson")
const OUT = arg("--out") || path.join(ROOT, "validation", "m14", "measurements", "clean", "error-impact.json")
const NDJSON = arg("--ndjson") || path.join(ROOT, "validation", "m14", "measurements", "clean", "error-impact.ndjson")
const SELFTEST = argv.includes("--selftest")

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const WIDE_ROOT = "$HOME/fixtures/clean-wide"

/**
 * The census records a path RELATIVE to the corpus root (or to `$HOME/fixtures`
 * for the wide clones). `rel()` in the census did that; this reverses it. Two candidate
 * roots are tried and the ABSOLUTE path is verified to exist before the file is measured,
 * so a row that cannot be resolved is reported as unresolvable rather than skipped.
 */
function toAbs(relPath: string): string | null {
  for (const base of [CR, WIDE_ROOT, "$HOME/fixtures"]) {
    const abs = path.resolve(base, relPath)
    if (fs.existsSync(abs)) return abs
  }
  return null
}

type CensusRow = { family: string; nodeType: string; published: string; file: string; line: number; column: number; inError: boolean; src: string }

if (!fs.existsSync(IN)) {
  console.error(`no census NDJSON at ${path.relative(ROOT, IN)} — run script/m14/clean-error-census.mts first`)
  process.exit(2)
}
const censusRows: CensusRow[] = fs.readFileSync(IN, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as CensusRow)

// Group by file: one child per file, and every name the census found in that file goes
// in the same request, so one parse answers all of that file's rows.
const byFile = new Map<string, CensusRow[]>()
let rowsWithMissingFile = 0
for (const r of censusRows) {
  const abs = toAbs(r.file)
  if (!abs) { rowsWithMissingFile++; continue }
  const list = byFile.get(abs) ?? []
  list.push(r)
  byFile.set(abs, list)
}
const files = [...byFile.keys()].sort()

console.log(`clean error-impact`)
console.log(`census: ${path.relative(ROOT, IN)}`)
console.log(`rows ${censusRows.length}  files ${files.length}  rowsWithMissingFile ${rowsWithMissingFile}`)
if (SELFTEST) {
  console.log(`SELFTEST: ${rowsWithMissingFile === 0 ? "PASS" : "FAIL"} — every census row names a file on disk`)
  process.exit(rowsWithMissingFile === 0 ? 0 : 1)
}
if (rowsWithMissingFile > 0) {
  console.error(`refusing to measure a population with ${rowsWithMissingFile} unresolvable rows: the census and this script disagree about where the corpus is`)
  process.exit(2)
}

type ChildOut = {
  path: string; outcome: string; ms?: number; error?: string
  symbols?: number; edges?: number; parseErrors?: number
  findings?: {
    name: string; family: string; censusLines: number[]; copies: number
    symbols: { kind: string; visibility: string; start: number; end: number; qualifiedName: string }[]
    atCensusLine: boolean
    asSource: number; asTarget: number; asSourceTypes: Record<string, number>; asTargetTypes: Record<string, number>
  }[]
}

const results: ChildOut[] = []
let done = 0
const queue = files.slice()

/**
 * `exit 228` is this lane's machine, not the file's property.
 *
 * Measured 2026-10-05: at `--concurrency 4` the first walk reported
 *   files 145  PARSED 13  HUNG 0  ERRORED 132  — every error `exit 228`
 * and the SAME file walked standalone to exit 0 with 62 symbols and 236 edges. The machine
 * had `load average: 17.69` on 8 cores with `MemAvailable: 2 GiB` shared by ten lanes, and
 * a failing child exits with the allocator's code, not with a parse verdict. Counting 132
 * files as "this file's invented names published nothing" would have been a fabricated
 * result of the shape this programme exists to prevent: a denominator of 13 over a
 * population of 145 that reads as "97 census rows were measured".
 *
 * So an ERRORED file is retried ONCE, alone, and the retry's outcome is what the row
 * carries. `retried` records how many needed it, so the number of files that only walked
 * under a quieter machine stays visible in the JSON instead of being silently absorbed.
 */
let retried = 0

async function walk(abs: string): Promise<ChildOut> {
  const rows = byFile.get(abs)!
  const payload = JSON.stringify(rows.map((r) => ({ name: r.published, line: r.line, family: r.family })))
  const ex = await execFileP("npx", ["tsx", CHILD, abs, payload], {
    encoding: "utf8", timeout: TIMEOUT_S * 1000, maxBuffer: 64 * 1024 * 1024,
  })
  return JSON.parse(ex.stdout) as ChildOut
}

async function worker(): Promise<void> {
  while (queue.length) {
    const abs = queue.shift()!
    try {
      results.push(await walk(abs))
    } catch (e) {
      const ex = e as { stdout?: string; stderr?: string; signal?: NodeJS.Signals; code?: number | string }
      const stderr = ex.stderr ?? ""
      const out = ex.stdout ?? ""
      const hung = /\[BB-HANG\]/.test(stderr) || /\[BB-HANG\]/.test(out) || ex.signal === "SIGTERM"
      if (!hung) {
        // Serial retry, one file, no competition. A hang is NOT retried: the 120 s
        // wall-clock arm inside engine.ts is a property of the file and re-running it
        // would only spend the budget twice to learn the same thing.
        retried++
        try {
          results.push(await walk(abs))
          done++
          if (done % 10 === 0 || done === files.length) progress()
          continue
        } catch (e2) {
          const ex2 = e2 as { stderr?: string; signal?: NodeJS.Signals; code?: number | string }
          const hung2 = /\[BB-HANG\]/.test(ex2.stderr ?? "") || ex2.signal === "SIGTERM"
          results.push({
            path: abs, outcome: hung2 ? "HUNG" : "ERRORED",
            error: `first: exit ${ex.code ?? ex.signal}; retry: exit ${ex2.code ?? ex2.signal}`,
            findings: [],
          })
          done++
          if (done % 10 === 0 || done === files.length) progress()
          continue
        }
      }
      results.push({
        path: abs, outcome: "HUNG",
        error: (stderr.split("\n").filter((l) => /\[BB-(HANG|PARSE-ERR)\]/.test(l)).join(" ") || `exit ${ex.code ?? ex.signal}`).slice(0, 300),
        findings: [],
      })
    }
    done++
    if (done % 10 === 0 || done === files.length) progress()
  }
}

function progress(): void {
  const p = results.filter((r) => r.outcome === "PARSED").length
  const h = results.filter((r) => r.outcome === "HUNG").length
  const e = results.filter((r) => r.outcome === "ERRORED").length
  console.log(`  [${String(done).padStart(4)}/${files.length}] parsed ${p}  hung ${h}  errored ${e}  retried ${retried}`)
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))

const parsed = results.filter((r) => r.outcome === "PARSED")
const hung = results.filter((r) => r.outcome === "HUNG")
const errored = results.filter((r) => r.outcome === "ERRORED")

/**
 * ONE RECORD PER (file, name), NOT PER CENSUS ROW.
 *
 * The census reports one row per grammar NODE, so a name mentioned in three signatures
 * yields three rows against the same published symbol. The child already counts that
 * name's edges once per file; this level counts the name once per file too, so the
 * totals are a count of PUBLISHED NAMES and not of mentions. `censusRows` is kept
 * alongside so the two populations stay visible and their difference is checkable: rows
 * are mentions, names are symbols, and for family C they differ by a factor of 2.
 */
type Agg = {
  censusRows: number; names: number; published: number; unpublished: number
  /** Published names carrying MORE THAN ONE symbol in their file — the reverse-walk ambiguity. */
  ambiguousNames: number
  /** Total symbol copies behind those names, so the mean multiplicity is computable. */
  ambiguousCopies: number
  /** Copies sitting exactly on a census line, i.e. the artifact the grammar produced. */
  artifactCopies: number
  withEdge: number; asSource: number; asTarget: number
  byKind: Record<string, number>; byVisibility: Record<string, number>; edgeTypes: Record<string, number>
}
const agg = (): Agg => ({
  censusRows: 0, names: 0, published: 0, unpublished: 0, ambiguousNames: 0, ambiguousCopies: 0,
  artifactCopies: 0, withEdge: 0, asSource: 0, asTarget: 0,
  byKind: Object.create(null), byVisibility: Object.create(null), edgeTypes: Object.create(null),
})
const perFamily: Record<string, Agg> = Object.create(null)
for (const r of parsed) {
  for (const f of r.findings ?? []) {
    const a = perFamily[f.family] ??= agg()
    a.names++
    a.censusRows += f.censusLines.length
    if (f.copies > 0) {
      a.published++
      for (const s of f.symbols) {
        a.byKind[s.kind || "(empty)"] = (a.byKind[s.kind || "(empty)"] ?? 0) + 1
        a.byVisibility[s.visibility || "(unset)"] = (a.byVisibility[s.visibility || "(unset)"] ?? 0) + 1
      }
      if (f.copies > 1) { a.ambiguousNames++; a.ambiguousCopies += f.copies }
      a.artifactCopies += f.symbols.filter((s) => f.censusLines.includes(s.start)).length
    } else a.unpublished++
    if (f.asSource + f.asTarget > 0) a.withEdge++
    a.asSource += f.asSource
    a.asTarget += f.asTarget
    for (const [ty, n] of Object.entries(f.asSourceTypes)) a.edgeTypes[`from:${ty}`] = ((a.edgeTypes[`from:${ty}`] as number) ?? 0) + n
    for (const [ty, n] of Object.entries(f.asTargetTypes)) a.edgeTypes[`to:${ty}`] = ((a.edgeTypes[`to:${ty}`] as number) ?? 0) + n
  }
}

const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(1)}%`)
const sum = (k: keyof Agg) => Object.values(perFamily).reduce((a, x) => a + (x[k] as number), 0)
const totalRows = sum("censusRows"), totalNames = sum("names"), totalPub = sum("published")
const totalEdge = sum("withEdge"), totalAmb = sum("ambiguousNames"), totalArt = sum("artifactCopies")

console.log(`\nfiles measured ${files.length}  PARSED ${parsed.length}  HUNG ${hung.length}  ERRORED ${errored.length}`)
console.log(`  edges in those files: ${parsed.reduce((a, r) => a + (r.edges ?? 0), 0)}   symbols: ${parsed.reduce((a, r) => a + (r.symbols ?? 0), 0)}`)
console.log(`\nINVENTED NAMES, from ${totalRows} census rows in the files that walked:`)
for (const [fam, a] of Object.entries(perFamily).sort()) {
  console.log(`  ${fam.padEnd(34)} rows ${String(a.censusRows).padStart(4)}  names ${String(a.names).padStart(4)}  published ${String(a.published).padStart(4)} (${pct(a.published, a.names).padStart(6)})  ambiguous ${String(a.ambiguousNames).padStart(3)}  artifactCopies ${String(a.artifactCopies).padStart(4)}  edges ${String(a.asSource + a.asTarget).padStart(5)}`)
}
console.log(`\n  TOTAL rows ${totalRows}  names ${totalNames}  published ${totalPub} (${pct(totalPub, totalNames)})`)
console.log(`  of the published names, ${totalAmb} carry >1 symbol in their file = ${pct(totalAmb, totalPub)}, and ${totalArt} of the copies sit on a census line`)
console.log(`  names with >=1 edge: ${totalEdge} (${pct(totalEdge, totalNames)})   edges touching an invented name: ${sum("asSource") + sum("asTarget")}`)
console.log(`\n  published kinds:`)
const kindsAll: Record<string, number> = Object.create(null)
const visAll: Record<string, number> = Object.create(null)
const edgeTypesAll: Record<string, number> = Object.create(null)
for (const a of Object.values(perFamily)) {
  for (const [k, v] of Object.entries(a.byKind)) kindsAll[k] = (kindsAll[k] ?? 0) + v
  for (const [k, v] of Object.entries(a.byVisibility)) visAll[k] = (visAll[k] ?? 0) + v
  for (const [k, v] of Object.entries(a.edgeTypes)) edgeTypesAll[k] = (edgeTypesAll[k] ?? 0) + v
}
for (const [k, v] of Object.entries(kindsAll).sort((a, b) => (b[1] as number) - (a[1] as number))) console.log(`    ${String(v).padStart(5)}  ${k}`)
console.log(`  visibility of the published ones:`)
for (const [k, v] of Object.entries(visAll).sort((a, b) => (b[1] as number) - (a[1] as number))) console.log(`    ${String(v).padStart(5)}  ${k}`)
console.log(`  edges on the invented names, by role and type:`)
for (const [k, v] of Object.entries(edgeTypesAll).sort((a, b) => (b[1] as number) - (a[1] as number))) console.log(`    ${String(v).padStart(5)}  ${k}`)

const flat: any[] = []
for (const r of parsed) for (const f of r.findings ?? []) flat.push({ file: r.path, ...f })
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(NDJSON, flat.map((r) => JSON.stringify(r)).join("\n") + (flat.length ? "\n" : ""))
fs.writeFileSync(OUT, JSON.stringify({
  instrument: "script/m14/clean-error-impact.mts",
  child: path.relative(ROOT, CHILD),
  population: { censusRows: censusRows.length, files: files.length, parsed: parsed.length, hung: hung.length, errored: errored.length, retried },
  perFileBudgetS: TIMEOUT_S, concurrency: CONCURRENCY,
  totals: {
    censusRows: totalRows, names: totalNames, published: totalPub,
    ambiguousNames: totalAmb, artifactCopies: totalArt, withEdge: totalEdge,
    edgesTouchingInventedNames: sum("asSource") + sum("asTarget"),
  },
  perFamily, kinds: kindsAll, visibility: visAll, edgeTypes: edgeTypesAll,
  hung: hung.map((h) => h.path), errored: errored.map((h) => ({ path: h.path, error: h.error })),
  ndjson: path.relative(ROOT, NDJSON),
}, null, 2))
console.log(`\nJSON  ${path.relative(ROOT, OUT)}`)
console.log(`NDJSON ${path.relative(ROOT, NDJSON)}  ${flat.length} rows (one per invented name, with kind, visibility and edge counts)`)