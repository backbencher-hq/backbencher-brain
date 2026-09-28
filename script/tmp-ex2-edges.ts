// tmp-ex2-edges.ts — dump the actual relationships of named elixir fixtures
// (raw analyzer), for precise expectation re-pinning.
// Usage: bun run script/tmp-ex2-edges.ts fixtureA fixtureB …
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-elixir.wasm")))
const parser = new ParserClass()
parser.setLanguage(g)
const mod: any = await import("../src/ast/real-elixir-analyzer")
const a = new mod.RealElixirAnalyzer()
const DIR = path.join(ROOT, "validation", "m14", "fixtures", "elixir")

for (const n of process.argv.slice(2)) {
  const src = fs.readFileSync(path.join(DIR, n + ".ex"), "utf8")
  const res: any = a.analyze(parser.parse(src).rootNode, src, path.join(DIR, n + ".ex"))
  console.log(`\n### ${n}`)
  for (const r of res.relationships) console.log(`  ${r.source} -[${r.type}]-> ${r.target}`)
}
process.exit(0)
