// #917: what does a libcmpp heading's parameter list actually contain?
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P()
parser.setLanguage(lang)

const F = "/home/ishaq2321/bb_tests/repositories/sqlite/ext/wasm/libcmpp.c"
const WANT = Number(process.env.BB_LINE ?? 5423)
const src = fs.readFileSync(F, "utf8")
const root = parser.parse(src).rootNode
let shown = 0
const st: any[] = [root]
while (st.length && shown < 3) {
  const n = st.pop()!
  for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
  if (n.type !== "compound_statement") continue
  let prev = n.previousSibling
  for (let g = 0; prev && g < 2 && (prev.isMissing || prev.type === ";"); g++) prev = prev.previousSibling
  if (!prev || prev.type !== "expression_statement") continue
  if (prev.startPosition.row + 1 !== WANT) continue
  const outer = prev.namedChild(0)
  const params = outer?.childForFieldName("arguments")
  shown++
  console.log(`--- L${prev.startPosition.row + 1}: ${prev.text.replace(/\s+/g, " ").slice(0, 100)}`)
  console.log(`    source: ${src.slice(prev.startIndex, params?.endIndex ?? prev.endIndex).replace(/\s+/g, " ").slice(0, 200)}`)
  for (let i = 0; i < (params?.childCount ?? 0); i++) {
    const c = params.child(i)
    console.log(`    child[${i}] ${c.type}${c.isError ? " (ERROR)" : ""} named=${c.isNamed} "${c.text.replace(/\s+/g, " ")}"`)
  }
}
