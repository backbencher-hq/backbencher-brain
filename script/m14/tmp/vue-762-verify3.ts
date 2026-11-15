// #762 truth-vs-analyzer at the differential matching level (label+target, site-agnostic).
import * as fs from "fs"
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
  const content = fs.readFileSync("script/m14/tmp/v762/probe2.vue", "utf8")
  // Embedded script tree exactly like the sweep's deriveEmbeddedScriptTrees
  const mod: any = await import("../../../script/m14/differential")
  const engine: any = await import("../../../src/ast/engine")
  const r: any = await engine.ASTEngine.parseFile("probe.vue", content)
  const truth: string[] = []
  for (const e of deriveTreeEdges(parser.parse((r as any)._embeddedContent ?? content).rootNode, "typescript")) {
    if (e.label === "calls") truth.push(e.target)
  }
  console.log("truth call targets: " + JSON.stringify([...new Set(truth)]))
}
main().catch((e) => { console.error(e); process.exit(1) })
