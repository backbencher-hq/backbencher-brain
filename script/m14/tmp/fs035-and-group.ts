// FS035 — what are the DIRECT children of a `let rec … and …` binding node?
//
// The residual's largest class is 24 rows sourced to `convTypeAux` (declared with `and` at
// ilreflect.fs:743) that sit at lines 719–731, inside `convTypeSpec` — the binding the
// group actually starts with. The oracle names a binding by asking its first
// `function_declaration_left` for an `identifier_pattern` and taking the last identifier
// inside it, so the question is what the node's direct children actually are. A mutual
// recursion group is a common F# shape and this is the first construct in the lane that
// depends on it.
import * as fs from "fs"
import * as path from "path"
const ROOT = path.resolve(import.meta.dirname, "../../..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
if (!P.__init) {
  await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  ;(P as any).__init = true
}
const file = process.argv[2]!
const want = process.argv[3] ?? "and convTypeAux"
const src = fs.readFileSync(file, "utf8")
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))
const tree = parser.parse(src)

let target: any = null
function find(n: any): void {
  if (target) return
  if (n.type === "function_or_value_defn" && n.text.includes(want)) { target = n; return }
  for (let i = 0; i < n.childCount; i++) find(n.child(i))
}
find(tree.rootNode)
if (!target) { console.log("not found"); process.exit(0) }
console.log(`node: ${target.type}  lines ${target.startPosition.row + 1}..${target.endPosition.row + 1}`)
console.log("\nDIRECT children (named only, in document order):")
for (let i = 0; i < target.namedChildCount; i++) {
  const c = target.namedChild(i)
  console.log(`  ${String(i).padStart(2)} ${c.type.padEnd(30)} ${JSON.stringify(c.text.slice(0, 52))}`)
}
const left = (() => { for (let i = 0; i < target.namedChildCount; i++) { const c = target.namedChild(i); if (c.type === "function_declaration_left") return c } return undefined })()
if (left) {
  console.log("\nfirst function_declaration_left's own children:")
  for (let i = 0; i < left.namedChildCount; i++) {
    const c = left.namedChild(i)
    console.log(`  ${String(i).padStart(2)} ${c.type.padEnd(30)} ${JSON.stringify(c.text.slice(0, 40))}`)
  }
}
