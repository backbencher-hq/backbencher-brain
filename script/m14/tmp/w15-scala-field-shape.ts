// M49 W15: what is a scala `field_expression` made of? The fix must read the
// MEMBER leaf by grammar field, not by text splitting.
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"

import { fileURLToPath } from "node:url"
const __dirname = fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]+$/, "")

const ROOT = path.resolve(import.meta.dir ?? __dirname, "..", "..", "..")
const SRC = "class Store {\n  val count = 0\n  def read: Int = this.count\n  def other(h: Holder): Int = h.value + h.deep.inner\n}\n"

const wts: any = WTS
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
const parser = new P()
parser.setLanguage(language)
const tree = parser.parse(SRC)

function dump(n: any, d = 0) {
  const fields = ["field", "expression", "object", "name", "function", "receiver", "operand"]
  const fv = fields.map((f) => {
    const c = n.childForFieldName?.(f)
    return c ? `${f}=${c.type}("${c.text}")` : null
  }).filter(Boolean)
  if (n.type === "field_expression") {
    console.log(`${"  ".repeat(d)}${n.type}  text="${n.text}"  fields:[${fv.join(", ")}]`)
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      console.log(`${"  ".repeat(d + 1)}child[${i}] ${c.type} "${c.text}"`)
    }
    return
  }
  for (let i = 0; i < n.namedChildCount; i++) dump(n.namedChild(i), d)
}
dump(tree.rootNode)
