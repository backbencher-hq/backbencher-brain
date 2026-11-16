// #919: what node STARTS at line 169 of unit-serialization.cpp, and what does
// the analyzer's own heading-text helper make of it?
//   bun script/m14/tmp/c919-h169.ts
import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const file = "<corpus-root>/bb_tests/repositories/nlohmann-json/tests/src/unit-serialization.cpp"
const src = readFileSync(file, "utf8")
const { RealCppAnalyzer } = await import(path.join(ROOT, "src", "ast", "real-cpp-analyzer.ts"))
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-cpp.wasm")))
const parser = new P(); parser.setLanguage(lang)
const root = parser.parse(src).rootNode
const an: any = new RealCppAnalyzer()
const st: any[] = [root]
while (st.length) {
  const n = st.pop()!
  if (n.startPosition.row + 1 === 169 && n.parent) {
    const det = an.getFunctionDetails(n)
    console.log(`node type=${n.type} lines ${n.startPosition.row + 1}..${n.endPosition.row + 1} parent=${n.parent.type}`)
    console.log(`  text head: ${JSON.stringify(n.text.slice(0, 70))}`)
    console.log(`  body field: ${n.childForFieldName("body") ? "YES" : "none"}`)
    console.log(`  details: ${JSON.stringify(det)}  macroShape=${det ? an.isMacroFunctionShape(n, det.name) : "n/a"}`)
    console.log(`  headingText: ${JSON.stringify(an.macroHeadingText(n, src, det?.name))}`)
    const fd = an.findChild(n, "function_declarator")
    console.log(`  findChild(function_declarator): ${fd ? `lines ${fd.startPosition.row + 1}..${fd.endPosition.row + 1} text=${JSON.stringify(fd.text.slice(0, 50))}` : "none"}`)
    const params = fd?.childForFieldName("parameters")
    console.log(`  its parameters: ${params ? `idx ${params.startIndex}..${params.endIndex} lines ${params.startPosition.row + 1}..${params.endPosition.row + 1}` : "none"}`)
  }
  for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
}
