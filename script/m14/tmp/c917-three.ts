// #917: the 3-argument `S3JniApi(existing(), type, mangled_name)` spelling.
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P()
parser.setLanguage(lang)

const F = "<corpus-root>/bb_tests/repositories/sqlite/ext/jni/src/c/sqlite3-jni.c"
const src = fs.readFileSync(F, "utf8")
const root = parser.parse(src).rootNode
let shown = 0
const st: any[] = [root]
while (st.length && shown < 4) {
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
  const macroArgs = inner.childForFieldName("arguments")
  if (!macroArgs) continue
  const kids = (macroArgs.namedChildren ?? []).map((c: any) => c)
  if (!kids.some((c: any) => c.type === "call_expression")) continue
  shown++
  console.log(`\n--- L${prev.startPosition.row + 1}: ${prev.text.replace(/\s+/g, " ").slice(0, 120)}`)
  for (let i = 0; i < macroArgs.childCount; i++) {
    const c = macroArgs.child(i)
    console.log(`    child[${i}] ${c.type}${c.isError ? " (ERROR)" : ""}${c.isMissing ? " (MISSING)" : ""} "${c.text.replace(/\s+/g, " ")}"  named=${c.isNamed}`)
  }
}
