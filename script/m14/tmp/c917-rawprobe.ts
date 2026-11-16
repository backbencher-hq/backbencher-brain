// #917: the LANE calls the analyzer class directly; the production entry is
// parseFile. If their edge sets differ for the same file, the "MISSING=0"
// history and my instrument are measuring different things.
import fs from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const cLang: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
const parser = new P()
parser.setLanguage(cLang)

const src = fs.readFileSync("<corpus-root>/bb_tests/repositories/sqlite/ext/wasm/libcmpp.c", "utf8")
const root = parser.parse(src).rootNode

const { RealCAnalyzer } = await import(path.resolve(ROOT, "src/ast/real-c-analyzer.ts"))
const r: any = await new RealCAnalyzer().analyze(root, src, "ext/wasm/libcmpp.c")
const rels = (r.relationships ?? []).filter((x: any) => String(x.target ?? "").includes("ListType_impl"))
console.log("RAW analyzer rels:", rels.map((x: any) => `${x.line_number}:${x.type}:${x.source}->${x.target}`))
console.log("RAW total rels:", r.relationships?.length, "uses:", (r.relationships ?? []).filter((x: any) => String(x.type) === "uses").length)

const { parseFile } = await import(path.resolve(ROOT, "src/ast/engine.ts"))
const p: any = await parseFile("ext/wasm/libcmpp.c", src, { language: "c" } as any)
const prels = (p.relationships ?? []).filter((x: any) => String(x.target ?? "").includes("ListType_impl"))
console.log("parseFile rels:", prels.map((x: any) => `${x.line_number}:${x.type}:${x.source}->${x.target}`))
console.log("parseFile total rels:", p.relationships?.length, "uses:", (p.relationships ?? []).filter((x: any) => String(x.type) === "uses").length)
