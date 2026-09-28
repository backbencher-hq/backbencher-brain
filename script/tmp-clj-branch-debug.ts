// tmp-clj-branch-debug.ts — replicate the impl-context branch conditions for
// every list node so the misfire is visible.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-clojure.wasm")))
const p = new ParserClass()
p.setLanguage(g)
const IMPL_PARENTS: Record<string, boolean> = {}
for (const k of ["defrecord", "deftype", "reify", "extend-type", "extend-protocol", "proxy", "defprotocol"]) IMPL_PARENTS[k] = true
const symName = (nd: any): string => {
  if (!nd) return ""
  if (nd.type === "sym_lit") {
    const nm = nd.childForFieldName?.("name")
    const ns = nd.childForFieldName?.("namespace")
    if (nm && ns) return `${ns.text}/${nm.text}`
    if (nm) return nm.text
    return nd.text
  }
  return nd.text ?? ""
}
const execHead = (list: any): any => {
  for (let i = 0; i < list.namedChildCount; i++) {
    const c = list.namedChild(i)
    if (c && c.type !== "comment" && c.type !== "dis_expr" && c.type !== "meta_lit") return c
  }
  return null
}
const formNameOf = (list: any): string => {
  const first = execHead(list)
  if (!first) return ""
  if (first.type !== "sym_lit") return ""
  return symName(first)
}
const src = fs.readFileSync(process.argv[2], "utf8")
const stack = [p.parse(src).rootNode]
while (stack.length > 0) {
  const n = stack.pop()!
  if (n.type === "list_lit") {
    const parent = n.parent
    const pf = parent?.type === "list_lit" ? formNameOf(parent) : `(parent=${parent?.type})`
    const fires = parent?.type === "list_lit" && IMPL_PARENTS[formNameOf(parent)] && execHead(parent) !== n
    console.log(`L${n.startPosition.row + 1} list [head=${JSON.stringify(formNameOf(n))}] parentForm=${JSON.stringify(pf)} implFires=${!!fires} mNameWouldBe=${JSON.stringify(fires ? symName(n.namedChild(0)) : "")}`)
  }
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
}
