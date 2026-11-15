import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P()
parser.setLanguage(lang)
const F = "/home/ishaq2321/bb_tests/repositories/sqlite/ext/wasm/libcmpp.c"
const src = fs.readFileSync(F, "utf8")
const root = parser.parse(src).rootNode
const st: any[] = [root]
while (st.length) {
  const n = st.pop()!
  for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
  if (n.type !== "compound_statement") continue
  const L1 = n.startPosition.row + 1
  if (L1 < 5520 || L1 > 5560) continue
  let prev = n.previousSibling
  for (let g = 0; prev && g < 2 && (prev.isMissing || prev.type === ";"); g++) prev = prev.previousSibling
  console.log(`\n--- body L${L1}  parent=${n.parent?.type}  prev=${prev?.type} @L${prev ? prev.startPosition.row + 1 : "?"}`)
  if (!prev) continue
  const outer = prev.namedChild(0)
  console.log(`    prev text: ${prev.text.replace(/\s+/g, " ").slice(0, 80)}`)
  if (!outer) continue
  console.log(`    outer=${outer.type}`)
  for (let i = 0; i < outer.childCount; i++) {
    const c = outer.child(i)
    console.log(`      outer[${i}] ${c.type}${c.isError ? " (ERROR)" : ""} named=${c.isNamed} "${c.text.replace(/\s+/g, " ").slice(0, 60)}"`)
  }
}
