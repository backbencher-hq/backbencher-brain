// #916 sub-class D: the JNI function at sqlite3-jni.c:6245 is a clean
// function_definition sibling, and the synthesized shape emits its function —
// so the loss is context-dependent. Printing the node, its children, and the
// analyzer's symbols around it.
import { readFileSync } from "node:fs"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const F = "/home/ishaq2321/bb_tests/repositories/sqlite/ext/jni/src/c/sqlite3-jni.c"
const wts: any = await import("web-tree-sitter")
const P = (wts.Parser ?? wts.default) as any
const L = (wts.Language ?? wts.default?.Language) as any
await P.init({ locateFile: () => `${ROOT}/node_modules/web-tree-sitter/tree-sitter.wasm` })
const lang = await L.load(readFileSync(`${ROOT}/wasm/tree-sitter-c.wasm`))
const parser = new P()
parser.setLanguage(lang)
const src = readFileSync(F, "utf8")
const tree = parser.parse(src)

const show = (m: any) =>
  `${m.type}${m.isMissing ? "[MISSING]" : ""}${m.isError ? "[ERROR]" : ""} @${m.startPosition.row + 1}-${m.endPosition.row + 1} ${JSON.stringify(m.text.length > 60 ? m.text.slice(0, 60) + "…" : m.text)}`

const hits: any[] = []
const walk = (n: any) => {
  if (n.type === "function_definition" && n.startPosition.row + 1 >= 6240 && n.startPosition.row + 1 <= 6250) hits.push(n)
  for (const c of n.children ?? []) walk(c)
}
walk(tree.rootNode)
for (const n of hits) {
  console.log(`\nfunction_definition ${show(n)}`)
  for (const c of n.children ?? []) {
    const fieldEntry = ["type", "declarator", "body"].find(f => n.childForFieldName(f) === c)
    console.log(`   ${"".padEnd(8)}field=${fieldEntry ?? "-"}  ${show(c)}`)
  }
}

const { parseFile } = await import(`${ROOT}/src/ast/engine.ts`)
const res: any = await parseFile(F, src, { language: "c" })
console.log(`\nanalyzer symbols 6230-6290:`)
for (const s of (res.symbols ?? []).filter((s: any) => s.range.startLine >= 6230 && s.range.startLine <= 6290)
  .sort((a: any, b: any) => a.range.startLine - b.range.startLine)) {
  console.log(`   @${s.range.startLine} ${s.kind} ${s.name}`)
}
console.log(`total symbols in file: ${(res.symbols ?? []).length}; last @${Math.max(...(res.symbols ?? []).map((s: any) => s.range.startLine))}`)
