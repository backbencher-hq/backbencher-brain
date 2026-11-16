// Authored-from-emission dump for a single fixture: prints the analyzer's
// symbols and relationships so an expectation file is written from what the
// analyzer DOES, never from what the author remembers it doing. Generic over
// the (fixture, wasm, analyzer) triple so a lane can re-use it.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const FIXTURE = process.argv[2]                             // e.g. groovy/anonymous-body-overrides.groovy
const WASM = process.argv[3] ?? "tree-sitter-groovy.wasm"
const MOD = process.argv[4] ?? "real-groovy-analyzer"
const CLS = process.argv[5] ?? "RealGroovyAnalyzer"
const LABELS = process.argv[6] ? new Set(process.argv[6].split(",")) : null

const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", WASM)))
const abs = path.join(ROOT, "validation/m14/fixtures", FIXTURE)
const content = fs.readFileSync(abs, "utf8")
const parser = new P()
parser.setLanguage(lang)
const tree: any = parser.parse(content)
const mod: any = await import(path.join(ROOT, `src/ast/${MOD}.ts`))
const res: any = await new mod[CLS]().analyze(tree.rootNode, content, `fixtures/${FIXTURE}`)

console.log(`hasError=${tree.rootNode.hasError} symbols=${res.symbols?.length} relationships=${res.relationships?.length}`)
console.log("\n--- SYMBOLS ---")
for (const s of res.symbols ?? []) {
  console.log(`  ${String(s.kind).padEnd(10)} ${String(s.name).padEnd(26)} owner=${s.ownerName ?? "-"}(${s.ownerKind ?? "-"}) line=${s.range?.startLine}`)
}
console.log("\n--- RELATIONSHIPS ---")
for (const r of res.relationships ?? []) {
  if (LABELS && !LABELS.has(String(r.type))) continue
  console.log(`  ${String(r.type).padEnd(14)} ${String(r.source).padEnd(34)} -> ${String(r.target).padEnd(34)} line=${r.line_number} conf=${r.confidence} ${JSON.stringify(r.metadata ?? {})}`)
}
process.exit(0)
