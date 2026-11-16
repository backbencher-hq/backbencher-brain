// Dump the live typescript emission for validation/m14/fixtures/typescript/
// one-line-base-873.ts, so its expectation is authored from measurement.
// Usage: bun script/m14/tmp/w24-ts-fixture-dump.ts
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const FILE = "typescript/one-line-base-873.ts"

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-typescript.wasm")))
  const parser = new P()
  parser.setLanguage(grammar)
  const abs = path.join(ROOT, "validation/m14/fixtures", FILE)
  const content = fs.readFileSync(abs, "utf8")
  const tree = parser.parse(content)
  const mod: any = await import(path.join(ROOT, "src/ast/real-typescript-analyzer.ts"))
  const analyzer = new mod.RealTypeScriptAnalyzer()
  const res: any = await analyzer.analyze(tree.rootNode, content, `fixtures/${FILE}`)
  console.log("symbols:")
  for (const s of res.symbols ?? []) console.log(`  L${s.range?.startLine} ${s.name} kind=${s.kind}`)
  console.log("relationships:")
  for (const r of res.relationships ?? []) {
    const meta = r.metadata ?? {}
    console.log(
      `  L${r.line_number} ${r.type} ${r.source} -> ${r.target} meta.line=${meta.line} ${JSON.stringify(
        Object.fromEntries(Object.entries(meta).filter(([k]) => k !== "line")),
      ).slice(0, 90)}`,
    )
  }
}
main()
