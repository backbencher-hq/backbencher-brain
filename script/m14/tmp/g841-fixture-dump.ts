// Author a groovy fixture expectation from LIVE emission, never from memory.
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")

async function main() {
  const files = process.argv.slice(2)
  if (files.length === 0) throw new Error("usage: bun script/m14/tmp/g841-fixture-dump.ts <fixture.groovy> [...]")

  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await L.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-groovy.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-groovy-analyzer.ts"))

  for (const rel of files) {
    const src = readFileSync(path.join(ROOT, rel), "utf8")
    const parser = new P()
    parser.setLanguage(grammar)
    const tree = parser.parse(src)
    console.log(`===== ${rel} =====`)
    console.log(`parse errors: ${tree.rootNode.hasError}`)
    const analyzer = new mod.RealGroovyAnalyzer()
    const res = await analyzer.analyze(tree.rootNode, src, path.basename(rel))
    console.log("--- symbols ---")
    for (const s of res.symbols ?? []) console.log(`  ${s.kind}\t${s.ownerName ? s.ownerName + "." : ""}${s.name}`)
    console.log("--- relationships ---")
    for (const r of res.relationships ?? []) console.log(`  ${r.type}\t${r.source} -> ${r.target}${r.line_number !== undefined ? `  line=${r.line_number}` : ""}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
