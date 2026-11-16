// C lane audit: is C's 5-13x slowness the grammar (parse) or the analyzer?
// Split parse-time from analyze-time on the same files and normalize per 1k
// tree nodes, then run the same split for cpp on C-like C++ so the comparison
// is apples-to-apples. Run: bun script/m14/tmp/c-audit-perf-split.ts
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })

async function bench(lang: "c" | "cpp", files: string[]) {
  const wasm = lang === "c" ? "wasm/tree-sitter-c.wasm" : "wasm/tree-sitter-cpp.wasm"
  const language = await L.load(readFileSync(wasm))
  const parser = new P()
  parser.setLanguage(language)
  const mod: any = await import(`../../../src/ast/real-${lang}-analyzer`)
  const Analyzer = mod.RealCAnalyzer ?? mod.RealCppAnalyzer ?? mod.default
  const analyzer = new Analyzer()

  let parseMs = 0
  let analyzeMs = 0
  let nodes = 0
  let bytes = 0
  const rows: Array<{ f: string; parse: number; analyze: number; nodes: number; kb: number }> = []
  for (const f of files) {
    const src = readFileSync(f, "utf8")
    const t0 = performance.now()
    const tree = parser.parse(src)
    const t1 = performance.now()
    await analyzer.analyze(tree.rootNode, src, f)
    const t2 = performance.now()
    const n = countNodes(tree.rootNode)
    parseMs += t1 - t0
    analyzeMs += t2 - t1
    nodes += n
    bytes += src.length
    rows.push({ f: f.split("/").slice(-2).join("/"), parse: t1 - t0, analyze: t2 - t1, nodes: n, kb: src.length / 1024 })
  }
  rows.sort((a, b) => b.nodes - a.nodes)
  console.log(`\n=== ${lang}: ${files.length} files, ${Math.round(bytes / 1024)} KB, ${nodes} nodes ===`)
  console.log(`  parse total ${parseMs.toFixed(0)}ms (${(parseMs / nodes * 1000).toFixed(2)}ms per 1k nodes)`)
  console.log(`  analyze total ${analyzeMs.toFixed(0)}ms (${(analyzeMs / nodes * 1000).toFixed(2)}ms per 1k nodes)`)
  console.log(`  analyze share: ${(analyzeMs / (analyzeMs + parseMs) * 100).toFixed(1)}%`)
  console.log(`  biggest files (nodes | parse ms | analyze ms | KB):`)
  for (const r of rows.slice(0, 5)) console.log(`    ${r.nodes.toString().padStart(6)} | ${r.parse.toFixed(1).padStart(7)} | ${r.analyze.toFixed(1).padStart(8)} | ${r.kb.toFixed(0).padStart(5)}  ${r.f}`)
  return { analyzeMs, nodes }
}

function countNodes(n: any): number {
  let c = 1
  for (let i = 0; i < n.namedChildCount; i++) {
    const ch = n.namedChild(i)
    if (ch) c += countNodes(ch)
  }
  return c
}

const Z = "<corpus-root>/bb_tests/repositories/zig"
const cFiles = execFileSync("bash", ["-c", `find ${Z} -name '*.c' -size +1k -not -path '*/.git/*' | sort | head -40`], { encoding: "utf8" }).split("\n").filter(Boolean)
const cppFiles = execFileSync("bash", ["-c", `find ${Z} -name '*.cpp' -o -name '*.cc' | grep -v '/.git/' | sort | head -40`], { encoding: "utf8" }).split("\n").filter(Boolean)
console.log(`c sample: ${cFiles.length} files | cpp sample: ${cppFiles.length} files`)
const c = await bench("c", cFiles)
const cpp = await bench("cpp", cppFiles)
console.log(`\n=== normalized verdict ===`)
console.log(`  c   ${(c.analyzeMs / c.nodes * 1000).toFixed(2)}ms per 1k nodes`)
console.log(`  cpp ${(cpp.analyzeMs / cpp.nodes * 1000).toFixed(2)}ms per 1k nodes`)
console.log(`  ratio: c is ${(c.analyzeMs / c.nodes) / (cpp.analyzeMs / cpp.nodes) < 1 ? (c.analyzeMs / c.nodes) / (cpp.analyzeMs / cpp.nodes) : 1}x of cpp — ${(c.analyzeMs / c.nodes * 1000).toFixed(2)} vs ${(cpp.analyzeMs / cpp.nodes * 1000).toFixed(2)}`)
console.log(`  c-time vs cpp-time: ${((c.analyzeMs / c.nodes) / (cpp.analyzeMs / cpp.nodes)).toFixed(2)}x`)
