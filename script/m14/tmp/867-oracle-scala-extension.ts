// M49/M37 #867 follow-on: the scala lanes' ONLY parity anomaly on the #867
// ceremony sample was scala3 tests/pos/typeclasses-this.scala:34, an analyzer
// `overrides Monad.map -> Functor.map` (confidence 1, implicitOverride) that the
// oracle could not derive. The tree puts a Scala 3 `extension (x: Self) def m`
// GROUP in an `extension_definition` node, so its defs are grandchildren of the
// template body; the oracle's member scan read direct children only. This probe
// pins the oracle change with a positive case AND two negative controls, because
// an oracle that derives more than the analyzer emits is as dishonest as one
// that derives less.
import { readFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const { deriveTreeEdges } = await import(path.join(ROOT, "script/m14/differential.ts"))
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const grammar = await Language.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-scala.wasm")))
const parser = new ParserClass()
parser.setLanguage(grammar)

const parse = (src: string) => parser.parse(src).rootNode
const astOf = async (p: string) => {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const text = readFileSync(p, "utf8")
  return { text, res: await ASTEngine.parseFile(p, text) }
}

// 1. the real corpus file: the truth must carry the edge the analyzer emits.
const FILE = "<corpus-root>/bb_tests/repositories/scala3/tests/pos/typeclasses-this.scala"
const truth = deriveTreeEdges(parse(readFileSync(FILE, "utf8")), "scala")
const ovr = truth.filter((e: any) => e.label === "overrides").map((e: any) => `${e.from} -> ${e.target}`)
console.log("=== positive: typeclasses-this.scala truth overrides ===")
for (const o of ovr) console.log("   ", o)
const want = "Monad.map -> Functor.map"
console.log(`   ${ovr.includes(want) ? "OK  " : "MISS"} ${want}`)

// Cross-check: BOTH sides of the differential must carry it now.
const { res } = await astOf(FILE)
const analyz = (res.relationships ?? [])
  .filter((r: any) => r.type === "overrides")
  .map((r: any) => `${r.source} -> ${r.target}`)
console.log("=== analyzer overrides ===")
for (const a of analyz) console.log("   ", a)
console.log(`   ${analyz.includes(want) ? "OK  " : "MISS"} analyzer carries ${want}`)

// 2. negative control A: an extension def whose name is NOT declared by the
//    in-file parent must produce NO override edge.
const negA = `
trait Base:
  def other: Int
trait Child extends Base:
  extension (x: Child) def only: Int = 1
`
const truthA = deriveTreeEdges(parse(negA), "scala").filter((e: any) => e.label === "overrides")
console.log(`=== negative A (parent does not declare the extension def): ${truthA.length} overrides edge(s) ===`)
console.log(`   ${truthA.length === 0 ? "OK" : "FAIL " + JSON.stringify(truthA)}`)

// 3. negative control B: no inheritance at all — same shape, no edge.
const negB = `
trait Solo:
  extension (x: Solo) def only: Int = 1
`
const truthB = deriveTreeEdges(parse(negB), "scala").filter((e: any) => e.label === "overrides")
console.log(`=== negative B (no heritage): ${truthB.length} overrides edge(s) ===`)
console.log(`   ${truthB.length === 0 ? "OK" : "FAIL " + JSON.stringify(truthB)}`)

// 4. positive control C: a plain (non-extension) member override must still be
//    derived — the helper must not have changed that path.
const posC = `
trait Base2:
  def m: Int
trait Child2 extends Base2:
  def m: Int = 2
`
const truthC = deriveTreeEdges(parse(posC), "scala").filter((e: any) => e.label === "overrides").map((e: any) => `${e.from} -> ${e.target}`)
console.log(`=== positive C (plain member override): ${JSON.stringify(truthC)} ===`)
console.log(`   ${truthC.includes("Child2.m -> Base2.m") ? "OK" : "FAIL"}`)
