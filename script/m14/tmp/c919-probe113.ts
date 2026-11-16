import fs from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-cpp.wasm")))
const parser = new P(); parser.setLanguage(lang)
const F = "<corpus-root>/bb_tests/repositories/nlohmann-json/tests/src/unit-regression1.cpp"
const src = fs.readFileSync(F, "utf8")
const root = parser.parse(src).rootNode
const { macroDeclaredBody } = await import(path.join(ROOT, "src/ast/real-cpp-analyzer.ts"))
const target = 113 // 1-based line
const st: any[] = [root]
while (st.length) {
  const n = st.pop()!
  if (n.startPosition.row + 1 <= target && n.endPosition.row + 1 >= target) {
    const md = macroDeclaredBody(n)
    console.log(`${n.type} [${n.startPosition.row + 1}..${n.endPosition.row + 1}] missing=${n.isMissing} macroDeclaredBody=${!!md}`)
    for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
  }
}
