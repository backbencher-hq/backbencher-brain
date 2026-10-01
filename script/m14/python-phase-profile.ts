/**
 * PY-PERF, PHASE SPLIT. Where does python's index time actually go — the PARSER or the
 * analyzer? The answer decides what is worth optimising, and it is not a question this repo
 * has answered: PY-18 filed the perf gate as unable to fail, and the measurements attached to
 * it report a single per-file number with no attribution inside it.
 *
 * The split matters because the two halves have completely different remedies. If the parser
 * dominates, the only real fix is not parsing (incremental parse, cache, or a cheaper grammar)
 * and analyzer work is wasted. If the analyzer dominates, a hot loop is fixable in the lane.
 *
 * Method, and its limits stated up front:
 *   · `parseTree` gives PARSE alone. `parseFile` gives PARSE + ANALYZE + engine post-processing
 *     (error traversal, metadata assembly, framework/architecture passes). So `analyzerMs` is
 *     `parseFile - parseTree` and INCLUDES that post-processing; it is not the analyzer alone.
 *     Separating those two would need another seam and is not claimed here.
 *   · One run per file, single-threaded, on a possibly loaded machine. These are ORDINALS for
 *     ranking, not a benchmark — the absolute numbers are not comparable to another machine's.
 *   · Files are truncated at the 1 MiB parse limit, exactly as production does, so a large file
 *     is measured on the bytes production reads.
 */

import * as fs from "node:fs"
import * as path from "node:path"

const root = process.argv[2]
const topN = Number(process.argv[3] ?? 25)
if (!root) {
  console.error("usage: python-phase-profile.ts <corpus-root> [topN]")
  process.exit(1)
}

const pyFiles: string[] = []
;(function walk(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith(".py")) pyFiles.push(p)
  }
})(root)

const engine: any = await import("../../src/ast/engine")

interface Row {
  file: string
  bytes: number
  parseMs: number
  totalMs: number
}

/** Analyzer PLUS engine post-processing — `parseFile` minus `parseTree`. Not the analyzer
 *  alone: `parseFile` also walks for ERROR nodes and assembles metadata. The split between
 *  those two is not claimed here. */
const analyzerMs = (r: Row): number => r.totalMs - r.parseMs
const analyzerShare = (r: Row): number => (r.totalMs === 0 ? 0 : analyzerMs(r) / r.totalMs)

const rows: Row[] = []
let nOk = 0
let nFail = 0

for (const f of pyFiles) {
  const raw = fs.readFileSync(f, "utf8")
  const content = raw.length > 1024 * 1024 ? raw.substring(0, 1024 * 1024) : raw

  let parseMs = 0
  let totalMs = 0
  try {
    let t0 = performance.now()
    const tr: any = await engine.ASTEngine.parseTree(f, content)
    parseMs = performance.now() - t0
    // Only the TREE is the caller's to delete. `parseTree`'s own note says the caller owns
    // `tree.delete()` "and, for Lua, parser/grammar cleanup" — for every other language the
    // parser comes from the engine's CACHE and is shared. Deleting it here broke the very next
    // `parseFile` in the loop, and the first version of this script reported "0 analysed,
    // 3271 failed" while the real fault was one over-eager cleanup two lines above.
    tr?.tree?.delete?.()

    t0 = performance.now()
    await engine.ASTEngine.parseFile(f, content)
    totalMs = performance.now() - t0
    nOk++
  } catch (e: any) {
    nFail++
    if (nFail <= 3) console.log(`  FAILED ${path.basename(f)}: ${String(e?.message ?? e).slice(0, 120)}`)
    continue
  }
  rows.push({ file: f, bytes: content.length, parseMs, totalMs })
}

rows.sort((a, b) => b.totalMs - a.totalMs)

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const totalMs = sum(rows.map((r) => r.totalMs))
const parseMs = sum(rows.map((r) => r.parseMs))
const analyzerTotalMs = sum(rows.map(analyzerMs))

const pct = (xs: number[], p: number): number => {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

console.log(`\nfiles: ${nOk} analysed, ${nFail} failed`)
console.log(`total: ${(totalMs / 1000).toFixed(1)}s   mean ${(totalMs / nOk).toFixed(1)}ms`)
console.log(`  PARSER   ${(parseMs / 1000).toFixed(1)}s  (${((100 * parseMs) / totalMs).toFixed(1)}% of total)`)
console.log(`  ANALYZER+ENGINE-POST ${(analyzerTotalMs / 1000).toFixed(1)}s  (${((100 * analyzerTotalMs) / totalMs).toFixed(1)}%)`)
console.log(`  p50 ${pct(rows.map((r) => r.totalMs), 50).toFixed(1)}ms  p95 ${pct(rows.map((r) => r.totalMs), 95).toFixed(1)}ms  p99 ${pct(rows.map((r) => r.totalMs), 99).toFixed(1)}ms  max ${rows[0]?.totalMs.toFixed(1)}ms`)

console.log(`\n  by SIZE:   >=256KB ${rows.filter((r) => r.bytes >= 256 * 1024).length} files carrying ${((100 * sum(rows.filter((r) => r.bytes >= 256 * 1024).map((r) => r.totalMs))) / totalMs).toFixed(1)}% of the time`)
const top8 = sum(rows.slice(0, 8).map((r) => r.totalMs))
console.log(`  by FILE:   top 8 files carry ${((100 * top8) / totalMs).toFixed(1)}% of the time`)

console.log(`\n  slowest ${Math.min(topN, rows.length)} files:`)
console.log(`    ${"total".padStart(9)} ${"parse".padStart(9)} ${"analyzer".padStart(9)} ${"share".padStart(6)}  file`)
for (const r of rows.slice(0, topN)) {
  const share = `${Math.round(100 * analyzerShare(r))}%`
  console.log(
    `    ${(r.totalMs.toFixed(0) + "ms").padStart(9)} ${(r.parseMs.toFixed(0) + "ms").padStart(9)} ` +
      `${(analyzerMs(r).toFixed(0) + "ms").padStart(9)} ${share.padStart(6)}  ` +
      `${path.basename(r.file)}`,
  )
}
