// script/m14/tmp/sw-barecall-probe.ts — the second-corpus finding
// `MISSING Tests/TestHelpers.swift :: calls -> method` (alamofire, full extent):
// the oracle derives a bare call to `method`, the analyzer publishes nothing.
// Reduce the shape until the difference is visible.
// Run: bun script/m14/tmp/sw-barecall-probe.ts
import * as fs from "node:fs"
import * as path from "node:path"
import { RealSwiftAnalyzer } from "../../../src/ast/real-swift-analyzer"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-swift.wasm")))
const mod: any = await import("../../../script/m14/differential")

const CASES: Array<[string, string]> = [
  ["plain struct computed prop", `struct E {\n  static var get: Int { method(.get) }\n  static func method(_ m: Int) -> Int { 0 }\n}\n`],
  ["enum with case method", `enum Path { case method(Int) }\nstruct E {\n  static var get: Int { method(.get) }\n  static func method(_ m: Int) -> Int { 0 }\n}\n`],
  ["static var path = Path.method(.get)", `enum Path { case method(Int) }\nstruct E {\n  var path = Path.method(.get)\n}\n`],
  ["both (corpus shape)", `enum Path { case method(Int) }\nstruct E {\n  static var get: Int { method(.get) }\n  static func method(_ m: Int) -> Int { 0 }\n  var path = Path.method(.get)\n}\n`],
  ["numeric receiver", `enum Path { case method(Int) }\nstruct E {\n  var path = Path.method(1)\n  static func f() -> Int { method(2) }\n  static func method(_ m: Int) -> Int { 0 }\n}\n`],
]

for (const [name, code] of CASES) {
  const pp = new P(); pp.setLanguage(LANG)
  const root = pp.parse(code).rootNode
  const r: any = await new RealSwiftAnalyzer().analyze(root, code, "t.swift", { typeKinds: new Map() } as any)
  const rels = (r.relationships ?? []).map((x: any) => ({ label: String(x.type).toLowerCase(), from: String(x.source), target: String(x.target), conf: x.confidence }))
  const truth = mod.deriveSwiftEdges(root, new Set<string>())
  for (const e of mod.deriveSwiftBareUses(root, r.symbols ?? [])) truth.push(e)
  const f = (xs: any[]) => xs.filter((x: any) => ["calls", "uses", "instantiates"].includes(x.label)).map((x: any) => `${x.label} ${x.from ? x.from + "->" : ""}${x.target}`).join(" | ") || "(none)"
  console.log(`\n===== ${name} (hasError=${root.hasError}) =====`)
  console.log(`  analyzer: ${f(rels)}`)
  console.log(`  oracle  : ${f(truth)}`)
}
