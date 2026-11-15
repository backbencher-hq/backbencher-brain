// M14 SWIFT LANE — export-family defect probe (read-only measurement).
//
// Prints, for the three failing export fixtures, exactly what the production
// analyzer emits: every `exports` / `imports` relationship with full metadata,
// and the ExportInfo LIST rows. This is the measurement the corrected
// expectations are derived FROM THE RULING, not fitted to.
//
// Run: bun run validation/m14/fixtures/swift/m14-swift-export-defect-probe.mts
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../../../..")
const FIX = path.join(ROOT, "validation/m14/fixtures/swift")

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js") as any)
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-swift.wasm")))
const parser = new ParserClass()
parser.setLanguage(grammar)

const mod = await import(path.join(ROOT, "src/ast/real-swift-analyzer.ts"))
const analyzer = new (mod.RealSwiftAnalyzer ?? mod.default)()
const analyzeFn = mod.analyzeSwiftFile ?? mod.defaultAnalyze

for (const base of ["imports-exports", "module-exports", "reexported-import"]) {
  const file = path.join(FIX, `${base}.swift`)
  const content = fs.readFileSync(file, "utf8")
  const tree = parser.parse(content)
  let res: any
  try {
    res = await analyzer.analyze(tree.rootNode, content, `fixtures/swift/${base}.swift`)
  } catch (e: any) {
    console.log(`\n### ${base}: analyze() threw: ${e?.message}`)
    continue
  }
  const rels: any[] = res.relationships ?? []
  console.log(`\n### ${base}.swift — ${rels.length} relationships`)
  for (const r of rels) {
    if (r.type !== "exports" && r.type !== "imports") continue
    console.log(`  ${r.type} [${r.from ?? r.source}] -> ${r.target} @${r.line_number ?? r.line}`)
    console.log(`     metadata = ${JSON.stringify(r.metadata)}`)
  }
  console.log(`  -- exports LIST (${(res.exports ?? []).length}):`)
  for (const e of res.exports ?? []) {
    console.log(`     ${JSON.stringify({ name: e.name, type: e.type, kind: e.kind, visibility: e.visibility, metadata: e.metadata })}`)
  }
  console.log(`  -- imports LIST (${(res.imports ?? []).length}):`)
  for (const i of res.imports ?? []) {
    console.log(`     ${JSON.stringify({ module: i.module, isExternal: i.isExternal, metadata: i.metadata })}`)
  }
}
