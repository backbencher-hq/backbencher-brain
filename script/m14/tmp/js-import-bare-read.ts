// Does the JS analyzer emit a bare-read Uses for an IMPORT BINDING identifier?
// If yes, every file importing a name falsely reports a read of it — and the
// svelte fixture's uses->Comp is a JS-side artifact, not a svelte defect.
import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
let P: any, LANG: any

async function parsers() {
  const wts: any = await import("web-tree-sitter")
  P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  LANG = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-javascript.wasm")))
}

async function analyze(src: string, name: string) {
  await parsers()
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(src).rootNode
  const a = new RealJavaScriptAnalyzer() as any
  const r = await a.analyze(root, src, name, {})
  console.log(`\n===== ${name} =====`)
  for (const rel of r.relationships ?? []) console.log(`  ${rel.type}  ${rel.source} -> ${rel.target} @${rel.confidence} ${rel.metadata ? JSON.stringify(rel.metadata) : ""}`)
}

async function main() {
  await analyze(`import Comp from "./comp";\nComp();\n`, "a.js")
  await analyze(`import { readFile } from "fs";\nreadFile("x");\n`, "b.js")
  await analyze(`import x, { y } from "./m";\nconsole.log(y);\n`, "c.js")
  await analyze(`const Comp = require("./c");\nComp();\n`, "d.js")
}

main()
