import { readFileSync } from "node:fs"
import * as path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await L.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-make.wasm")))
const parser = new P(); parser.setLanguage(g)
const { RealMakefileAnalyzer } = await import(path.join(ROOT, "src/ast/real-makefile-analyzer"))
const an = new RealMakefileAnalyzer()
const file = process.argv[2]
const src = readFileSync(path.join(ROOT, file), "utf8")
const out: any = an.analyze(parser.parse(src).rootNode, src, file)
console.log("SYMBOLS:", out.symbols.map((s: any) => `${s.kind}:${s.name}`).join(" | "))
console.log("KINDS:", [...new Set(out.symbols.map((s: any) => s.kind))].join(","))
console.log("RELS:", out.relationships.length, "TYPES:", [...new Set(out.relationships.map((r: any) => r.type))].join(","))
console.log("META:", JSON.stringify(out.metadata))
