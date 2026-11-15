// M49 W15: does scala emit ANY member-read uses? The family-parity gate found
// `none` for `class Store { val count = 0; def read: Int = this.count }` while
// every other managed-OO analyzer emits `read -> count`. Before registering a
// gap, vary the SHAPE — the answer may be shape-dependent rather than absent.
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"

import { fileURLToPath } from "node:url"
const __dirname = fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]+$/, "")

const ROOT = path.resolve(import.meta.dir ?? __dirname, "..", "..", "..")
const CASES: Record<string, string> = {
  "this-in-expression-body": "class Store {\n  val count = 0\n  def read: Int = this.count\n}\n",
  "bare-in-expression-body": "class Store {\n  val count = 0\n  def read: Int = count\n}\n",
  "this-in-block-body": "class Store {\n  val count = 0\n  def read: Int = {\n    this.count\n  }\n}\n",
  "this-in-var": "class Store {\n  val count = 0\n  def read: Int = {\n    val x = this.count\n    x\n  }\n}\n",
  "case-class-field": "case class Store(count: Int) {\n  def read: Int = this.count\n}\n",
}

const wts: any = WTS
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
const mod = await import("../../../src/ast/real-scala-analyzer")

for (const [name, src] of Object.entries(CASES)) {
  const parser = new P()
  parser.setLanguage(language)
  const tree = parser.parse(src)
  const r = await new mod.RealScalaAnalyzer().analyze(tree.rootNode, src, "probe.scala")
  const uses = (r.relationships ?? []).filter((x: any) => (x.type ?? x.relationshipType) === "uses")
  const contains = (r.relationships ?? []).filter((x: any) => (x.type ?? x.relationshipType) === "contains")
  console.log(`\n=== ${name} ===`)
  console.log(`  parse error: ${tree.rootNode.hasError}`)
  console.log(`  symbols: ${(r.symbols ?? []).map((s: any) => `${s.name}:${s.kind}`).join(", ")}`)
  console.log(`  contains: ${contains.map((x: any) => `${x.source}->${x.target}`).join(", ") || "(none)"}`)
  console.log(`  uses: ${uses.map((x: any) => `${x.source}->${x.target}`).join(", ") || "(none)"}`)
}
