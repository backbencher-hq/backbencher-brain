import * as path from "node:path"
import { readFileSync } from "node:fs"
import { getParser } from "../../../../../src/ast/engine"
const ROOT = path.resolve(import.meta.dirname, "../../../../..")
const src = readFileSync(path.join(ROOT, ".corpus/sqlite/test/tt3_stress.c"), "utf8")
const parser: any = await getParser("c")
const tree = parser.parse(src)
const line = 313
const walk = (n: any): void => {
  if (n.startPosition.row + 1 <= line && line <= n.endPosition.row + 1 && n.type === "call_expression") {
    let d = 0
    const show = (x: any): void => { console.log(`${"  ".repeat(d)}${x.type} ${JSON.stringify(String(x.text).slice(0, 40))}`); d++; for (let i = 0; i < x.childCount; i++) show(x.child(i)); d-- }
    show(n)
  }
  for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
}
walk(tree.rootNode)
