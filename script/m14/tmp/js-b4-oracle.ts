// CONTROL: instance/instance — oracle MUST emit Sub.greet->Base.greet
import { deriveTreeEdges } from "../../../script/m14/differential"

import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(require("fs").readFileSync("wasm/tree-sitter-javascript.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const src = "class Base { greet() {} }\nclass Sub extends Base { greet() {} }\n"
  const edges = deriveTreeEdges(parser.parse(src).rootNode, "javascript")
  console.log("oracle overrides: " + JSON.stringify(edges.filter((e: any) => e.label === "overrides")))
}
main().catch((e) => { console.error(e); process.exit(1) })
