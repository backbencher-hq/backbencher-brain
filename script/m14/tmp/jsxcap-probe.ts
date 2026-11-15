import * as WTS from "web-tree-sitter"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"
async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load("wasm/tree-sitter-javascript.wasm")
  const p = new P()
  p.setLanguage(lang)
  const a = new RealJavaScriptAnalyzer() as any
  for (const n of [50, 300, 900]) {
    const src = `const el = <B />;\n` + `const a = 1;\n`.repeat(n)
    const root = p.parse(src).rootNode
    const r = await a.analyze(root, src, "T.js", undefined)
    console.log(`padlines=${n} fw=` + JSON.stringify((r.metadata as any)?.detectedFrameworks))
  }
}
main()
