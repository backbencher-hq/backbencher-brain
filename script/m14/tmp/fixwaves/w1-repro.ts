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
  const src = `const config = { inner: { deeper: { leaf: 1 } } };\nfunction read() {\n  return config.inner.deeper.leaf;\n}\nfunction bare() {\n  return config;\n}\n`
  const p = new P(); p.setLanguage(js)
  const a = new RealJavaScriptAnalyzer() as any
  const r = await a.analyze(p.parse(src).rootNode, src, "T.js", {})
  const uses = (r.relationships ?? []).filter((x: any) => x.type === "uses")
  console.log("uses edges:")
  for (const u of uses) console.log("  " + u.source + " -> " + u.target)
}
main()
