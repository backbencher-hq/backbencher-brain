import * as fs from "fs"
import * as path from "path"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-javascript.wasm")))
  const p = new P(); p.setLanguage(lang)
  const f = "validation/m14/fixtures/javascript/template-substitution-reads.js"
  const src = fs.readFileSync(f, "utf8")
  const a = new RealJavaScriptAnalyzer() as any
  const r = await a.analyze(p.parse(src).rootNode, src, "template-substitution-reads.js")
  for (const rel of (r.relationships ?? [])) console.log(`${rel.type} ${rel.source}->${rel.target} @${rel.confidence} ${JSON.stringify(rel.metadata ?? {})}`)
}
main()
