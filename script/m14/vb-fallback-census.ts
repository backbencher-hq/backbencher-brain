/**
 * HOW MUCH OF THE VB CORPUS IS ACTUALLY ANALYSED, AND HOW MUCH IS A SILENT
 * FALLBACK? The number every VB corpus total depends on.
 *
 * WHY THIS FILE EXISTS. `pool-worker.parseFile` returns
 * `extractFallback(content, …)` — a language-agnostic TEXT pass that produces
 * symbols, imports and relationships WITHOUT the grammar — whenever the engine
 * throws, and it returns that object through the same `parseFile` a caller uses.
 * The return value carries `fallback: true`, but every consumer in this lane
 * counts `parseFile` results as analyzer output, because there is nothing in the
 * result that says "this file never reached RealVbAnalyzer" except that one flag.
 *
 * Two consequences, both measured here rather than asserted:
 *
 *   1. A corpus total is a MIXTURE of analyzer rows and fallback rows, and the
 *      proportion is not recorded anywhere. `2,658 files parsed, 0 parse
 *      failures` reads as "the analyzer saw 2,658 files" and means "2,658 files
 *      returned something".
 *   2. The mixture is NOT STABLE. `vb-determinism-probe.ts` observed the same
 *      file yield two different answers across four identical sweeps, with
 *      `[BB-PARSE-ERR] … memory access out of bounds` and
 *      `[BB-HANG] parser stuck 120s` in the log for that file. The pinned wasm
 *      traps intermittently under the 8-way concurrency every sweep in this lane
 *      uses, so a file's contribution to a sweep total is a SAMPLE, not a
 *      property of the language. That is why the recorded BEFORE artifact
 *      (102,295 relationships) and an independent re-measurement of the same
 *      commit over the same files (102,399) differ by 104.
 *
 * So this file counts, per file, which of three things happened:
 *
 *   ANALYZED  the real analyzer ran — `fallback` is absent/false
 *   FALLBACK  `extractFallback` answered, so no grammar and no RealVbAnalyzer
 *   EMPTY    the path returned nothing at all
 *
 * and cross-tabs the FALLBACK set against the per-type relationship labels, so
 * the answer is "N of the M `references` edges in this total are text-scan rows",
 * which is the only form of the number a reader can act on.
 *
 * It reads no analyzer source and imports no analyzer symbol.
 *
 * CLI: npx tsx script/m14/vb-fallback-census.ts [--workers 4] [--out f.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const CR = process.env.BB_VB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPOS = (argOf("--repo", "p3d,dismt,pcl,tankex,runtime") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const WORKERS = Math.max(1, parseInt(argOf("--workers", "4") ?? "4"))
const OUT = argOf("--out")

const files: { repo: string; dir: string; rel: string; abs: string }[] = []
for (const e of REPOS) {
  const dir = path.join(CR, e)
  try { statSync(dir); execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".vb")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    let text = ""
    try { text = readFileSync(abs, "utf8").replace(/^\uFEFF/, "") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "vb") continue
    files.push({ repo: e, dir, rel, abs })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))
console.log(`vb fallback census — corpus ${CR}  repos ${REPOS.join(",")}  admitted ${files.length}  workers ${WORKERS}`)

type Verdict = "ANALYZED" | "FALLBACK" | "EMPTY" | "THREW"
type Row = { verdict: Verdict; symbols: number; rels: number; byType: Map<string, number> }
const rows = new Map<string, Row>()
let idx = 0
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    const label = `${f.repo}/${f.rel}`
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch {
      rows.set(label, { verdict: "THREW", symbols: 0, rels: 0, byType: new Map() })
      continue
    }
    const relsIn: any[] = r?.relationships ?? []
    const symsIn: any[] = r?.symbols ?? []
    const byType = new Map<string, number>()
    for (const x of relsIn) {
      const t = String(x?.type ?? x?.relationshipType ?? "")
      byType.set(t, (byType.get(t) ?? 0) + 1)
    }
    // `fallback` is set by BOTH fallback branches (over-5MB skip and the
    // extractFallback throw path), so it is the flag that says "the grammar did
    // not answer this file". Its absence is the only positive evidence that
    // RealVbAnalyzer ran, which is why the verdict is stated that way round.
    const verdict: Verdict = r?.fallback === true ? "FALLBACK" : symsIn.length === 0 && relsIn.length === 0 ? "EMPTY" : "ANALYZED"
    rows.set(label, { verdict, symbols: symsIn.length, rels: relsIn.length, byType })
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()))

const tally: Record<Verdict, number> = { ANALYZED: 0, FALLBACK: 0, EMPTY: 0, THREW: 0 }
const perVerdictTotals: Record<Verdict, { symbols: number; rels: number }> = {
  ANALYZED: { symbols: 0, rels: 0 }, FALLBACK: { symbols: 0, rels: 0 }, EMPTY: { symbols: 0, rels: 0 }, THREW: { symbols: 0, rels: 0 },
}
const perVerdictTypes = new Map<Verdict, Map<string, number>>()
const offenders: string[] = []
for (const [label, row] of [...rows].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  tally[row.verdict]++
  perVerdictTotals[row.verdict].symbols += row.symbols
  perVerdictTotals[row.verdict].rels += row.rels
  const m = perVerdictTypes.get(row.verdict) ?? new Map<string, number>()
  for (const [t, n] of row.byType) m.set(t, (m.get(t) ?? 0) + n)
  perVerdictTypes.set(row.verdict, m)
  if (row.verdict === "FALLBACK") offenders.push(label)
}

const total = files.length
const pct = (n: number): string => `${((n / Math.max(1, total)) * 100).toFixed(2)}%`
console.log(`\nper-file outcome over ${total} files`)
for (const v of ["ANALYZED", "FALLBACK", "EMPTY", "THREW"] as const) {
  console.log(`  ${v.padEnd(9)} ${String(tally[v]).padStart(5)} files  (${pct(tally[v]).padStart(6)})   symbols ${perVerdictTotals[v].symbols}  relationships ${perVerdictTotals[v].rels}`)
}
console.log(`\nrelationship labels by verdict (this is the cross-tab that says how much of each total is a text-scan row)`)
const allTypes = [...new Set([...(perVerdictTypes.get("ANALYZED")?.keys() ?? []), ...(perVerdictTypes.get("FALLBACK")?.keys() ?? [])])].sort()
console.log(`  ${"type".padEnd(14)}${"ANALYZED".padStart(10)}${"FALLBACK".padStart(10)}  note`)
for (const t of allTypes) {
  const a = perVerdictTypes.get("ANALYZED")?.get(t) ?? 0
  const f = perVerdictTypes.get("FALLBACK")?.get(t) ?? 0
  const note = f > 0 && a === 0 ? "fallback-only label" : f > 0 ? `${((f / Math.max(1, a + f)) * 100).toFixed(1)}% of this label is a text-scan row` : ""
  console.log(`  ${t.padEnd(14)}${String(a).padStart(10)}${String(f).padStart(10)}  ${note}`)
}
console.log(`\nfiles that were answered WITHOUT the grammar (first 25 of ${offenders.length}):`)
for (const o of offenders.slice(0, 25)) console.log(`  ${o}`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    corpusRoot: CR, repos: REPOS, admitted: total, workers: WORKERS,
    tally, perVerdictTotals,
    perVerdictTypes: Object.fromEntries([...perVerdictTypes].map(([k, v]) => [k, Object.fromEntries([...v].sort())])),
    fallbackFiles: offenders,
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}
// Silence is not a pass: a corpus where nothing fell back and a corpus where it did
// are different facts, and the exit code has to distinguish them.
process.exitCode = tally.FALLBACK === 0 && tally.THREW === 0 ? 0 : 1
