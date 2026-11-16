// #740 verification probe — runs the LIVE analyzer on the pinned grammar.
import * as fs from "fs"
import * as WTS from "web-tree-sitter"
import { RealKotlinAnalyzer } from "../../../src/ast/real-kotlin-analyzer"

const ROOT = "<corpus-root>/mcp/backbencher-brain"

const SRC = [
  "class K(val a: Int) {",
  "  var x: Int = 0",
  "  var total: Int = 0",
  "  val inner = Inner()",
  "  fun bare(): Int { return x }",
  "  fun dotted(): Int { return this.x }",
  "  fun chain(): Int { return inner.leaf }",
  "  fun plus(): Int { return x + total }",
  "  fun write() { x = 0 }",
  "  fun shadow(p: Int): Int { val x = 9; return x }",
  "  fun nolocal(): Int { val z = 7; return z }",
  "  fun callee(): Int { return go(x) }",
  "  fun go(v: Int): Int { return v }",
  "  fun interp(): String { return \"v=$x\" }",
  "}",
].join("\n") + "\n"

async function main() {
  const wts: any = WTS
  const Parser = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await Parser.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await Language.load(fs.readFileSync(ROOT + "/wasm/tree-sitter-kotlin.wasm"))
  const P = new Parser()
  P.setLanguage(lang)
  const res: any = new RealKotlinAnalyzer().analyze(P.parse(SRC).rootNode, SRC, "k.kt")
  const uses = (res.relationships ?? []).filter((r: any) => r.type === "uses")
  console.log("ALL uses edges:")
  for (const u of uses) console.log("  " + u.source + " -> " + u.target + "  conf=" + u.confidence + " meta=" + JSON.stringify(u.metadata))
  const has = (s: string, t: string) => uses.some((u: any) => u.source === s && u.target === t)
  const checks: [string, boolean][] = [
    ["bare:   bare -> x (MUST be true)", has("bare", "x")],
    ["dotted: dotted -> x (MUST be true)", has("dotted", "x")],
    ["chain:  chain -> inner (MUST be true)", has("chain", "inner")],
    ["plus:   plus -> x (MUST be true)", has("plus", "x")],
    ["plus:   plus -> total (MUST be true)", has("plus", "total")],
    ["arg:    callee -> x (MUST be true)", has("callee", "x")],
    ["interp: interp -> x (MUST be true)", has("interp", "x")],
    ["write:  write -> x (MUST be false)", !has("write", "x")],
    ["shadow: shadow -> x (MUST be false)", !has("shadow", "x")],
    ["nolocal:nolocal -> z (MUST be false)", !has("nolocal", "z")],
    ["callee: callee -> go (MUST be false)", !has("callee", "go")],
  ]
  let ok = true
  for (const [nm, pass] of checks) {
    if (!pass) ok = false
    console.log((pass ? "PASS  " : "FAIL  ") + nm)
  }
  console.log(ok ? "ALL CHECKS PASS" : "SOME CHECKS FAILED")
}
main()
