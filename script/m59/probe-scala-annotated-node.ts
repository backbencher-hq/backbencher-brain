// script/m59/probe-scala-annotated-node.ts — M59 #825
//
// Does tree-sitter-scala give a definition node the line of its leading
// annotation? If yes, every `contains` edge for an annotated member is stamped
// with the annotation's line (4 of 13 remaining scala oracle failures on a
// 60-file sample). This decides whether the analyzer or the oracle must change.
//
// Read-only.

import * as WTS from "web-tree-sitter"
import { readFileSync } from "node:fs"

const SRC = `import scala.annotation.tailrec

class C {
  @tailrec
  def loop(n: Int): Int =
    if (n <= 0) 0 else loop(n - 1)

  @deprecated("x", "1.0")
  val v: Int = 1

  @Category(Array(classOf[BootstrappedOnlyTests]))
  @Test def replStagingTests = scripts("/x").foreach(f)
}
`

async function main() {
  const core = "/tmp/bb-ts-core.wasm"
  const grammar = "/tmp/bb-wasm_tree-sitter-scala_tree-sitter-scala.wasm"
  await WTS.Parser.init()
  const Lang: any = await WTS.Language.load(grammar)
  const parser = new WTS.Parser()
  parser.setLanguage(Lang)
  const tree = parser.parse(readFileSync ? SRC : SRC)
  const lines = SRC.split("\n")
  const show = (label: string, n: any) => {
    if (!n) return console.log(`${label}: <none>`)
    console.log(`${label}: type=${n.type} startRow=${n.startPosition.row + 1} text=${JSON.stringify(n.text.slice(0, 45))}`)
  }
  const walk = (n: any) => {
    if (["function_definition", "val_definition", "class_definition"].includes(n.type)) {
      console.log(`\n--- ${n.type} @ source line ${n.startPosition.row + 1}: ${JSON.stringify(lines[n.startPosition.row])}`)
      show("  node", n)
      show("  name field", n.childForFieldName?.("name"))
      show("  first child", n.namedChild(0))
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(tree.rootNode)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
