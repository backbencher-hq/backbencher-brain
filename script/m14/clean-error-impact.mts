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
    name: string; line: number; family: string
    published: boolean; kind: string; visibility: string; symLines: number[]
    asSource: number; asTarget: number; asSourceTypes: Record<string, number>; asTargetTypes: Record<string, number>
  }[]
}

const results: ChildOut[] = []
let done = 0
let running = 0
const queue = files.slice()

async function worker(): Promise<void> {
  while (queue.length) {
    const abs = queue.shift()!
    const rows = byFile.get(abs)!
    const payload = JSON.stringify(rows.map((r) => ({ name: r.published, line: r.line, family: r.family })))
    try {
      const r = await execFileP("npx", ["tsx", CHILD, abs, payload], {
        encoding: "utf8", timeout: TIMEOUT_S * 1000, maxBuffer: 64 * 1024 * 1024,
      })
      const j = JSON.parse(r.stdout) as ChildOut
      results.push(j)
    } catch (e) {
      const ex = e as { stdout?: string; stderr?: string; signal?: NodeJS.Signals; code?: number | string }
      const stderr = ex.stderr ?? ""
      const out = ex.stdout ?? ""
      const hung = /\[BB-HANG\]/.test(stderr) || /\[BB-HANG\]/.test(out) || ex.signal === "SIGTERM"
      results.push({
        path: abs, outcome: hung ? "HUNG" : "ERRORED",
        error: (stderr.split("\n").filter((l) => /\[BB-(HANG|PARSE-ERR)\]/.test(l)).join(" ") || `exit ${ex.code ?? ex.signal}`).slice(0, 300),
        findings: [],
      })
    }
    done++
    if (done % 10 === 0 || done === files.length) {
      console.log(`  [${String(done).padStart(4)}/${files.length}] parsed ${results.filter((r) => r.outcome === "PARSED").length}  hung ${results.filter((r) => r.outcome === "HUNG").length}  errored ${results.filter((r) => r.outcome === "ERRORED").length}`)
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))

const parsed = results.filter((r) => r.outcome === "PARSED")
const hung = results.filter((r) => r.outcome === "HUNG")
const errored = results.filter((r) => r.outcome === "ERRORED")

type Agg = { rows: number; published: number; unpublished: number; withEdge: number; asSource: number; asTarget: number; byKind: Record<string, number>; byVisibility: Record<string, number>; edgeTypes: Record<string, number> }
const agg = (): Agg => ({ rows: 0, published: 0, unpublished: 0, withEdge: 0, asSource: 0, asTarget: 0, byKind: Object.create(null), byVisibility: Object.create(null), edgeTypes: Object.create(null) })
const perFamily: Record<string, Agg> = Object.create(null)
for (const r of parsed) {
  for (const f of r.findings ?? []) {
    const a = perFamily[f.family] ??= agg()
    a.rows++
    if (f.published) {
      a.published++
      a.byKind[f.kind || "(empty)"] = (a.byKind[f.kind || "(empty)"] ?? 0) + 1
      a.byVisibility[f.visibility || "(unset)"] = (a.byVisibility[f.visibility || "(unset)"] ?? 0) + 1
    } else a.unpublished++
    if (f.asSource + f.asTarget > 0) a.withEdge++
    a.asSource += f.asSource
    a.asTarget += f.asTarget
    for (const [ty, n] of Object.entries(f.asSourceTypes)) a.edgeTypes[`from:${ty}`] = ((a.edgeTypes[`from:${ty}`] as number) ?? 0) + n
    for (const [ty, n] of Object.entries(f.asTargetTypes)) a.edgeTypes[`to:${ty}`] = ((a.edgeTypes[`to:${ty}`] as number) ?? 0) + n
  }
}

const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(1)}%`)
const totalRows = Object.values(perFamily).reduce((a, x) => a + x.rows, 0)
const totalPub = Object.values(perFamily).reduce((a, x) => a + x.published, 0)
const totalEdge = Object.values(perFamily).reduce((a, x) => a + x.withEdge, 0)

console.log(`\nfiles measured ${files.length}  PARSED ${parsed.length}  HUNG ${hung.length}  ERRORED ${errored.length}`)
console.log(`  edges in those files: ${parsed.reduce((a, r) => a + (r.edges ?? 0), 0)}   symbols: ${parsed.reduce((a, r) => a + (r.symbols ?? 0), 0)}`)
console.log(`\nINVENTED NAMES, of ${totalRows} census rows in the files that walked:`)
for (const [fam, a] of Object.entries(perFamily).sort()) {
  console.log(`  ${fam.padEnd(34)} rows ${String(a.rows).padStart(4)}  published ${String(a.published).padStart(4)} (${pct(a.published, a.rows).padStart(6)})  with >=1 edge ${String(a.withEdge).padStart(4)} (${pct(a.withEdge, a.rows).padStart(6)})  edges in ${String(a.asSource + a.asTarget).padStart(5)}`)
}
console.log(`\n  TOTAL rows ${totalRows}  published ${totalPub} (${pct(totalPub, totalRows)})  with >=1 edge ${totalEdge} (${pct(totalEdge, totalRows)})`)
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
  population: { censusRows: censusRows.length, files: files.length, parsed: parsed.length, hung: hung.length, errored: errored.length },
  perFileBudgetS: TIMEOUT_S, concurrency: CONCURRENCY,
  totals: { rows: totalRows, published: totalPub, withEdge: totalEdge },
  perFamily, kinds: kindsAll, visibility: visAll, edgeTypes: edgeTypesAll,
  hung: hung.map((h) => h.path), errored: errored.map((h) => ({ path: h.path, error: h.error })),
  ndjson: path.relative(ROOT, NDJSON),
}, null, 2))
console.log(`\nJSON  ${path.relative(ROOT, OUT)}`)
console.log(`NDJSON ${path.relative(ROOT, NDJSON)}  ${flat.length} rows (one per invented name, with kind, visibility and edge counts)`)