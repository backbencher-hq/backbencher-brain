// Minimise the scala analyzer's 175-second outlier.
//
// The size curve says this is NOT a scaling defect: log-log exponent 0.89 across
// 8,448x of file size, and `compiler/src/dotty/tools/dotc/core/Types.scala` — 26%
// LARGER than the worst file — costs 5.21 ms/KB against the worst file's 738.72.
// So cost is driven by something IN the file, not by how big it is.
//
// This bisects tests/pos/large.scala on line ranges to shrink a 243KB reproducer
// to the smallest range that still costs seconds, then reports that range's shape:
// symbol count, max tree depth, node-type histogram, longest line. A minimised
// reproducer is the difference between "large.scala is slow" (unactionable) and a
// named construct (actionable).

import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const FILE = process.argv[2] ?? "/home/ishaq2321/bb_tests/repositories/scala3/tests/pos/large.scala"
const BUDGET_MS = Number(process.argv[3] ?? 2000)

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P()
  parser.setLanguage(lang)
  const analyzer = new RealScalaAnalyzer()

  const full = fs.readFileSync(FILE, "utf8")
  const lines = full.split("\n")
  console.log(`# minimising ${path.basename(FILE)} — ${lines.length} lines, ${full.length} bytes`)
  const longest = lines.reduce((a, l, i) => (l.length > (a?.len ?? 0) ? { len: l.length, n: i + 1 } : a), undefined as any)
  console.log(`longest single line: ${longest.len} chars at line ${longest.n}\n`)

  const timeRange = (from: number, to: number): { ms: number; bytes: number } => {
    const src = lines.slice(from, to).join("\n")
    const t = performance.now()
    try {
      const root = parser.parse(src).rootNode
      analyzer.analyze(root, src, FILE)
    } catch { return { ms: 0, bytes: src.length } }
    return { ms: performance.now() - t, bytes: src.length }
  }

  const whole = timeRange(0, lines.length)
  console.log(`whole file: ${whole.ms.toFixed(0)}ms (${whole.bytes} bytes)`)
  if (whole.ms < BUDGET_MS) {
    console.log(`\nunder the ${BUDGET_MS}ms budget already — nothing to minimise`)
    return
  }

  // shrink by halves from the front: does the cost live in one region?
  let lo = 0
  let hi = lines.length
  let steps = 0
  const trace: string[] = []
  while (hi - lo > 1 && steps < 40) {
    steps++
    const mid = (lo + hi) >> 1
    const head = timeRange(lo, mid)
    if (head.ms >= BUDGET_MS) { hi = mid; trace.push(`head [${lo},${mid}) = ${head.ms.toFixed(0)}ms -> keep head`) }
    else {
      const tail = timeRange(mid, hi)
      if (tail.ms >= BUDGET_MS) { lo = mid; trace.push(`tail [${mid},${hi}) = ${tail.ms.toFixed(0)}ms -> keep tail`) }
      else { trace.push(`neither half reaches budget (head ${head.ms.toFixed(0)}ms, tail ${tail.ms.toFixed(0)}ms) -> cost is SPREAD`); break }
    }
  }
  console.log(`\n## bisect trace`)
  for (const t of trace) console.log(`  ${t}`)
  console.log(`\nminimal range: lines ${lo + 1}..${hi} (${hi - lo} lines)`)

  const src = lines.slice(lo, hi).join("\n")
  const root = parser.parse(src).rootNode
  const t = performance.now()
  const res = analyzer.analyze(root, src, FILE)
  const ms = performance.now() - t
  console.log(`\n## the minimised reproducer`)
  console.log(`- ${src.length} bytes, ${hi - lo} lines, ${ms.toFixed(0)}ms`)
  console.log(`- symbols: ${res.symbols?.length ?? 0}`)
  console.log(`- relationships: ${res.relationships?.length ?? 0}`)

  let maxDepth = 0
  const hist = new Map<string, number>()
  const walk = (n: any, d: number): void => {
    if (d > maxDepth) maxDepth = d
    hist.set(n.type, (hist.get(n.type) ?? 0) + 1)
    for (const c of n.namedChildren ?? []) walk(c, d + 1)
  }
  walk(root, 0)
  console.log(`- max tree depth: ${maxDepth}`)
  console.log(`- distinct node types: ${hist.size}`)
  console.log(`\n## top node types in the reproducer`)
  for (const [k, v] of [...hist].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`  ${String(v).padStart(6)}  ${k}`)

  const rl = src.split("\n")
  const rlSorted = [...rl].sort((a, b) => b.length - a.length)
  console.log(`\n## longest lines in the reproducer`)
  for (const l of rlSorted.slice(0, 3)) console.log(`  ${l.length} chars: ${JSON.stringify(l.slice(0, 220))}`)
  console.log(`\n## source (first 600 chars)`)
  console.log(src.slice(0, 600))
}
main().catch((e) => { console.error(e); process.exit(1) })