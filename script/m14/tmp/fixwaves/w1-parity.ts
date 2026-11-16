// Parity: analyzer uses vs oracle uses on the chain+bare shape (site-agnostic label+target match).
import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"
import { RealJavaScriptAnalyzer } from "../../../../src/ast/real-javascript-analyzer"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const js = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-javascript.wasm")))
  const mod: any = await import("<corpus-root>/mcp/backbencher-brain/script/m14/differential.ts")
  const src = `const config = { inner: { deeper: { leaf: 1 } } };\nfunction read() {\n  return config.inner.deeper.leaf;\n}\nfunction bare() {\n  return config;\n}\nfunction gated(flag) {\n  if (flag) { config.inner = 1; }\n  return config;\n}\n`
  const p = new P(); p.setLanguage(js)
  const root = p.parse(src).rootNode
  const a = new RealJavaScriptAnalyzer() as any
  const r = await a.analyze(root, src, "T.js", {})
  const an = new Set((r.relationships ?? []).filter((x: any) => x.type === "uses").map((x: any) => x.target))
  const orc = new Set((mod.deriveJavaScriptEdges(root) as any[]).filter((x: any) => x.label === "uses").map((x: any) => x.target))
  console.log("analyzer uses:", [...an].sort().join(", "))
  console.log("oracle   uses:", [...orc].sort().join(", "))
  const onlyA = [...an].filter((x) => !orc.has(x)); const onlyO = [...orc].filter((x) => !an.has(x))
  console.log("analyzer-only:", onlyA.length ? onlyA.join(", ") : "none")
  console.log("oracle-only:", onlyO.length ? onlyO.join(", ") : "none")
}
main()
