// #918 site 5529 is the DECLARATION spelling — measure it exactly before
// designing the recovery for it.
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P()
parser.setLanguage(lang)

const FILE = "/home/ishaq2321/bb_tests/repositories/sqlite/ext/wasm/libcmpp.c"
const src = fs.readFileSync(FILE, "utf8")
const root = parser.parse(src).rootNode
const LINE = 5529

let decl: any = null
const st = [root]
while (st.length) {
  const n = st.pop()!
  if (n.type === "declaration" && n.startPosition.row + 1 === LINE) decl = n
  for (let i = n.childCount - 1; i >= 0; i--) st.push(n.child(i))
}
console.log("decl found:", !!decl)
if (decl) {
  console.log(`extent: L${decl.startPosition.row + 1}:${decl.startPosition.column} - L${decl.endPosition.row + 1}:${decl.endPosition.column}`)
  console.log(`text: ${JSON.stringify(decl.text)}`)
  console.log("children:")
  for (let i = 0; i < decl.childCount; i++) {
    const c = decl.child(i)
    console.log(`  [${i}] ${c.type}${c.isError ? "(ERR)" : ""}${c.isMissing ? "(MISS)" : ""} named=${c.isNamed} text=${JSON.stringify(c.text.slice(0, 80))}`)
    if (c.isError) {
      console.log(`      ERROR namedChildren: ${c.namedChildren.map((k: any) => `${k.type}:${JSON.stringify(k.text.slice(0, 30))}`).join(" | ")}`)
    }
    if (c.type === "parenthesized_declarator") {
      console.log(`      PD namedChildren: ${c.namedChildren.map((k: any) => `${k.type}:${JSON.stringify(k.text.slice(0, 30))}`).join(" | ")}`)
      console.log(`      PD childCount=${c.childCount} children: ${Array.from({ length: c.childCount }, (_, j) => `${c.child(j).type}:${JSON.stringify(c.child(j).text.slice(0, 25))}`).join(" | ")}`)
    }
    if (c.type === "macro_type_specifier") {
      console.log(`      MTS namedChildren: ${c.namedChildren.map((k: any) => `${k.type}:${JSON.stringify(k.text.slice(0, 30))}`).join(" | ")}`)
      const nm = c.childForFieldName("name")
      const ty = c.childForFieldName("type")
      console.log(`      MTS name=${nm?.type}:${JSON.stringify(nm?.text)} type=${ty?.type}:${JSON.stringify(ty?.text)}`)
      console.log(`      MTS lastNamed=${c.namedChild(c.namedChildCount - 1)?.type}`)
    }
  }
  // siblings
  let s = decl.nextSibling
  const sibs: string[] = []
  for (let i = 0; s && i < 3; i++, s = s.nextSibling) sibs.push(`${s.type}${s.isError ? "(ERR)" : ""}${s.isMissing ? "(MISS)" : ""}:${JSON.stringify(s.text.slice(0, 50))}`)
  console.log(`next siblings: ${sibs.join(" | ")}`)
}
// What does the whole file's parse say at that region? the enclosing ERROR's extent
let encErr: any = null
{
  const st2 = [root]
  while (st2.length) {
    const n = st2.pop()!
    if (n.isError && n.startPosition.row + 1 <= LINE && n.endPosition.row + 1 >= LINE) {
      if (!encErr || (n.endIndex - n.startIndex) < (encErr.endIndex - encErr.startIndex)) encErr = n
    }
    for (let i = n.childCount - 1; i >= 0; i--) st2.push(n.child(i))
  }
}
if (encErr) {
  console.log(`innermost ERROR: L${encErr.startPosition.row + 1}:${encErr.startPosition.column}-L${encErr.endPosition.row + 1}:${encErr.endPosition.column} (${encErr.endIndex - encErr.startIndex} bytes)`)
  const up: string[] = []
  let p = encErr.parent
  while (p) { up.push(`${p.type}${p.isError ? "(ERR)" : ""}`); p = p.parent }
  console.log(`  ancestors: ${up.join(" < ")}`)
}
