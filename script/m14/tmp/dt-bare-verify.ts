// #752 verification probe — runs the LIVE analyzer on the pinned grammar.
import * as fs from "fs"
import * as WTS from "web-tree-sitter"
import { RealDartAnalyzer } from "../../../src/ast/real-dart-analyzer"

const ROOT = "<corpus-root>/mcp/backbencher-brain"

const SRC = [
  "class Store {",
  "  int count = 0;",
  "  int total = 0;",
  "  void zero() { count = 0; }",
  "  int bare() { return count; }",
  "  int dotted() { return this.count; }",
  "  int notLocal() { int count = 5; return count; }",
  "  int plus() { return count + total; }",
  "  int chained() { return this.total; }",
  "}",
].join("\n") + "\n"

async function main() {
  const wts: any = WTS
  const Parser = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await Parser.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await Language.load(fs.readFileSync(ROOT + "/wasm/tree-sitter-dart.wasm"))
  const P = new Parser()
  P.setLanguage(lang)
  const tree = P.parse(SRC)
  const analyzer: any = new RealDartAnalyzer()
  const res: any = analyzer.analyze(tree.rootNode, SRC, "store.dart")
  const rels: any[] = res.relationships ?? []
  const uses = rels.filter((r) => r.type === "uses")
  console.log("ALL uses edges:")
  for (const u of uses) console.log("  " + u.source + " -> " + u.target + "  meta=" + JSON.stringify(u.metadata))
  const has = (s: string, t: string) => uses.some((u) => u.source === s && u.target === t)
  const checks: [string, boolean][] = [
    ["bare:      bare -> count (MUST be true)", has("bare", "count")],
    ["dotted:    dotted -> count (MUST be true)", has("dotted", "count")],
    ["plus:      plus -> count (MUST be true)", has("plus", "count")],
    ["plus:      plus -> total (MUST be true)", has("plus", "total")],
    ["write:     zero -> count (MUST be false)", !has("zero", "count")],
    ["local:     notLocal -> count (MUST be false)", !has("notLocal", "count")],
  ]
  let ok = true
  for (const [name, pass] of checks) {
    if (!pass) ok = false
    console.log((pass ? "PASS  " : "FAIL  ") + name)
  }
  console.log(ok ? "ALL CHECKS PASS" : "SOME CHECKS FAILED")
}

main()
