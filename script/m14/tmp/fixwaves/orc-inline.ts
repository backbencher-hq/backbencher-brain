import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const js = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-javascript.wasm")))
const mod: any = await import("/home/ishaq2321/mcp/backbencher-brain/script/m14/differential.ts")
const src = "const config = 1;\nfunction read() {\n  return config;\n}\n"
const p2 = new P(); p2.setLanguage(js)
const edges = mod.deriveTreeEdges(p2.parse(src).rootNode, "javascript")
console.log("TOTAL", edges.length)
for (const e of edges.filter((x: any) => x.label === "uses")) console.log("ORACLE_USES", JSON.stringify(e))
