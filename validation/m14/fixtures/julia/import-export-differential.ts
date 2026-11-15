/**
 * JULIA `imports` / `exports` DIFFERENTIAL — the two DERIVATION findings, measured.
 *
 * ## What this is for
 *
 * `imports` and `exports` are the last two types this lane emits with NO independent derivation
 * behind them. Both were RULED non-applicable on prose, both were overturned by a corpus
 * measurement, and both are now emitted on 2,804 and 2,859 edges respectively with nothing comparing
 * them to a second derivation. This script is what makes them comparable: it drives BOTH sides over
 * the whole admitted corpus and reports the disagreement in BOTH directions.
 *
 * Both directions matter and the second is the one that finds defects. "The analyzer found what the
 * oracle found" cannot see an edge the ANALYZER invented, and this lane's history is dominated by the
 * opposite error — a type declared absent that was present, and edges whose SHAPE was narrower than
 * julia's grammar. So MISSING (oracle found it, analyzer did not) is reported first and is the column
 * to read.
 *
 * ## Why it runs the whole admitted population
 *
 * The surface is large — 2,804 and 2,859 edges — so a sample would be a sample of a large number and
 * the honest denominator is the population. It also runs at width 4, not width 8: `parseFile` traps
 * `memory access out of bounds` at 8-way concurrency on this corpus and degraded 0 times at width 4
 * across 4,800 parses, which is the evidence for the width rather than a rate (the trap is
 * probabilistic and this lane declines to quote one).
 *
 * ## What the comparison key is, and what it cannot see
 *
 * An edge is `(from, target)` per label, over a per-FILE set. Two consequences, both stated in the
 * output rather than left to be assumed:
 *
 *   1. **Direction is not part of the key**, so this cannot tell an edge that runs the wrong way. The
 *      oracles emit bare names on both sides and a name-keyed comparison is the only one both can
 *      answer.
 *   2. **The set is per file**, so a module imported by two statements in one scope is one edge on
 *      both sides, and an edge duplicated within a file cannot be counted as a defect.
 *
 * ## The limitation the three oracles share, declared once
 *
 * They are all SECOND WALKERS OVER THE SAME GRAMMAR. A grammar bug shared by the analyzer and the
 * oracle is invisible to every differential in this file. Only instrument A and instrument B measure
 * the language itself.
 *
 * READ-ONLY. Writes only to the path given by `--json`.
 *
 *   npx tsx validation/m14/fixtures/julia/import-export-differential.ts [--json <path>]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { deriveJuliaImportsTruth } from "../../../../script/m14/oracles/julia-imports"
import { deriveJuliaExportsTruth } from "../../../../script/m14/oracles/julia-exports"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const jsonOut = (() => { const i = process.argv.indexOf("--json"); return i >= 0 ? process.argv[i + 1] : null })()
const LIMIT = Number(process.env.BB_CENSUS_LIMIT ?? 0) || 0
const WORKERS = 4
const MAX_SHOWN = 40

type Edge = { label: string; from: string; target: string }

// ---- the admitted population, discovered exactly as the census and the arbiter discover it, then
// SORTED so the sample is a function of the corpus and not of directory order.
const files: { label: string; abs: string }[] = []
let overSize = 0
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) { if (abs.endsWith(".jl")) overSize++; continue }; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "julia") continue
    files.push({ label: `${e}/${rel}`, abs })
  }
}
files.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
const population = files.length
if (LIMIT) files.length = Math.min(files.length, LIMIT)

const key = (label: string, file: string, e: Edge) => `${label}|${file}|${e.from}|${e.target}`
const truth = new Map<string, Set<string>>()
const analyzer = new Map<string, Set<string>>()
const perFile = new Map<string, { truth: number; an: number }>()

let degraded = 0
let threw = 0
let done = 0

async function one(f: { label: string; abs: string }): Promise<void> {
  let res: any
  try { res = await parseFile(f.abs) } catch { threw++; return }
  if (!res) return
  // `parseFile` CATCHES a wasm load failure and silently substitutes a regex extractor, so a file
  // that degraded does not throw — it arrives with no symbol kinds. Named rather than counted in
  // passing, because the count of throws is not the count of parse failures.
  const md = (res as any)?.metadata ?? {}
  if (md.degraded || md.usedFallback || (res as any)?.degraded) degraded++
  const rels: any[] = (res as any)?.relationships ?? []
  for (const r of rels) {
    const label = String(r.type ?? "")
    if (label !== "imports" && label !== "exports") continue
    const k = key(label, f.label, { label, from: String(r.source ?? ""), target: String(r.target ?? "") } as Edge)
    let s = analyzer.get(label)
    if (!s) { s = new Set(); analyzer.set(label, s) }
    s.add(k)
    const pf = perFile.get(f.label) ?? { truth: 0, an: 0 }
    if (label === "imports") pf.an++
    else perFile.set(f.label, pf)
  }
  done++
}

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-julia.wasm"))))

for (const f of files) {
  let text: string
  try { text = readFileSync(f.abs, "utf8") } catch { continue }
  let tree: any
  try { tree = parser.parse(text) } catch { continue }
  if (!tree) continue
  // Free the tree on every exit path, including the `continue` inside the label loop below. This
  // loop parses the whole admitted corpus in ONE process, and an unfreed tree-sitter tree is held
  // by the wasm module for the life of the process: measured by
  // `validation/m14/fixtures/julia/tree-lifetime-probe.ts`, retaining trees makes the third pass
  // over 1,985 files throw `Aborted()` on 1,928 of them while freeing every tree makes all three
  // passes throw 0. `Edge` is a plain data record, so nothing read here outlives the tree.
  try {
    for (const [label, fn] of [["imports", deriveJuliaImportsTruth], ["exports", deriveJuliaExportsTruth]] as const) {
      let derived: Edge[] = []
      try { derived = (fn as any)(tree.rootNode) } catch { continue }
      let s = truth.get(label)
      if (!s) { s = new Set(); truth.set(label, s) }
      for (const e of derived) s.add(key(label, f.label, e))
    }
  } finally {
    try { tree.delete?.() } catch { /* already released */ }
  }
}

// ---- analyzer side, at width WORKERS
let cursor = 0
const failures: string[] = []
await Promise.all(Array.from({ length: WORKERS }, async () => {
  while (cursor < files.length) {
    const i = cursor++
    try { await one(files[i]!) } catch (e: any) { failures.push(`${files[i]!.label}: ${String(e?.message ?? e)}`) }
  }
}))

type Row = { label: string; covered: number; missing: number; unexplained: number; coveredPct: number; unexplainedPct: number; missingExamples: string[]; unexplainedExamples: string[] }
const rows: Row[] = []
for (const label of ["imports", "exports"]) {
  const t = truth.get(label) ?? new Set<string>()
  const a = analyzer.get(label) ?? new Set<string>()
  const missing = [...t].filter((k) => !a.has(k))
  const unexplained = [...a].filter((k) => !t.has(k))
  rows.push({
    label,
    covered: t.size - missing.length,
    missing: missing.length,
    unexplained: unexplained.length,
    coveredPct: t.size ? ((t.size - missing.length) / t.size) * 100 : 0,
    unexplainedPct: a.size ? (unexplained.length / a.size) * 100 : 0,
    missingExamples: missing.slice(0, MAX_SHOWN),
    unexplainedExamples: unexplained.slice(0, MAX_SHOWN),
  })
}

console.log(`JULIA imports/exports DIFFERENTIAL`)
console.log(`corpus root ${CR}`)
console.log(`population ${population} · analysed ${files.length}${LIMIT ? ` (BB_CENSUS_LIMIT=${LIMIT})` : " (no sampling)"} · width ${WORKERS}`)
console.log(`analyzer side: parseFile from src/ast/pool-worker.ts (production entry) · threw ${threw} · degraded ${degraded} · worker failures ${failures.length}`)
console.log(`truth side:   deriveJuliaImportsTruth / deriveJuliaExportsTruth, second walkers over the same grammar`)
console.log(`\nlabel        truth  covered   MISSING  covered%   analyzer  UNEXPL  unexpl%`)
for (const r of rows) {
  const a = analyzer.get(r.label)?.size ?? 0
  console.log(
    `${r.label.padEnd(12)}${String(r.covered + r.missing).padStart(5)}${String(r.covered).padStart(9)}${String(r.missing).padStart(10)}` +
    `${r.coveredPct.toFixed(1).padStart(9)}%${String(a).padStart(11)}${String(r.unexplained).padStart(8)}${r.unexplainedPct.toFixed(1).padStart(8)}%`,
  )
}
for (const r of rows) {
  if (r.missing) {
    console.log(`\n--- ${r.label}: MISSING ${r.missing} (oracle found, analyzer did not) ---`)
    for (const k of r.missingExamples) console.log(`    ${k}`)
    if (r.missing > r.missingExamples.length) console.log(`    … and ${r.missing - r.missingExamples.length} more`)
  }
  if (r.unexplained) {
    console.log(`\n--- ${r.label}: UNEXPLAINED ${r.unexplained} (analyzer emitted, oracle did not derive) ---`)
    for (const k of r.unexplainedExamples) console.log(`    ${k}`)
    if (r.unexplained > r.unexplainedExamples.length) console.log(`    ${r.unexplained - r.unexplainedExamples.length} more`)
  }
}
if (failures.length) {
  console.log(`\n--- worker failures (${failures.length}) ---`)
  for (const f of failures.slice(0, 20)) console.log(`    ${f}`)
}

const payload = {
  issueId: "m60-julia-import-export-differential",
  corpusRoot: CR,
  population,
  analysed: files.length,
  sampled: LIMIT > 0,
  width: WORKERS,
  analyzerEntry: "parseFile (src/ast/pool-worker.ts)",
  threw,
  degraded,
  workerFailures: failures.length,
  keyIsDirectionless: true,
  setIsPerFile: true,
  rows,
}
if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(payload, null, 2)); console.log(`\nwrote ${jsonOut}`) }