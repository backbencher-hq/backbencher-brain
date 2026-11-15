import { RealTypeScriptAnalyzer } from "../../../src/ast/real-typescript-analyzer"
import { deriveTreeEdges } from "../../../script/m14/differential"

import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(require("fs").readFileSync("wasm/tree-sitter-typescript.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const az = new RealTypeScriptAnalyzer()
  const dts = 'declare module "lib" {\n  interface Readable { subscribe(fn: () => void): void }\n  interface Spring<T> extends Readable<T> { subscribe(fn: () => void): void }\n}\n'
  const s: any = az.analyze(parser.parse(dts).rootNode, dts, "index.d.ts")
  console.log("analyzer rels: " + JSON.stringify((s.relationships ?? []).map((e: any) => e.type + ":" + e.source + "->" + e.target)))
  const truth = deriveTreeEdges(parser.parse(dts).rootNode, "typescript")
  console.log("truth rels:    " + JSON.stringify(truth.filter((e: any) => e.label !== "calls").map((e: any) => e.label + ":" + e.from + "->" + e.target)))
}
main().catch((e) => { console.error(e); process.exit(1) })
