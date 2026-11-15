// B5 cross-kind slot semantics: data members REPLACE accessor slots; accessors MERGE.
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"

import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(require("fs").readFileSync("wasm/tree-sitter-javascript.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const az = new RealJavaScriptAnalyzer()
  const run = (src: string, file: string) => az.analyze(parser.parse(src).rootNode, src, file)
  const kx = "class K1 {\n  get x() { return 1 }\n  x() { return 2 }\n}\n"
  const xk = "class K2 {\n  x() { return 1 }\n  get x() { return 2 }\n}\n"
  const triple = "class K3 {\n  get x() { return 1 }\n  set x(v) {}\n  x() { return 3 }\n}\n"
  const pair = "class K4 {\n  get x() { return 1 }\n  set x(v) {}\n}\n"
  for (const [tag, src] of [["K1 get-then-data (expect ONE x method)", kx], ["K2 data-then-get (expect ONE x property)", xk], ["K3 get+set+data (expect ONE x method)", triple], ["K4 get+set pair (expect TWO x properties)", pair]] as const) {
    const r: any = run(src, "k.js")
    console.log(tag + ": " + JSON.stringify(r.symbols.filter((s: any) => s.name === "x").map((s: any) => ({ kind: s.kind, ak: s.metadata?.accessorKind }))))
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
