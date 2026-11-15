// #917: every wrapped site in the two files vs the recovered symbols — which
// sites are refused, and why?
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

const FILES = [
  "/home/ishaq2321/bb_tests/repositories/sqlite/ext/wasm/libcmpp.c",
  "/home/ishaq2321/bb_tests/repositories/sqlite/ext/jni/src/c/sqlite3-jni.c",
]

for (const F of FILES) {
  const src = fs.readFileSync(F, "utf8")
  const root = parser.parse(src).rootNode
  const sites: Array<{ line: number; text: string }> = []
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()!
    for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
    if (n.type !== "compound_statement") continue
    let prev = n.previousSibling
    for (let g = 0; prev && g < 2 && (prev.isMissing || prev.type === ";"); g++) prev = prev.previousSibling
    if (!prev || prev.type !== "expression_statement") continue
    const outer = prev.namedChild(0)
    if (!outer || outer.type !== "call_expression") continue
    const inner = outer.childForFieldName("function") ?? outer.namedChild(0)
    if (!inner || inner.type !== "call_expression") continue
    const macro = inner.childForFieldName("function") ?? inner.namedChild(0)
    if (!macro || macro.type !== "identifier") continue
    sites.push({ line: prev.startPosition.row + 1, text: prev.text.replace(/\s+/g, " ").slice(0, 90) })
  }
  const res: any = await parseFile(F, src, { language: "c" })
  const recoveredLines = new Set(
    (res.symbols ?? []).filter((s: any) => s.metadata?.recoveredFromMacroWrappedHeader).map((s: any) => s.range.startLine),
  )
  const refusals = sites.filter((s) => !recoveredLines.has(s.line))
  console.log(`\n#### ${path.basename(F)}  sites=${sites.length} recovered=${recoveredLines.size} refused=${refusals.length}`)
  for (const r of refusals) console.log(`   refused L${r.line}: ${r.text}`)
}
