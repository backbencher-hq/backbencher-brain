// #908 fixture: both sides' rows for the new pin (analyzer via the fixture
// runner's own path, oracle via deriveCCalls on the same tree).
import fs from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"
import { deriveCCalls } from "../differential"

const FILE = "validation/m14/fixtures/c/function-like-macro-not-a-binding-908.c"
const src = fs.readFileSync(FILE, "utf8")
const res: any = await ASTEngine.parseFile(FILE, src)
console.log("=== ANALYZER ===")
for (const s of res.symbols ?? []) {
  console.log(`  SYM ${s.kind} ${s.name} @L${s.line_number ?? s.range?.startLine}`)
}
for (const r of res.relationships ?? []) {
  console.log(`  REL ${r.type} ${r.source} -> ${r.target} @L${r.line_number}`)
}

const WTS: any = await import("web-tree-sitter")
const P = WTS.Parser ?? WTS.default ?? WTS
const L = WTS.Language ?? WTS.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P()
parser.setLanguage(lang)
const root = parser.parse(src).rootNode
console.log("=== ORACLE (deriveCCalls) ===")
for (const r of deriveCCalls(root, src)) console.log(`  REL ${r.label} ${r.from} -> ${r.target}`)
