// #754 verification probe — runs the LIVE analyzer on the pinned grammar.
import * as fs from "fs"
import * as WTS from "web-tree-sitter"
import { RealSwiftAnalyzer } from "../../../src/ast/real-swift-analyzer"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"

const SRC = [
  "class Store {",
  "  var count = 0",
  "  var total = 0",
  "  func zero() { count = 0 }",
  "  func bare() -> Int { return count }",
  "  func dotted() -> Int { return self.count }",
  "  func notLocal() -> Int { let count = 5; return count }",
  "  func plus() -> Int { return count + total }",
  "  func call() { go(count) }",
  "  func go(_ v: Int) {}",
  "}",
].join("\n") + "\n"

async function main() {
  const wts: any = WTS
  const Parser = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await Parser.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await Language.load(fs.readFileSync(ROOT + "/wasm/tree-sitter-swift.wasm"))
  const P = new Parser()
  P.setLanguage(lang)
  const tree = P.parse(SRC)
  const az: any = new RealSwiftAnalyzer()
  const res: any = az.analyze(tree.rootNode, SRC, "store.swift")
  const uses = (res.relationships ?? []).filter((r: any) => r.type === "uses")
  console.log("ALL uses edges:")
  for (const u of uses) console.log("  " + u.source + " -> " + u.target + "  meta=" + JSON.stringify(u.metadata))
  const has = (s: string, t: string) => uses.some((u: any) => u.source === s && u.target === t)
  const checks: [string, boolean][] = [
    ["bare:   bare -> count (MUST be true)", has("bare", "count")],
    ["dotted: dotted -> count (MUST be true)", has("dotted", "count")],
    ["plus:   plus -> count (MUST be true)", has("plus", "count")],
    ["plus:   plus -> total (MUST be true)", has("plus", "total")],
    ["write:  zero -> count (MUST be false)", !has("zero", "count")],
    ["local:  notLocal -> count (MUST be false)", !has("notLocal", "count")],
  ]
  let ok = true
  for (const [n, p] of checks) { if (!p) ok = false; console.log((p ? "PASS  " : "FAIL  ") + n) }
  console.log(ok ? "ALL CHECKS PASS" : "SOME CHECKS FAILED")
}

main()
