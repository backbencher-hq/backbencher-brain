import { readFileSync } from "node:fs"
import * as path from "node:path"
import { RealProtobufAnalyzer } from "../../../../../src/ast/real-protobuf-analyzer"
const ROOT = process.cwd()
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang: any = await L.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-protobuf.wasm")))
const p = new P(); p.setLanguage(lang)
const a = new RealProtobufAnalyzer()
const f = process.argv[2]
const text = readFileSync(f, "utf8")
const r: any = a.analyze(p.parse(text).rootNode, text, f)
console.log("--- relationships ---")
for (const x of r.relationships) console.log(`  L${x.line_number} ${x.source} -${x.type}-> ${x.target}  ${JSON.stringify(x.metadata)}`)
console.log("--- symbols ---")
for (const s of r.symbols) console.log(`  ${s.metadata?.id}  kind=${s.kind} owner=${s.ownerName ?? "-"}  ${JSON.stringify(s.metadata)}`)
