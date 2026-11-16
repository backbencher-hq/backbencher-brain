// Does a BARE identifier read (return config;) emit uses? Separate control.
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
  const src = `function bare() {\n  return config;\n}\nlet config = 1;\n`
  const p = new P(); p.setLanguage(js)
  const a = new RealJavaScriptAnalyzer() as any
  const r = await a.analyze(p.parse(src).rootNode, src, "T.js", {})
  console.log("uses:", JSON.stringify((r.relationships ?? []).filter((x: any) => x.type === "uses")))
}
main()
