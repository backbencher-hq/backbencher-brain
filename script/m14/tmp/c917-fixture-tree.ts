// #917: the fixture's pointer-return and variadic headings, exactly.
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P()
parser.setLanguage(lang)

const TARGETS: Array<[string, number]> = [
  ["validation/m14/fixtures/c/macro-wrapped-heading-917.c", 65],
  ["validation/m14/fixtures/c/macro-wrapped-heading-917.c", 69],
  // the real sites for comparison
  ["/home/ishaq2321/bb_tests/repositories/sqlite/ext/wasm/libcmpp.c", 5529],
  ["/home/ishaq2321/bb_tests/repositories/sqlite/ext/wasm/libcmpp.c", 5514],
]

for (const [F, line] of TARGETS) {
  const src = fs.readFileSync(F, "utf8")
  const root = parser.parse(src).rootNode
  const st: any[] = [root]
  let found: any = null
  while (st.length) {
    const n = st.pop()!
    for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
    if (n.type === "expression_statement" && n.startPosition.row + 1 === line) { found = n; break }
  }
  console.log(`\n--- ${F.split("/").pop()}:${line}  ${found ? "FOUND" : "not found"}`)
  if (!found) continue
  const outer = found.namedChild(0)
  const macro = outer?.childForFieldName?.("function")
  const args = macro?.childForFieldName?.("arguments")
  const params = outer?.childForFieldName?.("arguments")
  for (const [tag, node] of [["macroArgs", args], ["params", params]] as const) {
    if (!node) { console.log(`  ${tag}: (none)`); continue }
    console.log(`  ${tag} "${node.text.replace(/\s+/g, " ")}"`)
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      console.log(`     [${i}] ${c.type}${c.isError ? " (ERROR)" : ""} named=${c.isNamed} "${c.text.replace(/\s+/g, " ")}"`)
    }
  }
}
