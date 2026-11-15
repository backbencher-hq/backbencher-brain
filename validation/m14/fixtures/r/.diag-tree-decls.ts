/** List every class declaration the tree walker sees in one file, with line + members. */
import * as fs from "node:fs"
import * as path from "node:path"

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(fs.readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-r.wasm"))))

const text = fs.readFileSync(process.argv[2], "utf8")
const tree = parser.parse(text)
console.log(`hasError=${tree.rootNode.hasError}`)

const found: string[] = []
const visit = (n: any): void => {
  if (n.type === "call") {
    const fn = n.childForFieldName?.("function")
    const callee = fn ? String(fn.text) : ""
    if (callee.includes("R6Class")) {
      const args = n.childForFieldName?.("arguments")
      const a0 = args?.namedChild?.(0)
      const v = a0?.type === "argument" ? a0.childForFieldName?.("value") : a0
      found.push(`line ${n.startPosition.row + 1}  callee=${callee}  firstArgType=${v?.type}  firstArgText=${JSON.stringify(String(v?.text ?? "").slice(0, 20))}`)
    }
  }
  for (let i = 0; i < n.childCount; i++) visit(n.child(i))
}
visit(tree.rootNode)
console.log(`R6Class calls seen: ${found.length}`)
for (const f of found) console.log("  " + f)

// Count ERROR nodes and where
let errs = 0
const errLines: number[] = []
const v2 = (n: any): void => {
  if (n.type === "ERROR") { errs++; errLines.push(n.startPosition.row + 1) }
  for (let i = 0; i < n.childCount; i++) v2(n.child(i))
}
v2(tree.rootNode)
console.log(`ERROR nodes: ${errs}`, errLines.slice(0, 20))