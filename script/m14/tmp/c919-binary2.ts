// #919: baseline vs current on ONE file, raw analyze(), all edges whose target
// is binary/values — where did `uses binary|186` go?
//   bun script/m14/tmp/c919-binary2.ts
import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const file = "<corpus-root>/bb_tests/repositories/nlohmann-json/tests/src/unit-serialization.cpp"
const src = readFileSync(file, "utf8")
const { RealCppAnalyzer } = await import(path.join(ROOT, "src", "ast", "real-cpp-analyzer.ts"))
const { RealCppAnalyzer: Base } = await import(path.join(ROOT, "src", "ast", "cpp-baseline-analyzer.ts"))
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-cpp.wasm")))
const parser = new P(); parser.setLanguage(lang)
const root = parser.parse(src).rootNode
for (const [tag, Cls] of [["BASELINE", Base], ["CURRENT", RealCppAnalyzer]] as any[]) {
  const res: any = new Cls().analyze(root, src, file)
  const rows = (res.relationships ?? []).filter((r: any) => ["binary", "values"].includes(String(r.target)))
  console.log(`\n=== ${tag}: ${rows.length} edges with target binary/values`)
  for (const r of rows) console.log(`   ${r.type} ${JSON.stringify(String(r.source).slice(0, 50))} -> ${r.target} line=${r.line_number}`)
  const syms = (res.symbols ?? []).filter((s: any) => ["binary", "values"].includes(s.name))
  console.log(`   symbols named binary/values: ${JSON.stringify(syms.map((s: any) => `${s.kind}@${s.range?.startLine}`))}`)
}
