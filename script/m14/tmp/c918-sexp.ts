// #918: s-expression dumps of the six sites (isolated) — the nesting matters,
// and the flattened pre-order list hid it.
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P()
parser.setLanguage(lang)

const FILE = "<corpus-root>/bb_tests/repositories/sqlite/ext/wasm/libcmpp.c"
const LINES: Array<[number, string]> = [
  [5514, "cmpp_rc_cstr"],
  [5529, "cmpp_mrealloc"],
  [5533, "cmpp_malloc"],
  [6102, "cmpp_dx_delim"],
  [9526, "cmpp_b_reuse"],
  [9714, "cmpp_b_borrow"],
]
const lines = fs.readFileSync(FILE, "utf8").split("\n")

for (const [line, name] of LINES) {
  let end = line
  for (let i = line - 1; i < lines.length; i++) {
    if (lines[i].startsWith("}")) { end = i + 1; break }
  }
  const snippet = lines.slice(line - 1, end).join("\n")
  const tree = parser.parse(snippet)
  console.log(`\n#### ${name} (L${line})`)
  console.log(tree.rootNode.toString())
  // Where is the macro's argument list inside the type?
  const st = [tree.rootNode]
  while (st.length) {
    const n = st.pop()!
    if (n.type === "macro_type_specifier" || n.type === "call_expression" || n.type === "argument_list" || n.type === "expression_statement" || n.type === "declaration" || n.type === "function_definition") {
      const f = n.childForFieldName("function")
      const a = n.childForFieldName("arguments")
      console.log(`   ${n.type}: text=${JSON.stringify(n.text.slice(0, 70))} fn=${f?.type ?? "-"}${f ? ":" + JSON.stringify(f.text.slice(0, 40)) : ""} args=${a?.type ?? "-"}${a ? ":" + JSON.stringify(a.text.slice(0, 40)) : ""} children=[${n.namedChildren.map((c: any) => c.type).join(",")}]`)
    }
    for (let i = n.childCount - 1; i >= 0; i--) st.push(n.child(i))
  }
}
