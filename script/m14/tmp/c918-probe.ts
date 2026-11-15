// #918: the pointer-return macro-wrapped headings. Two questions per site:
// (1) what does the grammar hand the analyzer (isolated + in-file), and
// (2) does the production entry extract the definition today?
import fs from "node:fs"
import path from "node:path"
const { parseFile } = await import(path.resolve("src/ast/engine.ts"))

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P()
parser.setLanguage(lang)

const FILE = "/home/ishaq2321/bb_tests/repositories/sqlite/ext/wasm/libcmpp.c"
const LINES: Array<[number, string]> = [
  [5514, "cmpp_rc_cstr"],
  [5529, "cmpp_mrealloc"],
  [5533, "cmpp_malloc"],
  [6102, "cmpp_dx_delim"],
  [9526, "cmpp_b_reuse"],
  [9714, "cmpp_b_borrow"],
]

const src = fs.readFileSync(FILE, "utf8")
const lines = src.split("\n")
const fileTree = parser.parse(src).rootNode

function walk(root: any, fn: (n: any) => void) {
  const st = [root]
  while (st.length) {
    const n = st.pop()!
    fn(n)
    for (let i = n.childCount - 1; i >= 0; i--) st.push(n.child(i))
  }
}

console.log("=== isolated snippets (the heading + its body) ===")
for (const [line, name] of LINES) {
  // heading line through the closing brace of the body (find the matching brace)
  let end = line // 1-based
  for (let i = line - 1; i < lines.length; i++) {
    if (lines[i].startsWith("}")) { end = i + 1; break }
  }
  const snippet = lines.slice(line - 1, end).join("\n")
  const root = parser.parse(snippet).rootNode
  const kids = (root: any) =>
    Array.from({ length: root.childCount }, (_, i) => root.child(i)).map((c: any) => `${c.type}${c.isMissing ? "(MISSING)" : ""}${c.isError ? "(ERR)" : ""}@${c.startPosition.row + 1}:${c.startPosition.column}-${c.endPosition.row + 1}:${c.endPosition.column}`)
  console.log(`\n#### ${name} (file L${line})  ${snippet.split("\n")[0]}`)
  console.log(`  root.hasError=${root.hasError}`)
  console.log(`  root children: ${kids(root).join(" | ")}`)
  for (let i = 0; i < root.childCount; i++) {
    const c = root.child(i)
    if (c.type === "function_definition") {
      const decl = c.childForFieldName("declarator")
      const type = c.childForFieldName("type")
      console.log(`    fn_def.type=${type?.type}:${JSON.stringify(type?.text)}`)
      console.log(`    fn_def.declarator=${decl?.type}${decl?.isError ? "(ERR)" : ""}: ${JSON.stringify(decl?.text?.slice(0, 120))}`)
      const sub: string[] = []
      walk(decl, (n: any) => sub.push(`${n.type}${n.isError ? "(ERR)" : ""}${n.isMissing ? "(MISSING)" : ""}:${JSON.stringify(n.text.slice(0, 40))}`))
      console.log(`    declarator subtree: ${sub.join(" > ")}`)
    }
  }
}

console.log("\n=== in-file: analyzer output at those lines ===")
const res: any = await parseFile(FILE, src, { language: "c" })
const syms = (res.symbols ?? []).filter((s: any) => s.range.startLine >= 5510 && s.range.startLine <= 9720)
const names = new Set((res.symbols ?? []).map((s: any) => s.name))
for (const [line, name] of LINES) {
  const near = syms.filter((s: any) => Math.abs(s.range.startLine - line) <= 6)
  const isSym = names.has(name)
  const defn = (res.symbols ?? []).find((s: any) => s.name === name)
  console.log(`L${line} ${name}: symbol=${isSym ? "YES" : "no"} kind=${defn?.kind ?? "-"} meta=${JSON.stringify(defn?.metadata ?? null)}`)
  for (const s of near) console.log(`      near: ${s.kind} ${s.name} @L${s.range.startLine} ${JSON.stringify(s.metadata ?? null).slice(0, 100)}`)
}

console.log("\n=== in-file: what root-level node covers each heading? ===")
for (const [line, name] of LINES) {
  let hit: any = null
  walk(fileTree, (n: any) => {
    if (n.type === "function_definition" || n.type === "declaration" || n.type === "expression_statement") {
      if (n.startPosition.row + 1 === line) hit = n
    }
  })
  let parent = hit
  while (parent) {
    if (parent.type === "translation_unit" || parent.type === "preproc_ifdef" || parent.isError || parent.type === "ERROR") break
    parent = parent.parent
  }
  console.log(`L${line} ${name}: node=${hit?.type ?? "(none)"} parentChain=${hit ? (() => { const c: string[] = []; let p = hit.parent; while (p && p.type !== "translation_unit") { c.push(`${p.type}${p.isError ? "(ERR)" : ""}`); p = p.parent } return c.join(" < ") || "(root)" })() : "-"}`)
}
