// C lane audit: reproduce the M12 corpus slice (deterministic first-400 sorted
// *.c >= 1KB from zig@738d2be9) through parse+analyze only, and look for
// superlinear scaling (time vs file size) — the signature of a per-function
// scan-from-position (recoverFunctionRange's content.indexOf("{", ...)).
// Run: bun script/m14/tmp/c-audit-perf-slice.ts
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const language = await L.load(readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P()
parser.setLanguage(language)
const mod: any = await import("../../../src/ast/real-c-analyzer")
const Analyzer = mod.RealCAnalyzer ?? mod.default
const analyzer = new Analyzer()

const Z = "<corpus-root>/bb_tests/repositories/zig"
const files = execFileSync("bash", ["-c", `find ${Z} -name '*.c' -size +1k -not -path '*/.git/*' | sort | head -400`], { encoding: "utf8" }).split("\n").filter(Boolean)
console.log(`slice: ${files.length} files`)

type Row = { f: string; bytes: number; nodes: number; parseMs: number; analyzeMs: number }
const rows: Row[] = []
const t0 = performance.now()
for (const f of files) {
  const src = readFileSync(f, "utf8")
  const p0 = performance.now()
  const tree = parser.parse(src)
  const p1 = performance.now()
  await analyzer.analyze(tree.rootNode, src, f)
  const p2 = performance.now()
  rows.push({ f: f.slice(f.indexOf("/zig/") + 5), bytes: src.length, nodes: countNodes(tree.rootNode), parseMs: p1 - p0, analyzeMs: p2 - p1 })
}
const totalMs = performance.now() - t0
const totBytes = rows.reduce((a, r) => a + r.bytes, 0)
const totNodes = rows.reduce((a, r) => a + r.nodes, 0)
const sumAnalyze = rows.reduce((a, r) => a + r.analyzeMs, 0)
const sumParse = rows.reduce((a, r) => a + r.parseMs, 0)
console.log(`wall ${(totalMs / 1000).toFixed(1)}s | files/s ${(rows.length / (totalMs / 1000)).toFixed(2)} | ${(totBytes / 1024 / 1024).toFixed(1)}MB | ${totNodes} nodes`)
console.log(`  parse   ${sumParse.toFixed(0)}ms (${(sumParse / rows.length).toFixed(1)}ms/file)`)
console.log(`  analyze ${sumAnalyze.toFixed(0)}ms (${(sumAnalyze / rows.length).toFixed(1)}ms/file) — ${(sumAnalyze / totalMs * 100).toFixed(0)}% of wall`)
console.log(`  per-KB analyze: ${(sumAnalyze / (totBytes / 1024)).toFixed(2)}ms/KB | per-1k-nodes: ${(sumAnalyze / totNodes * 1000).toFixed(1)}ms`)
rows.sort((a, b) => b.analyzeMs - a.analyzeMs)
console.log(`\nslowest 10 (analyze ms | bytes | KB/ms | nodes | file):`)
for (const r of rows.slice(0, 10)) {
  console.log(`  ${r.analyzeMs.toFixed(0).padStart(6)} | ${String(r.bytes).padStart(8)} | ${(r.bytes / 1024 / r.analyzeMs).toFixed(1).padStart(6)} | ${String(r.nodes).padStart(6)} | ${r.f}`)
}
// scaling: quartiles by size
const bySize = [...rows].sort((a, b) => a.bytes - b.bytes)
const q = Math.floor(bySize.length / 4)
for (const [name, seg] of [["smallest quartile", bySize.slice(0, q)], ["largest quartile", bySize.slice(-q)]] as const) {
  const kb = seg.reduce((a, r) => a + r.bytes, 0) / 1024
  const ms = seg.reduce((a, r) => a + r.analyzeMs, 0)
  console.log(`  ${name}: ${kb.toFixed(0)}KB -> ${ms.toFixed(0)}ms = ${(ms / kb).toFixed(2)}ms/KB`)
}
function countNodes(n: any): number {
  let c = 1
  for (let i = 0; i < n.namedChildCount; i++) { const ch = n.namedChild(i); if (ch) c += countNodes(ch) }
  return c
}
