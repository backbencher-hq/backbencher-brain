// #919: the shape of the region that produced `uses|global|events|1252` in
// unit-deserialization.cpp — heading nodes, bodies, and what each predicate says.
//   bun script/m14/tmp/c919-shape2.ts <file> <fromLine> <toLine>
import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-cpp.wasm")))
const parser = new P(); parser.setLanguage(lang)
const file = process.argv[2]
const from = Number(process.argv[3]); const to = Number(process.argv[4])
const src = readFileSync(file, "utf8")
const { macroDeclaredBody, macroInvocationText, RealCppAnalyzer } = await import(path.join(ROOT, "src/ast/real-cpp-analyzer.ts"))
const pred: any = new RealCppAnalyzer()
const root = parser.parse(src).rootNode
const st: any[] = [root]
while (st.length) {
  const n = st.pop()!
  const s = n.startPosition.row + 1, e = n.endPosition.row + 1
  if (e >= from && s <= to) {
    const interesting = ["translation_unit", "namespace_definition", "function_definition", "compound_statement", "expression_statement", "call_expression", "declaration"]
    if (interesting.includes(n.type)) {
      const md = macroDeclaredBody(n)
      const det = n.type === "function_definition" ? pred.getFunctionDetails(n) : null
      const mac = det ? pred.isMacroFunctionShape(n, det.name) : false
      let note = ""
      if (md) note = `macroDeclaredBody name=${JSON.stringify(md.macroName)} text=${JSON.stringify(macroInvocationText(src, md.nameNode.startIndex))}`
      if (det) note += ` funcDetails=${JSON.stringify(det.name)} macroShape=${mac}`
      console.log(`${n.type} [${s}..${e}] children=${n.namedChildCount} ${note}`)
    }
    for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
  }
}
