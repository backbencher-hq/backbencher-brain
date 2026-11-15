// #917: root children + ERROR spans under a chosen grammar wasm.
//   bun script/m14/tmp/c917-root.ts <wasm> <file>
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2]))
const parser = new P()
parser.setLanguage(lang)
const F = process.argv[3]
const src = fs.readFileSync(F, "utf8")
const root = parser.parse(src).rootNode
console.log(`${F.split("/").pop()} root children=${root.childCount}`)
for (let i = 0; i < Math.min(24, root.childCount); i++) {
  const c = root.child(i)
  console.log(`  ${c.type}${c.isError ? "(ERROR)" : ""} [L${c.startPosition.row + 1}-L${c.endPosition.row + 1}] named=${c.namedChildCount}`)
}
const errs: any[] = []
const st: any[] = [root]
while (st.length) {
  const n = st.pop()!
  if (n.isError) errs.push(n)
  for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
}
errs.sort((a, b) => b.endIndex - b.startIndex - (a.endIndex - a.startIndex))
console.log(
  `ERRORs=${errs.length}; largest 3: ` +
    errs.slice(0, 3).map((e) => `L${e.startPosition.row + 1}-L${e.endPosition.row + 1} (${e.childCount} kids, first=${e.child(0)?.type})`).join(" | "),
)
// count function_definition nodes and which contain a macro_specifier
let fns = 0
let wrapped = 0
const st2: any[] = [root]
while (st2.length) {
  const n = st2.pop()!
  if (n.type === "function_definition") {
    fns++
    const kids = n.namedChildren ?? []
    if (kids.some((k: any) => k.type === "macro_specifier")) wrapped++
  }
  for (let i = 0; i < n.childCount; i++) st2.push(n.child(i))
}
console.log(`function_definitions=${fns} (macro-wrapped=${wrapped})`)
