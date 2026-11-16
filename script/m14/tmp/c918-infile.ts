// #918: the IN-FILE shape at each site (the isolated parse and the file parse
// disagree at 5529, and only the file parse is what the analyzer sees).
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
  [5514, "cmpp_rc_cstr"], [5529, "cmpp_mrealloc"], [5533, "cmpp_malloc"],
  [6102, "cmpp_dx_delim"], [9526, "cmpp_b_reuse"], [9714, "cmpp_b_borrow"],
]
const src = fs.readFileSync(FILE, "utf8")
const root = parser.parse(src).rootNode
const rows = src.split("\n")

function chain(n: any): string {
  const out: string[] = []
  let p = n.parent
  while (p && p.type !== "translation_unit") { out.push(`${p.type}${p.isError ? "(ERR)" : ""}`); p = p.parent }
  return out.join(" < ") || "(root)"
}
function fields(n: any): string {
  const f: string[] = []
  for (const name of ["name", "type", "declarator", "body", "function", "arguments", "parameters", "value"]) {
    const c = n.childForFieldName(name)
    if (c) f.push(`${name}=${c.type}${c.isError ? "(ERR)" : ""}${c.isMissing ? "(MISS)" : ""}:${JSON.stringify(c.text.slice(0, 45))}`)
  }
  return f.join(" ")
}

for (const [line, name] of LINES) {
  // the node whose FIRST line is `line`
  let hit: any = null
  const st = [root]
  while (st.length) {
    const n = st.pop()!
    if (n.startPosition.row + 1 === line && (n.type === "function_definition" || n.type === "declaration" || n.type === "expression_statement" || n.type === "ERROR")) hit = n
    for (let i = n.childCount - 1; i >= 0; i--) st.push(n.child(i))
  }
  // climb to the DECLARATION-SHAPED ancestor that starts on this line — the
  // innermost ERROR starts here too, and the analyzer never sees that one first.
  let cur = hit
  while (cur && !(cur.startPosition.row + 1 === line && (cur.type === "function_definition" || cur.type === "declaration"))) cur = cur.parent
  hit = cur
  console.log(`\n#### ${name} L${line}  src=${JSON.stringify(rows[line - 1].slice(0, 60))}`)
  if (!hit) { console.log("   (no declaration-shaped node starts at this line)"); continue }
  console.log(`   node=${hit.type}${hit.isError ? "(ERR)" : ""} ${fields(hit)}`)
  console.log(`   parent chain: ${chain(hit)}`)
  const kids: string[] = []
  for (let i = 0; i < hit.namedChildCount; i++) {
    const c = hit.namedChild(i)
    kids.push(`${c.type}${c.isError ? "(ERR)" : ""}${c.isMissing ? "(MISS)" : ""}[${JSON.stringify(c.text.slice(0, 50))}]`)
  }
  console.log(`   children: ${kids.join(" | ")}`)
  // next siblings (is there a body/ orphan compound?)
  const sibs: string[] = []
  let s = hit.nextSibling
  for (let i = 0; s && i < 4; i++, s = s.nextSibling) sibs.push(`${s.type}${s.isError ? "(ERR)" : ""}${s.isMissing ? "(MISS)" : ""}[${JSON.stringify(s.text.slice(0, 40))}]`)
  console.log(`   next siblings: ${sibs.join(" | ")}`)
}
