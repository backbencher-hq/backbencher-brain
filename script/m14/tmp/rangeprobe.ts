import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { RealPowershellAnalyzer } from "../../../src/ast/real-powershell-analyzer"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-powershell.wasm"))))
const src = "$xs = 1..3\n"
const tree = parser.parse(src)
console.log("TREE:\n" + tree.rootNode.toString())
const a = new RealPowershellAnalyzer()
const r: any = a.analyze(tree.rootNode, src, "t.ps1")
for (const x of r.relationships) console.log(`REL ${x.kind ?? x.type} ${x.source ?? x.from} -> ${x.target ?? x.to} @${x.line_number} meta=${JSON.stringify(x.metadata ?? {})}`)
