// M49 W22 (#841): dump the REAL analyzer output for the class-body dot
// continuation fixture, so the expectation is authored from live emission and
// never from memory. Usage: bun script/m14/tmp/w22-fixture-dump.ts
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const FILE = "groovy/class-body-dot-continuation-841.groovy"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-groovy.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  const abs = path.join(ROOT, "validation/m14/fixtures", FILE)
  const content = fs.readFileSync(abs, "utf8")
  const tree = parser.parse(content)
  console.log(`hasError=${tree.rootNode.hasError}`)
  const mod: any = await import(path.join(ROOT, "src/ast/real-groovy-analyzer.ts"))
  const analyzer = new mod.RealGroovyAnalyzer()
  const res: any = await analyzer.analyze(tree.rootNode, content, `fixtures/${FILE}`)
  console.log("--- symbols")
  for (const s of res.symbols ?? []) {
    console.log(`  L${s.range?.startLine}  ${s.name}  kind=${s.kind} owner=${s.ownerName ?? "-"} ownerKind=${s.ownerKind ?? "-"}`)
  }
  console.log("--- relationships")
  for (const r of res.relationships ?? []) {
    const t = String(r.type ?? r.relationshipType)
    console.log(`  L${r.line_number ?? r.line}  ${t}  ${r.source} -> ${r.target ?? r.targetName}  conf=${r.confidence} meta=${JSON.stringify(r.metadata ?? {})}`)
  }
}
main()
