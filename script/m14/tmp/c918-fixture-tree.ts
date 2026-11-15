// Why does the fixture's `void *` two-parameter heading not reproduce the
// DECLARATION spelling (libcmpp.c:5529)? Dump the tree at that line.
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P()
parser.setLanguage(lang)
const F = "validation/m14/fixtures/c/macro-wrapped-pointer-heading-918.c"
const src = fs.readFileSync(F, "utf8")
const root = parser.parse(src).rootNode
const LINE = 69
console.log(src.split("\n").slice(LINE - 1, LINE + 4).join("\n"))
console.log("---")
let node: any = null
const st = [root]
while (st.length) {
  const n = st.pop()!
  if (n.startPosition.row + 1 === LINE && (n.type === "function_definition" || n.type === "declaration" || n.type === "ERROR" || n.type === "expression_statement")) node = n
  for (let i = n.childCount - 1; i >= 0; i--) st.push(n.child(i))
}
console.log("node:", node?.type, node?.isError ? "(ERR)" : "")
if (node) {
  console.log("text:", JSON.stringify(node.text.slice(0, 120)))
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    console.log(`  [${i}] ${c.type}${c.isError ? "(ERR)" : ""}${c.isMissing ? "(MISS)" : ""} named=${c.isNamed} ${JSON.stringify(c.text.slice(0, 60))}`)
  }
  console.log("fields:", ["type", "declarator", "body"].map((f) => `${f}=${node.childForFieldName(f)?.type ?? "-"}`).join(" "))
  let s = node.nextSibling
  console.log("next siblings:", s ? `${s.type}:${JSON.stringify(s.text.slice(0, 30))}` : "(none)")
}
// Also the whole-file view: does the file have a giant ERROR anywhere?
console.log("root children:", Array.from({ length: root.namedChildCount }, (_, i) => `${root.namedChild(i).type}`).join(", "))
