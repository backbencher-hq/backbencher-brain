// Is the scala analyzer's tail QUADRATIC?
//
// The full-corpus perf baseline gave median 2.70ms, p90 19.71ms, p99 194ms and a
// 135,381ms MAX on tests/pos/large.scala — 243KB in 1,005 lines, so ~242 bytes per
// line (generated, not hand-written). If cost were linear in bytes, a file ~50x
// the median would cost ~50x the median time, i.e. ~135ms. It cost 135,000ms:
// about 1000x, which is quadratic behaviour, not a big file.
//
// This measures the exponent rather than asserting it: files bucketed by size,
// each timed, with the SAME tree parsed once and only `analyze` timed, so parse
// cost cannot be mistaken for analysis cost. A linear fit through log-log points
// gives the exponent; anything near 2 is a real algorithmic defect that will bite
// any consumer indexing a repository with generated code in it.

import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "<corpus-root>/bb_tests/repositories"
const repo = process.argv[2] ?? "scala3"

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "target") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith(".scala")) out.push(p)
  }
  return out
}

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P()
  parser.setLanguage(lang)
  const analyzer = new RealScalaAnalyzer()

  const all = walk(path.join(CORPUS, repo)).sort()
  const sized = all.map((f) => ({ f, bytes: fs.statSync(f).size })).sort((a, b) => a.bytes - b.bytes)
  const p50 = sized[Math.floor(sized.length / 2)].bytes

  // one file per size decile, plus the largest files, so the curve spans 3 orders
  const picks: typeof sized = []
  for (let d = 0; d < 10; d++) {
    const i = Math.floor((sized.length - 1) * (d / 9))
    picks.push(sized[i])
  }
  for (const s of sized.slice(-6)) if (!picks.includes(s)) picks.push(s)

  const rows: { bytes: number; ms: number; ratio: number; file: string }[] = []
  for (const { f, bytes } of picks) {
    const src = fs.readFileSync(f, "utf8")
    let root: any
    try { root = parser.parse(src).rootNode } catch { continue }
    analyzer.analyze(root, src, f) // warm: JIT + caches, so the timing is steady-state
    const t = performance.now()
    try { analyzer.analyze(root, src, f) } catch { continue }
    const ms = performance.now() - t
    rows.push({ bytes, ms, ratio: ms / Math.max(0.01, bytes / 1024), file: f.replace(path.join(CORPUS, repo) + "/", "") })
    process.stderr.write(`  ${bytes}B -> ${ms.toFixed(1)}ms\n`)
  }
  rows.sort((a, b) => a.bytes - b.bytes)

  console.log(`# is the scala analyzer superlinear? — ${repo}, median file ${p50}B\n`)
  console.log("| file bytes | ms/file | ms per KB | x median size | file |")
  console.log("|---:|---:|---:|---:|---|")
  for (const r of rows) {
    console.log(`| ${r.bytes.toLocaleString()} | ${r.ms.toFixed(1)} | ${r.ratio.toFixed(2)} | ${(r.bytes / p50).toFixed(1)}x | \`${r.file}\` |`)
  }

  // log-log slope over the range where timing is above timer noise
  const usable = rows.filter((r) => r.ms > 1)
  if (usable.length >= 3) {
    const n = usable.length
    const lx = usable.map((r) => Math.log(r.bytes))
    const ly = usable.map((r) => Math.log(r.ms))
    const mx = lx.reduce((a, b) => a + b, 0) / n
    const my = ly.reduce((a, b) => a + b, 0) / n
    const num = usable.reduce((a, _, i) => a + (lx[i] - mx) * (ly[i] - my), 0)
    const den = usable.reduce((a, _, i) => a + (lx[i] - mx) ** 2, 0)
    const slope = num / den
    console.log(`\n- log-log slope over ${n} points spanning ${(Math.max(...usable.map((r) => r.bytes)) / Math.min(...usable.map((r) => r.bytes))).toFixed(0)}x in size: **exponent ${slope.toFixed(2)}**`)
    console.log(`- linear would be 1.00, quadratic 2.00`)
    const biggest = usable[usable.length - 1]
    const smallest = usable[0]
    const sizeRatio = biggest.bytes / smallest.bytes
    const timeRatio = biggest.ms / smallest.ms
    console.log(`- measured: ${sizeRatio.toFixed(0)}x the bytes cost ${timeRatio.toFixed(0)}x the time (linear would be ${sizeRatio.toFixed(0)}x)`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })