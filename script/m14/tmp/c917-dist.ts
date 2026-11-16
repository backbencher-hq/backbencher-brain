// #917 measurement: how are the wrapped headers distributed in the real files,
// and what does the analyzer currently emit in those regions?
import fs from "node:fs"

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P()
parser.setLanguage(lang)

const FILES = [
  "<corpus-root>/bb_tests/repositories/sqlite/ext/wasm/libcmpp.c",
  "<corpus-root>/bb_tests/repositories/sqlite/ext/jni/src/c/sqlite3-jni.c",
]

// A wrapped header: an expression_statement whose child is a call_expression
// whose callee is itself a call_expression (MACRO(args))(params)
function isWrappedHeader(n: any): any | null {
  if (n.type !== "expression_statement") return null
  let c: any = null
  for (let i = 0; i < n.namedChildCount; i++) {
    const k = n.namedChild(i)
    if (k?.type === "call_expression") { c = k; break }
  }
  if (!c) return null
  const callee = c.childForFieldName?.("function") ?? c.namedChild(0)
  if (!callee || callee.type !== "call_expression") return null
  return { header: c, callee }
}

for (const F of FILES) {
  const src = fs.readFileSync(F, "utf8")
  const tree = parser.parse(src)
  const root = tree.rootNode
  console.log(`\n######## ${F.split("/").pop()}  root.hasError=${root.hasError}`)
  let wrapped = 0
  let fileScope = 0
  let inError = 0
  const bodies: Array<{ line: number; parentType: string; parentSpan: string; prev: string }> = []
  const stack: any[] = [root]
  const errorSpans: Array<{ start: number; end: number; line: number }> = []
  while (stack.length) {
    const n = stack.pop()!
    if (n.isError) errorSpans.push({ start: n.startIndex, end: n.endIndex, line: n.startPosition.row })
    if (n.type === "compound_statement") {
      // Is it a function body? Only if an ancestor is function_definition.
      let anc = n.parent
      let isFnBody = false
      while (anc) { if (anc.type === "function_definition") { isFnBody = true; break } anc = anc.parent }
      if (!isFnBody) {
        const prev = n.previousSibling
        const w = prev ? isWrappedHeader(prev) : null
        if (w) {
          wrapped++
          const p = n.parent
          bodies.push({
            line: n.startPosition.row + 1,
            parentType: p?.type || "?",
            parentSpan: p ? `${p.startPosition.row + 1}-${p.endPosition.row + 1}` : "?",
            prev: `${prev.type} @${prev.startPosition.row + 1}`,
          })
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
  }
  console.log(`wrapped headers with adjacent body: ${wrapped}`)
  for (const b of bodies.slice(0, 8)) console.log(`   body L${b.line}  parent=${b.parentType} [${b.parentSpan}] prev=${b.prev}`)
  if (bodies.length > 8) console.log(`   ... ${bodies.length - 8} more`)
  // ERROR spans that are large
  errorSpans.sort((a, b) => b.end - b.start - (a.end - a.start))
  console.log(`ERROR nodes: ${errorSpans.length}; largest 6 (lines):`)
  for (const e of errorSpans.slice(0, 6)) {
    const lineCount = src.slice(e.start, e.end).split("\n").length
    console.log(`   L${e.line + 1}.. span ${lineCount} lines (${e.end - e.start} bytes)`)
  }
}
